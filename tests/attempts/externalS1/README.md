# externalS1 - 외부 웹파이썬 후보가 pyproc S1과 같은 일을 하는가

## 가설

pyproc S1은 단순한 NumPy 속도 표가 아니다. 같은 브라우저 탭 안에서 4개의 독립 Python worker가 같은 NumPy matmul을 shard하고, 단일 worker baseline과 같은 run 안에서 비교되는 병렬 실행 계약이다.

WebVM, JupyterLite, marimo WASM은 모두 브라우저 안 실행 표면을 제공하지만 표면의 목적이 다르다. 같은 S1을 제공하지 못하는 후보는 0점으로 처리하지 않고 `N/A` artifact로 봉인한다. 그 뒤 single-lane, boot, server, resume 같은 다른 scenario로 분리해 비교한다.

## 졸업 게이트

1. WebVM, JupyterLite, marimo WASM 각각에 대해 공식 문서 또는 실제 실행 결과를 근거로 S1 가능 여부를 판정한다.
2. 같은 S1을 수행할 수 있으면 최소 3회 warmed sample을 `bench:artifact` 측정 artifact로 남긴다.
3. 같은 S1을 수행할 수 없으면 공식 출처와 사유를 가진 `bench:artifact --na` artifact로 남긴다.
4. [속도 비교 계약](../../../mainPlan/browser-os-north-star/06-speed-comparison.md)의 S1 비교표가 pyproc 기준 artifact와 외부 후보 행을 함께 포함한다.

## 후보 판정 기준

| 후보 | 공식 표면 | S1 판정 질문 |
|---|---|---|
| WebVM | 브라우저 안 Linux VM, Linux ABI-compatible 환경 | 4개 브라우저 Python worker에 NumPy shard를 분배하는 라이브러리 API가 있는가 |
| JupyterLite | 브라우저 JupyterLab, Pyodide kernel, Web Worker kernel | 단일 API로 worker pool sharded NumPy task를 실행하고 같은 run에서 single baseline과 비교할 수 있는가 |
| marimo WASM | Pyodide 기반 브라우저 notebook | CPU-bound true parallel sharded matmul을 제공하는가 |

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-15 | 공식 문서 판정 | Edge/Windows, 문서 기반 | pyproc S1 기준 artifact 3.95x 존재, 외부 후보는 S1 동일 계약 미확인 | N/A artifact 생성 필요 | WebVM/JupyterLite/marimo WASM N/A artifact를 만들고 비교표에 합친다 |

## 판정

진행 중. S1은 pyproc의 병렬 worker pool 증거 축으로 유지한다. 외부 후보는 같은 S1 가능 여부를 먼저 봉인하고, 불가능하면 single-lane이나 boot 비교로 재정의하지 않는다.
