use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::env;
use std::io::{self, Read, Write};
use std::mem::size_of;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use windows::core::{BOOL, BSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
};
use windows::Win32::System::Ole::{SafeArrayGetElement, SafeArrayGetLBound, SafeArrayGetUBound};
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::System::Variant::{VARENUM, VARIANT, VT_ARRAY, VT_I4};
use windows::Win32::UI::Accessibility::*;
use windows::Win32::UI::HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, SetProcessDpiAwarenessContext};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_VIRTUALDESK, MOUSEINPUT, SendInput,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, EnumWindows, GA_ROOT, GetAncestor, GetForegroundWindow, GetMessageW,
    GetSystemMetrics, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, KBDLLHOOKSTRUCT,
    IsWindowVisible, LLKHF_INJECTED, LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, SM_CXVIRTUALSCREEN,
    SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SetWindowsHookExW,
    TranslateMessage, WH_KEYBOARD_LL, WH_MOUSE_LL, WindowFromPoint,
};

const PROTOCOL: &str = "pyproc.windowsMotorHost";
const VERSION: u32 = 1;
const MAX_FRAME: usize = 1024 * 1024;
const MAX_CANDIDATES: i32 = 4096;
// Ancestors walked from the element under the click point to the bound target; deeper nesting refuses the click.
const MAX_HIT_DEPTH: usize = 64;
const INJECTED_MARKER: usize = 0x5059_5052_4f43;
// UI Automation control types a binding may name, by the role names the Motor sends.
const CONTROL_TYPES: [(&str, UIA_CONTROLTYPE_ID); 9] = [
    ("button", UIA_ButtonControlTypeId), ("checkbox", UIA_CheckBoxControlTypeId),
    ("radio", UIA_RadioButtonControlTypeId), ("textbox", UIA_EditControlTypeId),
    ("combobox", UIA_ComboBoxControlTypeId), ("listitem", UIA_ListItemControlTypeId),
    ("treeitem", UIA_TreeItemControlTypeId), ("text", UIA_TextControlTypeId),
    ("slider", UIA_SliderControlTypeId),
];
static USER_INPUT_EPOCH: AtomicU64 = AtomicU64::new(0);
static HOOKS_READY: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    protocol: String,
    version: u32,
    #[serde(rename = "requestId")]
    request_id: String,
    operation: String,
    #[serde(rename = "bootstrapCapability", default)]
    bootstrap_capability: Option<String>,
    input: Value,
}

#[derive(Debug, Serialize)]
struct Response<'a> {
    protocol: &'static str,
    version: u32,
    #[serde(rename = "requestId")]
    request_id: &'a str,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<HostError>,
}

#[derive(Debug, Serialize)]
struct HostError {
    code: String,
    message: String,
    outcome: String,
    retryable: bool,
}

#[derive(Debug)]
struct Failure {
    code: &'static str,
    message: String,
    outcome: &'static str,
}

