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
