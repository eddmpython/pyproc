// nativeProbe - attempt 32 probe. Observe one allowed independent Windows window through UI Automation, act on one
// exact semantic target, and enter text through the window's active OS input method with physical-input precedence.
// It is a measurement tool for the attempt, not the product host. Results live in ../README.md.
//
// Usage: pyproc-native-window-probe <command> <json | @file>
// Commands: windows, observe, act, waitWindow, inputMethod, type, click, key, foreground, idle.
// Every command names an exact executable path; acting commands also name an exact window title and the surface
// digest returned by observe. Output is one JSON object on stdout; handles and coordinates are never returned.

#![allow(non_snake_case)]

use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::mem::size_of;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::UI::HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext};
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::System::Ole::{SafeArrayGetElement, SafeArrayGetLBound, SafeArrayGetUBound};
use windows::Win32::System::Variant::{VARENUM, VARIANT, VT_ARRAY, VT_I4};
use windows::Win32::UI::Accessibility::*;
use windows::Win32::UI::Input::Ime::ImmGetDefaultIMEWnd;
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::core::{BOOL, PWSTR};

const MARKER: usize = 0x5059_5052_4f43;
const MAX_ENTITIES: usize = 20000;
const WM_IME_CONTROL: u32 = 0x0283;
const IMC_GETCONVERSIONMODE: usize = 0x0001;
const IMC_SETCONVERSIONMODE: usize = 0x0002;
const IMC_GETOPENSTATUS: usize = 0x0005;
const IME_CMODE_HANGUL: usize = 0x0001;
const KOREAN: usize = 0x0412;
static PHYSICAL: AtomicU64 = AtomicU64::new(0);
static HOOKS: AtomicBool = AtomicBool::new(false);

// 2-set (dubeolsik) keys for the 19 initial, 21 medial and 28 final jamo of a precomposed syllable.
const INITIAL: [&str; 19] = ["r", "R", "s", "e", "E", "f", "a", "q", "Q", "t", "T", "d", "w", "W", "c", "z", "x", "v", "g"];
const MEDIAL: [&str; 21] = [
    "k", "o", "i", "O", "j", "p", "u", "P", "h", "hk", "ho", "hl", "y", "n", "nj", "np", "nl", "b", "m", "ml", "l",
];
const FINAL: [&str; 28] = [
    "", "r", "R", "rt", "s", "sw", "sg", "e", "f", "fr", "fa", "fq", "ft", "fx", "fv", "fg", "a", "q", "qt", "t", "T",
    "d", "w", "c", "z", "x", "v", "g",
];

struct Failure {
    code: &'static str,
    message: String,
    sent: bool,
}

type Outcome<T> = Result<T, Failure>;

fn fail<T>(code: &'static str, message: impl Into<String>) -> Outcome<T> {
    Err(Failure { code, message: message.into(), sent: false })
}

fn failSent<T>(code: &'static str, message: impl Into<String>) -> Outcome<T> {
    Err(Failure { code, message: message.into(), sent: true })
}

fn digest(parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_le_bytes());
        hash.update(part.as_bytes());
    }
    hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn text(input: &Value, key: &str) -> Outcome<String> {
    match input.get(key).and_then(Value::as_str) {
        Some(value) if !value.is_empty() && value.len() <= 4000 => Ok(value.to_string()),
        _ => fail("PROBE_INPUT_INVALID", format!("{key} must be a non-empty string")),
    }
}

#[derive(Clone)]
struct Window {
    hwnd: HWND,
    pid: u32,
    thread: u32,
    title: String,
    class: String,
}

impl Window {
    fn surface(&self) -> String {
        format!("surface:{}", digest(&[&self.pid.to_string(), &(self.hwnd.0 as usize).to_string(), &self.title, &self.class]))
    }
}

fn titleOf(hwnd: HWND) -> String {
    let length = unsafe { GetWindowTextLengthW(hwnd) };
    if length <= 0 {
        return String::new();
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..copied.max(0) as usize])
}

fn classOf(hwnd: HWND) -> String {
    let mut buffer = [0u16; 256];
    let copied = unsafe { GetClassNameW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..copied.max(0) as usize])
}

fn processPath(pid: u32) -> Option<String> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    let result = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut length) };
    let _ = unsafe { CloseHandle(process) };
    result.ok()?;
    Some(String::from_utf16_lossy(&buffer[..length as usize]))
}

fn samePath(left: &str, right: &str) -> bool {
    left.replace('/', "\\").to_lowercase() == right.replace('/', "\\").to_lowercase()
}

unsafe extern "system" fn collectWindow(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if unsafe { IsWindowVisible(hwnd) }.as_bool() {
        let found = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
        found.push(hwnd);
    }
    true.into()
}

