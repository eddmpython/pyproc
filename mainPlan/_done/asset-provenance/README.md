# asset-provenance - 증거 없음이 통과로 새지 않게 한다

> ✅ **완료 (2026-07-19).** 배포 판정을 두 어휘 한 벌(`local-test-only` /
> `upstream-cdn-runtime-reference`)로 모으고 증거 없음이 통과로 새는 구멍을 전부 봉합했다.
> catalog 하나가 두 guest의 실행 자산 전부(엔진 부팅 집합 6파일 포함)를 기술하고, 파생물은
> 바이트 대조, 봉인은 제품 쪽에서도 물며(P1 변이 RED), 신설 게이트 전부 음성 시험으로 이빨
> 확인. 남은 것은 자산 취득 트랙(합성 바이너리 인벤토리 검증, Linux 자체 빌드)이며 계약
> 실태 표와 `promotionRequires`가 고정한다. 최종 기록은 [진행 원장](01-progress-ledger.md).

Web Machine의 기술 North Star는 닫혔다([web-machine-platform](../web-machine-platform/README.md)).
두 guest OS가 같은 host 계약으로 부팅하고, durable generation으로 복원되고, 65MB signed
`.webmachine`이 원본 storage 없는 새 프로필에서 3.5초에 두 OS를 되살린다.

남은 것은 자산의 법적 속성이다. 그런데 그걸 지킨다는 장치들이 실제로는 지키지 않는다.

## 한 문장

**배포 판정을 두 어휘 한 벌로 모으고, 증거 없음이 통과로 새는 구멍을 막는다.**

## 실측이 확정한 것 (2026-07-17)

| # | 사실 | 확인 방법 |
|---|---|---|
| P1 | **제품 봉인이 장식이다.** 제품이 실제로 부팅하는 catalog에서 Linux image의 license를 거짓 `MIT`, provenance를 거짓 `fully-verified-reproducible`로 바꿔도 `npm test` 1055 passed / 0 failed | 변이 주입 후 게이트 실행 |
| P2 | **봉인이 걸린 쪽은 CI가 안 도는 fixture다.** `local-test-only` 강제와 guest-image `NOASSERTION` 강제는 `tests/webMachine/fixtures/v86/`에만 있다. 제품 catalog에는 없다 | `run.mjs:1299,1303` vs `1492-1510` |
| P3 | **저장소가 자기 정책을 스스로 위반한다.** `assetProvenance.mjs:74`가 `licenseConcluded: component.licenseDeclared`로 복사해서, `filesAnalyzed:false`인 KolibriOS Package에 `GPL-2.0-only`를 **결론**으로 박는다. 같은 자산의 File 층위는 `NOASSERTION`이고, 게이트는 File 층위만 본다 | `fixtureSbom.json` 판독 |
| P4 | **catalog가 둘이고 어휘가 다르다.** 5개 자산이 같은 sha256으로 두 스키마에 중복 기술돼 있다(`channel`/`redistribution`/`promotionRequires` vs `packagePolicy`/`components[]`/`distribution`/`bundleBlockers[]`). 교차 검증 코드 0 | 두 catalog 대조 |
| P5 | **"exact revision 복원 불가"는 거짓이다.** bzImage setup header(`0x20E`)에서 커널 버전이 1초에 나온다: `6.8.12 (builder@archlinux) #5 PREEMPT_DYNAMIC Sat Aug 31 22:58:35 UTC 2024`. gzip 페이로드를 풀면 툴체인까지 나온다(Buildroot `2021.11-11272-ge2962af`, gcc 13.2.0, binutils 2.42) | 바이너리 직접 판독 |
| P6 | **막힌 것은 `.config` 하나다.** `IKCFG_ST` 매직 없음(CONFIG_IKCONFIG 비활성), `copy/v86` 트리에 buildroot 레시피 없음, `e2962af`는 mainline buildroot에서 HTTP 422(포크 또는 비공개 트리). 즉 `promotionRequires` 4항목 중 막힌 건 `reproducible-build-recipe` 1개 | 바이너리 + upstream 조회 |
| P7 | **`redistribution: "disabled"`는 정책이 아니라 사실의 기술이다.** `pages.yml`은 `examples src assets`만 복사하고 npm `files`에 `apps`/`packages`가 없다. `packages/*` 4개는 전부 `private: true, 0.0.0`. **채널을 product로 바꿔도 바뀌는 바이트가 0이다** | 배포 경로 전수 |
| P8 | **봉투 schema v2는 필요 없다.** `machineManifest.js:81`의 `guestManifest`는 열린 JSON 서브트리라 재귀 정규화 + canonical JSON + content digest + 서명을 이미 받는다. `machineConfig.js:27`이 이미 채널을 그렇게 싣고 있다 | 모듈 실험 |
| P9 | **`i.copy.sh`가 10MB Linux image의 유일한 출처다.** 1인 호스팅, 미러 0, 불변성 보증 0, 버전 개념 없는 mutable URL | catalog 판독 |

## 기각한 설계 (실측 근거)

