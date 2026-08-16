# V86 실행 자산 재현 recipe

V86 engine module, WASM binary, SeaBIOS, VGA BIOS를 exact source에서 함께 만든다. npm registry와
상류 repository의 서명된 provenance를 연결해 V86 source commit을 고정하고, SeaBIOS tag가 가리키는
commit과 v86 repository의 release config를 별도 고정한다.

Linux build host에서 실행한다. workflow는 Ubuntu archive의 날짜 snapshot까지 고정해 compiler와
firmware tool package 해석이 시간이 지나도 같은 archive 상태를 보게 한다.

```sh
npm run assets:v86
```

정식 workflow는 서로 격리된 두 runner에서 처음부터 build한다. 각 build는 다음을 함께 낸다.

- `libv86.mjs`, `v86.wasm`, `seabios.bin`, `vgabios.bin`
- V86와 SeaBIOS exact source tar
- runtime component CycloneDX SBOM
- V86, QEMU 유래 부분, SoftFloat, Zstandard, SeaBIOS legal material
- source, toolchain, 입력, 모든 산출물 digest를 담은 build manifest

두 build의 manifest와 선언 파일이 모두 byte-identical이어야 verified artifact가 생긴다. builder는
catalog 승격으로 확정한 네 runtime digest도 lock과 대조하며 하나라도 다르면 실패한다. catalog 승격은
verified artifact의 digest, 실제 x86 browser gate, source와 legal release가 모두 준비된 뒤에만 한다.