fn windowsOf(executable: &str) -> Outcome<Vec<Window>> {
    let mut handles = Vec::new();
    unsafe { EnumWindows(Some(collectWindow), LPARAM(&mut handles as *mut _ as isize)) }
        .map_err(|error| Failure { code: "PROBE_WINDOW_ENUM", message: error.to_string(), sent: false })?;
    let mut result = Vec::new();
    for hwnd in handles {
        let mut pid = 0u32;
        let thread = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 || !processPath(pid).is_some_and(|path| samePath(&path, executable)) {
            continue;
        }
        result.push(Window { hwnd, pid, thread, title: titleOf(hwnd), class: classOf(hwnd) });
    }
    Ok(result)
}

fn exactWindow(input: &Value) -> Outcome<Window> {
    let executable = text(input, "executablePath")?;
    let title = text(input, "windowTitle")?;
    let matches: Vec<Window> = windowsOf(&executable)?.into_iter().filter(|window| window.title == title).collect();
    if matches.len() != 1 {
        return fail(
            if matches.len() > 1 { "PROBE_WINDOW_AMBIGUOUS" } else { "PROBE_WINDOW_STALE" },
            format!("exact executable and title fence requires one window, found {}", matches.len()),
        );
    }
    let window = matches.into_iter().next().unwrap();
    if let Some(expected) = input.get("surface").and_then(Value::as_str) {
        if expected != window.surface() {
            return fail("PROBE_SURFACE_STALE", "the window surface changed since observation");
        }
    }
    Ok(window)
}

const ROLES: [(UIA_CONTROLTYPE_ID, &str); 37] = [
    (UIA_ButtonControlTypeId, "button"),
    (UIA_CheckBoxControlTypeId, "checkbox"),
    (UIA_RadioButtonControlTypeId, "radio"),
    (UIA_EditControlTypeId, "textbox"),
    (UIA_ComboBoxControlTypeId, "combobox"),
    (UIA_ListControlTypeId, "list"),
    (UIA_ListItemControlTypeId, "listitem"),
    (UIA_TreeControlTypeId, "tree"),
    (UIA_TreeItemControlTypeId, "treeitem"),
    (UIA_TextControlTypeId, "text"),
    (UIA_SliderControlTypeId, "slider"),
    (UIA_DocumentControlTypeId, "document"),
    (UIA_HyperlinkControlTypeId, "link"),
    (UIA_GroupControlTypeId, "group"),
    (UIA_PaneControlTypeId, "pane"),
    (UIA_WindowControlTypeId, "window"),
    (UIA_MenuItemControlTypeId, "menuitem"),
    (UIA_MenuControlTypeId, "menu"),
    (UIA_MenuBarControlTypeId, "menubar"),
    (UIA_ImageControlTypeId, "image"),
    (UIA_TabControlTypeId, "tablist"),
    (UIA_TabItemControlTypeId, "tab"),
    (UIA_ToolBarControlTypeId, "toolbar"),
    (UIA_SplitButtonControlTypeId, "splitbutton"),
    (UIA_HeaderControlTypeId, "header"),
    (UIA_HeaderItemControlTypeId, "columnheader"),
    (UIA_DataItemControlTypeId, "row"),
    (UIA_DataGridControlTypeId, "grid"),
    (UIA_TableControlTypeId, "table"),
    (UIA_TitleBarControlTypeId, "titlebar"),
    (UIA_ScrollBarControlTypeId, "scrollbar"),
    (UIA_StatusBarControlTypeId, "status"),
    (UIA_ProgressBarControlTypeId, "progressbar"),
    (UIA_SpinnerControlTypeId, "spinbutton"),
    (UIA_SeparatorControlTypeId, "separator"),
    (UIA_ToolTipControlTypeId, "tooltip"),
    (UIA_CustomControlTypeId, "custom"),
];

fn roleOf(id: UIA_CONTROLTYPE_ID) -> &'static str {
    ROLES.iter().find(|(known, _)| *known == id).map(|(_, role)| *role).unwrap_or("unknown")
}

fn controlTypeOf(role: &str) -> Outcome<UIA_CONTROLTYPE_ID> {
    match ROLES.iter().find(|(_, known)| *known == role) {
        Some((id, _)) => Ok(*id),
        None => fail("PROBE_INPUT_INVALID", format!("unknown role {role}")),
    }
}

struct Entity {
    element: IUIAutomationElement,
    role: &'static str,
    name: String,
    automationId: String,
    enabled: bool,
    focused: bool,
    intents: Vec<&'static str>,
    value: Option<String>,
}

fn uia<T>(result: windows::core::Result<T>) -> Outcome<T> {
    result.map_err(|error| Failure { code: "PROBE_UIA_UNAVAILABLE", message: error.to_string(), sent: false })
}

fn automation() -> Outcome<IUIAutomation> {
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    uia(unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) })
}

