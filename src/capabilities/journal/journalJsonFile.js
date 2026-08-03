// journalJsonFile.js - Layer 2: 저널 디렉터리의 JSON 파일 1개 판독.
//
// "파일 없음"(첫 부팅)과 "파일 파손"(손상)을 구분하는 것이 이 판독의 전부다. 손상을 첫 부팅으로
// 위장하면 저널이 있는데도 조용히 빈 머신으로 부팅하는 데이터 유실이 된다(외부 평가 적발).
// 그 판정이 마커 판독과 구 세대 판독에 두 벌로 살아 있었고, 두 벌이면 하나는 뒤처진다.
export async function readJsonFile(dir, name) {
  let text;
  try { text = await (await (await dir.getFileHandle(name)).getFile()).text(); }
  catch (e) {
    if (e.name === "NotFoundError") return { missing: true };
    return { corrupt: `${name} 읽기 실패(${e.name})` };
  }
  try { return { value: JSON.parse(text) }; }
  catch (e) { return { corrupt: `${name} JSON 파손(${e.message})` }; }
}
