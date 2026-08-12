# automationComputer - 언어와 provider를 바꿔도 같은 자동화 컴퓨터인가

## 가설

Python machine과 browser automation을 언어 중립 Control Protocol과 `AutomationSpace` 계약으로
분리하면 JavaScript, Python, MCP 소비자가 같은 명령 의미론과 오류, 취소, artifact, replay 경계를
공유할 수 있다. Native CDP, 격리 frame, 기록 replay, browser guest는 provider만 달라지고 소비자
workflow는 바뀌지 않는다.

## 졸업 게이트

- Control Protocol: hello/request/response/error/cancel/event/attachment wire fixture 왕복 100%, 알 수
  없는 version과 field, request ID 재사용, 중복 terminal, attachment offset/digest 위반을 전부 거부.
- Python SDK: 깨끗한 가상 환경에서 wheel 설치 후 설치된 Node 제품을 stdio로 기동하고 machine,
  checkpoint, browser screenshot, 취소, 오류를 실제 왕복.
- AutomationSpace: 같은 contract suite가 가짜 provider, Native CDP, FrameSpace, ReplaySpace에서 통과.
- Native CDP: Chrome과 Edge에서 관찰, action, screenshot artifact, network, tab, storage, runtime,
  권한 거부, 결과 불명 수렴을 설치 패키지로 검증.
- FrameSpace: same-origin과 허용 cross-origin은 동작하고 sandbox와 거부 origin은 fail-closed.
- ReplaySpace: 기록 변조와 누락 artifact를 거부하고 effect를 다시 보내지 않은 채 같은 결과를 재생.
- v86 browser probe: cold/warm boot, heap, 첫 화면, 입력, network, screenshot을 실측해 provider 승격
  또는 제품 경계를 수치로 확정.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-12 | controlProtocolProbe | Node 22.19, NDJSON wire | GREEN 32/32. frame/상태 양성과 schema/version/order/digest 음성 fixture | request ID 단회성, terminal 단일성, attachment 선검증을 갖춘 v1 채택 | shared host와 설치 제품 게이트로 승격 |
| 2026-08-12 | controlProtocolProduct | packed npm, Edge, Pyodide | GREEN 6/6. hello 14종, Python persistence, post-send cancel, PNG attachment와 digest | MCP와 native NDJSON이 같은 ControlHost와 page epoch bridge를 사용 | Python SDK가 이 wire를 외부 구현 없이 소비 |

## 판정

진행 중 (Python SDK wheel, source distribution, 설치 통합)
