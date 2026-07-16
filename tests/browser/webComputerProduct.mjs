// webComputerProduct.mjs - 실제 제품 URL의 부팅, 저장, 재시작, 이동 image 동선을 실행한다.
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["tests/browser/run.mjs", "apps/webComputer/"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: { ...process.env, PYPROC_GATE_INITIAL_SEARCH: "?gate=1" },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
