# docs - the documentation tree

pyproc's public persistent documentation: the SSOT for product direction, package contracts, references, and operating policy. Executable truth lives in `src/` and `tests/`; experiments begin under `tests/attempts/`; historical decisions remain available through git history. The summary of hard rules lives in `CLAUDE.md` at the repository root.

Language: `usage/`, `reference/`, and `product/` are English. `operations/` is the internal operating tree and stays Korean.

## Category rules

- Create a category folder **only when a real document exists**. No empty folders and no "for later" categories.
- Document filenames follow the repository convention: `camelCase.md`.
- When a document contradicts the code or the rules, update the document in the same change.

## Map

| Category | Document | What |
|---|---|---|
| [product/](product/) | [vision.md](product/vision.md) | Product direction: the North Star, what it is and is not, success and failure criteria, the support boundary |
| | [glossary.md](product/glossary.md) | Glossary: the naming boundary between the pyproc kernel and the Web Machine layer (`src/machine`, bundled in npm) |
| [specs/](specs/) | [apx/README.md](specs/apx/README.md) | APX 1.0 product contract: graph and situation representations, provenance, uncertainty, broker authority, visual evidence, action verification, and conformance |
| | [verification/README.md](specs/verification/README.md) | Experience Verification 1.0: strict repository contracts, deterministic verdicts, Evidence Pack integrity, exact comparison, and effect-free replay |
| | [machineFleet/README.md](specs/machineFleet/README.md) | Hibernating Machine Fleet protocol: state, lease, commit-before-stop, exact resume, hot admission, and resource evidence |
| | [executionMemory/README.md](specs/executionMemory/README.md) | Execution Memory protocol: immutable revisions, verified links, CAS HEAD, completion truth, signed handoff, privacy, and retention |
| | [rehearseCommit/README.md](specs/rehearseCommit/README.md) | Rehearse-Commit protocol: exact intent, signed approval, durable one-shot lease, honest outcome, and evidence-linked receipt |
| | [appSpace/README.md](specs/appSpace/README.md) | Transactional AppSpace protocol: cooperative logical state, fenced capture, immutable app and Machine pairs, CAS adoption, and effect outbox boundary |
| | [replayGraph/README.md](specs/replayGraph/README.md) | ReplayGraph Worlds protocol: content-addressed known states, exact verified edges, effect-free traversal, coverage, evaluation, and CAS revisions |
| [operations/](operations/) | [operatingModel.md](operations/operatingModel.md) | Operating model: documentation, executable truth, experiments, git history, memory operations, development principles |
| | [contractReality.md](operations/contractReality.md) | Contract reality: continuous tracking of the gap between contract and actual (recorded on discovery, deleted when closed). Open debt, standing re-verification, tradeoffs, the frontier |
| | [assetProvenance.md](operations/assetProvenance.md) | Provenance and distribution policy for runtime assets: no evidence is not a pass, SSOT versus derivatives, the seven-item official image distribution gate, known risks |
| | [testing.md](operations/testing.md) | The test gates (`npm test`) and the browser measurement procedure (a COOP/COEP server) |
| | [agentExperienceInitiatives.md](operations/agentExperienceInitiatives.md) | Ordered Initiative 0 through 8 plan: entrance, browser cognition, verified changes, hibernating fleets, execution memory, one-shot effects, transactional apps, replay worlds, and proof-carrying actuation |
| | [experimentalFreeze.md](operations/experimentalFreeze.md) | The freeze on new Experimental public surfaces and the conditions for lifting it |
| | [moduleBoundaries.md](operations/moduleBoundaries.md) | Ownership boundaries between Runtime capability clusters, policy modules, contract suites, and runtime assets |
| | [benchmarking.md](operations/benchmarking.md) | The measurement contract for internal benchmarks, canonical scenarios, and raw-evidence rules (posting on a public surface is forbidden: the no-bragging-with-numbers rule) |
| | [release.md](operations/release.md) | The version, tag, and release procedure (the `0.0.x` line, SHA-pin consumption) |
| | [demoHosting.md](operations/demoHosting.md) | The live demo deployment procedure (COOP/COEP static hosting, the root `_headers`) |
| [usage/](usage/) | [contract.md](usage/contract.md) | The package contract: install, version pinning, import boundaries, runtime-asset deployment, Pyodide version consistency |
| | [machineEntrance.md](usage/machineEntrance.md) | Machine Entrance: compile a closed or explicitly authorized profile, run effect-free doctor, and reach the first installed result |
| | [capabilityMatrix.md](usage/capabilityMatrix.md) | The capability matrix: intrinsic value, contract state, prerequisites, runnable surface, verification, boundaries |
| | [platformRequirements.md](usage/platformRequirements.md) | Platform requirements and preflight: browsers, JSPI, COOP/COEP, engine pin, resources, memory-pressure guidance |
| | [machineFleet.md](usage/machineFleet.md) | Bounded hot Machine registration, safe suspend, fresh leases, exact cold resume, and honest resource accounting |
| | [executionMemory.md](usage/executionMemory.md) | Durable execution sessions, browser boundaries, Evidence Pack completion, signed handoff, and client parity |
| | [resumeCatalog.md](usage/resumeCatalog.md) | The resource policy for which file descriptors, sockets, and DB connections `resume.py` must reopen after a revival |
| | [trustPermissions.md](usage/trustPermissions.md) | `.pymachine` public key distribution, signer fingerprints, and the permission UI contract |
| | [browserAutomation.md](usage/browserAutomation.md) | Installed MCP browser automation: manifest, screenshots, artifacts, authority, outcomes, and authorized-use boundaries |
| | [controlProtocol.md](usage/controlProtocol.md) | Language-neutral installed control: handshake, operations, cancellation, outcomes, and verified binary attachments |
| | [pythonSdk.md](usage/pythonSdk.md) | Official Python client: clean installation, persistent execution, checkpoint recovery, cancellation, and screenshots |
| | [javascriptControl.md](usage/javascriptControl.md) | Stable Node.js client: installed product lifecycle, persistent Python, APX, verified attachments, cancellation, and shutdown |
| | [experienceVerification.md](usage/experienceVerification.md) | Strict repository Experience Contracts, deterministic browser verdicts, canonical Evidence Packs, exact comparison, and effect-free replay |
| | [automationSpace.md](usage/automationSpace.md) | Provider-neutral automation lifecycle, authorization, effect, artifact, restore, and replay boundaries |
| | [frameSpace.md](usage/frameSpace.md) | Cooperative credentialless frame automation, target bridge, sandbox, screenshot, and origin boundaries |
| | [replaySpace.md](usage/replaySpace.md) | Hash-chained automation recording, artifact completeness, effect-free replay, and checkpoint-aligned resume |
| | [rehearseCommit.md](usage/rehearseCommit.md) | Configure, rehearse, approve, commit once, recover without resend, and seal an external effect |
| | [appSpace.md](usage/appSpace.md) | Configure a cooperative app adapter, pair its logical state with a Machine checkpoint, branch, restore, adopt, and stage effects without sending |
| | [replayGraph.md](usage/replayGraph.md) | Import recordings or AppSpace branches, traverse exact pinned worlds without effects, evaluate paths, and inspect coverage |
| [reference/](reference/) | [api.md](reference/api.md) | The function-level API reference: the six root exports and the machine handle vocabulary, escape hatches and subpaths, the full error code table (a machine gate forces every root export to be anchored) |
| | [bundleFormat.md](reference/bundleFormat.md) | The canonical layout of the portable bundle (`PYBUNDLE1`) envelope: byte placement, header fields, the separation of integrity from signature |