impl Failure {
    fn not_sent(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), outcome: "notSent" }
    }

    fn unknown(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), outcome: "outcomeUnknown" }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TargetInvariant {
    name: String,
    #[serde(rename = "controlType")]
    control_type: String,
    #[serde(rename = "automationId", default)]
    automation_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ApplicationPolicy {
    #[serde(rename = "applicationId")]
    application_id: String,
    #[serde(rename = "executablePath")]
    executable_path: String,
    #[serde(rename = "windowTitle")]
    window_title: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NativePolicy {
    applications: Vec<ApplicationPolicy>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BindInput {
    #[serde(rename = "applicationId")]
    application_id: String,
    #[serde(rename = "surfaceEpoch")]
    surface_epoch: String,
    target: TargetInvariant,
}

#[derive(Clone, Debug)]
struct Binding {
    application_id: String,
    process_id: u32,
    executable_path: String,
    window_title: String,
    surface_epoch: String,
    target: TargetInvariant,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SemanticPostcondition {
    name: String,
    #[serde(rename = "controlType")]
    control_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExecuteAccessibilityInput {
    #[serde(rename = "bindingRef")]
    binding_ref: String,
    #[serde(rename = "planSha256")]
    plan_sha256: String,
    #[serde(rename = "intentSha256")]
    intent_sha256: String,
    intent: String,
    desired: Value,
    #[serde(rename = "surfaceEpoch")]
    surface_epoch: String,
    postcondition: SemanticPostcondition,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeLease {
    #[serde(rename = "leaseRef")]
    lease_ref: String,
    #[serde(rename = "intentSha256")]
    intent_sha256: String,
    #[serde(rename = "surfaceEpoch")]
    surface_epoch: String,
    #[serde(rename = "applicationId")]
    application_id: String,
    #[serde(rename = "expiresAt")]
    expires_at: u64,
    #[serde(rename = "userInputEpoch")]
    user_input_epoch: u64,
    #[serde(rename = "cancelOnUserInput")]
    cancel_on_user_input: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ExecuteOsInput {
    #[serde(rename = "bindingRef")]
    binding_ref: String,
    #[serde(rename = "planSha256")]
    plan_sha256: String,
    #[serde(rename = "intentSha256")]
    intent_sha256: String,
    intent: String,
    #[serde(rename = "surfaceEpoch")]
    surface_epoch: String,
    lease: NativeLease,
    postcondition: SemanticPostcondition,
}

struct Host {
    automation: IUIAutomation,
    applications: HashMap<String, ApplicationPolicy>,
    bindings: HashMap<String, Binding>,
    used_leases: HashSet<String>,
    sequence: u64,
}

fn digest(parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_le_bytes());
        hash.update(part.as_bytes());
    }
    hash.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn valid_ref(value: &str, prefix: &str) -> bool {
    value.starts_with(prefix) && value.len() <= 256
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
}

fn window_title(hwnd: HWND) -> Result<String, Failure> {
    let length = unsafe { GetWindowTextLengthW(hwnd) };
    if length <= 0 {
        return Err(Failure::not_sent("NATIVE_WINDOW_INVALID", "foreground window title is unavailable"));
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    if copied <= 0 {
        return Err(Failure::not_sent("NATIVE_WINDOW_INVALID", "foreground window title could not be read"));
    }
    Ok(String::from_utf16_lossy(&buffer[..copied as usize]))
}

fn process_path(process_id: u32) -> Result<String, Failure> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }
        .map_err(|error| Failure::not_sent("NATIVE_PROCESS_ACCESS_DENIED", error.to_string()))?;
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    let result = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32,
        PWSTR(buffer.as_mut_ptr()), &mut length) };
    let _ = unsafe { CloseHandle(process) };
    result.map_err(|error| Failure::not_sent("NATIVE_PROCESS_ACCESS_DENIED", error.to_string()))?;
    Ok(String::from_utf16_lossy(&buffer[..length as usize]))
}

fn same_windows_path(left: &str, right: &str) -> bool {
    left.replace('/', "\\").to_lowercase() == right.replace('/', "\\").to_lowercase()
}

fn foreground_for(process_id: u32, expected_title: &str) -> Result<HWND, Failure> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return Err(Failure::not_sent("NATIVE_FOREGROUND_MISMATCH", "no foreground window is available"));
    }
    let mut actual_process = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut actual_process)); }
    if actual_process != process_id || window_title(hwnd)? != expected_title {
        return Err(Failure::not_sent("NATIVE_FOREGROUND_MISMATCH",
            "foreground process or window title differs from the exact surface fence"));
    }
    Ok(hwnd)
}

unsafe extern "system" fn collect_visible_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if unsafe { IsWindowVisible(hwnd) }.as_bool() {
        let windows = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
        windows.push(hwnd);
    }
    true.into()
}

fn window_for(process_id: u32, expected_title: &str) -> Result<HWND, Failure> {
    let mut windows = Vec::new();
    unsafe { EnumWindows(Some(collect_visible_window), LPARAM(&mut windows as *mut _ as isize)) }
        .map_err(|error| Failure::not_sent("NATIVE_WINDOW_INVALID", error.to_string()))?;
    let matches: Vec<_> = windows.into_iter().filter(|hwnd| {
        let mut actual_process = 0u32;
        unsafe { GetWindowThreadProcessId(*hwnd, Some(&mut actual_process)); }
        actual_process == process_id && window_title(*hwnd).is_ok_and(|title| title == expected_title)
    }).collect();
    if matches.len() != 1 {
        return Err(Failure::not_sent(if matches.len() > 1 { "NATIVE_WINDOW_AMBIGUOUS" } else { "NATIVE_WINDOW_STALE" },
            format!("exact process and title fence requires one window, found {}", matches.len())));
    }
    Ok(matches[0])
}

fn application_window(policy: &ApplicationPolicy) -> Result<(HWND, u32), Failure> {
    let mut windows = Vec::new();
    unsafe { EnumWindows(Some(collect_visible_window), LPARAM(&mut windows as *mut _ as isize)) }
        .map_err(|error| Failure::not_sent("NATIVE_WINDOW_INVALID", error.to_string()))?;
    let matches: Vec<_> = windows.into_iter().filter_map(|hwnd| {
        if !window_title(hwnd).is_ok_and(|title| title == policy.window_title) { return None; }
        let mut process_id = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)); }
        if process_id == 0 || !process_path(process_id)
            .is_ok_and(|path| same_windows_path(&path, &policy.executable_path)) { return None; }
        Some((hwnd, process_id))
    }).collect();
    if matches.len() != 1 {
        return Err(Failure::not_sent(if matches.len() > 1 { "NATIVE_WINDOW_AMBIGUOUS" } else { "NATIVE_WINDOW_STALE" },
            format!("allowed application fence requires one window, found {}", matches.len())));
    }
    Ok(matches[0])
}

fn uia_failure(error: windows::core::Error) -> Failure {
    Failure::not_sent("NATIVE_UIA_UNAVAILABLE", error.to_string())
}

