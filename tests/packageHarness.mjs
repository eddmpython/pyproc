// tests/packageHarness.mjs - npm tarball 소비자 게이트 공용 조각.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function commandSpec(cmd, args) {
  if (cmd === "npm" && process.platform === "win32") {
    const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (!existsSync(npmCli)) throw new Error(`npm-cli.js 없음: ${npmCli}`);
    return { command: process.execPath, args: [npmCli, ...args], display: `npm ${args.join(" ")}` };
  }
  if (process.platform === "win32" && cmd.endsWith(".cmd")) {
    return { command: cmd, args, display: `${cmd} ${args.join(" ")}`, shell: true };
  }
  return { command: cmd, args, display: `${cmd} ${args.join(" ")}` };
}

export function run(cmd, args, opts = {}) {
  const spec = commandSpec(cmd, args);
  const r = spawnSync(spec.command, spec.args, {
    cwd: opts.cwd ?? ROOT,
    encoding: "utf8",
    stdio: "pipe",
    shell: spec.shell ?? false,
  });
  if (r.status !== 0) {
    const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();
    const reason = r.error ? `\n${r.error.message}` : "";
    throw new Error(`${spec.display} failed${reason}\n${out.slice(-4000)}`);
  }
  return r;
}

export function binPath(appDir, name) {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return join(appDir, "node_modules", ".bin", `${name}${suffix}`);
}

export async function installPackedPyProc(prefix = "pyprocConsumer-") {
  const tmp = mkdtempSync(join(tmpdir(), prefix));
  const pack = run("npm", ["pack", "--json", "--pack-destination", tmp], { cwd: ROOT });
  // pack --json의 형상은 npm 메이저에 따라 다르다(실측 2026-07-19): npm 10은 배열
  // [{filename,...}], npm 12는 패키지명 키의 객체 {"pyproc": {filename,...}}. 러너는
  // trusted publishing 요건으로 npm@latest를 쓰므로 두 형상을 모두 수용한다.
  const parsed = JSON.parse(pack.stdout.trim());
  const packed = Array.isArray(parsed) ? parsed[0]
    : (parsed?.filename ? parsed : Object.values(parsed ?? {})[0]);
  if (!packed?.filename) throw new Error("npm pack JSON에 filename이 없음");

  const appDir = join(tmp, "app");
  await mkdir(appDir, { recursive: true });
  await writeFile(join(appDir, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2));
  run("npm", ["install", join(tmp, packed.filename), "--package-lock=false", "--ignore-scripts", "--no-audit", "--no-fund", "--silent"], { cwd: appDir });
  return { tmp, appDir, packed };
}