먼저 세운 안은 "배포 판정을 선언에서 계산으로" 바꾸는 것이었다: 3-tier `provenanceMode` +
`assetChannel`/`machineChannel`/`imageChannel` min 대수 + 봉투 schema v2 + pyproc 단독
product 추천. 적대적 검증과 실측이 네 곳을 무너뜨렸다.

1. **min 대수의 정의역이 비어 있다.** 제품 catalog에 pyodide 자산이 **0개**다. 그래서
   `machineChannel(pythonOs) = min over {} = product`가 된다. **공집합에 대한 min이 최상단을
   준다.** 즉 그 모델은 pyproc에 product를 주는데, 깨끗해서가 아니라 아무도
   `pyodide.asm.wasm`(9.6MB)을 catalog에 적지 않았기 때문이다. **증거의 부재를 보상한다.**
   min 자체는 옳다(합성물의 배포 가능성은 최악 구성요소가 정한다). 고쳐야 할 것은 대수가
   아니라 정의역이다.
2. **pyproc 단독 추천이 범주 오류였다.** 근거로 든 `pyodide-lock.json` 354개는 부팅 적재
   집합이 아니다(`install_dir=stdlib` 0개). 실제 부팅 자산 `pyodide.asm.wasm` 9.6MB /
   `python_stdlib.zip` 2.5MB / `pyodide.asm.mjs` 1.2MB는 lock이 **0% 덮는다**. 그리고
   `.gitignore:31`이 `vendor/`를 무시해서 lock은 CI에서 보이지도 않는다. pyproc 단독 export
   경로도 없다(`webComputerPersistence.js:79`가 컨텍스트 전체를 내보낸다).
   **`pyodide.asm.wasm`(9.6MB)은 `v86.wasm`(2MB)과 같은 판정을 받아야 한다**: 둘 다 합성
   바이너리이고 최종 인벤토리가 미검증이다.
3. **"영원히 불가"가 거짓이었다**(P5/P6). 그 수사가 North Star의 주력 증명(dual-boot)을
   포기하는 결론을 정당화하고 있었다. 커널은 식별됐고 막힌 건 1항목이다.
4. **schema v2가 0을 얻고 위험을 산다**(P8). 게다가 설계가 지목한 차단 지점
   (`assertExactKeys`)만 고치면 **조용한 유실**이 난다: `machineManifest.js`의 하드코딩 키
   목록은 5곳이고 그중 3곳(`151`, `212`, `229`)이 큰 소리 없이 필드를 떨어뜨린다. 오류 0,
   서명은 provenance 없는 content 위에 찍히고, 테스트는 전부 green이다.

## 완료 조건

1. **catalog가 하나다.** 어휘 하나, 자산 기술 하나. 제품과 fixture가 같은 validator를 통과한다.
2. **제품 쪽 봉인이 fixture 쪽과 같은 강도다.** opaque guest image의 license를 추정으로
   확정하면 제품 catalog에서도 게이트가 문다(P1이 재발하지 않는다).
3. **Package 층위가 File 층위 정책을 지킨다.** `filesAnalyzed:false`이고 provenance가
   opaque인 component의 `licenseConcluded`는 `NOASSERTION`이다. 게이트가 두 층위를 다 본다(P3).
4. **SBOM이 SPDX 2.3 적합이다.** File checksum에 SHA1(§8.4 카디널리티 1..1),
   `documentNamespace`가 catalog 내용에 따라 유일하면서 재생성에 결정적이다.
5. **봉투가 자기 출처를 운반한다.** `guestManifest.provenance`에 `catalogId`와 `sbomDigest`와
   `policyVersion`이 실린다. **`channel`은 싣지 않는다**: 수신자가 재계산할 수 없는 판정은
   선언이고, `imageTrust.js`가 서명 검증 **전에** manifest를 파싱해 UI에 쓰므로 공격자 제어
   문자열이 된다. 봉투는 "어떤 catalog로 만들어졌는가"만 나르고 판정은 저장소 게이트가 한다.
6. **정책에 주소와 버전이 있다.** 지속 정책이 `_done` 아카이브가 아니라 `docs/`에 살고
   (규칙 SSOT가 요구하는 정보 구조), `policyVersion`이 봉투가 싣는 값과 일치한다.
7. **알려진 위험이 기록된다.** `i.copy.sh` 단일 출처(P9)와 배포 기제 부재(P7)가 계약 실태
   표에 있다.

## 완료 조건이 아닌 것

- **무엇이 product 채널에 도달하는지 약속하지 않는다.** 이 이니셔티브는 판정 장치가 실제로
  물게 만든다. 판정 결과는 기계를 돌린 산출물이지 계획의 목표가 아니다.
- **Linux 자체 빌드를 실행하지 않는다.** 커널 6.8.12는 식별됐고(P5) 경로는 열려 있지만,
  `.config` 확정과 재현 빌드는 자산 취득 작업이지 판정 배관 작업이 아니다. 교체 자산이
  만족할 계약을 스키마로 고정하는 것까지가 여기 범위다.
