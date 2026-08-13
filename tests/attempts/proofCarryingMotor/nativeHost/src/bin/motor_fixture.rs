use serde::Serialize;
use std::ptr::null_mut;
use windows::core::w;
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{GetStockObject, WHITE_BRUSH};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::*;

const BUTTON_ID: usize = 1001;
const STATUS_ID: usize = 1002;
const FOCUS_TIMER_ID: usize = 1;

#[derive(Serialize)]
struct Ready {
    #[serde(rename = "processId")]
    process_id: u32,
    #[serde(rename = "windowTitle")]
    window_title: &'static str,
}

unsafe fn force_foreground(hwnd: HWND) {
    let foreground = unsafe { GetForegroundWindow() };
    let foreground_thread = if foreground.0.is_null() { 0 }
        else { unsafe { GetWindowThreadProcessId(foreground, None) } };
    let current_thread = unsafe { GetCurrentThreadId() };
    let attached = foreground_thread != 0 && foreground_thread != current_thread
        && unsafe { AttachThreadInput(current_thread, foreground_thread, true) }.as_bool();
    let _ = unsafe { BringWindowToTop(hwnd) };
    let _ = unsafe { SetForegroundWindow(hwnd) };
    if attached { unsafe { let _ = AttachThreadInput(current_thread, foreground_thread, false); } }
}

unsafe extern "system" fn window_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match message {
        WM_CREATE => {
            unsafe {
                let instance = GetModuleHandleW(None).unwrap_or_default();
                let _ = CreateWindowExW(WINDOW_EX_STYLE::default(), w!("BUTTON"), w!("Save"),
                    WS_CHILD | WS_VISIBLE | WINDOW_STYLE(BS_PUSHBUTTON as u32), 32, 32, 120, 44,
                    Some(hwnd), Some(HMENU(BUTTON_ID as *mut _)), Some(HINSTANCE(instance.0)), None);
                let _ = CreateWindowExW(WINDOW_EX_STYLE::default(), w!("STATIC"), w!("idle"),
                    WS_CHILD | WS_VISIBLE, 32, 94, 240, 32, Some(hwnd),
                    Some(HMENU(STATUS_ID as *mut _)), Some(HINSTANCE(instance.0)), None);
                SetTimer(Some(hwnd), FOCUS_TIMER_ID, 25, None);
            }
            LRESULT(0)
        },
        WM_TIMER if wparam.0 == FOCUS_TIMER_ID => {
            unsafe { force_foreground(hwnd); }
            LRESULT(0)
        },
        WM_COMMAND if (wparam.0 & 0xffff) == BUTTON_ID => {
            unsafe {
                let _ = KillTimer(Some(hwnd), FOCUS_TIMER_ID);
                if let Ok(status) = GetDlgItem(Some(hwnd), STATUS_ID as i32) {
                    let _ = SetWindowTextW(status, w!("saved"));
                }
            }
            LRESULT(0)
        },
        WM_CLOSE => { unsafe { DestroyWindow(hwnd).ok(); } LRESULT(0) },
        WM_DESTROY => { unsafe { PostQuitMessage(0); } LRESULT(0) },
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

fn main() -> windows::core::Result<()> {
    unsafe {
        let duplicate = std::env::args().any(|argument| argument == "--duplicate");
        let instance = GetModuleHandleW(None)?;
        let class = w!("PyProcMotorFixtureWindow");
        let cursor = LoadCursorW(None, IDC_ARROW)?;
        let background = GetStockObject(WHITE_BRUSH);
        RegisterClassW(&WNDCLASSW { lpfnWndProc: Some(window_proc), hInstance: HINSTANCE(instance.0),
            lpszClassName: class, hCursor: cursor, hbrBackground: windows::Win32::Graphics::Gdi::HBRUSH(background.0),
            ..Default::default() });
        let hwnd = CreateWindowExW(WINDOW_EX_STYLE::default(), class, w!("PyProc Motor Fixture"),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE, 100, 100, 420, 220, None, None,
            Some(HINSTANCE(instance.0)), Some(null_mut()))?;
        if duplicate {
            let _ = CreateWindowExW(WINDOW_EX_STYLE::default(), w!("BUTTON"), w!("Save"),
                WS_CHILD | WS_VISIBLE | WINDOW_STYLE(BS_PUSHBUTTON as u32), 180, 32, 120, 44,
                Some(hwnd), Some(HMENU(1003usize as *mut _)), Some(HINSTANCE(instance.0)), None);
        }
        let _ = ShowWindow(hwnd, SW_SHOW);
        force_foreground(hwnd);
        println!("{}", serde_json::to_string(&Ready { process_id: std::process::id(),
            window_title: "PyProc Motor Fixture" }).unwrap());
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
    Ok(())
}
