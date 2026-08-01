# docs - the documentation tree

pyproc's public persistent documentation: the SSOT for product direction, consumption contracts, references, and operating policy. Executable truth lives in `src/` and `tests/`; experiments begin under `tests/attempts/`; historical decisions remain available through git history. The summary of hard rules lives in `CLAUDE.md` at the repository root (a local rules document, untracked by git).

Language: `consuming/`, `reference/`, and `product/` are English, because that is where an adopter makes decisions. `operations/` is the internal operating tree and stays Korean.

## Category rules

- Create a category folder **only when a real document exists**. No empty folders and no "for later" categories.
- Document filenames follow the repository convention: `camelCase.md`.
- When a document contradicts the code or the rules, update the document in the same change.

## Map

| Category | Document | What |
|---|---|---|
| [product/](product/) | [vision.md](product/vision.md) | Product direction: the North Star, what it is and is not, success and failure criteria, the support boundary |
| | [glossary.md](product/glossary.md) | Glossary: the naming boundary between the pyproc kernel and the Web Machine layer (`src/machine`, bundled in npm) |
| [operations/](operations/) | [operatingModel.md](operations/operatingModel.md) | Operating model: documentation, executable truth, experiments, git history, memory operations, development principles |
| | [contractReality.md](operations/contractReality.md) | Contract reality: continuous tracking of the gap between contract and actual (recorded on discovery, deleted when closed). Open debt, standing re-verification, tradeoffs, the frontier |
| | [assetProvenance.md](operations/assetProvenance.md) | Provenance and distribution policy for runtime assets: no evidence is not a pass, SSOT versus derivatives, the seven-item official image distribution gate, known risks |
| | [testing.md](operations/testing.md) | The test gates (`npm test`) and the browser measurement procedure (a COOP/COEP server) |
| | [experimentalFreeze.md](operations/experimentalFreeze.md) | The freeze on new Experimental public surfaces and the conditions for lifting it |
| | [moduleBoundaries.md](operations/moduleBoundaries.md) | Ownership boundaries between Runtime capability clusters, policy modules, contract suites, and runtime assets |
| | [benchmarking.md](operations/benchmarking.md) | The measurement contract for internal benchmarks, canonical scenarios, and raw-evidence rules (posting on a public surface is forbidden: the no-bragging-with-numbers rule) |
| | [release.md](operations/release.md) | The version, tag, and release procedure (the `0.0.x` line, SHA-pin consumption) |
| | [demoHosting.md](operations/demoHosting.md) | The live demo deployment procedure (COOP/COEP static hosting, the root `_headers`) |
| [consuming/](consuming/) | [contract.md](consuming/contract.md) | The consumption contract: install, version pinning, import boundaries, runtime-asset deployment, per-consumer wiring status, Pyodide version consistency |
| | [capabilityMatrix.md](consuming/capabilityMatrix.md) | The capability matrix: per-surface product value, status, prerequisites, runnable surface, verification, boundaries |
| | [compatibility.md](consuming/compatibility.md) | Environment compatibility on one page: browsers, JSPI, COOP/COEP, engine pin, resource characteristics, memory-pressure guidance |
| | [resumeCatalog.md](consuming/resumeCatalog.md) | The per-product policy for which file descriptors, sockets, and DB connections `resume.py` must reopen after a revival |
| | [trustPermissions.md](consuming/trustPermissions.md) | `.pymachine` public key distribution, signer fingerprints, and the permission UI contract |
| [reference/](reference/) | [api.md](reference/api.md) | The function-level API reference: the six root exports and the machine handle vocabulary, escape hatches and subpaths, the full error code table (a machine gate forces every root export to be anchored) |
| | [bundleFormat.md](reference/bundleFormat.md) | The canonical layout of the portable bundle (`PYBUNDLE1`) envelope: byte placement, header fields, the separation of integrity from signature |

## Quick routing (area to document)

- First time using it: the root [README.md](../README.md) Quick start, then [reference/api.md](reference/api.md)
- Looking up a function signature or an error code: [reference/api.md](reference/api.md)
- What pyproc is and where it is going: [product/vision.md](product/vision.md)
- Where a new idea starts: [tests/attempts/README.md](../tests/attempts/README.md)
- Product direction and roadmap: [product/vision.md](product/vision.md); current contract gaps: [operations/contractReality.md](operations/contractReality.md); executable status: [`tests/northStar.mjs`](../tests/northStar.mjs); historical decisions: git history
- What must be green before a commit: [operations/testing.md](operations/testing.md)
- How speed is measured and where it is recorded (never on a public surface): [operations/benchmarking.md](operations/benchmarking.md)
- When and how the version moves: [operations/release.md](operations/release.md)
- How a product takes pyproc as a dependency: [consuming/contract.md](consuming/contract.md)
- Which capabilities a product can rely on: [consuming/capabilityMatrix.md](consuming/capabilityMatrix.md)
- Whether a target environment can run it: [consuming/compatibility.md](consuming/compatibility.md)
- The policy for reopening product resources after a revival: [consuming/resumeCatalog.md](consuming/resumeCatalog.md)
- Public key distribution and permission UI policy: [consuming/trustPermissions.md](consuming/trustPermissions.md)
- Contributing from outside: [CONTRIBUTING.md](../CONTRIBUTING.md)
