// pyproc-user-browser-host: the native messaging host the user's browser starts for the pyproc User Browser
// extension. It relays length-prefixed JSON frames between the extension (stdin and stdout) and one control host
// connected to a named pipe that only the current Windows user can open, from this machine only. It announces the pipe
// in a rendezvous file under the user's local app data once the extension says which profile it runs in, tells the
// extension when a control host connects (with a fresh connection number) or goes away, and exits when the browser
// closes its stdin. Frames from the extension reach a client only after the extension acknowledged that client's
// connection number, so nothing the extension wrote for an earlier client reaches the next one.
#![cfg(windows)]

use std::ffi::c_void;
use std::fs;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;

use serde_json::{Value, json};
use windows::Win32::Foundation::{
    CloseHandle, ERROR_IO_PENDING, ERROR_PIPE_CONNECTED, HANDLE, HLOCAL, INVALID_HANDLE_VALUE, LocalFree, WAIT_OBJECT_0,
};
use windows::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows::Win32::Security::Cryptography::{BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom};
use windows::Win32::Security::{
    GetTokenInformation, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
};
use windows::Win32::Storage::FileSystem::{
    FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED, PIPE_ACCESS_DUPLEX, ReadFile, WriteFile,
};
use windows::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, GetNamedPipeClientProcessId, PIPE_READMODE_BYTE,
    PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_WAIT,
};
use windows::Win32::System::Threading::{CreateEventW, GetCurrentProcess, OpenProcessToken, WaitForSingleObject};
use windows::core::{HSTRING, PWSTR};

// Chrome sends the host frames up to 64 MiB and accepts frames up to 1 MiB from it.
const MAX_FROM_BROWSER: usize = 64 * 1024 * 1024;
const MAX_TO_BROWSER: usize = 1024 * 1024;
const PIPE_BUFFER: u32 = 64 * 1024;
// A client that stops reading for this long is let go, so the host still notices when the browser closes its stdin.
const WRITE_TIMEOUT_MS: u32 = 10_000;
// Frames the host itself reads are tiny; anything larger is only ever relayed.
const HOST_FRAME_LIMIT: usize = 4096;
const RENDEZVOUS_PROTOCOL: &str = "pyproc.userBrowserHost";

#[derive(Clone, Copy)]
struct Pipe(HANDLE);
// The pipe is opened for overlapped I/O: one thread reads while another writes, each with its own OVERLAPPED.
unsafe impl Send for Pipe {}
unsafe impl Sync for Pipe {}

fn main() {
    if let Err(error) = run() {
        let _ = writeln!(io::stderr(), "pyproc user browser host: {error}");
        process::exit(1);
    }
}

// The connected client's number (0 when none) and the number the extension last acknowledged.
struct Connection {
    current: AtomicU64,
    ready: AtomicU64,
}

fn run() -> io::Result<()> {
    let origin = std::env::args().nth(1).unwrap_or_default();
    let (pipe, pipe_name) = create_pipe()?;
    let connection = Arc::new(Connection { current: AtomicU64::new(0), ready: AtomicU64::new(0) });
    let reader_connection = Arc::clone(&connection);
    let reader_name = pipe_name.clone();
    thread::spawn(move || browser_loop(pipe, reader_connection, reader_name, origin));
    let mut stdout = io::stdout().lock();
    let mut next_number = 0u64;
    loop {
        accept(pipe)?;
        let mut client_pid = 0u32;
        let _ = unsafe { GetNamedPipeClientProcessId(pipe.0, &mut client_pid) };
        next_number += 1;
        connection.current.store(next_number, Ordering::SeqCst);
        write_frame(&mut stdout, &json!({"method": "PyprocUserBrowserHost.clientConnected",
            "params": {"connection": next_number, "clientPid": client_pid}}))?;
        let mut header = [0u8; 4];
        loop {
            if pipe_read_exact(pipe, &mut header).is_err() { break; }
            let length = u32::from_le_bytes(header) as usize;
            if length == 0 || length > MAX_TO_BROWSER { break; }
            let mut payload = vec![0u8; length];
            if pipe_read_exact(pipe, &mut payload).is_err() { break; }
            if serde_json::from_slice::<Value>(&payload).is_err() { break; }
            stdout.write_all(&header)?;
            stdout.write_all(&payload)?;
            stdout.flush()?;
        }
        connection.current.store(0, Ordering::SeqCst);
        write_frame(&mut stdout, &json!({"method": "PyprocUserBrowserHost.clientGone",
            "params": {"connection": next_number}}))?;
        unsafe { let _ = DisconnectNamedPipe(pipe.0); }
    }
}

