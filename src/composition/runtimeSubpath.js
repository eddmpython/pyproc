// runtimeSubpath.js - Layer 3 조립: `pyproc/runtime` subpath가 가리키는 지점.
//
// 왜 rank 0 배럴(src/runtime/index.js)을 직접 가리키지 않는가: 능력 팩토리(`enableReactive`,
// `enableAsgiServer` ...)는 `runtimeApi.js`가 import 시점에 Runtime.prototype에 설치한다. 그래서
// subpath가 rank 0 배럴을 가리키면 그것을 단독으로 import한 소비자는 팩토리 없는 Runtime을 받고,
// 문서가 지시하는 채택 패턴이 `rt.enableReactive is not a function`으로 죽는다(2026-07-27
// workerGuest 캠페인이 라이브로 재현했다: contract.md의 `new Runtime(py)` 후 `enableAsgiServer`가
// 그 형태다). runtimeApi의 머리말은 이미 "index.js와 pyproc/runtime이 이것을 소비한다"고 적고
// 있었고, 어긋난 것은 배선이었다.
//
// 층은 지킨다: rank 0이 composition을 import할 수는 없으므로(위로 향함), 반대로 composition이
// rank 0 배럴을 재수출한다. 이 파일이 존재하는 이유 전부가 그 방향이다.
import "./runtimeApi.js"; // 부수효과: Runtime.prototype에 능력 레지스트리를 설치한다

export * from "../runtime/index.js";
