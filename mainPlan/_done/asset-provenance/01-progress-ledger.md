# 01 - 진행 원장

재개 지점은 항상 이 문서의 마지막 줄이다.

## 2026-07-17 개설

### 결정 1: "배포 판정을 선언에서 계산으로" 안을 기각했다

먼저 세운 설계는 3-tier `provenanceMode` + `assetChannel`/`machineChannel`/`imageChannel`
min 대수 + 봉투 schema v2 + pyproc 단독 product 추천이었다. 적대적 검증과 실측이 네 곳을
무너뜨렸다. 기각 근거는 [README](README.md)의 "기각한 설계"가 정본이고, 요점은 이것이다.

**모델이 증거의 부재를 보상했다.** 제품 catalog에 pyodide 자산이 0개라
`machineChannel(pythonOs) = min over {} = product`가 된다. 공집합에 대한 min이 최상단을
준다. 그 모델은 pyproc에 product를 주는데 깨끗해서가 아니라 아무도 9.6MB 합성 바이너리를
적지 않았기 때문이다. **고쳐야 할 것은 대수가 아니라 정의역이었다.**

**"영원히 불가"가 거짓이었다.** bzImage setup header에서 커널 버전이 1초에 나온다:
`6.8.12 (builder@archlinux) #5 PREEMPT_DYNAMIC Sat Aug 31 22:58:35 UTC 2024`. 그 수사가
North Star의 주력 증명(dual-boot)을 포기하는 결론을 정당화하고 있었다. 막힌 것은
`promotionRequires` 4항목 중 `reproducible-build-recipe` 1개다.

**schema v2가 0을 얻고 위험을 샀다.** `guestManifest`가 이미 열린 JSON 서브트리라 포맷
변경 0으로 오늘 실을 수 있고, 저장소가 이미 `machineConfig.js:27`에서 그렇게 하고 있다.
게다가 설계가 지목한 차단 지점만 고치면 조용한 유실이 난다(하드코딩 키 목록 5곳 중 3곳이
큰 소리 없이 필드를 떨어뜨린다).

### 결정 2: 이 이니셔티브는 "판정을 만들자"가 아니라 "판정이 물게 하자"다

실측이 확정한 것은 provenance 장치가 없다는 것이 아니라 **있는데 안 문다**는 것이다.

- 제품 catalog에서 Linux image의 license를 거짓 `MIT`로, provenance를 거짓
  `fully-verified-reproducible`로 바꿔도 `npm test` 1055 passed / 0 failed(변이 주입 실측).
- 봉인(`local-test-only`, guest-image `NOASSERTION` 강제)이 걸린 쪽은 CI가 안 도는
  fixture이고, 봉인 없는 쪽이 제품이다.
- 저장소가 File 층위에서 강제하는 정책을 Package 층위에서 스스로 위반한다(KolibriOS Package
  `licenseConcluded: GPL-2.0-only`, 같은 자산 File은 `NOASSERTION`).

그래서 새 어휘를 얹는 대신 있는 어휘를 하나로 모으고 사각을 봉합한다. 2개를 3개로 만들지
않는다.

### 결정 3: 봉투는 판정이 아니라 출처를 나른다

`guestManifest.provenance`에 `catalogId`/`sbomDigest`/`policyVersion`을 싣되 `channel`은
싣지 않는다. 수신자는 catalog도 자산도 없어서 재계산할 수 없고, 재계산 불가능한 판정은
계산이 아니라 선언이다. 게다가 `imageTrust.js`가 서명 검증 **전에** manifest를 파싱해
신뢰 화면에 쓰므로, 봉투의 `channel`을 UI에 띄우면 공격자 제어 문자열을 제품 판정으로
표시하게 된다. 정책이 이미 같은 말을 적어뒀다: "trusted signature는 출처 identity를 증명할
뿐 license compliance를 대신하지 않는다."

### 방법 기록: 이번에도 적대적 검증이 설계를 살렸다

구조 이니셔티브에서 도메인 10폴더안이 순환을 1->9로 늘린다는 것이 실측으로 드러나 폐기된
전례가 있다. 이번에도 같은 방식으로 8개 주장 중 3개가 무너지고 1개는 이미 저장소에 구현돼
있었으며, 설계가 인용하지 않은 정책 문서가 설계 절반을 이미 담고 있었다.