// Frames from the extension: `hello` names the profile and is answered with the rendezvous file, `ready` acknowledges
// a client's connection number; the rest go to the connected client once the extension acknowledged it, or nowhere.
// A closed stdin means the browser let the host go.
fn browser_loop(pipe: Pipe, connection: Arc<Connection>, pipe_name: String, origin: String) {
    let mut stdin = io::stdin().lock();
    let mut rendezvous: Option<PathBuf> = None;
    loop {
        let frame = match read_frame(&mut stdin, MAX_FROM_BROWSER) {
            Ok(Some(frame)) => frame,
            _ => break,
        };
        if let Some(message) = host_message(&frame) {
            match message["method"].as_str() {
                Some("PyprocUserBrowserHost.hello") if rendezvous.is_none() => {
                    rendezvous = announce(&message["params"], &pipe_name, &origin).ok();
                }
                Some("PyprocUserBrowserHost.ready") => {
                    connection.ready.store(message["params"]["connection"].as_u64().unwrap_or(0), Ordering::SeqCst);
                }
                _ => {}
            }
            continue;
        }
        let current = connection.current.load(Ordering::SeqCst);
        if current != 0 && connection.ready.load(Ordering::SeqCst) == current {
            let mut bytes = (frame.len() as u32).to_le_bytes().to_vec();
            bytes.extend_from_slice(&frame);
            if pipe_write_all(pipe, &bytes).is_err() {
                // A client that does not read is let go; the accept loop reports it gone.
                unsafe { let _ = DisconnectNamedPipe(pipe.0); }
            }
        }
    }
    if let Some(path) = rendezvous { let _ = fs::remove_file(path); }
    process::exit(0);
}

fn host_message(frame: &[u8]) -> Option<Value> {
    if frame.len() > HOST_FRAME_LIMIT { return None; }
    let message = serde_json::from_slice::<Value>(frame).ok()?;
    message["method"].as_str()?.starts_with("PyprocUserBrowserHost.").then_some(message)
}

fn announce(params: &Value, pipe_name: &str, origin: &str) -> io::Result<PathBuf> {
    let profile_id = params["profileId"].as_str().unwrap_or("");
    if profile_id.is_empty() || profile_id.len() > 64
        || !profile_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "profileId is invalid"));
    }
    let root = PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or_else(|| io::Error::other("LOCALAPPDATA is unset"))?)
        .join("pyproc").join("userBrowser").join("hosts");
    fs::create_dir_all(&root)?;
    let path = root.join(format!("{profile_id}.json"));
    let temporary = root.join(format!("{profile_id}.{}.tmp", process::id()));
    let body = json!({
        "protocol": RENDEZVOUS_PROTOCOL, "version": 1, "pipeName": pipe_name, "profileId": profile_id,
        "product": params["product"].as_str().unwrap_or(""), "origin": origin, "pid": process::id(),
    });
    fs::write(&temporary, serde_json::to_vec(&body).map_err(io::Error::other)?)?;
    fs::rename(&temporary, &path)?;
    Ok(path)
}

fn read_frame(reader: &mut impl Read, limit: usize) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; 4];
    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let length = u32::from_le_bytes(header) as usize;
    if length == 0 || length > limit {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "frame length is invalid"));
    }
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn write_frame(writer: &mut impl Write, value: &Value) -> io::Result<()> {
    let bytes = serde_json::to_vec(value).map_err(io::Error::other)?;
    writer.write_all(&(bytes.len() as u32).to_le_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()
}

// One pipe instance under a fresh random name, readable and writable only by the current user, refusing remote clients
// and refusing to open if the name already exists (so nobody can squat it first).
fn create_pipe() -> io::Result<(Pipe, String)> {
    let sddl = HSTRING::from(format!("D:P(A;;GA;;;{})", current_user_sid()?));
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(&sddl, SDDL_REVISION_1, &mut descriptor, None)
            .map_err(io::Error::other)?;
    }
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: false.into(),
    };
    let name = format!(r"\\.\pipe\pyproc-userBrowser-{}", random_hex(16)?);
    let handle = unsafe {
        CreateNamedPipeW(
            &HSTRING::from(name.as_str()),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            PIPE_BUFFER,
            PIPE_BUFFER,
            0,
            Some(&attributes),
        )
    };
    unsafe { let _ = LocalFree(Some(HLOCAL(descriptor.0))); }
    if handle == INVALID_HANDLE_VALUE || handle.is_invalid() {
        return Err(io::Error::last_os_error());
    }
    Ok((Pipe(handle), name))
}

