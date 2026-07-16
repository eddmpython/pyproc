# 01. 아키텍처

## 배치

```text
apps/webComputer/
├─ index.html             # 제품 composition root
├─ app.js                 # UI event와 제품 상태
├─ webComputerRuntime.js  # host, guest, device, persistence 조립
├─ machineConfig.js       # engine과 guest image URL 계약
├─ imageTrust.js          # 실행 전 untrusted header 표시
├─ identityStore.js       # device-local signing identity
├─ gate.js                # 실제 제품 동선 E2E
├─ styles.css             # 반응형 제품 화면
├─ assetCatalog.json      # 외부 실행 자산 hash와 배포 상태
└─ assets/                # 준비 스크립트 산출물, git 미추적
```

## 의존성 방향

`app.js -> webComputerRuntime.js -> package public roots` 단방향이다. 제품은 `@web-machine/core`, `@web-machine/browser`, `@web-machine/guest-pyproc`, `@web-machine/guest-v86`, pyproc root만 소비한다. `tests/`, package `src/`, engine 내부 deep path는 import하지 않는다.

## 상태 흐름

1. Web Lock과 durable epoch로 workspace owner를 하나만 선출한다.
2. owner가 IndexedDB HEAD를 읽는다.
3. HEAD가 있으면 두 guest와 두 block device를 boot 없이 restore하고 Linux display와 input을 새 browser process의 device에 다시 연결한다.
4. HEAD가 없으면 Python OS와 Linux를 동시에 boot한다.
5. Save는 실행 중 guest를 pause하고 block flush, 두 snapshot, 두 block을 한 CAS generation으로 commit한 뒤 기존 실행 상태를 복구한다.
6. Export는 같은 pause 경계에서 device-local P-256 key로 `.webmachine`을 서명한다.
7. Import는 header의 signer, guest, device, 권한을 먼저 표시한다. 사용자가 Trust and import를 눌러야 signature와 전체 blob integrity를 검증하고 engine을 생성한다.

## 실행 자산

제품 source는 engine binary, firmware, guest image를 포함하지 않는다. `scripts/prepareWebComputerAssets.mjs`가 catalog의 URL, byte length, SHA-256을 검증해 로컬 product asset directory를 만든다. provenance가 닫히지 않은 현재 Linux image는 UI에서 Development image로 표시한다.
