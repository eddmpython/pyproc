# foregroundWatcher.ps1 - the gate's own window and eyes on the user's desktop. It shows a window, brings it to the
# front, then samples the foreground window every 25 ms and remembers every moment it was another window. On stdin,
# `mark <name>` answers with the foreground so far and the visible top-level windows on this desktop whose process
# command line contains the marker (never its own window: its command line names the marker too); `quit` answers with
# everything it saw and exits. It only reports; the gate judges.
param([Parameter(Mandatory = $true)][string]$Marker)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class ForegroundEyes {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  public static uint ProcessOf(IntPtr hwnd) { uint pid; GetWindowThreadProcessId(hwnd, out pid); return pid; }
  public static string TitleOf(IntPtr hwnd) { var text = new StringBuilder(256); GetWindowText(hwnd, text, 256); return text.ToString(); }
  public static List<IntPtr> VisibleWindows() {
    var found = new List<IntPtr>();
    EnumWindows((hwnd, lParam) => { if (IsWindowVisible(hwnd)) found.Add(hwnd); return true; }, IntPtr.Zero);
    return found;
  }
}
"@

$form = New-Object System.Windows.Forms.Form
$form.Text = "pyproc foreground gate"
$form.Width = 360
$form.Height = 160
$form.StartPosition = "CenterScreen"
$form.TopMost = $false
$form.Show()
$form.Activate()
[System.Windows.Forms.Application]::DoEvents()
$gate = $form.Handle
[void][ForegroundEyes]::SetForegroundWindow($gate)
Start-Sleep -Milliseconds 300
[System.Windows.Forms.Application]::DoEvents()
$start = [ForegroundEyes]::GetForegroundWindow()
$left = New-Object System.Collections.ArrayList
$commandLines = @{}

function CommandLineOf([uint32]$processId) {
  if (-not $commandLines.ContainsKey($processId)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
    $commandLines[$processId] = if ($process) { [string]$process.CommandLine } else { "" }
  }
  return $commandLines[$processId]
}

function MarkedWindows {
  $marked = @()
  foreach ($hwnd in [ForegroundEyes]::VisibleWindows()) {
    $processId = [ForegroundEyes]::ProcessOf($hwnd)
    if ($processId -ne $PID -and (CommandLineOf $processId).Contains($Marker)) {
      $marked += @{ hwnd = [int64]$hwnd; pid = $processId; title = [ForegroundEyes]::TitleOf($hwnd) }
    }
  }
  return ,$marked
}

function Say($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }

Say @{ ready = $true; gate = [int64]$gate; start = [int64]$start; gateInFront = ($start -eq $gate) }
$reader = [Console]::In
$pending = $reader.ReadLineAsync()
while ($true) {
  [System.Windows.Forms.Application]::DoEvents()
  $now = [ForegroundEyes]::GetForegroundWindow()
  if ($now -ne $start -and $left.Count -lt 50) {
    $last = if ($left.Count) { $left[$left.Count - 1].hwnd } else { 0 }
    if ([int64]$now -ne $last) {
      [void]$left.Add(@{ hwnd = [int64]$now; pid = [ForegroundEyes]::ProcessOf($now); title = [ForegroundEyes]::TitleOf($now);
        at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() })
    }
  }
  if ($pending.IsCompleted) {
    $line = [string]$pending.Result
    if ($null -eq $pending.Result -or $line -eq "quit") { break }
    if ($line.StartsWith("mark ")) {
      Say @{ mark = $line.Substring(5); foreground = [int64]$now; left = @($left); windows = (MarkedWindows) }
    }
    $pending = $reader.ReadLineAsync()
  }
  Start-Sleep -Milliseconds 25
}
Say @{ summary = $true; left = @($left) }
$form.Close()
