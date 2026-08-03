# 수동 probe

CI가 돌릴 수 없는 실측 페이지가 사는 곳이다. `tests/browser/`는 게이트 폴더라 그 안의 페이지는
전부 러너가 열어야 한다는 불변식이 있고, 여기 있는 것들은 그 조건을 만족할 수 없다.

지금 사는 것: WebGPU probe 7개. 헤드리스 Edge는 저장소의 SwiftShader 스위치로도
`requestAdapter()`가 `null`을 돌려주므로 GPU 결과값은 CI에서 확인할 수 없다. CI가 무는 것은
등록된 WGSL 커널과 WebGPU에 넘기는 셰이더 바이트의 동일성이고, 그 상한은
[계약 실태 표](../../docs/operations/contractReality.md)에 명시돼 있다.

이 폴더의 페이지는 창 모드 Edge에서 `npm run serve` 뒤에 직접 연다. 절차는
[testing.md](../../docs/operations/testing.md)에 있다.

북극성 원장이 `gpuPythonProbe.html`을 `localPythonParity` 축의 수동 증거로 등재한다. 그래서
이 폴더는 실험 수명주기(`tests/attempts/`)가 아니라 정식 위치에 산다: 증거가 삭제 예정 폴더에
살면 그 축의 근거가 언제든 사라진다.