fn current_user_sid() -> io::Result<String> {
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(io::Error::other)?;
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut needed);
        let mut buffer = vec![0u8; needed as usize];
        let result = GetTokenInformation(token, TokenUser, Some(buffer.as_mut_ptr() as *mut c_void), needed,
            &mut needed);
        let _ = CloseHandle(token);
        result.map_err(io::Error::other)?;
        let user = &*(buffer.as_ptr() as *const TOKEN_USER);
        let mut text = PWSTR::null();
        ConvertSidToStringSidW(user.User.Sid, &mut text).map_err(io::Error::other)?;
        let sid = text.to_string().map_err(io::Error::other);
        let _ = LocalFree(Some(HLOCAL(text.0 as *mut c_void)));
        sid
    }
}

fn random_hex(bytes: usize) -> io::Result<String> {
    let mut buffer = vec![0u8; bytes];
    let status = unsafe { BCryptGenRandom(None, &mut buffer, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    if status.is_err() {
        return Err(io::Error::other("system random source failed"));
    }
    Ok(buffer.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn event() -> io::Result<HANDLE> {
    unsafe { CreateEventW(None, true, false, None).map_err(io::Error::other) }
}

fn accept(pipe: Pipe) -> io::Result<()> {
    let signal = event()?;
    let mut overlapped = OVERLAPPED { hEvent: signal, ..Default::default() };
    let outcome = unsafe { ConnectNamedPipe(pipe.0, Some(&mut overlapped)) };
    let result = match outcome {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ERROR_PIPE_CONNECTED.to_hresult() => Ok(()),
        Err(error) if error.code() == ERROR_IO_PENDING.to_hresult() => {
            let mut transferred = 0u32;
            unsafe { GetOverlappedResult(pipe.0, &overlapped, &mut transferred, true) }.map_err(io::Error::other)
        }
        Err(error) => Err(io::Error::other(error)),
    };
    unsafe { let _ = CloseHandle(signal); }
    result
}

fn pipe_read_exact(pipe: Pipe, buffer: &mut [u8]) -> io::Result<()> {
    let signal = event()?;
    let mut filled = 0;
    let mut result = Ok(());
    while filled < buffer.len() {
        let mut overlapped = OVERLAPPED { hEvent: signal, ..Default::default() };
        let mut transferred = 0u32;
        let started = unsafe { ReadFile(pipe.0, Some(&mut buffer[filled..]), None, Some(&mut overlapped)) };
        let done = match started {
            Ok(()) => unsafe { GetOverlappedResult(pipe.0, &overlapped, &mut transferred, true) },
            Err(error) if error.code() == ERROR_IO_PENDING.to_hresult() =>
                unsafe { GetOverlappedResult(pipe.0, &overlapped, &mut transferred, true) },
            Err(error) => Err(error),
        };
        if let Err(error) = done { result = Err(io::Error::other(error)); break; }
        if transferred == 0 { result = Err(io::Error::from(io::ErrorKind::BrokenPipe)); break; }
        filled += transferred as usize;
    }
    unsafe { let _ = CloseHandle(signal); }
    result
}

fn pipe_write_all(pipe: Pipe, buffer: &[u8]) -> io::Result<()> {
    let signal = event()?;
    let mut written = 0;
    let mut result = Ok(());
    while written < buffer.len() {
        let mut overlapped = OVERLAPPED { hEvent: signal, ..Default::default() };
        let mut transferred = 0u32;
        let started = unsafe { WriteFile(pipe.0, Some(&buffer[written..]), None, Some(&mut overlapped)) };
        let done = match started {
            Ok(()) => unsafe { GetOverlappedResult(pipe.0, &overlapped, &mut transferred, true) },
            Err(error) if error.code() == ERROR_IO_PENDING.to_hresult() => {
                if unsafe { WaitForSingleObject(signal, WRITE_TIMEOUT_MS) } != WAIT_OBJECT_0 {
                    // The client stopped reading: cancel the write and wait for the cancellation to land.
                    unsafe { let _ = CancelIoEx(pipe.0, Some(&overlapped)); }
                    let _ = unsafe { GetOverlappedResult(pipe.0, &overlapped, &mut transferred, true) };
                    result = Err(io::Error::from(io::ErrorKind::TimedOut));
                    break;
                }
                unsafe { GetOverlappedResult(pipe.0, &overlapped, &mut transferred, true) }
            }
            Err(error) => Err(error),
        };
        if let Err(error) = done { result = Err(io::Error::other(error)); break; }
        if transferred == 0 { result = Err(io::Error::from(io::ErrorKind::BrokenPipe)); break; }
        written += transferred as usize;
    }
    unsafe { let _ = CloseHandle(signal); }
    result
}
