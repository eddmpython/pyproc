// pyproc-browser-desktop: starts one browser on a desktop of its own, so none of its windows can take the foreground or
// the keyboard of the desktop the user works on (Windows gives each desktop its own foreground window). The browser
// still has real windows there: it renders, lays out, and answers input the way a headed browser does.
//
// Usage: pyproc-browser-desktop <program> [arguments...]
//
// It creates a fresh desktop in this process's window station and starts the program there with exactly the handles and
// startup information this process was given (standard handles, show state, and the C runtime descriptor table, so a
// DevTools pipe on descriptors 3 and 4 reaches the browser as it would from its launcher). It waits for the program and
// exits with its exit code; it holds the desktop until then, and a process-tree kill of this helper ends the browser
// too. A failure of the helper itself exits with HELPER_FAILED and says why on standard error.
#![cfg(windows)]

use std::ffi::OsString;
use std::io::{self, Write};
use std::os::windows::ffi::OsStrExt;
use std::process;

use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows::Win32::Security::Cryptography::{BCRYPT_USE_SYSTEM_PREFERRED_RNG, BCryptGenRandom};
use windows::Win32::System::StationsAndDesktops::{CloseDesktop, CreateDesktopW, DESKTOP_CONTROL_FLAGS};
use windows::Win32::System::Threading::{
    CreateProcessW, GetExitCodeProcess, GetStartupInfoW, INFINITE, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION,
    STARTF_USESHOWWINDOW, STARTF_USESTDHANDLES, STARTUPINFOW, WaitForSingleObject,
};
use windows::core::{PCWSTR, PWSTR};

// Distinct from what a browser exits with, so the launcher can tell the helper failed before the browser ran.
const HELPER_FAILED: i32 = 0x70D;
// Created with less (only DESKTOP_READOBJECTS), CreateDesktopW fails with ERROR_NOT_ENOUGH_MEMORY on Windows 11.
const DESKTOP_ACCESS: u32 = 0x1000_0000; // GENERIC_ALL

fn main() {
    match run() {
        Ok(code) => process::exit(code as i32),
        Err(error) => {
            let _ = writeln!(io::stderr(), "pyproc browser desktop: {error}");
            process::exit(HELPER_FAILED);
        }
    }
}

fn run() -> Result<u32, String> {
    let mut args = std::env::args_os().skip(1);
    let program = args.next().ok_or("usage: pyproc-browser-desktop <program> [arguments...]")?;
    let mut line = Vec::new();
    quote(&program, &mut line);
    for arg in args {
        line.push(u16::from(b' '));
        quote(&arg, &mut line);
    }
    line.push(0);

    let name = desktop_name()?;
    // SAFETY: `name` is a NUL-terminated UTF-16 string that outlives the call; no device or mode is passed.
    let desktop = unsafe {
        CreateDesktopW(PCWSTR(name.as_ptr()), PCWSTR::null(), None, DESKTOP_CONTROL_FLAGS(0), DESKTOP_ACCESS, None)
    }
    .map_err(|error| format!("cannot create a desktop: {error}"))?;
    let outcome = start(&name, &mut line);
    // SAFETY: the handle came from CreateDesktopW above and is closed once, after the browser is gone.
    let _ = unsafe { CloseDesktop(desktop) };
    outcome
}