// The runtime id is the identity UI Automation gives an element. Chromium answers one descendant query with the same
// element many times (121 copies of one element were measured), so candidates are counted by it.
fn runtime_id(element: &IUIAutomationElement) -> Option<Vec<i32>> {
    let value: VARIANT = unsafe { element.GetCachedPropertyValue(UIA_RuntimeIdPropertyId) }.ok()?;
    unsafe {
        let inner = &value.Anonymous.Anonymous;
        if inner.vt != VARENUM(VT_ARRAY.0 | VT_I4.0) || inner.Anonymous.parray.is_null() { return None; }
        let array = inner.Anonymous.parray;
        let lower = SafeArrayGetLBound(array, 1).ok()?;
        let upper = SafeArrayGetUBound(array, 1).ok()?;
        let mut parts = Vec::new();
        for index in lower..=upper {
            let mut part = 0i32;
            SafeArrayGetElement(array, &index, &mut part as *mut i32 as *mut core::ffi::c_void).ok()?;
            parts.push(part);
        }
        (!parts.is_empty()).then_some(parts)
    }
}

// Keeps the first item of each identity. An item without one is never merged, so a missing id can only leave a
// target ambiguous, never make an ambiguous target look unique.
fn unique_by_identity<T>(items: impl IntoIterator<Item = (Option<Vec<i32>>, T)>) -> Vec<T> {
    let mut seen = HashSet::new();
    items.into_iter().filter_map(|(identity, item)| identity.is_none_or(|key| seen.insert(key)).then_some(item))
        .collect()
}

// The enabled elements under `root` with exactly the target's name, control type and (when named) automation id.
// The provider evaluates the condition and returns the cached identity in one query per call.
fn candidates(root: &IUIAutomationElement, automation: &IUIAutomation, target: &TargetInvariant)
    -> Result<Vec<IUIAutomationElement>, Failure> {
    let Some(&(_, control_type)) = CONTROL_TYPES.iter().find(|(role, _)| *role == target.control_type)
        else { return Ok(Vec::new()); };
    let property = |id: UIA_PROPERTY_ID, value: VARIANT| unsafe { automation.CreatePropertyCondition(id, &value) }
        .map_err(uia_failure);
    let typed = property(UIA_ControlTypePropertyId, VARIANT::from(control_type.0))?;
    let named = property(UIA_NamePropertyId, VARIANT::from(target.name.as_str()))?;
    let mut condition = unsafe { automation.CreateAndCondition(&typed, &named) }.map_err(uia_failure)?;
    if let Some(automation_id) = &target.automation_id {
        let identified = property(UIA_AutomationIdPropertyId, VARIANT::from(automation_id.as_str()))?;
        condition = unsafe { automation.CreateAndCondition(&condition, &identified) }.map_err(uia_failure)?;
    }
    let request = unsafe { automation.CreateCacheRequest() }.map_err(uia_failure)?;
    for id in [UIA_RuntimeIdPropertyId, UIA_IsEnabledPropertyId] {
        unsafe { request.AddProperty(id) }.map_err(uia_failure)?;
    }
    let array = unsafe { root.FindAllBuildCache(TreeScope_Descendants, &condition, &request) }.map_err(uia_failure)?;
    let length = unsafe { array.Length() }.map_err(uia_failure)?;
    if length > MAX_CANDIDATES {
        return Err(Failure::not_sent("NATIVE_TARGET_INCOMPLETE", "UI Automation candidate budget was exceeded"));
    }
    let enabled = (0..length).filter_map(|index| unsafe { array.GetElement(index) }.ok())
        .filter(|element| unsafe { element.CachedIsEnabled() }.is_ok_and(|value| value.as_bool()))
        .map(|element| (runtime_id(&element), element));
    Ok(unique_by_identity(enabled))
}

fn exact_element(automation: &IUIAutomation, binding: &Binding, require_foreground: bool)
    -> Result<(HWND, IUIAutomationElement), Failure> {
    let hwnd = if require_foreground { foreground_for(binding.process_id, &binding.window_title)? }
        else { window_for(binding.process_id, &binding.window_title)? };
    let executable_path = process_path(binding.process_id)?;
    if !same_windows_path(&executable_path, &binding.executable_path) {
        return Err(Failure::not_sent("NATIVE_PROCESS_MISMATCH", "process executable differs from the allowed application fence"));
    }
    let root = unsafe { automation.ElementFromHandle(hwnd) }.map_err(uia_failure)?;
    let matches = candidates(&root, automation, &binding.target)?;
    if matches.len() != 1 {
        return Err(Failure::not_sent(if matches.len() > 1 { "NATIVE_TARGET_AMBIGUOUS" } else { "NATIVE_TARGET_STALE" },
            format!("exact UI Automation binding requires one candidate, found {}", matches.len())));
    }
    Ok((hwnd, matches.into_iter().next().unwrap()))
}

fn semantic_exists(automation: &IUIAutomation, binding: &Binding, expected: &SemanticPostcondition,
    require_foreground: bool) -> bool {
    let hwnd = if require_foreground { foreground_for(binding.process_id, &binding.window_title) }
        else { window_for(binding.process_id, &binding.window_title) };
    let Ok(hwnd) = hwnd else { return false; };
    let Ok(root) = (unsafe { automation.ElementFromHandle(hwnd) }) else { return false; };
    let target = TargetInvariant { name: expected.name.clone(), control_type: expected.control_type.clone(), automation_id: None };
    candidates(&root, automation, &target).is_ok_and(|items| !items.is_empty())
}

