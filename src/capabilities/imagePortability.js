// imagePortability.js - Layer 2: "이 힙을 이미지로 쓸 수 있는가"의 단일 판정.
//
// 왜 한 곳인가: 이미지를 쓰는 입구가 셋이다(session.save, session.exportImage, journal.commit).
// 판정이 입구마다 살면 하나가 빠지고, 실제로 빠져 있었다(감사 실측 2026-08-01: 저널 WAL이
// 판정 없이 커밋했고 recover는 새 탭의 새 커널로 그것을 되살린다).
//
// 판정의 근거는 실측이다(workerGuest 캠페인 13케이스): JS 핸들은 인터프리터 국소 상태라 힙
// 이미지가 나르지 못한다. 내보낸 커널이 핸들을 하나라도 심었으면, 그 이미지로 부활한 커널은
// 프록시 경로 전부가 트랩한다 - 이름을 지우거나 표면을 다시 심어도 살아나지 않는다. 그래서
// 판정은 "지금 핸들이 있는가"가 아니라 "이 힙에 핸들이 심긴 적이 있는가"이고, 그 집합은
// 단조 증가한다(케이스 B/D가 제거로도 못 살린다는 것을 보였다).
import { PyProcError } from "../runtime/errors.js";

export function requirePortableHeap(rt, entry, opts = {}) {
  if (opts.allowHostProxies === true) return;
  const names = typeof rt.hostProxySurfaces === "function" ? rt.hostProxySurfaces() : [];
  if (!names.length) return;
  throw new PyProcError(
    "PYPROC_IMAGE_PROXY_SURFACE",
    `${entry}: this heap holds JS handles installed as ${names.join(", ")}, and a JS handle cannot cross an image: `
    + "the revived kernel traps on every proxy path, including handles it mints itself. "
    + "Move the surface to a value boundary (pure Python plus bytes through run(), as the packet port does), "
    + "or pass { allowHostProxies: true } if this image is only ever opened in the context that made it.",
  );
}
