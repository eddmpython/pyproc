# Testing

## Structure and contracts

```powershell
npm test
npm run test:contracts
npm run test:types
npm run test:package
npm run test:engine-independence
npm run skills:check
npm run skills:test-routing
npm run skills:test-package
npm run skills:test-mcp
npm run skills:test-forward
npm run skills:test-performance
```

`npm test`는 공개 표면, module reference, 삭제 원장, dash와 control character, Markdown link, workflow SHA pin,
asset provenance와 TypeScript를 검사한다. `test:package`는 runtime graph를 검사한다. Skill OS package gate는
catalog에 선언한 body와 resource, 설치된 reader, source digest parity, retired root 부재를 별도로 검사한다.

## Browser runtime

```powershell
$env:PYPROC_BROWSER='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:browser
npm run test:installed
npm run test:examples
npm run test:preflight
npm run test:web-machine
npm run test:automation-lifecycle
```

Chrome은 `PYPROC_BROWSER`를 Chrome executable로 바꿔 같은 명령을 실행한다. 브라우저 게이트는 owned kernel
boot, execution, typed values, checkpoint restore, process clone, terminal, Machine image와 installed asset
integrity를 실제 WASM으로 검증한다.

`test:automation-lifecycle`은 packed 제품에서 Situation, visual screenshot, proof-carrying action,
screenshot, artifact 삭제, detach와 target close를 반복한다. 모든 live owner count, Control process와 임시
browser profile이 격리된 0 기준선으로 돌아와야 한다.

실제 hardware compute와 pixel readback은 headed Edge에서 별도 gate로 실행한다.

```powershell
$env:PYPROC_BROWSER='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:hardware-visual-oracle
```

이 gate는 packed tarball의 `pyproc/gpu`와 `pyproc/wasi` 공개 specifier만 import하고 hardware adapter,
두 GPU hostcall, compute digest, RGBA8 pixel digest, 자원 정리와 terminal screenshot을 판정한다.
adapter 부재, software fallback, device loss, validation 오류와 결과 불일치는 SKIP 없이 RED다. 표준 hosted
runner에는 hardware GPU가 없으므로 `.github/workflows/hardware-gpu.yml`은 `pyproc-webgpu` label을 가진
interactive Windows self-hosted runner에서 수동 dispatch한다. workflow 등록 자체는 실행 증거가 아니다.

## Local server

```powershell
npm run serve
```

`http://localhost:8788/`에서 데모를 열 수 있다. 서버는 COOP와 COEP 헤더를 제공한다.

## Benchmarks

`npm run bench:speed`는 사용자의 browser에서 ordered command loop를 측정한다. 측정치는 test artifact에
남기며 공개 제품 문구에 고정 숫자로 게시하지 않는다.