/// Start the program on the desktop with this process's own startup handles, and wait for its exit code.
fn start(desktop: &[u16], line: &mut [u16]) -> Result<u32, String> {
    let mut given = STARTUPINFOW { cb: size_of::<STARTUPINFOW>() as u32, ..Default::default() };
    // SAFETY: `given` is a valid, writable STARTUPINFOW of the declared size.
    unsafe { GetStartupInfoW(&mut given) };
    let startup = STARTUPINFOW {
        cb: size_of::<STARTUPINFOW>() as u32,
        lpDesktop: PWSTR(desktop.as_ptr() as *mut u16),
        dwFlags: given.dwFlags & (STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW),
        wShowWindow: given.wShowWindow,
        cbReserved2: given.cbReserved2,
        lpReserved2: given.lpReserved2,
        hStdInput: given.hStdInput,
        hStdOutput: given.hStdOutput,
        hStdError: given.hStdError,
        ..Default::default()
    };
    let mut started = PROCESS_INFORMATION::default();
    // SAFETY: `line` is a writable NUL-terminated command line, `startup` points at buffers that outlive the call, and
    // the handles it names are the ones this process inherited to pass on (bInheritHandles hands them to the browser).
    unsafe {
        CreateProcessW(
            PCWSTR::null(),
            Some(PWSTR(line.as_mut_ptr())),
            None,
            None,
            true,
            PROCESS_CREATION_FLAGS(0),
            None,
            PCWSTR::null(),
            &startup,
            &mut started,
        )
    }
    .map_err(|error| format!("cannot start the browser: {error}"))?;
    // SAFETY: both handles come from CreateProcessW and are waited on and closed exactly once.
    unsafe {
        let _ = CloseHandle(started.hThread);
        let waited = WaitForSingleObject(started.hProcess, INFINITE);
        let mut code = 0u32;
        let read = GetExitCodeProcess(started.hProcess, &mut code);
        let _ = CloseHandle(started.hProcess);
        if waited != WAIT_OBJECT_0 {
            return Err("lost track of the browser process".into());
        }
        read.map_err(|error| format!("cannot read the browser's exit code: {error}"))?;
        Ok(code)
    }
}

/// A desktop name no other running browser uses: `pyproc-browser-` and 16 random hex digits, NUL-terminated.
fn desktop_name() -> Result<Vec<u16>, String> {
    let mut random = [0u8; 8];
    // SAFETY: the buffer is valid for its whole length; the system-preferred generator needs no algorithm handle.
    unsafe { BCryptGenRandom(None, &mut random, BCRYPT_USE_SYSTEM_PREFERRED_RNG) }
        .ok()
        .map_err(|error| format!("cannot draw a desktop name: {error}"))?;
    let hex: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
    Ok(format!("pyproc-browser-{hex}").encode_utf16().chain(Some(0)).collect())
}

/// Append one argument to a command line the way the C runtime (and Chromium) splits it back.
fn quote(arg: &OsString, line: &mut Vec<u16>) {
    let wide: Vec<u16> = arg.encode_wide().collect();
    let plain = !wide.is_empty() && !wide.iter().any(|&unit| matches!(unit, 0x20 | 0x09 | 0x0A | 0x0B | 0x22));
    if plain {
        line.extend_from_slice(&wide);
        return;
    }
    const BACKSLASH: u16 = 0x5C;
    const QUOTE: u16 = 0x22;
    line.push(QUOTE);
    let mut backslashes = 0usize;
    for unit in wide {
        if unit == BACKSLASH {
            backslashes += 1;
            continue;
        }
        let doubled = if unit == QUOTE { backslashes * 2 + 1 } else { backslashes };
        line.extend(std::iter::repeat_n(BACKSLASH, doubled));
        line.push(unit);
        backslashes = 0;
    }
    line.extend(std::iter::repeat_n(BACKSLASH, backslashes * 2));
    line.push(QUOTE);
}

#[cfg(test)]
mod tests {
    use super::quote;
    use std::ffi::OsString;

    fn quoted(arg: &str) -> String {
        let mut line = Vec::new();
        quote(&OsString::from(arg), &mut line);
        String::from_utf16(&line).unwrap()
    }

    #[test]
    fn arguments_come_back_as_the_c_runtime_splits_them() {
        assert_eq!(quoted("--user-data-dir=C:\\Temp\\x"), "--user-data-dir=C:\\Temp\\x");
        assert_eq!(quoted("C:\\Program Files\\Edge\\msedge.exe"), "\"C:\\Program Files\\Edge\\msedge.exe\"");
        assert_eq!(quoted(""), "\"\"");
        assert_eq!(quoted("a \"b\""), "\"a \\\"b\\\"\"");
        assert_eq!(quoted("C:\\dir with space\\"), "\"C:\\dir with space\\\\\"");
        assert_eq!(quoted("data:text/html,<p a='b c'>"), "\"data:text/html,<p a='b c'>\"");
    }
}
