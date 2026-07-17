# 05. 자산 provenance와 배포 정책

## 결정

Web Machine code package와 실행 자산을 같은 배포물로 취급하지 않는다.

1. `core`, `browser`, `guest-pyproc`, `guest-v86` code package에는 third-party binary를 0개만 허용한다.
2. engine constructor, firmware, guest image는 composition root가 명시적으로 주입한다.
3. provenance가 불완전한 binary는 hash가 맞아도 `local-test-only`다.
4. 공식 `.webmachine` image 배포는 image가 포함한 OS·filesystem의 SBOM과 compliance material을 별도로 갖추기 전까지 금지한다.

hash는 무결성을 증명하지만 재배포 권리를 증명하지 않는다. 프로젝트 이름의 license만 알아도 exact binary에
포함된 component, source revision, build config를 모르면 배포 판정은 `NOASSERTION`이다.

## 현재 자산 판정

SSOT는 [assetCatalog.json](../../../scripts/assetCatalog.json), 파생 표준 산출물은
[assetSbom.json](../../../scripts/assetSbom.json)이다. `assetProvenance.mjs --check`가
두 파일의 일치를 검사하고 `npm test`가 package 미번들과 opaque guest image의 `NOASSERTION`을 강제한다.

| 자산 | 확인된 provenance | license 정보 | 현재 배포 판정 |
|---|---|---|---|
| `libv86.mjs` | npm `v86@0.5.424`, registry integrity, source repository | package declared `BSD-2-Clause` | local test만, code package는 constructor 외부 주입 |
| `v86.wasm` | npm `v86@0.5.424`, registry integrity, source repository | composite binary의 최종 inventory 미검증 | local test만, package 미번들 |
| `seabios.bin` | v86 `2f1346b` build script가 SeaBIOS `rel-1.16.2`와 고정 config 사용 | `LGPL-3.0-only` | 재현 build·license/source 전달물 전 local test만 |
| `vgabios.bin` | 위 SeaBIOS build의 `out/vgabios.bin` | `LGPL-3.0-only` | 재현 build·license/source 전달물 전 local test만 |
| `buildroot-bzimage68.bin` | v86 test URL과 SHA-256만 확인, exact revision/config 없음 | kernel·rootfs component inventory 없음 | 번들·공식 image 배포 금지 |
| `kolibri.img` | v86 test URL과 SHA-256만 확인, exact image revision 없음 | KolibriOS project는 GPLv2지만 image 내용 mapping 없음 | 번들·공식 image 배포 금지 |

근거:

- v86은 [공식 저장소](https://github.com/copy/v86#license)에서 BSD-2-Clause와 별도 third-party license를 명시한다.
- BIOS build recipe는 [SeaBIOS rel-1.16.2를 checkout](https://github.com/copy/v86/blob/2f1346b/bios/fetch-and-build-seabios.sh)하고
  같은 경로의 [LGPL-3.0 text](https://github.com/copy/v86/blob/2f1346b/bios/COPYING.LESSER)를 둔다.
- v86은 guest disk를 저장소에 포함하지 않고 [별도 test URL에서 받는다](https://github.com/copy/v86#testing).
- Buildroot는 제품 산출물마다 package manifest, source, license text, config를 모으는
  [`make legal-info`](https://buildroot.org/downloads/manual/manual.html#legal-info)를 요구한다. 현재 binary에는 이 전달물이 없다.
- KolibriOS 공식 다운로드는 GPLv2를 명시하지만, 현재 고정한 `i.copy.sh` image와 exact source revision의 연결은 없다.

## package 경계

```text
@web-machine/core             pure code
@web-machine/browser          browser implementation code
@web-machine/guest-pyproc     adapter code, pyproc engine externally pinned
@web-machine/guest-v86        adapter code, V86 constructor externally injected

application composition root
  -> engine/firmware/guest asset manifest
  -> provenance approval
  -> runtime registration
```

`.webmachine` schema v1은 engine과 boot image를 파일에 복사하지 않는다. 다만 guest RAM snapshot과 block state는
원래 OS의 executable·filesystem material을 포함할 수 있다. 사용자가 자기 환경에서 export한 file은 package가
아니며, 그것을 제3자에게 배포하는 순간 별도 software distribution이 된다. trusted signature는 출처 identity를
증명할 뿐 license compliance를 대신하지 않는다.

## 공식 machine image 배포 게이트

공식 Linux 또는 graphical `.webmachine` image를 배포하려면 모두 필요하다.

1. guest source repository와 exact revision.
2. 재현 가능한 build config, patch series, compiler/toolchain pin.
3. Buildroot 계열은 `make legal-info` 전체 결과와 경고 0 판정.
4. firmware와 filesystem을 포함한 SPDX SBOM.
5. license text, notice, corresponding source 또는 source offer 전달 경로.
6. 최종 boot asset과 `.webmachine` blob의 SHA-256.
7. signed image manifest가 SBOM digest와 provenance policy version을 포함하는 다음 schema.

이 일곱 항목 전에는 public image catalog, bundled lab, CDN mirror를 만들지 않는다. code package 승격과 이
게이트를 묶지 않되, 실행 가능한 공식 image가 없는 상태를 완성된 배포 제품이라고 부르지도 않는다.
