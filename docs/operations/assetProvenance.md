# 자산 provenance와 배포 정책

**policyVersion: 3.** 이 숫자는 서명된 `.webmachine` 봉투가 나르는 값이다
(`apps/webComputer/assetProvenance.js`). 이 문서의 결정이 바뀌면 함께 올리고, `npm test`가
문서와 봉투의 값 일치를 강제한다. v3의 변경: complete source, legal material, SBOM과 함께
프로젝트 release로 공개한 자산을 가리키는 `project-release-runtime-reference` 판정을 추가했다.

## 결정

Web Machine code package와 실행 자산을 같은 배포물로 취급하지 않는다.

1. `core`, `browser`, `guest-pyproc`, `guest-v86` code package에는 third-party binary를 0개만 허용한다.
2. engine constructor, firmware, guest image는 composition root가 명시적으로 주입한다.
3. provenance가 불완전한 binary는 우리가 재배포하지 않는다: 번들도, 재호스팅도 금지.
   hash가 맞아도 마찬가지다. 다만 **상류 자신의 배포 지점을 런타임에 참조하는 것은
   재배포가 아니다**: 바이트는 상류에서 소비자의 브라우저로 직접 간다. 그 참조 사실과
   대상 바이트의 digest는 catalog가 기술한다(`upstream-cdn-runtime-reference`). 프로젝트가
   source/legal/SBOM과 함께 별도 release asset으로 공개한 바이트는
   `project-release-runtime-reference`, 로컬 시험에서만 받는 fixture는 `local-test-only`다.
4. 공식 `.webmachine` image 배포는 image가 포함한 OS·filesystem의 SBOM과 compliance material을 갖추기 전까지 금지한다.

hash는 무결성을 증명하지만 재배포 권리를 증명하지 않는다. 프로젝트 이름의 license만 알아도
exact binary에 포함된 component, source revision, build config를 모르면 배포 판정은
`NOASSERTION`이다.

## 증거 없음은 통과가 아니다

이 정책의 핵심 문장이자, 실제로 새고 있던 자리다.

- **Package의 결론은 자기가 덮는 File 중 가장 약한 것보다 강할 수 없다.** SPDX 의미론이자
  위 원칙의 기계 표현이다. `licenseDeclared`(상류가 뭐라 했나)와 `licenseConcluded`(우리가
  뭐라 결론냈나)는 다른 질문이므로 복사하지 않는다.
- **자산을 기술하지 않는 것이 면제가 아니다.** 두 guest의 실행 자산 전부(엔진 부팅 집합
  포함)를 catalog 하나가 기술하므로 미기술 게스트는 없다. 한때 부재를 명시로 싣는 장치
  (`UNDESCRIBED_ASSET_PROVENANCE`)가 pyproc 게스트에 걸려 있었는데, 자산이 기술되면서
  장치도 은퇴했다. 재등장 = 어떤 게스트의 자산이 catalog 밖으로 샜다는 뜻이고 게이트가
  잡는다.
- **봉투는 판정이 아니라 출처를 나른다.** `policyVersion`/`catalogId`/`sbomDigest`는 싣고
  `channel`은 싣지 않는다. 수신자는 catalog도 자산도 없어서 재계산할 수 없고, 재계산
  불가능한 판정은 계산이 아니라 선언이다. 게다가 `imageTrust`가 서명 검증 **전에** manifest를
  파싱해 신뢰 화면에 쓰므로, 봉투의 채널 주장은 공격자 제어 문자열이 된다.
  **trusted signature는 출처 identity를 증명할 뿐 license compliance를 대신하지 않는다.**

## SSOT와 파생물

정본은 [scripts/assetCatalog.json](../../scripts/assetCatalog.json) 하나다. 나머지는 전부
파생물이고 `npm run assets:provenance -- --check`가 바이트로 대조한다(`npm test`가 호출).

