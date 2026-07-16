// wheelUnzip.js - 순수 파이썬 wheel(= zip)을 브라우저 네이티브 DecompressionStream으로 푼다.
// 의존성 0(외부 zip 라이브러리 금지): 압축 해제는 플랫폼의 deflate-raw를 쓴다. WasiSession의
// installWheel이 이걸로 wheel을 풀어 파일 목록을 얻고, 파이썬이 /site에 써서 import 가능하게 한다.
//
// 중앙 디렉터리 기반으로 읽는다: local header만 걸으면 data descriptor(범용 플래그 bit3 = 크기가
// 헤더에 0으로 오고 데이터 뒤에 오는) wheel에서 크기를 몰라 깨진다. 중앙 디렉터리는 항상 정확한
// 크기/오프셋을 담으므로 pip/build가 만든 어떤 wheel도 정확히 푼다.

import { PyProcError } from "../../errors.js";

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// wheel(ArrayBuffer 또는 Uint8Array)을 [ [path, Uint8Array], ... ]로 푼다. 디렉터리 엔트리는 제외.
export async function unzipWheel(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // EOCD(0x06054b50)를 뒤에서 찾는다(zip 코멘트 최대 65535 + 헤더 22바이트 범위).
  let eocd = -1;
  const floor = Math.max(0, u8.length - 22 - 65535);
  for (let i = u8.length - 22; i >= floor; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new PyProcError("PYPROC_ASSET_INTEGRITY", "unzipWheel: EOCD 없음(zip 아님)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true); // 중앙 디렉터리 시작 오프셋
  const files = [];
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new PyProcError("PYPROC_ASSET_INTEGRITY", "unzipWheel: 중앙 디렉터리 헤더 손상");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    // 실제 데이터 시작: local header의 name/extra 길이는 central과 다를 수 있으니 local에서 읽는다.
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = u8.subarray(dataStart, dataStart + compSize);
    let content;
    if (method === 0) content = comp.slice();               // stored
    else if (method === 8) content = await inflateRaw(comp); // deflate
    else throw new PyProcError("PYPROC_ASSET_INTEGRITY", "unzipWheel: 미지원 압축 방식 " + method + " (" + name + ")");
    if (!name.endsWith("/")) files.push([name, content]);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
