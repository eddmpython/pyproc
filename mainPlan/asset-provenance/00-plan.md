# 00 - 단계와 계약

전제 사실은 [README](README.md)의 실측 표(P1~P9)다. 여기는 무엇을 어떻게 닫는가만 적는다.

## 순서의 근거

기각한 설계는 0->1->2->3->4 직렬 6단계였다. 실측 결과 그 직렬성의 근거였던 채널 대수와
schema v2가 사라졌으므로, 남는 작업은 **거의 독립**이고 순서는 위험 크기로 정한다.

| # | 단계 | 왜 이 순서 | 게이트 |
|---|---|---|---|
| 1 | Package 층위 모순 수리 | **살아있는 모순**이다. 저장소가 File 층위에서 강제하는 정책(`run.mjs:1303`, "opaque guest image license를 추정으로 확정하면 안 된다")을 Package 층위에서 스스로 위반한다(P3). 다른 무엇에도 의존하지 않는다 | Package 층위 `licenseConcluded` 검사 신설. 음성 시험: KolibriOS Package를 `GPL-2.0-only`로 되돌리면 RED |
| 2 | SPDX 적합성 3건 | 1과 같은 파일(`assetProvenance.mjs`). 한 번에 여는 것이 싸다 | 기존 `--check` 바이트 일치 유지. SHA1 존재 검사, namespace 결정성+유일성 검사 |
| 3 | catalog 통합 | **진짜 병**이다(P4). 걸쇠 4곳은 중복의 증상이다. 어휘가 하나가 되면 P1(제품 봉인 장식)이 구조적으로 사라진다 | 두 소비처가 같은 validator 통과. 같은 name 자산의 sha256 교차 일치. 음성 시험: P1의 변이(거짓 MIT)가 RED |
| 4 | 봉투가 출처를 나른다 | `guestManifest`가 이미 열린 집합이라 포맷 변경 0(P8). 3의 `catalogId`/`sbomDigest`가 입력이므로 3 다음 | `machineEnvelopeProbe` 왕복 + provenance 변조 시 서명 실패. `guestManifest`에 `channel` 키 재등장 0 |
| 5 | 정책에 주소를 준다 | 1~4가 확정한 사실을 담아야 하므로 마지막. 규칙 SSOT가 "`_done`은 지속 정책의 정본이 될 수 없다"고 못 박았는데 자산 배포 정책이 거기 산다 | 링크 생존(기존) + `policyVersion` 일치 검사 |
| 6 | 알려진 위험 기록 | 계약 실태 표는 "계약과 실제의 간극을 먼저 기록"하는 자리다 | 없음(문서) |

## 1단계: Package 층위 모순

`assetProvenance.mjs:74`가 이렇게 한다.

```js
licenseConcluded: component.licenseDeclared,
```

`filesAnalyzed: false`인 Package에 상류의 **선언**을 그대로 **결론**으로 복사한다. 결과가
`fixtureSbom.json`에 실재한다: `KolibriOS guest image` Package가 `licenseConcluded:
"GPL-2.0-only"`인데 같은 자산의 File은 `NOASSERTION`이다.

정책 본문이 이 패턴을 정확히 금지한다: "프로젝트 이름의 license만 알아도 exact binary에
포함된 component, source revision, build config를 모르면 배포 판정은 `NOASSERTION`이다."

**조치**: catalog에 component별 `licenseConcluded`를 명시 필드로 두고, 생성기는 복사하지
않고 그 필드를 읽는다. opaque component는 `NOASSERTION`이 값이다. `licenseDeclared`는
상류 주장으로 남긴다(둘은 다른 질문이다: 상류가 뭐라 했나 vs 우리가 뭐라 결론냈나).

**게이트**: 지금 검사는 `role === "guest-image"` asset만 본다. Package/component 층위로
확장한다.

## 2단계: SPDX 적합성

| 결함 | 조치 | 주의 |
|---|---|---|
| File checksum에 SHA1 없음 | SPDX 2.3 §8.4가 SHA1을 `1..1`로 요구한다. catalog에 `sha1` 필드 추가 | 외부 검증기가 SBOM을 읽을 수 있어야 정책 4번이 의미를 갖는다 |
| `documentNamespace`가 catalog 내용과 무관 | `.../sbom/${catalogId}/${catalogDigest}`. **내용이 다르면 유일하고 같으면 결정적**이라 SPDX 유일성과 재생성 바이트 일치를 동시에 만족한다 | UUID는 `--check` 바이트 비교를 깨므로 안 된다 |
| `created` 하드코딩 | 이름 붙인 상수 + 출처 주석으로. **동적 타임스탬프는 안 된다** | `assertV86FixtureSbom`이 바이트 비교를 하므로 동적 값은 게이트를 매 실행 깬다. 규칙이 요구하는 것은 이름과 출처이지 동적화가 아니다 |

## 3단계: catalog 통합

자산 5개가 두 어휘로 중복 기술돼 있다.

