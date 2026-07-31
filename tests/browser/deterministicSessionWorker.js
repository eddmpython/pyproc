// deterministicSessionWorker.js - 결정적 리플레이 세션을 워커에서 호스팅하는 게이트 대상.
// 워커에는 document가 없어 엔진 스크립트를 태그로 심을 수 없다. 그래서 워커가 엔진을 스스로
// import하고 loadPyodide를 매니페스트로 넘긴다(호스트 능력이지 환경 선언이 아니다).
// 이 파일이 검증하는 계약은 셋이다: (1) 결정적 부팅이 워커에서 성립한다, (2) 워커 커널의
// cp0이 메인 커널의 cp0과 바이트 단위로 같다(전달이 결정성을 건드리지 않는다),
// (3) 워커가 내보낸 이미지가 워커 경계를 건너 메인 스레드에서 부활한다.
import { bootSession, openMachine } from "../../src/session/session.js";
import { DEFAULT_INDEX } from "../../src/runtime/runtime.js";

let session = null;

onmessage = async (event) => {
  const message = event.data || {};
  const { reqId } = message;
  try {
    if (message.type === "boot") {
      // 기본 배포 지점은 런타임의 상수 하나가 정본이다(게이트가 사본을 만들면 엔진 버전 이동
      // 때 워커만 옛 지점에 남아, cp0 대조가 "다른 엔진끼리"의 비교가 된다).
      const indexURL = message.indexURL || DEFAULT_INDEX;
      const engine = await import(indexURL + "pyodide.mjs");
      session = await bootSession({ indexURL, loadPyodide: (cfg) => engine.loadPyodide(cfg) });
      postMessage({
        reqId,
        ok: true,
        h0: await session._cp0Digest(),
        hasDocument: typeof document !== "undefined",
        globalEngine: typeof globalThis.loadPyodide,
      });
      return;
    }
    if (message.type === "openImage") {
      // 부활도 워커에서 성립해야 한다: 파일 안 매니페스트는 JSON이라 로더를 담을 수 없으므로
      // 호출 옵션으로 준다(session.js withHostLoader). openState가 h0를 대조하므로, 성공 자체가
      // "이 워커의 cp0 == 이미지를 만든 워커의 cp0"의 증거다.
      const indexURL = message.indexURL || DEFAULT_INDEX;
      const engine = await import(indexURL + "pyodide.mjs");
      session = await openMachine(new Blob([message.bytes]), {
        trust: true,
        loadPyodide: (cfg) => engine.loadPyodide(cfg),
      });
      postMessage({ reqId, ok: true, h0: await session._cp0Digest() });
      return;
    }
    if (!session) throw new Error("deterministicSessionWorker: 부팅 전");
    if (message.type === "run") {
      postMessage({ reqId, ok: true, value: session.rt.run(String(message.code || "")) });
      return;
    }
    if (message.type === "exportImage") {
      const blob = await session.exportImage();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      postMessage({ reqId, ok: true, bytes }, [bytes.buffer]);
      return;
    }
    throw new Error(`deterministicSessionWorker: 미지원 요청 ${message.type}`);
  } catch (error) {
    postMessage({ reqId, ok: false, message: String(error?.message || error), code: error?.code || "" });
  }
};
