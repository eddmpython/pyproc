// coreAssetCache.js - Layer 0: 엔진 코어 자산의 캐시와 무결성 검증.
//
// boot() 안에 인라인으로 살던 38줄짜리 클로저였다. 그 함수 하나가 12개 옵션의 상호의존 분기와
// 이 캐시를 함께 지고 있었고, cache 객체는 설정이자 통계 누산기이자 실패 콜백 홀더로 세 역할을
// 겸했다. 여기서는 그 셋을 이름으로 가른다.
//
// 계약: 로컬 캐시도 실행 바이트다. 변조된 캐시를 네트워크로 조용히 우회하지 않고 부팅을 멈춘다.
import { PyProcError } from "./errors.js";
import { verifySri } from "./contentDigest.js";

const CORE_MIME = { ".wasm": "application/wasm", ".zip": "application/zip", ".json": "application/json", ".js": "text/javascript", ".mjs": "text/javascript" };

export function normalizeCoreIntegrity(policy) {
  if (!policy) return null;
  const files = policy.files || policy;
  return { files, required: policy.required !== false };
}

function expectedCoreIntegrity(policy, url, name) {
  if (!policy) return null;
  const href = new URL(url, location.href).href;
  const pathname = new URL(href).pathname;
  let relative = null;
  const indexRoot = policy.indexURL ? new URL(policy.indexURL, location.href).href : "";
  if (indexRoot && href.startsWith(indexRoot)) relative = href.slice(indexRoot.length);
  return policy.files[href]
    || policy.files[url]
    || policy.files[pathname]
    || policy.files[pathname.replace(/^\/+/, "")]
    || (relative ? policy.files[relative] : null)
    || policy.files[name]
    || null;
}

// 코어 자산 캐시 하나. dir이 없어도 무결성 정책만으로 성립한다(검증만 하고 저장하지 않는다).
export function createCoreAssetCache({ dir = null, integrity = null }) {
  const stats = { hits: 0, misses: 0, verified: 0, integrityMissing: 0 };
  let rejectIntegrity = null;
  // 무결성 실패는 로드 promise와 경주해 즉시 부팅을 깬다. 실패를 던지기만 하면 엔진 내부가
  // 그것을 삼키고 다른 경로로 계속 갈 수 있다.
  const integrityFailure = new Promise((_, reject) => { rejectIntegrity = reject; });
  let originalFetch = null;
  const fail = (error) => {
    const e = error instanceof Error ? error : new PyProcError("PYPROC_ASSET_INTEGRITY", String(error));
    if (rejectIntegrity) rejectIntegrity(e);
    throw e;
  };
  const verify = async (data, expected, name) => {
    try { await verifySri(data, expected, name); stats.verified++; }
    catch (e) { fail(e); }
  };
  return {
    stats,
    integrityFailure,
    setOriginalFetch(fetchFn) { originalFetch = fetchFn; },
    async fetchAsset(url) {
      const name = new URL(url).pathname.split("/").pop();
      const ext = name.slice(name.lastIndexOf("."));
      const type = CORE_MIME[ext] || "application/octet-stream";
      const expected = expectedCoreIntegrity(integrity, url, name);
      if (integrity?.required && !expected) {
        stats.integrityMissing++;
        fail(new PyProcError("PYPROC_ASSET_INTEGRITY", `integrity: ${name} is not listed in coreIntegrity`));
      }
      if (dir) {
        // 캐시에 있는가와 그 바이트가 옳은가는 다른 질문이다. 예전에는 둘을 한 try로 감싸고
        // 오류 메시지에 "integrity:"가 들어 있는지로 갈랐다: 오류 문구를 다듬는 리팩터 하나가
        // 그 분기를 무력화하는 자리였고, code 계약이 있는데도 쓰지 않았다.
        let cached = null;
        try { cached = await (await dir.getFileHandle(name)).getFile(); }
        catch (e) { cached = null; } // 캐시 미스(파일 없음/권한 없음) -> 네트워크
        if (cached) {
          const data = await cached.arrayBuffer();
          if (expected) await verify(data, expected, name);
          stats.hits++;
          return new Response(data, { headers: { "Content-Type": type } });
        }
      }
      const resp = await (originalFetch || fetch)(url); // 감싼 fetch 재진입(무한 재귀) 방지
      if (!resp.ok) return resp;
      const data = await resp.arrayBuffer();
      if (expected) await verify(data, expected, name);
      if (dir) {
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable(); await w.write(data); await w.close();
      }
      stats.misses++;
      return new Response(data, { headers: { "Content-Type": type } });
    },
  };
}
