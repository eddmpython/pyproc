# Changed-path routing

## Contents

- Contract
- Canonical routes
- Interpretation

## Contract

Evaluate old and new paths for renames and deletions. Union every matching `read` and `run` set. Unknown paths require
`develop-pyproc` and `verify-pyproc` plus explicit review.

## Canonical routes

<!-- skill-routes:start -->
```json
[
  {"paths":["skills/**","scripts/skillOs/**"],"read":["start-pyproc","develop-pyproc","verify-pyproc"],"run":["npm run skills:check","npm run skills:test-routing","npm run skills:test-package","npm run skills:test-mcp","npm run skills:test-forward","npm run skills:test-performance"]},
  {"paths":["AGENTS.md","CLAUDE.md","README.md","README.ko.md","CONTRIBUTING.md","CONTRIBUTING.ko.md","SECURITY.md"],"read":["start-pyproc","develop-pyproc","verify-pyproc"],"run":["npm run skills:check","npm test"]},
  {"paths":["package.json","package-lock.json","tests/packageGate.mjs","tests/packageHarness.mjs"],"read":["ship-pyproc","use-pyproc-runtime","verify-pyproc"],"run":["npm run test:package","npm run test:installed"]},
  {"paths":["index.js","index.d.ts","src/runtime/**","src/capabilities/**","src/composition/**","src/session/**","src/processOs/**"],"read":["develop-pyproc","use-pyproc-runtime","reference-pyproc-api","verify-pyproc"],"run":["npm run test:contracts","npm run test:types","npm run test:browser","npm run test:installed"]},
  {"paths":["src/machine/**","apps/webComputer/**","tests/webMachine/**"],"read":["develop-pyproc","use-pyproc-machine","verify-pyproc"],"run":["npm run test:web-machine","npm run test:web-computer","npm run test:installed"]},
  {"paths":["scripts/controlProtocol/**","scripts/pyprocControl.mjs","scripts/pyprocMcp.mjs","pythonSdk/**","tests/pythonSdk/**"],"read":["control-pyproc","verify-pyproc"],"run":["npm run test:contracts","npm run test:control-product","npm run test:mcp","npm run test:mcp-product","npm run test:python-sdk"]},
  {"paths":["scripts/browserControl/**","scripts/automationSpace/**","tests/browser/browserControl*","tests/browser/frameSpace*","tests/browser/replaySpace*"],"read":["automate-browser-with-pyproc","control-pyproc","verify-pyproc"],"run":["npm run test:browser-control","npm run test:browser-control-stress","npm run test:frame-space","npm run test:replay-space"]},
  {"paths":["scripts/perception/**","tests/browser/apxProduct.mjs","tests/browser/experienceVerificationProduct.mjs"],"read":["verify-browser-experience","verify-pyproc"],"run":["npm run test:perception-computer","npm run test:experience-verification"]},
  {"paths":["scripts/effectTransaction/**","scripts/actuation/**","tests/browser/actuationProduct.mjs"],"read":["commit-pyproc-effects","automate-browser-with-pyproc","verify-pyproc"],"run":["npm run test:actuation","npm run test:contracts"]},
  {"paths":["scripts/appSpace/**","tests/browser/appSpaceProduct.mjs"],"read":["transact-pyproc-app-state","verify-pyproc"],"run":["npm run test:app-space"]},
  {"paths":["scripts/replayGraph/**","tests/browser/replayGraphProduct.mjs"],"read":["explore-pyproc-replays","verify-pyproc"],"run":["npm run test:replay-graph"]},
  {"paths":["scripts/assetCatalog.json","scripts/assetSbom.json","scripts/assetProvenance.mjs","src/runtime/engines/wasi/owned/**"],"read":["manage-pyproc-assets","ship-pyproc","verify-pyproc"],"run":["npm run assets:provenance -- --check","npm run test:package","npm run test:browser"]},
  {"paths":["tests/browser/benchCompare.mjs","tests/browser/perfBudget.json","tests/browser/speedBench.mjs"],"read":["benchmark-pyproc","verify-pyproc"],"run":["npm run bench:speed"]},
  {"paths":[".github/**","CHANGELOG.md","scripts/commitMessage.mjs"],"read":["ship-pyproc","develop-pyproc","verify-pyproc"],"run":["npm test","npm run test:package"]},
  {"paths":["mainPlan/**","tests/attempts/**"],"read":["evolve-pyproc","develop-pyproc","verify-pyproc"],"run":["npm test"]},
  {"paths":["tests/**"],"read":["develop-pyproc","verify-pyproc"],"run":["npm test"]},
  {"paths":["examples/**"],"read":["use-pyproc-runtime","verify-pyproc"],"run":["npm run test:examples"]}
]
```
<!-- skill-routes:end -->

## Interpretation

Treat route output as required knowledge and verification, not permission to perform effects, publish, or release.