| 파생물 | 무엇 |
|---|---|
| [scripts/assetSbom.json](../../scripts/assetSbom.json) | SPDX 2.3 SBOM |
| `apps/webComputer/assetCatalog.json` | 제품이 적재하는 자산(`consumers`가 선택) |
| `apps/webComputer/assetProvenance.js` | 봉투가 나르는 출처(브라우저 import용 모듈) |

파생을 쓰는 이유: 예전엔 같은 자산 5개가 두 파일에 두 어휘로 손수 중복 기술돼 있었고, 그래서
제품 catalog에서 Linux image의 license를 거짓 `MIT`로 바꿔도 `npm test`가 통과했다. 봉인이
걸린 쪽은 CI가 안 도는 fixture였고 봉인 없는 쪽이 제품이었다.

## 현재 자산 판정

엔진 부팅 집합(Pyodide 314.0.2, `DEFAULT_INDEX` 밑, 두 유통 경로 교차 검증: GitHub release
tarball과 jsdelivr CDN의 바이트가 sha256 동일함을 2026-07-19 실측):

| 자산 | 확인된 provenance | 배포 판정 |
|---|---|---|
| `pyodide.js` / `pyodide.mjs` | Pyodide 자기 소스의 loader 빌드물. exact tag `314.0.2`, 공개 빌드 recipe(미재현) | 상류 CDN 런타임 참조만 |
| `pyodide.asm.mjs` | Emscripten 생성 글루. 제3자 런타임 코드 포함, inventory 미검증 | 상류 CDN 런타임 참조만 |
| `pyodide.asm.wasm` | 합성 바이너리(CPython + 링크 라이브러리). 최종 inventory 미검증. `v86.wasm`과 동일 잣대 | 상류 CDN 런타임 참조만 |
| `python_stdlib.zip` | CPython stdlib + Pyodide 패치. 내용 inventory 미검증 | 상류 CDN 런타임 참조만 |
| `pyodide-lock.json` | Pyodide 빌드가 생성한 패키지 메타데이터 | 상류 CDN 런타임 참조만 |

Web Machine fixture(v86 계열):

| 자산 | 확인된 provenance | 배포 판정 |
|---|---|---|
| `libv86.mjs` | npm `v86@0.5.424` registry integrity, source repository. exact revision 없음 | local test만 |
| `v86.wasm` | 위와 같음. composite binary의 최종 inventory 미검증 | local test만 |
| `seabios.bin` | v86 `2f1346b` build script가 SeaBIOS `rel-1.16.2`와 고정 config 사용. **exact version + 공개 config가 있어 재현 경로가 열려 있다** | 재현 build·license 전달물 전 local test만 |
| `vgabios.bin` | 위 SeaBIOS build의 `out/vgabios.bin` | 위와 같음 |
| `buildroot-pyproc-i686.bin` | Buildroot `2025.02.16` exact source와 config로 만든 프로젝트 재현 빌드. 독립 builder 둘의 byte-identical 결과, complete legal-info, CycloneDX, build/repro manifest를 `buildroot-pyproc-i686-v2` release에서 함께 제공 | project release runtime 참조, npm 번들 제외 |
| `kolibri.img` | `i.copy.sh/kolibri.img`와 `cdn.jsdelivr.net/gh/copy/images@master/kolibri.img` 두 출처. SHA-256는 일치. exact image revision 없음 | 번들·공식 image 배포 금지 |

component 결론은 전부 위 불변식이 도출한다. `Pyodide`는 `pyodide.asm.wasm`(inventory 미검증)을
덮으므로 `NOASSERTION`이고(선언 MPL-2.0은 `licenseDeclared`로 남는다), `v86`은
`v86.wasm`을 덮으므로 `NOASSERTION`, `KolibriOS`는 상류가 GPL-2.0-only를 선언했지만 opaque
binary라 `NOASSERTION`이다.

## 공식 machine image 배포 게이트

공식 Linux 또는 graphical `.webmachine` image를 배포하려면 모두 필요하다.

