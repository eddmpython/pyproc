// fixtureProbe.mjs - attempt 32 measurement against a local WinForms fixture on the interactive Windows desktop.
//
// Usage (Windows, Korean input method installed, nobody typing):
//   PYPROC_ATTEMPT_TARGET=<absolute dir outside the repository> node tests/attempts/32-nativeWindowObservation/fixtureProbe.mjs
//   PYPROC_ATTEMPT_PROBE=<built probe exe> node ... --only occlusion   (run one case against a given binary)
//
// It builds nativeProbe with cargo into PYPROC_ATTEMPT_TARGET, opens two fixture windows it owns (a form and a TopMost
// cover over one of its buttons) and checks: observation of an independent window, exact-target and surface fences,
// Hangul composition through the window's input method, a Windows common file dialog driven by UI Automation, and
// that a physical click whose point belongs to another window is refused before contact.
//
// Result (2026-10-06, Windows 11 26200, Korean IME 0412, 100% scale): see ../README.md conclusion table.
import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

if (process.platform !== "win32") {
  console.log("attempt 32 fixture probe runs only on Windows");
  process.exit(0);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const POWERSHELL = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0",
  "powershell.exe");
const TITLE = "PyProc Native Fixture";
const COVER = "PyProc Cover Fixture";
const DIALOG = "PyProc Fixture Open";

function buildProbe() {
  if (process.env.PYPROC_ATTEMPT_PROBE) return process.env.PYPROC_ATTEMPT_PROBE;
  const target = process.env.PYPROC_ATTEMPT_TARGET;
  if (!target) throw new Error("PYPROC_ATTEMPT_TARGET must name a build folder outside the repository");
  const built = spawnSync("cargo", ["build", "--release", "--target-dir", target], {
    cwd: join(HERE, "nativeProbe"), stdio: "inherit" });
  if (built.status !== 0) throw new Error("cargo build failed");
  return join(target, "release", "pyproc-native-window-probe.exe");
}

const PROBE = buildProbe();
function probe(command, input) {
  const result = spawnSync(PROBE, [command, JSON.stringify(input)], { encoding: "utf8", windowsHide: true,
    timeout: 60000 });
  return JSON.parse(result.stdout.trim());
}

const fixtureScript = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = '${TITLE}'
$form.StartPosition = 'Manual'; $form.Left = 120; $form.Top = 120; $form.Width = 520; $form.Height = 320
$text = New-Object System.Windows.Forms.TextBox
$text.Left = 24; $text.Top = 24; $text.Width = 220; $text.AccessibleName = 'Fixture Text'
$choose = New-Object System.Windows.Forms.Button
$choose.Text = 'Choose File'; $choose.Left = 24; $choose.Top = 70; $choose.Width = 140; $choose.Height = 40
$chosen = New-Object System.Windows.Forms.Label
$chosen.Text = 'nothing chosen'; $chosen.Left = 180; $chosen.Top = 80; $chosen.Width = 300
$covered = New-Object System.Windows.Forms.Button
$covered.Text = 'Covered'; $covered.Left = 24; $covered.Top = 140; $covered.Width = 140; $covered.Height = 40
$rename = New-Object System.Windows.Forms.Button
$rename.Text = 'Rename'; $rename.Left = 200; $rename.Top = 140; $rename.Width = 140; $rename.Height = 40
$choose.Add_Click({
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = '${DIALOG}'
  if ($dialog.ShowDialog($form) -eq 'OK') { $chosen.Text = 'picked:' + [IO.Path]::GetFileName($dialog.FileName) }
  [Console]::Out.WriteLine('CHOSEN ' + $chosen.Text); [Console]::Out.Flush()
})
$covered.Add_Click({ [Console]::Out.WriteLine('FIXTURE_COVERED_CLICK'); [Console]::Out.Flush() })
$rename.Add_Click({ $form.Text = '${TITLE} Renamed' })
$form.Controls.AddRange(@($text, $choose, $chosen, $covered, $rename))
$cover = New-Object System.Windows.Forms.Form
$cover.Text = '${COVER}'; $cover.FormBorderStyle = 'None'; $cover.TopMost = $true; $cover.ShowInTaskbar = $false
$cover.StartPosition = 'Manual'; $cover.BackColor = 'DarkRed'
$cover.Add_Click({ [Console]::Out.WriteLine('COVER_CLICK'); [Console]::Out.Flush() })
$form.Add_Shown({
  $point = $covered.PointToScreen((New-Object System.Drawing.Point(0, 0)))
  $cover.SetBounds($point.X - 10, $point.Y - 10, $covered.Width + 20, $covered.Height + 20)
  $cover.Show()
  $form.Activate()
  [Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
})
[System.Windows.Forms.Application]::Run($form)
`;

const lines = [];
const fixture = spawn(POWERSHELL, ["-NoLogo", "-NoProfile", "-STA", "-Command", fixtureScript],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
fixture.stdout.setEncoding("utf8");
fixture.stdout.on("data", (chunk) => lines.push(...chunk.split(/\r?\n/u).filter(Boolean)));
const scratch = mkdtempSync(join(tmpdir(), "pyprocAttempt32-"));
const results = [];
async function check(name, operation) {
  if (only && only !== name) return;
  try {
    await operation();
    results.push({ name, ok: true });
    console.log(`  PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error.message || error) });
    console.log(`  FAIL ${name}: ${error.message || error}`);
  }
}