## Quick routing (area to document)

- First time using it: the root [README.md](../README.md) Quick start, then [reference/api.md](reference/api.md)
- Looking up a function signature or an error code: [reference/api.md](reference/api.md)
- What pyproc is and where it is going: [product/vision.md](product/vision.md)
- Where a new idea starts: [tests/attempts/README.md](../tests/attempts/README.md)
- Product direction and roadmap: [product/vision.md](product/vision.md); current contract gaps: [operations/contractReality.md](operations/contractReality.md); executable status: [`tests/northStar.mjs`](../tests/northStar.mjs); historical decisions: git history
- What must be green before a commit: [operations/testing.md](operations/testing.md)
- Ordered agent experience work and its graduation gates: [operations/agentExperienceInitiatives.md](operations/agentExperienceInitiatives.md)
- How speed is measured and where it is recorded (never on a public surface): [operations/benchmarking.md](operations/benchmarking.md)
- When and how the version moves: [operations/release.md](operations/release.md)
- Package installation and public boundaries: [usage/contract.md](usage/contract.md)
- First installed Python or browser result: [usage/machineEntrance.md](usage/machineEntrance.md)
- Capability contract and prerequisites: [usage/capabilityMatrix.md](usage/capabilityMatrix.md)
- Whether a target environment can run it: [usage/platformRequirements.md](usage/platformRequirements.md)
- How to keep a bounded number of durable Machines hot: [usage/machineFleet.md](usage/machineFleet.md)
- The policy for reopening resources after a revival: [usage/resumeCatalog.md](usage/resumeCatalog.md)
- Public key distribution and permission UI policy: [usage/trustPermissions.md](usage/trustPermissions.md)
- Installed MCP browser automation: [usage/browserAutomation.md](usage/browserAutomation.md)
- Language-neutral installed control: [usage/controlProtocol.md](usage/controlProtocol.md)
- Official Python client: [usage/pythonSdk.md](usage/pythonSdk.md)
- Official JavaScript control client: [usage/javascriptControl.md](usage/javascriptControl.md)
- Repository experience audit and Evidence Pack verification: [usage/experienceVerification.md](usage/experienceVerification.md)
- Automation provider contract: [usage/automationSpace.md](usage/automationSpace.md)
- Cooperative frame provider: [usage/frameSpace.md](usage/frameSpace.md)
- Automation recording and replay: [usage/replaySpace.md](usage/replaySpace.md)
- Cooperative app and Machine state pairs: [usage/appSpace.md](usage/appSpace.md)
- Effect-free verified branch worlds: [usage/replayGraph.md](usage/replayGraph.md)
- PyProc Eyes graph, SituationCapsule, and evidence contract: [APX 1.0](specs/apx/README.md)
- Repository change verdict and Evidence Pack contract: [Experience Verification 1.0](specs/verification/README.md)
- ReplayGraph node, edge, traversal, integrity, and evaluation contract: [ReplayGraph Worlds 1.0](specs/replayGraph/README.md)
- Contributing from outside: [CONTRIBUTING.md](../CONTRIBUTING.md)
