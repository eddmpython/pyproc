# 01. 아키텍처

```text
package contract gate
  -> root 6 + typed subpaths + executable docs

RuntimeContract
  <- Runtime(PyodideEngine: sync + heap)
  <- WasiSession(async + checkpoint)

capabilities/
  journal/        named cluster
  reactive.js    stats + retention budget

Buildroot exact source + config
  -> bzImage + legal-info + CycloneDX + build manifest
  -> independent reproducibility gate
  -> catalog promotion
```

EngineContract의 선택 기능은 capability로 판정한다. RuntimeContract는 async execution, globals,
host value bridge만 최소로 고정한다. 동기 실행과 heap은 엔진별 capability다.