// One cross-process round trip per query: the provider evaluates the condition and returns cached properties.
const CACHED: [UIA_PROPERTY_ID; 13] = [
    UIA_RuntimeIdPropertyId,
    UIA_NamePropertyId,
    UIA_ControlTypePropertyId,
    UIA_AutomationIdPropertyId,
    UIA_IsEnabledPropertyId,
    UIA_HasKeyboardFocusPropertyId,
    UIA_IsKeyboardFocusablePropertyId,
    UIA_IsPasswordPropertyId,
    UIA_IsInvokePatternAvailablePropertyId,
    UIA_IsValuePatternAvailablePropertyId,
    UIA_IsTogglePatternAvailablePropertyId,
    UIA_IsSelectionItemPatternAvailablePropertyId,
    UIA_IsExpandCollapsePatternAvailablePropertyId,
];

// Chromium answers a descendant query with the same element many times; the runtime id is its identity.
fn runtimeKey(element: &IUIAutomationElement) -> String {
    let Ok(value) = (unsafe { element.GetCachedPropertyValue(UIA_RuntimeIdPropertyId) }) else { return String::new() };
    unsafe {
        let inner = &value.Anonymous.Anonymous;
        if inner.vt != VARENUM(VT_ARRAY.0 | VT_I4.0) || inner.Anonymous.parray.is_null() {
            return String::new();
        }
        let array = inner.Anonymous.parray;
        let lower = SafeArrayGetLBound(array, 1).unwrap_or(0);
        let upper = SafeArrayGetUBound(array, 1).unwrap_or(-1);
        let mut parts = Vec::new();
        for index in lower..=upper {
            let mut item = 0i32;
            if SafeArrayGetElement(array, &index, &mut item as *mut i32 as *mut core::ffi::c_void).is_ok() {
                parts.push(item.to_string());
            }
        }
        parts.join(".")
    }
}

fn cachedFlag(element: &IUIAutomationElement, property: UIA_PROPERTY_ID) -> bool {
    unsafe { element.GetCachedPropertyValue(property) }.ok().and_then(|value| bool::try_from(&value).ok()).unwrap_or(false)
}

fn entityOf(element: IUIAutomationElement) -> Entity {
    let role = roleOf(unsafe { element.CachedControlType() }.unwrap_or_default());
    let name = unsafe { element.CachedName() }.map(|value| value.to_string()).unwrap_or_default();
    let automationId = unsafe { element.CachedAutomationId() }.map(|value| value.to_string()).unwrap_or_default();
    let enabled = cachedFlag(&element, UIA_IsEnabledPropertyId);
    let focused = cachedFlag(&element, UIA_HasKeyboardFocusPropertyId);
    let mut intents = Vec::new();
    if cachedFlag(&element, UIA_IsInvokePatternAvailablePropertyId) {
        intents.push("activate");
    }
    let hasValue = cachedFlag(&element, UIA_IsValuePatternAvailablePropertyId);
    if hasValue {
        intents.push("setValue");
    }
    if cachedFlag(&element, UIA_IsTogglePatternAvailablePropertyId)
        || cachedFlag(&element, UIA_IsSelectionItemPatternAvailablePropertyId)
    {
        intents.push("setSelected");
    }
    if cachedFlag(&element, UIA_IsExpandCollapsePatternAvailablePropertyId) {
        intents.push("setExpanded");
    }
    if cachedFlag(&element, UIA_IsKeyboardFocusablePropertyId) {
        intents.push("focus");
    }
    let readable = hasValue && matches!(role, "textbox" | "combobox" | "document");
    let value = if readable && !cachedFlag(&element, UIA_IsPasswordPropertyId) {
        unsafe { element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) }
            .ok()
            .and_then(|pattern| unsafe { pattern.CurrentValue() }.ok())
            .map(|text| text.to_string().chars().take(2000).collect())
    } else {
        None
    };
    Entity { element, role, name, automationId, enabled, focused, intents, value }
}

fn find(automation: &IUIAutomation, window: &Window, condition: &IUIAutomationCondition) -> Outcome<(Vec<Entity>, usize, bool)> {
    let root = uia(unsafe { automation.ElementFromHandle(window.hwnd) })?;
    let request = uia(unsafe { automation.CreateCacheRequest() })?;
    for property in CACHED {
        uia(unsafe { request.AddProperty(property) })?;
    }
    let array = uia(unsafe { root.FindAllBuildCache(TreeScope_Descendants, condition, &request) })?;
    let reported = unsafe { array.Length() }.unwrap_or(0).max(0) as usize;
    let mut seen = std::collections::HashSet::new();
    let mut entities = Vec::new();
    for index in 0..reported {
        if let Ok(element) = unsafe { array.GetElement(index as i32) } {
            let key = runtimeKey(&element);
            if key.is_empty() || !seen.insert(key) {
                continue;
            }
            if entities.len() == MAX_ENTITIES {
                return Ok((entities, seen.len(), true));
            }
            entities.push(entityOf(element));
        }
    }
    Ok((entities, seen.len(), false))
}

fn property(automation: &IUIAutomation, id: UIA_PROPERTY_ID, value: VARIANT) -> Outcome<IUIAutomationCondition> {
    uia(unsafe { automation.CreatePropertyCondition(id, &value) })
}

