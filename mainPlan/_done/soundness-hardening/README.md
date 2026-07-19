# soundness-hardening

> ✅ **완료 (2026-07-19).** 차별점의 정확성 주장을 고정 시나리오에서 property/fuzz로 끌어올렸다.
> 3표면 전문 에이전트 감사로 진짜 공백(핵심 주장 CI 커버리지 0, 강한 증거가 삭제 예정 probe에
> 상주)을 확정하고, delta false-negative fuzz·bundle index-forgery·reactive 나무 참조 무결성·
> KernelElection 정합·full-heap 왕복·OPFS 쓰기 순서 법을 전부 음성 시험 통과 게이트로 고정.
> 완료 조건 6/6 + 보너스 2. 구조 1273->1357, 브라우저 84->87. 최종 기록은
> [진행 원장](01-progress-ledger.md).

pyproc가 파는 이유(체크포인트·분기·복원·부활의 정확성)를 고정 시나리오가 아니라 적대적
변이 하에서 증명한다. North Star는 유지한다: 척추를 방탄으로 만들 뿐 다리를 자르지 않는다.

- [00-product-vision.md](00-product-vision.md) - 왜, 완료 조건, 거부한 것.
- [01-progress-ledger.md](01-progress-ledger.md) - 결정 원장. 재개 지점은 마지막 줄.

재개 지점은 [01-progress-ledger.md](01-progress-ledger.md) 마지막 줄이다.
