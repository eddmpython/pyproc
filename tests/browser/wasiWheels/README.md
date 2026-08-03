# WASI 레인의 순수 파이썬 wheel

`tests/browser/wasiGate.html`이 `installWheel` 경로를 검증할 때 읽는 자산이다. 파일 자체는
저장소가 나르지 않는다(`.gitignore`): 서드파티 배포 바이트라 이 레포의 자산 정책 밖이다.
없으면 게이트가 SKIP으로 넘어가고, 그 사실이 출력에 남는다.

## 받는 법

```bash
pip download six==1.17.0 packaging==26.2 --only-binary=:all: --no-deps -d tests/browser/wasiWheels
```

단일 모듈(`six`)과 중첩 패키지(`packaging`) 둘을 두는 이유는 두 경로가 다르기 때문이다:
전자는 `.py` 하나, 후자는 디렉터리 트리이고 stdlib만 의존해 실제 작업(버전 비교)을 돌린다.

## 자산 정책

wasm(WLR 3.12, 26MB) + shim은 enginePort(enginePort 캠페인)에서 참조(레포 미추적). wheel은 이 폴더에 두되 미추적(gitignore `*.whl`). wasiGate가 same-origin으로 읽고, 없으면 SKIP(자산 없어도 게이트 green). 재현:

```
python -m pip download six==1.17.0 packaging==26.2 --no-deps --only-binary=:all: -d tests/attempts/wasiPackages/
```