fn exactTarget(automation: &IUIAutomation, window: &Window, input: &Value) -> Outcome<Entity> {
    let target = input.get("target").ok_or_else(|| Failure {
        code: "PROBE_INPUT_INVALID",
        message: "target is required".into(),
        sent: false,
    })?;
    let role = text(target, "role")?;
    let name = target.get("name").and_then(Value::as_str).unwrap_or("").to_string();
    let typed = property(automation, UIA_ControlTypePropertyId, VARIANT::from(controlTypeOf(&role)?.0))?;
    let named = property(automation, UIA_NamePropertyId, VARIANT::from(name.as_str()))?;
    let mut condition = uia(unsafe { automation.CreateAndCondition(&typed, &named) })?;
    if let Some(automationId) = target.get("automationId").and_then(Value::as_str) {
        let identity = property(automation, UIA_AutomationIdPropertyId, VARIANT::from(automationId))?;
        condition = uia(unsafe { automation.CreateAndCondition(&condition, &identity) })?;
    }
    let (entities, _, truncated) = find(automation, window, &condition)?;
    if truncated {
        return fail("PROBE_PERCEPTION_INCOMPLETE", "the target query exceeded the probe budget");
    }
    let mut matches: Vec<Entity> = entities.into_iter().filter(|entity| entity.enabled).collect();
    if matches.len() != 1 {
        return fail(
            if matches.len() > 1 { "PROBE_TARGET_AMBIGUOUS" } else { "PROBE_TARGET_STALE" },
            format!("exact semantic target requires one enabled candidate, found {}", matches.len()),
        );
    }
    Ok(matches.remove(0))
}

fn entityJson(window: &Window, entity: &Entity, ordinal: usize) -> Value {
    let reference = digest(&[&window.surface(), entity.role, &entity.name, &entity.automationId, &ordinal.to_string()]);
    let mut value = json!({
        "entityRef": format!("native:{}", &reference[..32]),
        "role": entity.role,
        "name": entity.name,
        "enabled": entity.enabled,
        "focused": entity.focused,
        "intents": entity.intents,
    });
    if !entity.automationId.is_empty() {
        value["automationId"] = json!(entity.automationId);
    }
    if let Some(text) = &entity.value {
        value["value"] = json!(text);
    }
    value
}

fn observe(input: &Value) -> Outcome<Value> {
    let window = exactWindow(input)?;
    let automation = automation()?;
    let roles: Vec<String> = input
        .get("roles")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    let mut condition = uia(unsafe { automation.CreateFalseCondition() })?;
    if roles.is_empty() {
        condition = uia(unsafe { automation.CreateTrueCondition() })?;
    }
    for role in roles.iter().filter(|role| role.as_str() != "none") {
        let typed = property(&automation, UIA_ControlTypePropertyId, VARIANT::from(controlTypeOf(role)?.0))?;
        condition = uia(unsafe { automation.CreateOrCondition(&condition, &typed) })?;
    }
    let (entities, total, truncated) = find(&automation, &window, &condition)?;
    let mut ordinals = std::collections::HashMap::new();
    let mut projected = Vec::new();
    for entity in &entities {
        let key = (entity.role, entity.name.clone(), entity.automationId.clone());
        let ordinal = ordinals.entry(key).and_modify(|count| *count += 1).or_insert(0usize);
        projected.push(entityJson(&window, entity, *ordinal));
    }
    Ok(json!({
        "surface": window.surface(),
        "title": window.title,
        "foreground": unsafe { GetForegroundWindow() } == window.hwnd,
        "inventory": { "matched": total, "complete": !truncated, "projected": projected.len() },
        "entities": projected,
    }))
}

fn listWindows(input: &Value) -> Outcome<Value> {
    let executable = text(input, "executablePath")?;
    let found: Vec<Value> = windowsOf(&executable)?
        .iter()
        .filter(|window| !window.title.is_empty())
        .map(|window| json!({ "title": window.title, "surface": window.surface(),
            "foreground": unsafe { GetForegroundWindow() } == window.hwnd }))
        .collect();
    Ok(json!({ "windows": found }))
}

fn waitWindow(input: &Value) -> Outcome<Value> {
    let timeout = input.get("timeoutMs").and_then(Value::as_u64).unwrap_or(10000).min(60000);
    let started = Instant::now();
    loop {
        match exactWindow(input) {
            Ok(window) => {
                return Ok(json!({ "surface": window.surface(), "title": window.title,
                    "foreground": unsafe { GetForegroundWindow() } == window.hwnd,
                    "waitedMs": started.elapsed().as_millis() as u64 }));
            }
            Err(error) if error.code == "PROBE_WINDOW_STALE" && started.elapsed().as_millis() < timeout as u128 => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error),
        }
    }
}