패턴이 같다: **그럴듯한 설계가 파일을 열지 않고 쓴 문장 위에 서 있었다.** "원리적 불가"도
"구조적 차단"도 바이너리와 모듈에 직접 물어보니 거짓이었다. 실측 없는 단정 하나가 결론
전체를 끌고 간다.

재개 지점: 1단계(Package 층위 모순 수리) 착수.

## 2026-07-17 1~6단계 완료

6개 커밋. 신설 게이트는 전부 음성 시험으로 이빨을 확인했다(규칙 SSOT의 게이트 규율).

### 완료 조건 대조

| # | 조건 | 판정 |
|---|---|---|
| 1 | catalog가 하나다 | 충족. SSOT는 `scripts/assetCatalog.json` 하나이고 제품 catalog/SBOM/provenance 모듈이 전부 파생물이다(`--check`가 바이트 대조) |
| 2 | 제품 봉인이 fixture와 같은 강도 | 충족. **P1의 변이(거짓 MIT)가 이제 RED다**(전에는 1055 passed) |
| 3 | Package가 File 정책을 지킨다 | 충족. 불변식이 값을 도출한다(kolibri GPL-2.0-only -> NOASSERTION, v86 BSD-2-Clause -> NOASSERTION) |
| 4 | SPDX 2.3 적합 | 충족. SHA1 1..1, namespace가 결정적이면서 유일, created가 계약값 |
| 5 | 봉투가 출처를 나른다 | 충족. `policyVersion`/`catalogId`/`sourceCatalogId`/`sbomDigest`. channel은 싣지 않는다 |
| 6 | 정책에 주소와 버전 | 충족. `docs/operations/assetProvenance.md` policyVersion 1, 봉투와 일치를 게이트가 강제 |
| 7 | 알려진 위험 기록 | 충족. 계약 실태 표에 2건 |

측정: 구조 게이트 1064 -> 1070, 신설 게이트 3종(Package 불변식, 봉투 출처, policyVersion 일치).
`test:web-computer` 13/13 GREEN 유지(두 OS 부팅과 65MB 이동 불변).

### 예상 못 한 것

**게이트가 아키텍처를 지목했다.** 제품에 provenance 모듈을 배선하자 구조 게이트가 "제품이
tests 경로를 소비"를 잡았다. 제품 compliance 산출물을 만드는 도구가 test fixture 폴더에
살고 있었다는 뜻이다. 도구와 SSOT를 `scripts/`로 옮겼다(`prepareWebComputerAssets.mjs`와
같은 층). 기획 단계에서 "남은 판단 하나"로 적어둔 것을 게이트가 강제했다.

**구조 게이트는 미정의 식별자를 못 본다는 것을 또 확인했다.** `UNDESCRIBED_ASSET_PROVENANCE`
import를 빠뜨렸는데 `npm test` 1065가 통과했고 `test:web-computer`가 ReferenceError로 잡았다.
structure-evolution에서 같은 일이 있었다(session 분해 중 sha256Hex import 유실). 이 사실은
이미 규칙과 testing.md에 적혀 있고, 이번이 두 번째 실증이다.

### 남은 것

**pyproc 게스트 자산 인벤토리.** 제품이 부팅하는 9.6MB `pyodide.asm.wasm`을 어떤 catalog도
기술하지 않는다. 지금은 부재를 명시로 싣는 것까지만 닫혔다(`UNDESCRIBED_ASSET_PROVENANCE`).
같은 잣대면 `v86.wasm`과 동일 판정(`NOASSERTION`/inventory 미검증)이어야 한다. 인벤토리
취득 경로는 있다(wheel `dist-info/METADATA` 추출, 의존성 0, `fetchEngine.mjs`의 bsdtar 선례).
계약 실태 표에 등재했다.

**Linux 자산 교체.** 커널 6.8.12는 식별됐고 막힌 것은 `.config` 1항목이다. 문서화된 config로
같은 버전을 빌드하면 `promotionRequires` 1~3번과 5번이 함께 열리고 `i.copy.sh` 단일 출처
위험도 사라진다. 하나로 둘을 푼다. 이건 provenance 배관이 아니라 자산 취득 트랙이다.

재개 지점: pyodide 인벤토리 취득 또는 Linux 자산 자체 빌드 트랙 개설.

