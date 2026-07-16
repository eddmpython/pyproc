# browser-os-north-star - 첫 Python guest OS 성숙 트랙

> ✅ 완료 (2026-07-16): 대형 힙, signed machine image, 대표 데모, 호환성 지도, 제품 소비, 탭 장애복구 증거를 닫아 첫 Python guest OS 성숙 트랙을 완결했다.

상태: 완료. pyproc Browser Python OS의 성능·호환성·제품 소비 증명을 닫아 [Web Machine Platform](../web-machine-platform/README.md)의 첫 guest OS를 단단하게 만들었다.

## 한 문장

**Chromium 탭을 하드웨어·보안 경계로 삼고, 파이썬을 커널·유저랜드로 삼는 첫 Web Machine guest OS를 만든다.**

상위 North Star는 브라우저를 여러 guest OS가 올라가는 컴퓨터로 만드는 것이다. 이 이니셔티브의 기존 판정표와 실측은 폐기하지 않고 Python guest의 근거로 유지한다.

## 왜 지금

`browser-os` 이니셔티브는 2026-07-12에 "OS 간판 조건부" 판정을 냈다. 당시 조건은 커널 탭독립(P2), IPC 파이프(P4), 집행되는 보호(P6)였고, 이후 세 조건은 모두 실측과 src 승격을 거쳤다. 이제 필요한 일은 기능을 더 흩뿌리는 것이 아니라 OS 목표를 기준으로 판정표, 대표 데모, 성능 봉투, 소비 배선을 다시 묶는 것이다.

## 문서 지도

1. [00-product-vision.md](00-product-vision.md) - "OS"를 무엇으로 정의하고 무엇으로 정의하지 않는가.
2. [01-architecture.md](01-architecture.md) - OS 축별 현재 자산, 잔여 벽, 다음 증명.
3. [02-phasing-and-wiring.md](02-phasing-and-wiring.md) - 단계, 게이트, 소비 배선, 롤백.
4. [03-progress-ledger.md](03-progress-ledger.md) - 결정 원장과 NEXT.
5. [04-os-verdict-v2.md](04-os-verdict-v2.md) - P2/P4/P6 완료 이후 OS 판정표 v2.
6. [05-large-heap-envelope.md](05-large-heap-envelope.md) - 512MB 대형 힙 성능 봉투 1차 실측.
7. [06-speed-comparison.md](06-speed-comparison.md) - WebVM/JupyterLite/marimo 대비 속도 비교 계약과 측정 슬롯.

## 이번 이니셔티브의 완료 조건

1. OS 판정표 v2가 현재 src 자산(P2/P4/P6 완료 이후)을 반영한다.
2. 500MB 이상 힙 구간에서 checkpoint, restore, journal, fork 비용을 실측해 성능 봉투를 낸다.
3. 세 대표 데모가 한 흐름으로 연결된다: 크래시 생존 머신, 브라우저 안 서버 개발, 멀티프로세스 데이터 작업.
4. 패키지·워크로드 호환성 표가 "로컬처럼" 주장의 근거가 된다.
5. 소비 제품 하나 이상이 OS 프리미티브를 공개 표면만으로 가져간다.
