# 02. 단계와 배선

1. 공개 계약 gate와 `pyproc/runtime` 정식 subpath.
2. EngineContract version/kind/capabilities 검증, 최소 RuntimeContract.
3. journal cluster와 contract test suite 분리.
4. reactive stats/retention policy와 porcelain/type/docs 연결.
5. Buildroot recipe와 catalog promotion gate.
6. Experimental freeze.
7. Node/type/browser/package gate 후 의도별 커밋과 main push.

롤백은 단계별 커밋 단위다. Buildroot catalog는 reproducibility 증거 전까지 기존 개발 자산을
유지하므로 browser product rollback이 필요 없다.