## 2026-07-19 엔진 부팅 집합 기술로 미기술 게스트 소멸, 이니셔티브 종결

마지막 남은 구멍(pyproc 게스트 자산 미기술)을 닫았다. 증거 없음이 통과로 새는 자리는
이제 없다.

### 실측

- **부팅 적재 집합 확정**: 메인 스레드 `pyodide.js`(script 태그), 워커 `pyodide.mjs`
  (dynamic import x3 파일), 엔진이 받는 `pyodide.asm.mjs`/`pyodide.asm.wasm`(9.6MB)/
  `python_stdlib.zip`/`pyodide-lock.json`. 총 6파일.
- **두 유통 경로 교차 검증**: GitHub release tarball(vendor/pyodide, fetchEngine 산물)과
  jsdelivr CDN(`DEFAULT_INDEX`)의 6파일 sha256이 전부 동일. catalog가 기술하는 바이트가
  제품이 실제 적재하는 바이트다.

### 결정

- **catalog 기술**: component `pyodide-release-314.0.2`(exact tag, 공개 빌드 recipe,
  provenanceStatus는 SeaBIOS와 같은 `upstream-source-recipe-not-reproduced` 재사용, 어휘
  증식 0). `pyodide.asm.wasm`은 v86.wasm과 같은 잣대(`NOASSERTION`/합성 바이너리 inventory
  미검증). loader 2파일과 lock은 프로젝트 자기 산물이라 MPL-2.0 결론(libv86.mjs 선례).
  component 결론은 불변식이 NOASSERTION으로 도출.
- **배포 판정 두 어휘 완성**: `upstream-cdn-runtime-reference` 신설(policyVersion 2).
  상류 자신의 배포 지점을 런타임에 참조하는 것은 재배포가 아니다(결정 3의 정밀화).
  최상위 catalogId를 `web-machine-execution-assets-v1`로 개명(v86 fixture만이 아니게 됐다).
- **부재 명시 장치 은퇴**: 미기술 게스트가 소멸했으므로 `UNDESCRIBED_ASSET_PROVENANCE`를
  제거하고 pythonOs도 `WEB_COMPUTER_ASSET_PROVENANCE`를 싣는다. 재등장은 게이트가 잡는다.
- **SBOM localPath**: 자산의 로컬 위치를 명시 필드로(SPDX fileName의 출처).

### 게이트 (전부 음성 시험으로 이빨 확인)

| 게이트 | 음성 시험 -> RED |
|---|---|
| 핀 결합(fetchEngine == DEFAULT_INDEX == catalog url) | catalog url을 v999로 변조 -> "catalog url이 DEFAULT_INDEX 밖" |
| 제품 이중 엔진 기술(v86.wasm + pyodide.asm.wasm) | 제품 catalog에서 pyodide.asm.wasm 삭제 -> "제품 catalog에 미기술" |
| 게스트 provenance 명시 + 은퇴 장치 재등장 금지 | pythonOs를 UNDESCRIBED로 되돌림 -> "기술된 자산 출처를 싣지 않는다" |
| 두 어휘 배포 판정(component별 기대값) | pyodide.js를 local-test-only로 위조 + 파생물 재생성 -> "upstream-cdn-runtime-reference여야 한다" |

구조 게이트 1064 -> 1321 전판 GREEN, 타입 게이트 GREEN, 브라우저 84/84 GREEN,
제품 E2E 13/13 GREEN(prepare가 제품 catalog 파생으로 엔진 자산까지 SRI 검증 적재, 11개).

### 남은 것 (이 이니셔티브 범위 밖, 자산 취득 트랙)

- **합성 바이너리 인벤토리 검증**: `pyodide.asm.wasm`/`v86.wasm`의 component inventory가
  검증되면 NOASSERTION이 실제 결론으로 승격된다. `promotionRequires`가 계약으로 고정.
- **Linux 자산 자체 빌드**: 커널 6.8.12 식별 완료, 막힌 것은 `.config` 1항목.
  `i.copy.sh` 단일 출처 위험과 함께 풀린다(계약 실태 표에 존속).

완료 조건 7항 전부 충족(2026-07-17 대조표) + 미기술 구멍 소멸. 종결 절차로 폴더를
`_done`으로 이관한다.