try {
  for (let index = 0; index < 100 && !lines.includes("READY"); index += 1) await sleep(100);
  assert.ok(lines.includes("READY"), "fixture did not start");
  const window = { executablePath: POWERSHELL, windowTitle: TITLE };
  const observed = probe("observe", { ...window, roles: ["textbox", "button"] });
  const surface = observed.output.surface;
  const fence = { ...window, surface };
  const idle = probe("idle", {}).output.idleMs;
  console.log(`attempt 32 fixture probe (user idle ${idle} ms)`);

  await check("observation", () => {
    assert.equal(observed.ok, true);
    const names = observed.output.entities.map((entity) => `${entity.role}:${entity.name}`);
    for (const expected of ["textbox:Fixture Text", "button:Choose File", "button:Covered", "button:Rename"]) {
      assert.ok(names.includes(expected), `missing ${expected}`);
    }
    assert.equal(observed.output.inventory.complete, true);
    assert.equal(JSON.stringify(observed).includes("hwnd"), false);
  });

  await check("fences", () => {
    assert.equal(probe("observe", { ...window, executablePath: "C:\\Windows\\notepad.exe" }).error.code,
      "PROBE_WINDOW_STALE");
    assert.equal(probe("act", { ...fence, surface: "surface:" + "0".repeat(64), target: { role: "button",
      name: "Rename" }, intent: "activate" }).error.code, "PROBE_SURFACE_STALE");
    assert.equal(probe("act", { ...fence, target: { role: "button", name: "Missing" }, intent: "activate" })
      .error.code, "PROBE_TARGET_STALE");
  });

  await check("occlusion", async () => {
    assert.equal(probe("foreground", window).output.foreground, true);
    const before = lines.length;
    const refused = probe("click", { ...fence, target: { role: "button", name: "Covered" } });
    await sleep(500);
    const received = lines.slice(before);
    assert.equal(received.includes("COVER_CLICK"), false, "the click reached the covering window");
    assert.equal(received.includes("FIXTURE_COVERED_CLICK"), false, "the covered button was clicked through");
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, "PROBE_TARGET_OCCLUDED");
    assert.equal(refused.error.outcome, "notSent");
  });

  await check("hangul", async () => {
    assert.equal(probe("foreground", window).output.foreground, true);
    assert.equal(probe("click", { ...fence, target: { role: "textbox", name: "Fixture Text" } }).ok, true);
    const typed = probe("type", { ...fence, target: { role: "textbox", name: "Fixture Text" }, text: "한글 입력" });
    assert.equal(typed.ok, true, JSON.stringify(typed.error));
    assert.equal(typed.output.inputMethodAfter.hangul, true);
    assert.equal(probe("key", { ...fence, key: "End" }).ok, true);
    await sleep(300);
    const value = probe("observe", { ...window, roles: ["textbox"] }).output.entities
      .find((entity) => entity.name === "Fixture Text").value;
    assert.equal(value, "한글 입력");
    probe("inputMethod", { ...window, setHangul: typed.output.inputMethodBefore.hangul });
  });

  await check("dialog", async () => {
    const file = join(scratch, "fixture 선택.txt");
    writeFileSync(file, "attempt 32\n");
    assert.equal(probe("foreground", window).output.foreground, true);
    assert.equal(probe("click", { ...fence, target: { role: "button", name: "Choose File" } }).ok, true);
    const dialog = { executablePath: POWERSHELL, windowTitle: DIALOG };
    assert.equal(probe("waitWindow", { ...dialog, timeoutMs: 10000 }).ok, true);
    const seen = probe("observe", { ...dialog, roles: ["textbox", "button", "splitbutton"] }).output;
    const name = seen.entities.find((entity) => entity.role === "textbox" && entity.automationId === "1148");
    const open = seen.entities.find((entity) => ["button", "splitbutton"].includes(entity.role)
      && entity.automationId === "1");
    assert.ok(name && open, "file name field or open button is missing");
    const dialogFence = { ...dialog, surface: seen.surface };
    assert.equal(probe("act", { ...dialogFence, target: { role: "textbox", name: name.name, automationId: "1148" },
      intent: "setValue", value: file }).output.terminal, "confirmed");
    const closed = probe("act", { ...dialogFence, target: { role: open.role, name: open.name, automationId: "1" },
      intent: "activate", expectClosed: true });
    assert.equal(closed.output.terminal, "confirmed");
    for (let index = 0; index < 50 && !lines.some((line) => line.startsWith("CHOSEN ")); index += 1) await sleep(100);
    assert.ok(lines.includes("CHOSEN picked:fixture 선택.txt"), lines.join(" | "));
  });

  await check("surfaceChange", () => {
    assert.equal(probe("act", { ...fence, target: { role: "button", name: "Rename" }, intent: "activate" }).ok, true);
    const renamed = { executablePath: POWERSHELL, windowTitle: `${TITLE} Renamed`, surface };
    assert.equal(probe("act", { ...renamed, target: { role: "button", name: "Rename" }, intent: "activate" })
      .error.code, "PROBE_SURFACE_STALE");
  });
} finally {
  fixture.kill();
  rmSync(scratch, { recursive: true, force: true });
}
const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ probe: PROBE, results }, null, 1));
process.exit(failed.length ? 1 : 0);