fn act(input: &Value) -> Outcome<Value> {
    let window = exactWindow(input)?;
    if input.get("surface").is_none() {
        return fail("PROBE_INPUT_INVALID", "act requires the observed surface");
    }
    let automation = automation()?;
    let entity = exactTarget(&automation, &window, input)?;
    let intent = text(input, "intent")?;
    if !entity.intents.contains(&intent.as_str()) {
        return fail("PROBE_PATTERN_UNAVAILABLE", format!("{intent} is not supported by the target"));
    }
    let rejected = |error: windows::core::Error| Failure { code: "PROBE_EFFECT_REJECTED", message: error.to_string(), sent: true };
    match intent.as_str() {
        "setValue" => {
            let value = input.get("value").and_then(Value::as_str).ok_or_else(|| Failure {
                code: "PROBE_INPUT_INVALID",
                message: "setValue requires value".into(),
                sent: false,
            })?;
            let pattern = unsafe { entity.element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) }
                .map_err(|error| Failure { code: "PROBE_PATTERN_UNAVAILABLE", message: error.to_string(), sent: false })?;
            unsafe { pattern.SetValue(&windows::core::BSTR::from(value)) }.map_err(rejected)?;
            let observed = unsafe { pattern.CurrentValue() }.map(|text| text.to_string()).unwrap_or_default();
            Ok(json!({ "terminal": if observed == value { "confirmed" } else { "contradicted" },
                "postcondition": { "valueMatches": observed == value } }))
        }
        "activate" => {
            let pattern = unsafe { entity.element.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) }
                .map_err(|error| Failure { code: "PROBE_PATTERN_UNAVAILABLE", message: error.to_string(), sent: false })?;
            unsafe { pattern.Invoke() }.map_err(rejected)?;
            let mut closed = false;
            if input.get("expectClosed").and_then(Value::as_bool) == Some(true) {
                for _ in 0..100 {
                    if exactWindow(&json!({ "executablePath": input["executablePath"], "windowTitle": input["windowTitle"] }))
                        .is_err_and(|error| error.code == "PROBE_WINDOW_STALE")
                    {
                        closed = true;
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                return Ok(json!({ "terminal": if closed { "confirmed" } else { "notObserved" },
                    "postcondition": { "windowClosed": closed } }));
            }
            Ok(json!({ "terminal": "notObserved", "postcondition": {} }))
        }
        "focus" => {
            unsafe { entity.element.SetFocus() }.map_err(rejected)?;
            let focused = unsafe { entity.element.CurrentHasKeyboardFocus() }.is_ok_and(|value| value.as_bool());
            Ok(json!({ "terminal": if focused { "confirmed" } else { "notObserved" }, "postcondition": { "focused": focused } }))
        }
        _ => fail("PROBE_INTENT_UNSUPPORTED", "intent must be setValue, activate or focus"),
    }
}

unsafe extern "system" fn keyboardHook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if !event.flags.contains(LLKHF_INJECTED) && event.dwExtraInfo != MARKER {
            PHYSICAL.fetch_add(1, Ordering::SeqCst);
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn mouseHook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let event = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        if event.flags & LLMHF_INJECTED == 0 && event.dwExtraInfo != MARKER {
            PHYSICAL.fetch_add(1, Ordering::SeqCst);
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn watchPhysicalInput() -> Outcome<u64> {
    thread::spawn(|| unsafe {
        let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboardHook), None, 0);
        let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouseHook), None, 0);
        if keyboard.is_err() || mouse.is_err() {
            return;
        }
        HOOKS.store(true, Ordering::SeqCst);
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    });
    for _ in 0..200 {
        if HOOKS.load(Ordering::SeqCst) {
            return Ok(PHYSICAL.load(Ordering::SeqCst));
        }
        thread::sleep(Duration::from_millis(5));
    }
    fail("PROBE_INPUT_OBSERVER_UNAVAILABLE", "physical input observer did not start")
}

fn keyInput(vk: u16, up: bool) -> INPUT {
    let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16;
    let flags = if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) };
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: MARKER } },
    }
}

fn mouseInput(x: i32, y: i32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: x, dy: y, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: MARKER } },
    }
}

struct Fence {
    window: Window,
    epoch: u64,
}

impl Fence {
    fn check(&self) -> Outcome<()> {
        if PHYSICAL.load(Ordering::SeqCst) != self.epoch {
            return failSent("PROBE_USER_PREEMPTED", "physical user input arrived; the probe stopped sending");
        }
        if unsafe { GetForegroundWindow() } != self.window.hwnd {
            return failSent("PROBE_FOREGROUND_LOST", "the fenced window lost the foreground");
        }
        Ok(())
    }

    fn send(&self, inputs: &[INPUT]) -> Outcome<()> {
        self.check()?;
        let sent = unsafe { SendInput(inputs, size_of::<INPUT>() as i32) };
        if sent != inputs.len() as u32 {
            return failSent("PROBE_OS_INPUT_REJECTED", "SendInput did not accept the complete gesture");
        }
        Ok(())
    }

    fn chord(&self, modifiers: &[u16], vk: u16) -> Outcome<()> {
        let mut inputs = Vec::new();
        for modifier in modifiers {
            inputs.push(keyInput(*modifier, false));
        }
        inputs.push(keyInput(vk, false));
        inputs.push(keyInput(vk, true));
        for modifier in modifiers.iter().rev() {
            inputs.push(keyInput(*modifier, true));
        }
        self.send(&inputs)
    }
}

