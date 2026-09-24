// listeningSockets.mjs - 한 프로세스와 그 자손이 연 TCP listen socket을 운영체제에서 직접 센다.
// 제품의 자기 보고가 아니라 OS 표를 본다. Windows는 CIM 프로세스 표와 Get-NetTCPConnection, Linux는 ps와 ss다.
// 부모가 먼저 끝나면 그 PID를 다른 프로세스가 물려받을 수 있으므로, 자식은 부모보다 늦게 생긴 경우만 자손으로 센다.
import { execFileSync } from "node:child_process";

function descendants(rootPid, rows) {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const children = new Map();
  for (const row of rows) {
    const parent = byPid.get(row.parentPid);
    if (!parent || row.startedAt < parent.startedAt) continue;
    if (!children.has(row.parentPid)) children.set(row.parentPid, []);
    children.get(row.parentPid).push(row.pid);
  }
  const found = new Set([rootPid]);
  const queue = [rootPid];
  while (queue.length) for (const child of children.get(queue.shift()) || []) {
    if (!found.has(child)) { found.add(child); queue.push(child); }
  }
  return found;
}

function windowsSockets(rootPid) {
  const script = "$p = @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId;"
    + " parentPid = $_.ParentProcessId; name = $_.Name; startedAt = [int64](($_.CreationDate.ToUniversalTime()"
    + " - [datetime]'1970-01-01').TotalMilliseconds) } });"
    + "$l = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object OwningProcess,LocalAddress,LocalPort);"
    + "@{ processes = $p; listeners = $l } | ConvertTo-Json -Depth 3 -Compress";
  const output = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 }));
  const tree = descendants(rootPid, output.processes);
  const names = new Map(output.processes.map((row) => [row.pid, row.name]));
  return (output.listeners || []).filter((row) => tree.has(row.OwningProcess)).map((row) => ({
    pid: row.OwningProcess, name: names.get(row.OwningProcess), address: `${row.LocalAddress}:${row.LocalPort}`,
  }));
}

function linuxSockets(rootPid) {
  const now = Date.now();
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,etimes=,comm="], { encoding: "utf8" }).trim().split("\n")
    .map((line) => line.trim().split(/\s+/))
    .map(([pid, parentPid, elapsed, name]) => ({ pid: Number(pid), parentPid: Number(parentPid),
      startedAt: now - Number(elapsed) * 1000, name }));
  const tree = descendants(rootPid, rows);
  const names = new Map(rows.map((row) => [row.pid, row.name]));
  return execFileSync("ss", ["-ltnpH"], { encoding: "utf8" }).split("\n").filter(Boolean).flatMap((line) => {
    const address = line.trim().split(/\s+/)[3];
    return [...line.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]))
      .filter((pid) => tree.has(pid)).map((pid) => ({ pid, name: names.get(pid), address }));
  });
}

/** Listening TCP sockets owned by `rootPid` or any process it started. */
export function listeningSocketsOf(rootPid) {
  if (!Number.isInteger(rootPid) || rootPid < 1) throw new TypeError("listeningSocketsOf requires a process id");
  if (process.platform === "win32") return windowsSockets(rootPid);
  if (process.platform === "linux") return linuxSockets(rootPid);
  throw new Error(`listen socket inspection is not implemented for ${process.platform}`);
}
