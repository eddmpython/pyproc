// envelopeBoundary.mjs - [봉투·이미지 경계] 절의 본문.
//
// run.mjs에서 나온 이유는 크기가 아니라 책임이다: 이 절은 property/fuzz 판정이고, run.mjs는
// 절을 엮어 돌리는 러너다. 판정 이름과 개수는 그대로다(게이트 층 하한이 그것을 센다).
// check는 러너가 주입한다: 통과/실패의 보고 방식은 러너가 소유한다.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mulberry32 } from "./seededRandom.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

export async function assertEnvelopeBoundary(check, checkAsync) {
  const provider = globalThis.crypto;
  const bundle = await import(pathToFileURL(join(ROOT, "src", "state", "bundleFormat.js")).href);
  const tags = await import(pathToFileURL(join(ROOT, "src", "state", "signedTag.js")).href);
  const { sha256AddressWith, sha256HexWith } = await import(pathToFileURL(join(ROOT, "src", "runtime", "contentDigest.js")).href);
  const image = await import(pathToFileURL(join(ROOT, "src", "session", "machineImage.js")).href);
  const { PAGE_SIZE: IMG_PAGE } = await import(pathToFileURL(join(ROOT, "src", "runtime", "memoryLayout.js")).href);
  const enc = new TextEncoder();
  const expectCode = async (fn, code, label) => {
    let got = "예외 없음";
    try { await fn(); } catch (e) { got = e.code || String(e.message || e); }
    if (got !== code) throw new Error(`${label}: 기대 ${code}, 실제 ${got}`);
  };

  // 서명된 bundle 하나를 짓는다(machine envelope 형태: commit=null). 오브젝트 주소는 내용주소.
  const blobA = new Uint8Array([1, 2, 3, 4, 5]);
  const blobB = new Uint8Array([9, 8, 7]);
  const addrA = await sha256AddressWith(provider, blobA);
  const addrB = await sha256AddressWith(provider, blobB);
  const meta = { kind: "gate", n: 1 };
  const objects = new Map([[addrA, blobA], [addrB, blobB]]);
  const headerDigest = await bundle.stateBundleHeaderDigest(provider, { commit: null, meta, objects });
  const keyPair = await tags.createStateKeyPair(provider);
  const pubJwk = await tags.exportStatePublicKey(provider, keyPair.publicKey);
  const tag = await tags.makeStateTag(provider, keyPair.privateKey, pubJwk, headerDigest);
  const signed = await bundle.encodeStateBundle(provider, { commit: null, meta, objects, tag });

  await checkAsync("봉투: 서명 bundle 접두 판독 정상(tag.target = 헤더 다이제스트)", async () => {
    const head = await bundle.readStateBundleHeader(provider, signed);
    if (head.tag.target !== headerDigest) throw new Error("tag.target != headerDigest");
    if (head.objects.length !== 2) throw new Error(`objects ${head.objects.length}`);
    const decoded = await bundle.decodeStateBundle(provider, signed);
    if (decoded.objects.get(addrA)[0] !== 1) throw new Error("decode 오브젝트 불일치");
  });

  // 접두 판독(신뢰 게이트)과 전량 디코드가 같은 헤더 판정을 쓴다. 예전에는 판정이 두 벌이었고
  // 접두 판독 쪽이 더 약했다(오브젝트 주소 형식과 길이를 한 덩어리로 봤다). 그 방향의 비대칭은
  // 조기 거부의 존재 이유를 무너뜨린다: 약한 쪽이 통과시킨 것을 나중 디코드가 잡으면 그때는
  // 이미 payload를 만진 뒤다. 두 경로에 같은 위조 헤더를 넣어 판정이 같은지 대조한다.
  await checkAsync("봉투: 접두 판독과 전량 디코드의 헤더 판정이 같다", async () => {
    const enc2 = new TextEncoder();
    // 헤더 JSON을 직접 조립해 봉투를 만든다(정상 경로로는 만들 수 없는 위조 색인을 넣는다).
    const forge = async (headerObject) => {
      const head = enc2.encode(JSON.stringify(headerObject));
      const body = new Uint8Array(4 + head.length);
      new DataView(body.buffer).setUint32(0, head.length);
      body.set(head, 4);
      const envelopeHex = await sha256HexWith(provider, body);
      const magic = enc2.encode(bundle.STATE_BUNDLE_MAGIC); // 상수를 직접 쓰면 오타가 magic 거부로 위장된다
      const out = new Uint8Array(magic.length + 64 + body.length);
      out.set(magic, 0);
      out.set(enc2.encode(envelopeHex), magic.length);
      out.set(body, magic.length + 64);
      return out;
    };
    const codeOf = async (fn) => {
      try { await fn(); return "예외 없음"; } catch (e) { return e.code || String(e.message || e); }
    };
    const forgeries = [
      { label: "주소 형식 위반", objects: [["not-an-address", 1]] },
      { label: "길이 음수", objects: [[`sha256:${"a".repeat(64)}`, -1]] },
      { label: "엔트리 형태 위반", objects: [[`sha256:${"a".repeat(64)}`]] },
      { label: "색인이 배열 아님", objects: {} },
    ];
    const problems = [];
    for (const forgery of forgeries) {
      const bytes = await forge({ version: 1, commit: null, meta: null, objects: forgery.objects, tag: null });
      const headCode = await codeOf(() => bundle.readStateBundleHeader(provider, bytes));
      const fullCode = await codeOf(() => bundle.decodeStateBundle(provider, bytes));
      if (headCode === "예외 없음") problems.push(`${forgery.label}: 접두 판독이 통과시켰다`);
      if (headCode !== fullCode) problems.push(`${forgery.label}: 접두 ${headCode} != 디코드 ${fullCode}`);
    }
    if (problems.length) throw new Error(problems.join(" / "));
  });
  // index-forgery: 헤더의 objects 색인 안 오브젝트 주소 hex 한 자를 뒤집는다(길이·형식 불변,
  // 여전히 sha256:64hex). 서명은 못 다시 하므로 tag는 그대로. readStateBundleHeader가 헤더를
  // 재직렬화해 다이제스트를 다시 계산하면 tag.target과 어긋난다 -> payload 접촉 전 INTEGRITY 거부.
  // 이것이 "색인 조작은 서명 대상 불일치가 잡는다"의 음성 증명(잃어버렸던 headerTagProbe).
  await checkAsync("봉투: index-forgery는 접두 판독에서 INTEGRITY 거부(payload 접촉 0)", async () => {
    const addrBytes = enc.encode(addrA);
    let at = -1;
    outer: for (let i = 78; i + addrBytes.length <= signed.length; i++) { // 78 = MAGIC(10)+envelope(64)+u32(4)
      for (let j = 0; j < addrBytes.length; j++) if (signed[i + j] !== addrBytes[j]) continue outer;
      at = i; break;
    }
    if (at < 0) throw new Error("헤더에서 오브젝트 주소를 못 찾음");
    const forged = signed.slice();
    const last = at + addrBytes.length - 1; // 주소 마지막 hex 문자
    forged[last] = forged[last] === 0x61 /* 'a' */ ? 0x62 /* 'b' */ : 0x61;
    await expectCode(() => bundle.readStateBundleHeader(provider, forged), "PYPROC_MACHINE_INTEGRITY", "index-forgery");
  });

  // version 거부: 접두 판독은 봉투 무결성을 안 보므로(payload는 verify-on-read가 개별 검증),
  // 헤더의 version 숫자만 바꿔도 지원 버전 검사에서 FORMAT_INVALID. "version":1 -> "version":2.
  await checkAsync("봉투: 지원하지 않는 version 접두 거부", async () => {
    const needle = enc.encode('"version":1');
    let at = -1;
    outer: for (let i = 78; i + needle.length <= signed.length; i++) {
      for (let j = 0; j < needle.length; j++) if (signed[i + j] !== needle[j]) continue outer;
      at = i; break;
    }
    if (at < 0) throw new Error('"version":1 못 찾음');
    const forged = signed.slice();
    forged[at + needle.length - 1] = 0x32; // '1' -> '2'
    await expectCode(() => bundle.readStateBundleHeader(provider, forged), "PYPROC_MACHINE_FORMAT_INVALID", "version");
  });

  // decodeStateBundle의 봉투 무결성: 오브젝트 바이트 1개를 뒤집으면 verify-on-read보다 먼저
  // 봉투 다이제스트(전신)가 어긋나 INTEGRITY. (payload 영역 변조)
  await checkAsync("봉투: 오브젝트 바이트 변조 decode INTEGRITY", async () => {
    const forged = signed.slice();
    forged[forged.length - 1] ^= 0xff;
    await expectCode(() => bundle.decodeStateBundle(provider, forged), "PYPROC_MACHINE_INTEGRITY", "payload tamper");
  });

  // 구 이미지(machineImage.js) 적대적 입력 경계: v1 거부 + validateMeta/validateManifest 전수.
  await checkAsync("이미지: 포맷 v1(무인증 헤더) 거부", async () => {
    const v1 = new Uint8Array([...enc.encode(image.MACHINE_MAGIC_V1), ...new Uint8Array(64), 0, 0, 0, 0]);
    await expectCode(() => image.decodeMachineEnvelope(v1), "PYPROC_MACHINE_FORMAT_INVALID", "v1 magic");
  });
  await checkAsync("이미지: 봉투해시 불일치 INTEGRITY", async () => {
    // 매직 v2 + 틀린 봉투해시 64자 + body(u32=0). 봉투해시가 sha256(body)와 다르므로 INTEGRITY.
    const body = new Uint8Array(4); // headLen 0
    const wrong = "0".repeat(64);
    const buf = new Uint8Array([...enc.encode(image.MACHINE_MAGIC), ...enc.encode(wrong), ...body]);
    await expectCode(() => image.decodeMachineEnvelope(buf), "PYPROC_MACHINE_INTEGRITY", "envelope hash");
  });
  check("이미지: validateMeta 경계 전수(과대할당·부분복원 차단)", () => {
    const bin = IMG_PAGE; // pages=[0] -> binLen = 1 * PAGE
    const good = { version: 2, manifest: "{}", heapLen: 2 * IMG_PAGE, sp: 0, pages: [0] };
    image.validateMeta({ ...good }, bin); // 정상: 예외 없음(heapLen 2페이지라 page 0/1 범위 내)
    // [meta, label, binLen]. binLen 생략 시 기본 bin. 각 케이스는 "그 검사만" 격리해야
    // 음성 시험이 이빨을 증명한다: 예컨대 페이지수 불일치는 범위·중복에 안 걸리는 입력으로.
    const cases = [
      [null, "메타 non-object"],
      [{ ...good, version: 0 }, "version 0"],
      [{ ...good, version: 4 }, "version 4"],
      [{ ...good, manifest: 42 }, "manifest 비문자열"],
      [{ ...good, heapLen: 0 }, "heapLen 0"],
      [{ ...good, heapLen: -1 }, "heapLen 음수"],
      [{ ...good, sp: 2 * IMG_PAGE + 1 }, "sp > heapLen"],
      [{ ...good, pages: "nope" }, "pages 비배열"],
      // 페이지수 검사 격리: page 0은 범위 내·무중복인데 binLen이 2페이지 -> 오직 수 불일치만 발동.
      [{ ...good, pages: [0] }, "pages 수 != binLen", 2 * IMG_PAGE],
      [{ ...good, pages: [999999] }, "page 번호 범위 초과"],
      // 중복 페이지 격리: binLen 2페이지로 수 검사 통과 후 중복 검사 도달.
      [{ ...good, pages: [0, 0] }, "페이지 번호 중복", 2 * IMG_PAGE],
      [{ version: 3, manifest: "{}", heapLen: 2 * IMG_PAGE, sp: 0, pages: [0], deltaBytes: 123 }, "v3 deltaBytes 불일치"],
    ];
    for (const [m, label, binOverride] of cases) {
      let threw = false;
      try { image.validateMeta(m, binOverride ?? bin); } catch (e) { threw = e.code === "PYPROC_MACHINE_FORMAT_INVALID"; }
      if (!threw) throw new Error(`${label}: FORMAT_INVALID로 거부되지 않음`);
    }
  });
  check("이미지: validateManifest 경계 전수(키 화이트리스트·타입·크기)", () => {
    image.validateManifest({ indexURL: "/x/", env: { A: "1" }, packages: ["six"], setup: "x=1" }); // 정상
    const cases = [
      [null, "non-object"],
      [[], "배열"],
      [{ evil: 1 }, "허용 안 된 키"],
      [{ indexURL: 42 }, "indexURL 비문자열"],
      [{ env: [] }, "env 비객체"],
      [{ env: { A: 1 } }, "env 값 비문자열"],
      [{ packages: Array(257).fill("x") }, "packages > 256"],
      [{ packages: ["x".repeat(201)] }, "패키지명 > 200"],
      [{ setup: "x".repeat(256 * 1024 + 1) }, "setup > 상한"],
    ];
    for (const [m, label] of cases) {
      let threw = false;
      try { image.validateManifest(m); } catch (e) { threw = e.code === "PYPROC_MACHINE_FORMAT_INVALID"; }
      if (!threw) throw new Error(`${label}: FORMAT_INVALID로 거부되지 않음`);
    }
  });
}