fn foregroundFence(input: &Value) -> Outcome<Fence> {
    let window = exactWindow(input)?;
    if input.get("surface").is_none() {
        return fail("PROBE_INPUT_INVALID", "physical input requires the observed surface");
    }
    let epoch = watchPhysicalInput()?;
    let fence = Fence { window, epoch };
    if unsafe { GetForegroundWindow() } != fence.window.hwnd {
        return fail("PROBE_FOREGROUND_MISMATCH", "the fenced window is not in the foreground");
    }
    Ok(fence)
}

struct InputMethod {
    imeWindow: HWND,
    layout: usize,
}

impl InputMethod {
    fn of(window: &Window) -> Outcome<Self> {
        let mut info = GUITHREADINFO { cbSize: size_of::<GUITHREADINFO>() as u32, ..Default::default() };
        let focus = if unsafe { GetGUIThreadInfo(window.thread, &mut info) }.is_ok() && !info.hwndFocus.0.is_null() {
            info.hwndFocus
        } else {
            window.hwnd
        };
        let imeWindow = unsafe { ImmGetDefaultIMEWnd(focus) };
        if imeWindow.0.is_null() {
            return fail("PROBE_INPUT_METHOD_UNAVAILABLE", "the window thread has no input method context");
        }
        let layout = unsafe { GetKeyboardLayout(window.thread) }.0 as usize & 0xffff;
        Ok(Self { imeWindow, layout })
    }

    fn control(&self, command: usize, value: isize) -> Outcome<usize> {
        let mut result = 0usize;
        let sent = unsafe {
            SendMessageTimeoutW(self.imeWindow, WM_IME_CONTROL, WPARAM(command), LPARAM(value), SMTO_ABORTIFHUNG, 1000, Some(&mut result))
        };
        if sent.0 == 0 {
            return fail("PROBE_INPUT_METHOD_UNRESPONSIVE", "the input method window did not answer");
        }
        Ok(result)
    }

    fn state(&self) -> Outcome<Value> {
        let open = self.control(IMC_GETOPENSTATUS, 0)?;
        let mode = self.control(IMC_GETCONVERSIONMODE, 0)?;
        Ok(json!({ "layout": format!("{:04x}", self.layout), "open": open != 0, "conversionMode": mode,
            "hangul": mode & IME_CMODE_HANGUL != 0 }))
    }

    fn hangul(&self, wanted: bool) -> Outcome<()> {
        let mode = self.control(IMC_GETCONVERSIONMODE, 0)?;
        if (mode & IME_CMODE_HANGUL != 0) == wanted {
            return Ok(());
        }
        let next = if wanted { mode | IME_CMODE_HANGUL } else { mode & !IME_CMODE_HANGUL };
        self.control(IMC_SETCONVERSIONMODE, next as isize)?;
        let observed = self.control(IMC_GETCONVERSIONMODE, 0)?;
        if (observed & IME_CMODE_HANGUL != 0) != wanted {
            return fail("PROBE_INPUT_METHOD_MODE", "the input method did not accept the requested conversion mode");
        }
        Ok(())
    }
}

fn inputMethod(input: &Value) -> Outcome<Value> {
    let window = exactWindow(input)?;
    let method = InputMethod::of(&window)?;
    if let Some(mode) = input.get("setHangul").and_then(Value::as_bool) {
        method.hangul(mode)?;
    }
    let mut state = method.state()?;
    state["foreground"] = json!(unsafe { GetForegroundWindow() } == window.hwnd);
    Ok(state)
}

enum Stroke {
    Hangul(Vec<(u16, bool)>),
    Latin(u16, bool),
    Plain(u16, bool),
}

fn letterKey(letter: char) -> (u16, bool) {
    (letter.to_ascii_uppercase() as u16, letter.is_ascii_uppercase())
}

fn strokes(text: &str, layout: HKL) -> Outcome<Vec<Stroke>> {
    let mut result = Vec::new();
    for character in text.chars() {
        let code = character as u32;
        if (0xac00..=0xd7a3).contains(&code) {
            let index = (code - 0xac00) as usize;
            let keys = [INITIAL[index / 588], MEDIAL[(index % 588) / 28], FINAL[index % 28]].concat();
            result.push(Stroke::Hangul(keys.chars().map(letterKey).collect()));
        } else if character == '\n' {
            result.push(Stroke::Plain(VK_RETURN.0, false));
        } else if character.is_ascii_alphabetic() {
            let (vk, shift) = letterKey(character);
            result.push(Stroke::Latin(vk, shift));
        } else if character.is_ascii() && !character.is_ascii_control() {
            let scanned = unsafe { VkKeyScanExW(code as u16, layout) };
            if scanned == -1 || (scanned >> 8) & 0b110 != 0 {
                return fail("PROBE_CHARACTER_UNSUPPORTED", format!("U+{code:04X} has no plain key on this layout"));
            }
            result.push(Stroke::Plain((scanned & 0xff) as u16, (scanned >> 8) & 1 == 1));
        } else {
            return fail("PROBE_CHARACTER_UNSUPPORTED", format!("U+{code:04X} is outside the probe text alphabet"));
        }
    }
    Ok(result)
}