fn wait_postcondition(automation: &IUIAutomation, binding: &Binding, expected: &SemanticPostcondition,
    require_foreground: bool) -> bool {
    for _ in 0..50 {
        if semantic_exists(automation, binding, expected, require_foreground) { return true; }
        thread::sleep(Duration::from_millis(20));
    }
    false
}

fn supported_intents(element: &IUIAutomationElement) -> Vec<&'static str> {
    let mut result = Vec::new();
    unsafe {
        if element.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId).is_ok() { result.push("activate"); }
        if element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId).is_ok()
            || element.GetCurrentPatternAs::<IUIAutomationRangeValuePattern>(UIA_RangeValuePatternId).is_ok() {
            result.push("setValue");
        }
        if element.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId).is_ok()
            || element.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId).is_ok() {
            result.push("setSelected");
        }
        if element.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId).is_ok() { result.push("setExpanded"); }
        if element.GetCurrentPatternAs::<IUIAutomationScrollItemPattern>(UIA_ScrollItemPatternId).is_ok() { result.push("scrollTo"); }
        if element.CurrentIsKeyboardFocusable().is_ok_and(|value| value.as_bool()) { result.push("focus"); }
    }
    result.sort_unstable();
    result.dedup();
    result
}

fn desired_bool(value: &Value, key: &str) -> Result<bool, Failure> {
    value.get(key).and_then(Value::as_bool)
        .ok_or_else(|| Failure::not_sent("NATIVE_INTENT_INVALID", format!("desired.{key} must be boolean")))
}

fn accessibility_effect(element: &IUIAutomationElement, intent: &str, desired: &Value) -> Result<(), Failure> {
    let rejected = |error: windows::core::Error| Failure::unknown("NATIVE_UIA_EFFECT_REJECTED",
        format!("UI Automation pattern rejected the frozen intent: {error}"));
    let unsupported = |intent: &str, error: windows::core::Error| Failure::not_sent(
        "NATIVE_PATTERN_UNSUPPORTED", format!("{intent} has no supported UI Automation pattern: {error}"));
    match intent {
        "activate" => {
            let pattern = unsafe { element.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) }
                .map_err(|error| unsupported(intent, error))?;
            unsafe { pattern.Invoke() }.map_err(rejected)
        },
        "focus" => unsafe { element.SetFocus() }.map_err(rejected),
        "setValue" => {
            if let Ok(pattern) = unsafe { element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) } {
                let value = desired.get("value").and_then(Value::as_str)
                    .ok_or_else(|| Failure::not_sent("NATIVE_INTENT_INVALID", "desired.value must be a string"))?;
                unsafe { pattern.SetValue(&BSTR::from(value)) }.map_err(rejected)
            } else {
                let value = desired.get("value").and_then(Value::as_f64)
                    .ok_or_else(|| Failure::not_sent("NATIVE_INTENT_INVALID", "desired.value must be a number"))?;
                let pattern = unsafe {
                    element.GetCurrentPatternAs::<IUIAutomationRangeValuePattern>(UIA_RangeValuePatternId)
                }.map_err(|error| unsupported(intent, error))?;
                unsafe { pattern.SetValue(value) }.map_err(rejected)
            }
        },
        "setSelected" => {
            let selected = desired_bool(desired, "selected")?;
            if let Ok(pattern) = unsafe { element.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId) } {
                let current = unsafe { pattern.CurrentToggleState() }.map_err(rejected)? == ToggleState_On;
                if current != selected { unsafe { pattern.Toggle() }.map_err(rejected)?; }
                Ok(())
            } else {
                let pattern = unsafe {
                    element.GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
                }.map_err(|error| unsupported(intent, error))?;
                let current = unsafe { pattern.CurrentIsSelected() }.map_err(rejected)?.as_bool();
                if selected && !current { unsafe { pattern.Select() }.map_err(rejected)?; }
                else if !selected && current { unsafe { pattern.RemoveFromSelection() }.map_err(rejected)?; }
                Ok(())
            }
        },
        "setExpanded" => {
            let expanded = desired_bool(desired, "expanded")?;
            let pattern = unsafe {
                element.GetCurrentPatternAs::<IUIAutomationExpandCollapsePattern>(UIA_ExpandCollapsePatternId)
            }.map_err(|error| unsupported(intent, error))?;
            if expanded { unsafe { pattern.Expand() }.map_err(rejected) }
            else { unsafe { pattern.Collapse() }.map_err(rejected) }
        },
        "scrollTo" => {
            let pattern = unsafe { element.GetCurrentPatternAs::<IUIAutomationScrollItemPattern>(UIA_ScrollItemPatternId) }
                .map_err(|error| unsupported(intent, error))?;
            unsafe { pattern.ScrollIntoView() }.map_err(rejected)
        },
        _ => Err(Failure::not_sent("NATIVE_INTENT_UNSUPPORTED", "native intent is not supported")),
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn absolute_coordinate(value: i32, origin: i32, span: i32) -> i32 {
    if span <= 1 { return 0; }
    (((value - origin) as i64 * 65535) / (span - 1) as i64).clamp(0, 65535) as i32
}

