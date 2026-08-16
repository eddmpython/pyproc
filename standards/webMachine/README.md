# Web Machine Core v1

Web Machine Core v1 is a vendor-neutral protocol extracted from the shipped machine lifecycle. It defines a small host and adapter boundary, explicit device permissions, serialized operations, inspection, snapshots, and a portable image manifest.

This directory is the public review bundle:

- [Explainer](explainer.md) states the user need, goals, and alternatives.
- [Protocol](protocol.md) is the normative contract.
- [Protocol manifest](protocolManifest.json) locks requirement identifiers and conformance artifacts.
- [Surface lock](surfaceLock.json) records the version 1 names.
- [Readiness report](readiness.md) distinguishes repository evidence from missing external adoption.
- [Conformance vectors](vectors/coreVectors.js) are implementation-neutral transcripts.
- [Minimal implementation](reference/minimalWebMachine.js) is dependency-free and does not import product source.
- [WPT-shaped test](conformance/wpt/webMachineCore.any.js) exposes one named subtest per vector.

Run the two implementations in the repository:

```sh
npm run test:web-machine-conformance
npm run test:contracts
```

The claim is deliberately limited to `standard-ready product protocol`. This package is not a web standard, and the repository-local second implementation is not external independent implementation experience.