1. guest source repository와 exact revision.
2. 재현 가능한 build config, patch series, compiler/toolchain pin.
3. Buildroot 계열은 `make legal-info` 전체 결과와 경고 0 판정.
4. firmware와 filesystem을 포함한 SPDX SBOM.
5. license text, notice, corresponding source 또는 source offer 전달 경로.
6. 최종 boot asset과 `.webmachine` blob의 SHA-256.
7. signed image manifest가 SBOM digest와 provenance policy version을 포함한다.

7번은 닫혔다(봉투가 `policyVersion`/`catalogId`/`sbomDigest`를 서명 대상 안에 나른다).
4번과 6번은 catalog가 기술하는 전 자산에 대해 닫혔다. Buildroot guest의 1~3번과 5번도
`buildroot-pyproc-i686-v2` project release에서 닫혔다. 전체 공식 `.webmachine` 배포는 별도
firmware와 emulator 자산이 같은 수준에 도달할 때까지 계속 금지한다.

교체 recipe는 `scripts/buildroot/`에 있다. 현재 지원 중인 Buildroot `2025.02.16` exact commit과
i686 config를 고정하고, initramfs 포함 bzImage, `legal-info`, CycloneDX, build manifest를
만든다. GitHub Actions run `30707101027`의 독립 builder `a`/`b`는 2026-08-02에 바이트 동일한
7,791,104-byte 이미지를 만들었다(SHA-256
`9c4f2b818986ee238c773d45240d33b6a35a9f15e32f65cc1c10b5574c12c760`). 이 v2 guest는
virtio 9P host volume, serial login shell, VGA console shell을 재현 recipe에 포함한다.
2026-08-02 `buildroot-pyproc-i686-v2` release에 binary, exact Buildroot source archive,
complete legal-info, CycloneDX, config, build/repro manifest를 함께 게시하고 catalog를 그
SHA-256 고정 URL로 전환했다. `scripts/buildroot/releaseAssets.json`은 공개한 7개 자산의 이름,
크기, SHA-256을 모두 고정하며, catalog의 `evidenceManifest`가 그 파일 자체의 SHA-256과 크기를
고정한다. 따라서 GitHub Release 자산이 같은 URL로 교체돼도 다음 대조에서 탐지한다. 만료되는
Actions artifact는 재현 영수증의 출처일 뿐 runtime URL이 아니다.

`.webmachine` schema는 engine과 boot image를 파일에 복사하지 않는다. 다만 guest RAM snapshot과
block state는 원래 OS의 executable·filesystem material을 포함할 수 있다. 사용자가 자기
환경에서 export한 file은 package가 아니며, 그것을 제3자에게 배포하는 순간 별도 software
distribution이 된다.

## 알려진 위험

| 위험 | 실태 |
|---|---|
| `i.copy.sh` 자산 | `kolibri.img`는 `copy/images` CDN 백업이 추가돼 다중화되었다. 준비기는 catalog의 `sources` 순서를 따라 실패 시 다른 출처를 시도한다. 프로젝트 Buildroot guest는 `i.copy.sh`를 사용하지 않는다. |
| 배포 기제 | Web Machine code는 npm `files`의 `src`에 실린다. Buildroot guest만 project release runtime asset으로 공개했고 npm에는 넣지 않는다. 제품 catalog 전체의 `redistribution: "disabled"`는 나머지 firmware/emulator를 묶은 공식 machine image 배포가 아직 닫혔다는 뜻이다. |

운영 규칙:

- `scripts/assetProvenance.mjs`는 `assets[].sources`를 검증하고, 각 자산의 후보 소스를 정리한다.
- `scripts/prepareWebComputerAssets.mjs`와 `tests/webMachine/fixtures/v86/prepareAssets.mjs`는 `sources` 순서로 우회 다운로드한다.
- `i.copy.sh`가 단일 소스인 자산은 허용되나, `sources`가 하나뿐일 때 실행 로그는 `주의:` 경고를 남겨 `N+1` 출처 준비를 촉발한다.

지속 설계 근거는 이 문서, catalog, 생성기와 구조 게이트가 함께 보존한다. 완료 과정은 git
이력과 Buildroot release의 manifest가 보존한다.