fn mouse_input(x: i32, y: i32, flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT {
        dx: x, dy: y, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: INJECTED_MARKER,
    } } }
}

// A physical click lands on whatever window owns the point. A target partly outside its window (a page laid out wider
// than the real window) or under another window, even a part of its own window, must refuse here, before contact.
fn contact_check(automation: &IUIAutomation, hwnd: HWND, element: &IUIAutomationElement, point: POINT)
    -> Result<(), Failure> {
    let occluded = |message: String| Failure::not_sent("NATIVE_TARGET_OCCLUDED", message);
    if unsafe { GetAncestor(WindowFromPoint(point), GA_ROOT) } != hwnd {
        return Err(occluded("the click point belongs to another window".into()));
    }
    let found = unsafe { automation.ElementFromPoint(point) }.map_err(|error| occluded(error.to_string()))?;
    let walker = unsafe { automation.RawViewWalker() }.map_err(uia_failure)?;
    let mut current = Some(found);
    for _ in 0..MAX_HIT_DEPTH {
        let Some(candidate) = current else { break };
        if unsafe { automation.CompareElements(&candidate, element) }.is_ok_and(|same| same.as_bool()) {
            return Ok(());
        }
        current = unsafe { walker.GetParentElement(&candidate) }.ok();
    }
    Err(occluded("the click point does not resolve to the bound target".into()))
}

fn center_of(element: &IUIAutomationElement) -> Result<POINT, Failure> {
    let rect = unsafe { element.CurrentBoundingRectangle() }
        .map_err(|error| Failure::not_sent("NATIVE_GEOMETRY_UNAVAILABLE", error.to_string()))?;
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return Err(Failure::not_sent("NATIVE_GEOMETRY_UNAVAILABLE", "target rectangle is empty"));
    }
    Ok(POINT { x: rect.left + (rect.right - rect.left) / 2, y: rect.top + (rect.bottom - rect.top) / 2 })
}

fn os_activate(automation: &IUIAutomation, hwnd: HWND, element: &IUIAutomationElement, lease: &NativeLease)
    -> Result<(), Failure> {
    let preempted = || USER_INPUT_EPOCH.load(Ordering::SeqCst) != lease.user_input_epoch;
    if preempted() {
        return Err(Failure::not_sent("NATIVE_USER_PREEMPTED", "physical user input revoked the ControlLease"));
    }
    let center = center_of(element)?;
    let origin_x = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let origin_y = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
    if unsafe { GetForegroundWindow() } != hwnd {
        return Err(Failure::not_sent("NATIVE_FOREGROUND_MISMATCH", "the bound window lost the foreground before contact"));
    }
    contact_check(automation, hwnd, element, center)?;
    if preempted() {
        return Err(Failure::not_sent("NATIVE_USER_PREEMPTED", "physical user input revoked the ControlLease"));
    }
    let x = absolute_coordinate(center.x, origin_x, width);
    let y = absolute_coordinate(center.y, origin_y, height);
    let common = MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
    let inputs = [mouse_input(x, y, common | MOUSEEVENTF_MOVE),
        mouse_input(x, y, common | MOUSEEVENTF_LEFTDOWN),
        mouse_input(x, y, common | MOUSEEVENTF_LEFTUP)];
    let sent = unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err(Failure::unknown("NATIVE_OS_INPUT_REJECTED",
            "SendInput did not accept the complete frozen gesture; UIPI cannot be distinguished"));
    }
    Ok(())
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let event = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if !event.flags.contains(LLKHF_INJECTED) && event.dwExtraInfo != INJECTED_MARKER {
            USER_INPUT_EPOCH.fetch_add(1, Ordering::SeqCst);
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let event = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        if event.flags & LLMHF_INJECTED == 0 && event.dwExtraInfo != INJECTED_MARKER {
            USER_INPUT_EPOCH.fetch_add(1, Ordering::SeqCst);
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn start_input_observer() -> Result<(), Failure> {
    thread::Builder::new().name("pyproc-physical-input".into()).spawn(|| unsafe {
        let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), None, 0);
        let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0);
        if keyboard.is_err() || mouse.is_err() { return; }
        HOOKS_READY.store(true, Ordering::SeqCst);
        let mut message = MSG::default();
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }).map_err(|error| Failure::not_sent("NATIVE_INPUT_OBSERVER_UNAVAILABLE", error.to_string()))?;
    for _ in 0..100 {
        if HOOKS_READY.load(Ordering::SeqCst) { return Ok(()); }
        thread::sleep(Duration::from_millis(10));
    }
    Err(Failure::not_sent("NATIVE_INPUT_OBSERVER_UNAVAILABLE",
        "low-level physical input observer did not become ready"))
}

