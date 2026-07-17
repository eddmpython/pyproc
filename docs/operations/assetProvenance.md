# 자산 provenance와 배포 정책

**policyVersion: 1.** 이 숫자는 서명된 `.webmachine` 봉투가 나르는 값이다
(`apps/webComputer/assetProvenance.js`). 이 문서의 결정이 바뀌면 함께 올리고, `npm test`가
문서와 봉투의 값 일치를 강제한다.

## 결정

Web Machine code package와 실행 자산을 같은 배포물로 취급하지 않는다.

1. `core`, `browser`, `guest-pyproc`, `guest-v86` code package에는 third-party binary를 0개만 허용한다.
2. engine constructor, firmware, guest image는 composition root가 명시적으로 주입한다.
3. provenance가 불완전한 binary는 hash가 맞아도 `local-test-only`다.
4. 공식 `.webmachine` image 배포는 image가 포함한 OS·filesystem의 SBOM과 compliance material을 갖추기 전까지 금지한다.

hash는 무결성을 증명하지만 재배포 권리를 증명하지 않는다. 프로젝트 이름의 license만 알아도
exact binary에 포함된 component, source revision, build config를 모르면 배포 판정은
`NOASSERTION`이다.

## 증거 없음은 통과가 아니다

이 정책의 핵심 문장이자, 실제로 새고 있던 자리다.

- **Package의 결론은 자기가 덮는 File 중 가장 약한 것보다 강할 수 없다.** SPDX 의미론이자
  위 원칙의 기계 표현이다. `licenseDeclared`(상류가 뭐라 했나)와 `licenseConcluded`(우리가
  뭐라 결론냈나)는 다른 질문이므로 복사하지 않는다.
- **자산을 기술하지 않는 것이 면제가 아니다.** 어떤 catalog도 기술하지 않는 게스트는 그
  부재를 명시로 밝힌다(`UNDESCRIBED_ASSET_PROVENANCE`). 침묵하면 증거 없음이 문제 없음으로
  읽힌다.
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

| 자산 | 확인된 provenance | 배포 판정 |
|---|---|---|
| `libv86.mjs` | npm `v86@0.5.424` registry integrity, source repository. exact revision 없음 | local test만 |
| `v86.wasm` | 위와 같음. composite binary의 최종 inventory 미검증 | local test만 |
| `seabios.bin` | v86 `2f1346b` build script가 SeaBIOS `rel-1.16.2`와 고정 config 사용. **exact version + 공개 config가 있어 재현 경로가 열려 있다** | 재현 build·license 전달물 전 local test만 |
| `vgabios.bin` | 위 SeaBIOS build의 `out/vgabios.bin` | 위와 같음 |
| `buildroot-bzimage68.bin` | **커널 6.8.12**(bzImage setup header에서 직접 판독), 툴체인 gcc 13.2.0 / binutils 2.42, Buildroot 트리 `2021.11-11272-ge2962af`. `.config` 미탑재(CONFIG_IKCONFIG 비활성), 그 트리는 mainline에 없음 | 번들·공식 image 배포 금지 |
| `kolibri.img` | v86 test URL과 SHA-256만. exact image revision 없음 | 번들·공식 image 배포 금지 |

component 결론은 전부 위 불변식이 도출한다. `v86`은 `v86.wasm`(inventory 미검증)을 덮으므로
`NOASSERTION`이고, `KolibriOS`는 상류가 GPL-2.0-only를 선언했지만 opaque binary라
`NOASSERTION`이다(선언은 `licenseDeclared`로 남는다).

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
4번과 6번은 fixture 자산에 대해 닫혔다. 1~3번과 5번은 `buildroot-bzimage68.bin`이 막고 있고,
그건 조사가 아니라 **자산 교체** 과제다: 커널 6.8.12는 이미 식별됐으므로 문서화된 `.config`로
같은 버전을 빌드하면 1~3번과 5번이 함께 열린다. 그들의 빌드를 재현할 필요가 없다.

`.webmachine` schema는 engine과 boot image를 파일에 복사하지 않는다. 다만 guest RAM snapshot과
block state는 원래 OS의 executable·filesystem material을 포함할 수 있다. 사용자가 자기
환경에서 export한 file은 package가 아니며, 그것을 제3자에게 배포하는 순간 별도 software
distribution이 된다.

## 알려진 위험

| 위험 | 실태 |
|---|---|
| `i.copy.sh` 단일 출처 | 10MB `buildroot-bzimage68.bin`의 유일한 출처가 1인 호스팅 mutable URL이다. 미러도 불변성 보증도 없고 404가 나면 `npm run test:web-computer`가 죽는다. 미러를 저장소에 두는 것은 위 결정 1이 금지하므로, 진짜 해는 자체 빌드다(커널이 식별됐으므로 막혀 있지 않다) |
| 배포 기제 | Web Machine 플랫폼은 `src/machine`으로 편입돼 npm `files`의 `src`에 실린다(코드 배포는 열림). 단 guest 실행 자산은 여전히 안 나간다: `redistribution: "disabled"`는 사실의 기술이고, 이 표의 provenance 조건이 채워지기 전까지 공식 image 배포는 금지다 |
| pyproc 게스트 자산 미기술 | 제품이 부팅하는 9.6MB `pyodide.asm.wasm`을 어떤 catalog도 기술하지 않는다. `pyodide-lock.json`의 354개는 선택적 wheel 카탈로그이지 부팅 적재 집합이 아니라서 그 합성 바이너리를 0% 덮는다. 같은 잣대로 `v86.wasm`과 동일 판정을 받아야 한다. 지금은 부재를 명시로 싣는 것까지만 닫혔다 |

설계 근거와 완료 기록은
[web-machine-platform](../../mainPlan/_done/web-machine-platform/README.md), 이 정책을 실제로
물게 만든 작업은 [asset-provenance](../../mainPlan/asset-provenance/README.md)에 있다.
