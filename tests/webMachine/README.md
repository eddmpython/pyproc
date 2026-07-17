# Web Machine 정식 검증 트리

완료 설계 기록: [web-machine-platform](../../mainPlan/_done/web-machine-platform/README.md).

`tests/attempts/webMachine` 캠페인의 졸업 게이트를 모두 통과한 뒤 독립 package와 함께 승격한 검증 표면이다.
과거 실측 수치와 실패에서 고친 계약은 [진행 원장](../../mainPlan/_done/web-machine-platform/03-progress-ledger.md)에 둔다.

## 구조

```text
tests/webMachine/
├─ contracts/          # fake/WASI 공통 adapter 검증용 구현
├─ fixtures/           # 입력·packet fixture와 v86 provenance/SBOM
└─ browser/probes/     # package를 조립하는 유일한 composition root
```

probe는 `src/machine/index.js` 배럴만 import한다. machine 내부 deep path와 guest 사이 import는 구조 게이트가 차단한다.
v86 constructor와 모든 engine/image binary는 composition root에서 외부 주입하며 package와 git에는 포함하지 않는다.

## 실행

```bash
node tests/webMachine/fixtures/v86/prepareAssets.mjs
node tests/webMachine/fixtures/v86/assetProvenance.mjs --check
node tests/browser/run.mjs tests/webMachine/browser/probes/hostContractProbe.html
node tests/browser/run.mjs tests/webMachine/browser/probes/deviceBackedDualBootProbe.html
node tests/browser/run.mjs tests/webMachine/browser/probes/machineEnvelopeProbe.html
```

`assetCatalog.json`이 fixture URL, SHA-256, byte length, license 결론, bundle blocker의 SSOT다.
기존 Buildroot와 Kolibri image는 exact source와 build inventory가 없어 계속 `local-test-only`다.