impl Host {
    fn new(policy: NativePolicy) -> Result<Self, Failure> {
        if policy.applications.is_empty() || policy.applications.len() > 128 {
            return Err(Failure::not_sent("NATIVE_POLICY_INVALID", "native policy requires one to 128 applications"));
        }
        let mut applications = HashMap::new();
        for application in policy.applications {
            if !valid_ref(&application.application_id, "application:")
                || !Path::new(&application.executable_path).is_absolute()
                || application.window_title.is_empty() || application.window_title.len() > 500
                || applications.insert(application.application_id.clone(), application).is_some() {
                return Err(Failure::not_sent("NATIVE_POLICY_INVALID", "native application policy is invalid"));
            }
        }
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok()
            .map_err(|error| Failure::not_sent("NATIVE_COM_UNAVAILABLE", error.to_string()))?;
        let automation = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }
            .map_err(|error| Failure::not_sent("NATIVE_UIA_UNAVAILABLE", error.to_string()))?;
        start_input_observer()?;
        Ok(Self { automation, applications, bindings: HashMap::new(), used_leases: HashSet::new(), sequence: 0 })
    }

    fn dispatch(&mut self, operation: &str, input: Value) -> Result<Value, Failure> {
        match operation {
            "inspect" => self.inspect(input),
            "bindApplication" => self.bind(input),
            "executeAccessibility" => self.execute_accessibility(input),
            "executeOsInput" => self.execute_os_input(input),
            _ => Err(Failure::not_sent("NATIVE_OPERATION_UNKNOWN", "native operation is not allowed")),
        }
    }

    fn inspect(&self, input: Value) -> Result<Value, Failure> {
        #[derive(Deserialize)] #[serde(deny_unknown_fields)] struct Empty {}
        let _: Empty = serde_json::from_value(input)
            .map_err(|error| Failure::not_sent("NATIVE_INPUT_INVALID", error.to_string()))?;
        Ok(json!({ "providerKind": "windows", "protocolVersion": VERSION,
            "accessibility": true, "osInput": HOOKS_READY.load(Ordering::SeqCst),
            "physicalUserInputObserver": HOOKS_READY.load(Ordering::SeqCst),
            "inputEpoch": USER_INPUT_EPOCH.load(Ordering::SeqCst), "listener": false }))
    }

    fn bind(&mut self, input: Value) -> Result<Value, Failure> {
        let request: BindInput = serde_json::from_value(input)
            .map_err(|error| Failure::not_sent("NATIVE_INPUT_INVALID", error.to_string()))?;
        if !valid_ref(&request.application_id, "application:")
            || !valid_ref(&request.surface_epoch, "surface:") || request.target.name.is_empty()
            || request.target.name.len() > 300 || request.target.control_type.is_empty() {
            return Err(Failure::not_sent("NATIVE_BINDING_INVALID", "native binding input is invalid"));
        }
        let application = self.applications.get(&request.application_id).cloned()
            .ok_or_else(|| Failure::not_sent("NATIVE_APPLICATION_DENIED", "application is outside the native allowlist"))?;
        let (_, process_id) = application_window(&application)?;
        let binding = Binding { application_id: application.application_id,
            process_id, executable_path: application.executable_path, window_title: application.window_title,
            surface_epoch: request.surface_epoch, target: request.target };
        let (hwnd, element) = exact_element(&self.automation, &binding, false)?;
        self.sequence += 1;
        let binding_ref = format!("nativeBinding:{}", digest(&[&self.sequence.to_string(),
            &binding.application_id, &binding.process_id.to_string(), &binding.window_title, &binding.surface_epoch,
            &binding.target.name, &binding.target.control_type]));
        let intents = supported_intents(&element);
        self.bindings.insert(binding_ref.clone(), binding);
        Ok(json!({ "bindingRef": binding_ref, "uniqueness": "unique", "candidateCount": 1,
            "supportedIntents": intents, "foreground": unsafe { GetForegroundWindow() } == hwnd,
            "inputEpoch": USER_INPUT_EPOCH.load(Ordering::SeqCst) }))
    }

    fn binding(&self, binding_ref: &str, surface_epoch: &str) -> Result<&Binding, Failure> {
        let binding = self.bindings.get(binding_ref)
            .ok_or_else(|| Failure::not_sent("NATIVE_TARGET_STALE", "native binding is unavailable"))?;
        if binding.surface_epoch != surface_epoch {
            return Err(Failure::not_sent("NATIVE_TARGET_STALE", "native surface epoch changed"));
        }
        Ok(binding)
    }

    fn execute_accessibility(&self, input: Value) -> Result<Value, Failure> {
        let request: ExecuteAccessibilityInput = serde_json::from_value(input)
            .map_err(|error| Failure::not_sent("NATIVE_INPUT_INVALID", error.to_string()))?;
        if !valid_digest(&request.plan_sha256) || !valid_digest(&request.intent_sha256) {
            return Err(Failure::not_sent("NATIVE_PLAN_INVALID", "native plan digests are invalid"));
        }
        let binding = self.binding(&request.binding_ref, &request.surface_epoch)?.clone();
        let (_, element) = exact_element(&self.automation, &binding, false)?;
        if !supported_intents(&element).contains(&request.intent.as_str()) {
            return Err(Failure::not_sent("NATIVE_PATTERN_UNAVAILABLE", "required UI Automation pattern is unavailable"));
        }
        accessibility_effect(&element, &request.intent, &request.desired)?;
        let confirmed = wait_postcondition(&self.automation, &binding, &request.postcondition, false);
        Ok(json!({ "effectOutcome": "applied", "terminal": if confirmed { "confirmed" } else { "notObserved" },
            "providerCalls": 1, "evidence": { "before": "exactUiaBinding", "after": if confirmed { "semanticPostcondition" } else { "notObserved" } } }))
    }

    fn execute_os_input(&mut self, input: Value) -> Result<Value, Failure> {
        let request: ExecuteOsInput = serde_json::from_value(input)
            .map_err(|error| Failure::not_sent("NATIVE_INPUT_INVALID", error.to_string()))?;
        if request.intent != "activate" || !valid_digest(&request.plan_sha256)
            || !valid_digest(&request.intent_sha256) || request.lease.intent_sha256 != request.intent_sha256
            || request.lease.surface_epoch != request.surface_epoch || !request.lease.cancel_on_user_input
            || !valid_ref(&request.lease.lease_ref, "controlLease:") || request.lease.expires_at <= now_ms() {
            return Err(Failure::not_sent("NATIVE_CONTROL_LEASE_INVALID", "OS input requires an exact active ControlLease"));
        }
        let binding = self.binding(&request.binding_ref, &request.surface_epoch)?.clone();
        if binding.application_id != request.lease.application_id {
            return Err(Failure::not_sent("NATIVE_CONTROL_LEASE_INVALID", "ControlLease application differs from target binding"));
        }
        if self.used_leases.contains(&request.lease.lease_ref) {
            return Err(Failure::not_sent("NATIVE_CONTROL_LEASE_CONSUMED", "ControlLease was already consumed"));
        }
        let (hwnd, element) = exact_element(&self.automation, &binding, true)?;
        self.used_leases.insert(request.lease.lease_ref.clone());
        os_activate(&self.automation, hwnd, &element, &request.lease)?;
        let confirmed = wait_postcondition(&self.automation, &binding, &request.postcondition, true);
        Ok(json!({ "effectOutcome": "applied", "terminal": if confirmed { "confirmed" } else { "notObserved" },
            "providerCalls": 1, "safetyRelease": true,
            "evidence": { "before": "foregroundLeaseExactUiaBindingAndContactPoint", "after": if confirmed { "semanticPostcondition" } else { "notObserved" } } }))
    }
}

