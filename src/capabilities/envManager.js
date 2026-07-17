// envManager.js - Layer 1 능력: uv 레인 = 환경의 선언 -> 즉시 부팅 -> 스크립트 자급.
// 실측(tests/attempts/envManager, 2026-07-12):
//   - 패키지가 실린 힙 스냅샷은 hiwire 벽(#5195, "Unexpected hiwire entry at index 6").
//     postImport / loadPyodide({packages}) / makeMemorySnapshot({serializer}) 3레인 전부 거부.
//   - 실전 우회: bare 스냅샷(_loadSnapshot 197ms, 콜드 부팅 3645ms 대비 18배) + OPFS 휠 +
//     import = 환경 웜 부팅 5465ms -> 1515ms (3.61배). 이 파일은 그 조립이다.
//   - PEP 723 인라인 메타데이터로 .py 파일이 의존성을 자급한다(브라우저판 uv run).
// core Runtime만 쓴다(enable* 호출 0). 합성 루트를 경유하면 능력이 조립을 부르는 위로 edge가
// 되므로 원산인 runtime.js에서 직접 받는다.
import { DEFAULT_INDEX, ensureEngineScript, Runtime } from "../runtime/runtime.js";
import { PyodideEngine } from "../runtime/engines/pyodideEngine.js";
import { WheelCache } from "./wheelCache.js";

async function hashHex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 환경 선언(manifest: indexURL/env/lockFileURL/packages/setup)으로 부팅한다.
// dirs(소비자 제공 디렉터리 핸들)가 캐시를 결정한다:
//   dirs.snapshots - bare 힙 스냅샷(엔진 버전당 1개). 2차 부팅이 설치 아닌 복원이 된다.
//   dirs.wheels    - .whl 캐시. 패키지 재다운로드 0.
// 반환: Runtime (rt.envBoot = { lane, bootMs, installMs, setupMs, totalMs } 통계 부착).
export async function bootEnv(manifest = {}, dirs = {}) {
  const indexURL = manifest.indexURL || DEFAULT_INDEX;
  await ensureEngineScript(indexURL);
  const cfg = { indexURL };
  if (manifest.env) cfg.env = manifest.env;
  if (manifest.lockFileURL) cfg.lockFileURL = manifest.lockFileURL;

  // 스냅샷 키는 indexURL에만 의존한다: 락/패키지는 힙 밖(JS/휠)에서 재적용되는 층이고,
  // 패키지가 실린 힙은 hiwire 벽으로 스냅샷 불가(상단 실측)라 bare가 유일한 스냅샷 단위다.
  const t0 = performance.now();
  let py = null, lane = "cold", cacheError = null;
  if (dirs.snapshots) {
    const name = "bare-" + (await hashHex(indexURL)) + ".bin";
    try {
      const f = await (await dirs.snapshots.getFileHandle(name)).getFile();
      py = await loadPyodide({ ...cfg, _loadSnapshot: new Uint8Array(await f.arrayBuffer()) });
      lane = "snapshot";
    } catch (e) { /* 캐시 미스 -> 콜드 부팅 + 채움 (best-effort 캐시) */ }
    if (!py) {
      py = await loadPyodide({ ...cfg, _makeSnapshot: true });
      lane = "coldFill";
      try {
        const snap = py.makeMemorySnapshot();
        const fh = await dirs.snapshots.getFileHandle(name, { create: true });
        const w = await fh.createWritable(); await w.write(snap); await w.close();
      } catch (e) { cacheError = String(e).slice(0, 120); } // 채움 실패는 부팅을 죽이지 않는다
    }
  } else {
    py = await loadPyodide(cfg);
  }
  const bootMs = Math.round(performance.now() - t0);

  // indexURL을 반드시 넘긴다: 빠뜨리면 기본 CDN으로 되돌아가 자식 워커/subprocess가
  // 자체 호스팅·오프라인 배포 지점에서 샌다(외부 평가 적발 실버그, 2026-07-12).
  const rt = new Runtime(new PyodideEngine(py), indexURL);
  const t1 = performance.now();
  if (manifest.packages && manifest.packages.length) {
    if (dirs.wheels) await new WheelCache(rt, { dir: dirs.wheels }).loadPackages(manifest.packages);
    else await rt.loadPackages(manifest.packages);
  }
  const installMs = Math.round(performance.now() - t1);
  const t2 = performance.now();
  if (manifest.setup) rt.run(manifest.setup);
  const setupMs = Math.round(performance.now() - t2);
  rt.envBoot = { lane, bootMs, installMs, setupMs, totalMs: Math.round(performance.now() - t0) };
  if (cacheError) rt.envBoot.cacheError = cacheError;
  return rt;
}

// PEP 723 판독기: 스펙 정규식 + tomllib(전부 파이썬 표준 라이브러리). 자작 파서 금지.
const PEP723_READER = `
import re as _pyprocRe, tomllib as _pyprocToml, json as _pyprocJson
def _pyprocPep723(src):
    pat = r'(?m)^# /// (?P<type>[a-zA-Z0-9-]+)$\\s(?P<content>(^#(| .*)$\\s)+)^# ///$'
    found = [m for m in _pyprocRe.finditer(pat, src) if m.group('type') == 'script']
    if len(found) > 1:
        raise ValueError('script 블록 중복')
    if not found:
        return None
    content = ''.join(line[2:] if line.startswith('# ') else line[1:] for line in found[0].group('content').splitlines(keepends=True))
    return _pyprocJson.dumps(_pyprocToml.loads(content))
`;

// 브라우저판 uv run: PEP 723 인라인 메타데이터(# /// script)를 읽어 의존성을 자동 설치하고
// 스크립트를 실행한다(.py 파일 하나가 자급 단위). opts.wheelDir로 휠 캐시 경유.
// requires-python은 파싱해 반환만 한다(강제하지 않음: 버전 해석기는 v1 스코프 밖).
export async function runScript(rt, src, opts = {}) {
  rt.run(PEP723_READER);
  rt.setGlobal("_pyprocScriptSrc", src);
  const metaJson = rt.run("_pyprocPep723(_pyprocScriptSrc)");
  const meta = metaJson ? JSON.parse(metaJson) : null;
  const deps = (meta && meta.dependencies) || [];
  if (deps.length) {
    const wc = opts.wheelDir ? new WheelCache(rt, { dir: opts.wheelDir }) : null;
    for (const dep of deps) await (wc ? wc.install(dep) : rt.install(dep));
  }
  return {
    result: await rt.runAsync(src),
    dependencies: deps,
    requiresPython: (meta && meta["requires-python"]) || null,
  };
}