fn typeText(input: &Value) -> Outcome<Value> {
    let value = input.get("text").and_then(Value::as_str).filter(|value| !value.is_empty() && value.chars().count() <= 500)
        .ok_or_else(|| Failure { code: "PROBE_INPUT_INVALID", message: "text must have 1 to 500 characters".into(), sent: false })?;
    let delay = Duration::from_millis(input.get("keyDelayMs").and_then(Value::as_u64).unwrap_or(35).clamp(10, 500));
    let fence = foregroundFence(input)?;
    let automation = automation()?;
    if input.get("target").is_some() {
        let entity = exactTarget(&automation, &fence.window, input)?;
        if !entity.focused {
            return fail("PROBE_TARGET_NOT_FOCUSED", "the exact target does not hold keyboard focus");
        }
    }
    let method = InputMethod::of(&fence.window)?;
    let layout = unsafe { GetKeyboardLayout(fence.window.thread) };
    let planned = strokes(value, layout)?;
    if planned.iter().any(|stroke| matches!(stroke, Stroke::Hangul(_))) && method.layout != KOREAN {
        return fail("PROBE_INPUT_METHOD_UNAVAILABLE", "Hangul text requires the Korean input method on the target thread");
    }
    let before = method.state()?;
    let mut keys = 0usize;
    for stroke in &planned {
        match stroke {
            Stroke::Hangul(sequence) => {
                fence.check()?;
                method.hangul(true)?;
                for (vk, shift) in sequence {
                    fence.chord(if *shift { &[VK_SHIFT.0] } else { &[] }, *vk)?;
                    keys += 1;
                    thread::sleep(delay);
                }
            }
            Stroke::Latin(vk, shift) => {
                fence.check()?;
                if method.layout == KOREAN {
                    method.hangul(false)?;
                }
                fence.chord(if *shift { &[VK_SHIFT.0] } else { &[] }, *vk)?;
                keys += 1;
                thread::sleep(delay);
            }
            Stroke::Plain(vk, shift) => {
                fence.chord(if *shift { &[VK_SHIFT.0] } else { &[] }, *vk)?;
                keys += 1;
                thread::sleep(delay);
            }
        }
    }
    let after = method.state()?;
    Ok(json!({ "terminal": "sent", "characters": value.chars().count(), "keys": keys,
        "inputMethodBefore": before, "inputMethodAfter": after }))
}

// A physical click lands on whatever window owns the point. A target partly outside its window (a page laid out
// wider than the real window) or covered by another window must fail before contact, not reach that other window.
fn hitsTarget(automation: &IUIAutomation, window: &Window, entity: &Entity, x: i32, y: i32) -> Outcome<()> {
    let point = POINT { x, y };
    let owner = unsafe { GetAncestor(WindowFromPoint(point), GA_ROOT) };
    if owner != window.hwnd {
        return fail("PROBE_TARGET_OCCLUDED", "the click point belongs to another window");
    }
    let found = unsafe { automation.ElementFromPoint(point) }
        .map_err(|error| Failure { code: "PROBE_TARGET_OCCLUDED", message: error.to_string(), sent: false })?;
    let walker = unsafe { automation.RawViewWalker() }
        .map_err(|error| Failure { code: "PROBE_UIA_UNAVAILABLE", message: error.to_string(), sent: false })?;
    let mut current = Some(found);
    for _ in 0..64 {
        let Some(element) = current else { break };
        if unsafe { automation.CompareElements(&element, &entity.element) }.is_ok_and(|same| same.as_bool()) {
            return Ok(());
        }
        current = unsafe { walker.GetParentElement(&element) }.ok();
    }
    fail("PROBE_TARGET_OCCLUDED", "the click point does not resolve to the exact target")
}

fn click(input: &Value) -> Outcome<Value> {
    let fence = foregroundFence(input)?;
    let automation = automation()?;
    let entity = exactTarget(&automation, &fence.window, input)?;
    let rect = unsafe { entity.element.CurrentBoundingRectangle() }
        .map_err(|error| Failure { code: "PROBE_GEOMETRY_UNAVAILABLE", message: error.to_string(), sent: false })?;
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return fail("PROBE_GEOMETRY_UNAVAILABLE", "target rectangle is empty");
    }
    let originX = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let originY = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
    let scale = |value: i32, origin: i32, span: i32| (((value - origin) as i64 * 65535) / (span - 1).max(1) as i64).clamp(0, 65535) as i32;
    let centerX = rect.left + (rect.right - rect.left) / 2;
    let centerY = rect.top + (rect.bottom - rect.top) / 2;
    hitsTarget(&automation, &fence.window, &entity, centerX, centerY)?;
    let x = scale(centerX, originX, width);
    let y = scale(centerY, originY, height);
    let common = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    fence.send(&[
        mouseInput(x, y, common | MOUSEEVENTF_MOVE),
        mouseInput(x, y, common | MOUSEEVENTF_LEFTDOWN),
        mouseInput(x, y, common | MOUSEEVENTF_LEFTUP),
    ])?;
    Ok(json!({ "terminal": "sent", "target": { "role": entity.role, "name": entity.name } }))
}