| | `tests/webMachine/fixtures/v86/assetCatalog.json` | `apps/webComputer/assetCatalog.json` |
|---|---|---|
| 어휘 | `packagePolicy`, `components[]`, `distribution`, `bundleBlockers[]`, `licenseDeclared` | `channel`, `redistribution`, `promotionRequires`, `provenanceStatus` |
| 자산 | 6 (kolibri 포함) | 5 |
| SBOM | 있음 | **없음** |
| 봉인 강도 | `local-test-only` + guest-image `NOASSERTION` 강제 | 필드 존재 검사만 |
| CI | **안 돈다** | 돈다 |

정책이 fixture를 SSOT로 지명했지만, 그 문서는 제품 catalog가 생기기 전에 쓰였고 그 존재를
모른다. 그런데 제품 catalog가 실제로 부팅하는 자산의 정본이다.

**조치**: 어휘를 하나로 모으고 자산 기술을 한 곳에 둔다. 제품과 fixture는 같은 validator를
통과하는 두 소비처가 된다(fixture는 kolibri를 더 갖는 상위집합).

**주의**: `ci.yml:83-84`의 자산 캐시 키가 `hashFiles('apps/webComputer/assetCatalog.json')`다.
catalog를 건드리면 12.6MB 재다운로드가 강제된다. 통합을 여러 커밋에 나누면 그만큼 반복된다.

## 4단계: 봉투가 출처를 나른다

실험으로 확인한 사실: `machineManifest.js:81`의 `jsonValue(value.guestManifest, ...)`는 열린
JSON 서브트리라 중첩 객체/배열이 재귀 정규화되고 canonical JSON에 들어가고 content digest에
들어가고 서명이 덮는다. **포맷 변경 0으로 오늘 실을 수 있다.**

```json
"guestManifest": {
  "product": { "image": "buildroot-linux-6.8.12-i686" },
  "provenance": { "policyVersion": 1, "catalogId": "...", "sbomDigest": "sha256:..." }
}
```

**`channel`을 넣지 않는다.** 근거 둘:
1. 수신자는 catalog도 자산도 없어서 재계산할 수 없다. 재계산 불가능한 판정은 계산이 아니라
   선언이고, 서명은 *누가 말했는지*를 묶을 뿐 *참인지*를 묶지 않는다.
2. `imageTrust.js`가 서명 검증 **전에** manifest를 `JSON.parse`해서 신뢰 화면에 쓴다
   (`gate.js:68`). 거기 `channel: "product"`를 띄우면 공격자 제어 문자열을 제품 판정으로
   표시하는 것이 된다.

정책이 이미 같은 말을 한다: "trusted signature는 출처 identity를 증명할 뿐 license
compliance를 대신하지 않는다."

따라서 `machineConfig.js:27`의 `product.channel`은 **제거**한다(중복이자 무방비 주장).

**최대 위험**: `machineManifest.js`의 하드코딩 키 목록 5곳 중 3곳(`151`, `212`, `229`)이
조용한 투영이다. `guestManifest`는 이미 그 목록 안에 있으므로 이번엔 안전하지만, 이 사실
자체를 주석으로 남긴다(다음 사람이 content에 필드를 더하려 할 때의 지뢰다).

## 5단계: 정책에 주소를 준다

규칙 SSOT: "mainPlan은 완료 시 `_done`으로 빠지므로 지속 정책의 정본이 될 수 없다."
그런데 `mainPlan/_done/web-machine-platform/05-asset-distribution-policy.md`가 지속 정책이고
참조자가 자기 폴더 README 하나뿐이며 `docs/`에 provenance 문서가 0건이다.

**조치**: 운영 정책을 `docs/operations/assetProvenance.md`로 승격하고 `policyVersion: 1`을
명문화한다. `_done`에는 설계 근거와 포인터를 남긴다(완료 기록은 삭제하지 않는다).
승격하며 P1~P9를 반영한다: SSOT 지명이 틀렸다는 것, 제품 catalog의 존재, 커널 6.8.12가
식별됐다는 것, 막힌 것이 `.config` 1항목이라는 것.

## 6단계: 알려진 위험

[계약 실태 표](../../docs/operations/contractReality.md)에 기록한다.

1. **`i.copy.sh` 단일 출처**(P9). 10MB Linux image의 유일한 출처가 1인 호스팅 mutable URL이다.
   404가 나면 `test:web-computer`가 죽는다. 미러를 저장소에 두는 것은 정책이 금지한다
   (code package third-party binary 0). 진짜 해는 자체 빌드이고, 그건 커널 6.8.12가
   식별됐으므로(P5) 막혀 있지 않다. 자산 취득 트랙의 첫 이유로 기록한다.
2. **배포 기제 부재**(P7). `redistribution: "disabled"`는 정책이 아니라 사실의 기술이다.
   provenance가 완벽해져도 오늘은 아무것도 나가지 않는다. 벽은 둘이고 provenance는 두 번째다.

## 게이트

각 커밋 전 `npm test`. 4단계는 `npm run test:web-computer`도.
**신설 게이트는 전부 음성 시험으로 이빨을 증명한다**(규칙 SSOT의 게이트 규율).

## 롤백

각 단계 독립 커밋. 3단계만 catalog 스키마를 바꾸므로 되돌리면 CI 자산 캐시가 한 번 더
무효화된다(기능 영향 없음). 4단계는 `guestManifest` 필드 추가라 되돌려도 v1 포맷 그대로다.