fn read_frame(reader: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; 4];
    match reader.read_exact(&mut header) {
        Ok(()) => {},
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let length = u32::from_le_bytes(header) as usize;
    if length == 0 || length > MAX_FRAME { return Err(io::Error::new(io::ErrorKind::InvalidData, "native frame length is invalid")); }
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn write_frame(writer: &mut impl Write, value: &Response<'_>) -> io::Result<()> {
    let bytes = serde_json::to_vec(value).map_err(io::Error::other)?;
    writer.write_all(&(bytes.len() as u32).to_le_bytes())?;
    writer.write_all(&bytes)?;
    writer.flush()
}

fn response<'a>(request_id: &'a str, result: Result<Value, Failure>) -> Response<'a> {
    match result {
        Ok(output) => Response { protocol: PROTOCOL, version: VERSION, request_id, ok: true,
            output: Some(output), error: None },
        Err(error) => Response { protocol: PROTOCOL, version: VERSION, request_id, ok: false,
            output: None, error: Some(HostError { code: error.code.into(), message: error.message,
                outcome: error.outcome.into(), retryable: false }) },
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // UI Automation rectangles, the contact-point check and SendInput then share physical pixels on scaled displays.
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let expected_bootstrap = env::var("PYPROC_NATIVE_BOOTSTRAP")?;
    let policy: NativePolicy = serde_json::from_str(&env::var("PYPROC_NATIVE_POLICY")?)?;
    if !valid_digest(&expected_bootstrap) { return Err("PYPROC_NATIVE_BOOTSTRAP must be a lowercase SHA-256 value".into()); }
    let mut host = Host::new(policy).map_err(|error| error.message)?;
    let mut authenticated = false;
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut writer = stdout.lock();
    while let Some(bytes) = read_frame(&mut reader)? {
        let parsed: Result<Request, _> = serde_json::from_slice(&bytes);
        let request = match parsed {
            Ok(request) => request,
            Err(error) => {
                let invalid = response("request:invalid", Err(Failure::not_sent("NATIVE_FRAME_INVALID", error.to_string())));
                write_frame(&mut writer, &invalid)?;
                continue;
            },
        };
        let result = if request.protocol != PROTOCOL || request.version != VERSION || !valid_ref(&request.request_id, "request:") {
            Err(Failure::not_sent("NATIVE_FRAME_INVALID", "native request envelope is invalid"))
        } else if !authenticated {
            if request.operation != "hello" || request.bootstrap_capability.as_deref() != Some(&expected_bootstrap) {
                Err(Failure::not_sent("NATIVE_BOOTSTRAP_INVALID", "single-use bootstrap capability is invalid"))
            } else {
                authenticated = true;
                Ok(json!({ "authenticated": true, "protocolVersion": VERSION }))
            }
        } else if request.bootstrap_capability.is_some() || request.operation == "hello" {
            Err(Failure::not_sent("NATIVE_BOOTSTRAP_INVALID", "bootstrap capability was already consumed"))
        } else {
            host.dispatch(&request.operation, request.input)
        };
        let reply = response(&request.request_id, result);
        write_frame(&mut writer, &reply)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use windows::core::{PCWSTR, w};
    use windows::Win32::Foundation::HINSTANCE;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::GetCurrentThreadId;
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, HWND_TOP, PostThreadMessageW, RegisterClassW, SW_SHOWNOACTIVATE,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos, ShowWindow, WINDOW_EX_STYLE, WM_QUIT, WNDCLASSW,
        WS_CHILD, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
    };

    #[test]
    fn repeated_runtime_ids_collapse_to_one_candidate() {
        let repeated = (0..121).map(|copy| (Some(vec![42, 7, 3]), copy));
        assert_eq!(unique_by_identity(repeated), vec![0]);
    }

    #[test]
    fn distinct_runtime_ids_stay_distinct() {
        let items = [(Some(vec![42, 1]), "save"), (Some(vec![42, 2]), "save"), (Some(vec![42, 1]), "save")];
        assert_eq!(unique_by_identity(items), vec!["save", "save"]);
    }

    #[test]
    fn missing_runtime_ids_never_merge() {
        let items = [(None, 1), (None, 2), (Some(vec![9]), 3), (Some(vec![9]), 4)];
        assert_eq!(unique_by_identity(items), vec![1, 2, 3]);
    }

    unsafe extern "system" fn fixture_procedure(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
    }

    // Windows this test owns, created on a thread that pumps their messages (UI Automation asks that thread), shown
    // TopMost without activation. No input is sent: the check only asks which window and element own a point.
    struct ContactFixture { window: isize, clear: isize, covered: isize, underneath: isize, outside: isize, thread: u32 }

    fn open_contact_fixture() -> (ContactFixture, thread::JoinHandle<()>) {
        let (sender, receiver) = mpsc::channel();
        let ui = thread::spawn(move || unsafe {
            let instance: HINSTANCE = GetModuleHandleW(None).unwrap().into();
            let class = w!("PyProcMotorContactFixture");
            RegisterClassW(&WNDCLASSW { lpfnWndProc: Some(fixture_procedure), hInstance: instance,
                lpszClassName: class, ..Default::default() });
            let popup = |x: i32, y: i32, width: i32, height: i32| {
                let hwnd = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, class,
                    w!("PyProc Motor Contact Fixture"), WS_POPUP, x, y, width, height, None, None, Some(instance), None)
                    .unwrap();
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                hwnd
            };
            let window = popup(60, 60, 320, 200);
            let button = |text: PCWSTR, x: i32, y: i32, width: i32| CreateWindowExW(WINDOW_EX_STYLE(0), w!("BUTTON"),
                text, WS_CHILD | WS_VISIBLE, x, y, width, 40, Some(window), None, Some(instance), None).unwrap();
            let clear = button(w!("Clear"), 20, 20, 120);
            let covered = button(w!("Covered"), 160, 20, 120);
            let underneath = button(w!("Underneath"), 20, 100, 120);
            let overlay = button(w!("Overlay"), 10, 90, 140);
            SetWindowPos(overlay, Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE).unwrap();
            // Its center (340, 120) lies 20 pixels past the window's right edge, where a bystander window sits.
            let outside = button(w!("Outside"), 260, 100, 160);
            popup(60 + 150, 60 + 10, 140, 60);
            popup(60 + 320, 60 + 100, 40, 40);
            sender.send(ContactFixture { window: window.0 as isize, clear: clear.0 as isize, covered: covered.0 as isize,
                underneath: underneath.0 as isize, outside: outside.0 as isize, thread: GetCurrentThreadId() }).unwrap();
            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        });
        (receiver.recv().unwrap(), ui)
    }

    #[test]
    fn contact_point_must_resolve_to_the_bound_target() {
        let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let automation: IUIAutomation = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.unwrap();
        let (fixture, ui) = open_contact_fixture();
        let window = HWND(fixture.window as *mut core::ffi::c_void);
        let outcome = |button: isize| {
            let element = unsafe { automation.ElementFromHandle(HWND(button as *mut core::ffi::c_void)) }.unwrap();
            let point = center_of(&element).unwrap();
            contact_check(&automation, window, &element, point).map_err(|failure| failure.code)
        };
        let results = [outcome(fixture.clear), outcome(fixture.covered), outcome(fixture.underneath),
            outcome(fixture.outside)];
        unsafe { PostThreadMessageW(fixture.thread, WM_QUIT, WPARAM(0), LPARAM(0)) }.unwrap();
        ui.join().unwrap();
        assert_eq!(results, [Ok(()), Err("NATIVE_TARGET_OCCLUDED"), Err("NATIVE_TARGET_OCCLUDED"),
            Err("NATIVE_TARGET_OCCLUDED")], "clear, covered by a TopMost window, under a sibling, past the edge");
    }
}