fn namedKey(name: &str) -> Outcome<u16> {
    let named = [("Escape", VK_ESCAPE.0), ("Enter", VK_RETURN.0), ("Backspace", VK_BACK.0), ("Tab", VK_TAB.0),
        ("Space", VK_SPACE.0), ("End", VK_END.0), ("Home", VK_HOME.0)];
    if let Some((_, vk)) = named.iter().find(|(known, _)| *known == name) {
        return Ok(*vk);
    }
    let mut characters = name.chars();
    match (characters.next(), characters.next()) {
        (Some(letter), None) if letter.is_ascii_alphanumeric() => Ok(letter.to_ascii_uppercase() as u16),
        _ => fail("PROBE_INPUT_INVALID", "key must be a letter, a digit or a named key"),
    }
}

fn key(input: &Value) -> Outcome<Value> {
    let fence = foregroundFence(input)?;
    let vk = namedKey(&text(input, "key")?)?;
    let mut modifiers = Vec::new();
    for modifier in input.get("modifiers").and_then(Value::as_array).cloned().unwrap_or_default() {
        modifiers.push(match modifier.as_str() {
            Some("Control") => VK_CONTROL.0,
            Some("Shift") => VK_SHIFT.0,
            Some("Alt") => VK_MENU.0,
            _ => return fail("PROBE_INPUT_INVALID", "modifiers are Control, Shift or Alt"),
        });
    }
    fence.chord(&modifiers, vk)?;
    Ok(json!({ "terminal": "sent" }))
}

fn foreground(input: &Value) -> Outcome<Value> {
    let window = exactWindow(input)?;
    let epoch = watchPhysicalInput()?;
    if unsafe { GetForegroundWindow() } == window.hwnd {
        return Ok(json!({ "foreground": true, "changed": false }));
    }
    // Only asks. An injected key lands in whatever window is in front, often a person's, so the Alt tap that once
    // unlocked the foreground here was removed; under the foreground lock this stays false.
    if PHYSICAL.load(Ordering::SeqCst) != epoch {
        return fail("PROBE_USER_PREEMPTED", "physical user input arrived");
    }
    let _ = unsafe { SetForegroundWindow(window.hwnd) };
    thread::sleep(Duration::from_millis(150));
    let now = unsafe { GetForegroundWindow() } == window.hwnd;
    Ok(json!({ "foreground": now, "changed": true }))
}

fn idle() -> Outcome<Value> {
    let mut info = LASTINPUTINFO { cbSize: size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return fail("PROBE_INPUT_OBSERVER_UNAVAILABLE", "last input time is unavailable");
    }
    let now = unsafe { GetTickCount() };
    let foreground = unsafe { GetForegroundWindow() };
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(foreground, Some(&mut pid)) };
    let executable = processPath(pid).unwrap_or_default();
    Ok(json!({ "idleMs": now.wrapping_sub(info.dwTime), "foregroundTitle": titleOf(foreground),
        "foregroundClass": classOf(foreground),
        "foregroundExecutable": executable.rsplit(['\\', '/']).next().unwrap_or("") }))
}

fn run(command: &str, input: &Value) -> Outcome<Value> {
    match command {
        "idle" => idle(),
        "windows" => listWindows(input),
        "observe" => observe(input),
        "waitWindow" => waitWindow(input),
        "act" => act(input),
        "inputMethod" => inputMethod(input),
        "type" => typeText(input),
        "click" => click(input),
        "key" => key(input),
        "foreground" => foreground(input),
        _ => fail("PROBE_COMMAND_UNKNOWN", "unknown command"),
    }
}

fn main() {
    // UI Automation rectangles, hit testing and SendInput then share physical pixels on scaled displays.
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let arguments: Vec<String> = env::args().collect();
    let parsed = arguments.get(2).map(|raw| {
        let source = if let Some(path) = raw.strip_prefix('@') { fs::read_to_string(path).unwrap_or_default() } else { raw.clone() };
        serde_json::from_str::<Value>(&source)
    });
    let output = match (arguments.get(1), parsed) {
        (Some(command), Some(Ok(input))) => run(command, &input),
        _ => fail("PROBE_INPUT_INVALID", "usage: pyproc-native-window-probe <command> <json | @file>"),
    };
    match output {
        Ok(value) => println!("{}", json!({ "ok": true, "output": value })),
        Err(error) => {
            println!("{}", json!({ "ok": false, "error": { "code": error.code, "message": error.message,
                "outcome": if error.sent { "outcomeUnknown" } else { "notSent" } } }));
            std::process::exit(2);
        }
    }
}
