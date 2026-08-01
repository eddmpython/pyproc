# Contributing to pyproc

Language: English · [한국어](CONTRIBUTING.ko.md)

pyproc is a reusable browser Python runtime (processes, parallelism, restore-based reactivity on top of Pyodide). Thanks for your interest. This document is the contract for participating in the repository.

## License and contribution terms

pyproc is licensed under the [Mozilla Public License 2.0](LICENSE), the same license as Pyodide. By submitting a contribution you agree it is provided under the same license: under MPL-2.0 a contributor grants the copyright and patent licenses for their contribution by contributing it (Section 2.1), so inbound = outbound holds and no separate CLA is required. If you cannot agree to that, do not submit code.

What this means in practice: you may embed pyproc in a closed-source app freely, but changes to pyproc's own files are published as source under MPL-2.0.

Also welcome besides code: bug reports, browser measurements (please include Chrome/Edge version and hardware), reproduction pages, documentation fixes, design discussion.

## Scope (so you do not waste effort)

- **Chromium / Edge only.** pyproc requires JSPI, SharedArrayBuffer, and `crossOriginIsolated`. Firefox/Safari support is out of scope by design; PRs adding compatibility shims will be declined.
- **No product UI or domain logic.** pyproc ships runtime primitives and capability contracts only. Products build their own surface on top.
- **No build step, ever.** Native ESM `.js` plus a hand-maintained `index.d.ts`. Bundlers and transpilers will not be introduced.

## How work flows here

1. **New capabilities start in `tests/attempts/<category>/`**, never directly in `src/`. A category is one question with a hypothesis and an explicit graduation gate, proven by browser measurements. See [tests/attempts/README.md](tests/attempts/README.md).
2. **Graduated learnings become maintained contracts** in `docs/`, automated evidence in `tests/`, and reviewable decisions in git history. Temporary planning archives are not kept in the repository.
3. **Only then does code land in `src/`**, where folder = layer and imports only ever point downward: `runtime/` (0: engine core) <- `state/` (1: the durable state kernel) <- `capabilities/` (2: things that attach to a runtime) <- `composition/` (3: installs the capability registry, exposes the public surface) <- `session/` (4) and `processOs/` (4) <- `machine/` (5: the browser-computer host and its guests). Every edge lowers the rank, so a cycle is impossible. Engine internals stay behind capability contracts.

   Every file in `src/` states its own rank on the first line, so you never have to open the gate source to find out: `// fileName.js - Layer 2: what it does`. Files under `machine/` also state their internal file rank, because that rank (not the folder) is what the import-direction and purity checks actually enforce: `// v86SerialPort.js - Layer 5/guests: ...`, ordered `pure` <- `platform` <- `guests` <- `composition`. `npm test` fails if a label is missing or disagrees with the rank map.

Operating details live in [docs/](docs/README.md).

## Development setup

```bash
git clone <repo> && cd pyproc
git config core.hooksPath .githooks   # activates the repository's guard hooks
npm test                              # Node structure gate, zero dependencies
npm run serve                         # COOP/COEP static server for browser validation
```

Browser validation: open `http://localhost:8788/examples/basic.html` and `processOs.html` in Chrome/Edge. The page must report `crossOriginIsolated === true`. Real verification of this WASM runtime only happens in a browser; see [docs/operations/testing.md](docs/operations/testing.md).

## Hard gates (machine enforced)

- `npm test` must be green before every commit.
- **main only.** No local branches in this repository; hooks block non-main refs. External contributions come from forks targeting `main`.
- **No em dash (U+2014)** in any text-surface file (`*.md`, `*.js`, `*.mjs`, `*.ts`, `*.html`, `*.css`, `*.yml`, `*.json`). Use a hyphen, a comma, or rewrite the sentence. The pre-commit hook blocks it.
- **Commit messages are records, not labels** (machine-enforced). A commit message is the primary
  record that release notes, incident analysis, and regression hunts all depend on. The decision
  logic lives in one place, [scripts/commitMessage.mjs](scripts/commitMessage.mjs); `.githooks/commit-msg`
  calls it and `tests/run.mjs` proves its teeth with positive and negative fixtures on every run.

  ```
  분류: one-line summary of what was done

  What changed, at the file and symbol level.
  Why it was needed, so whoever reverts it can judge.
  Verification: which gate is green. For a new gate, the negative-test result too.
  ```

  - **Subject**: `분류: summary` form, 72 characters or fewer, no trailing period, Korean.
  - **Body required**: separated by a blank line, at least 2 lines, 100 characters or fewer per line.
  - **A verification line is required.** A change with no record of what confirmed it is a claim, not a record.
  - Write **subject-neutral** messages (no first-person self-reference).
  - If one piece of work mixes intents (new feature plus signature change plus cleanup), **split it into one commit per intent**.
  - **No tool or generation traces**: no model names, tool names, generation markers, or co-author trailers in commit messages, comments, or docs. The same rule source blocks them.
  - Subjects git writes itself (`Merge`, `Revert`, `fixup!`) skip the form check; the trace check stays.
  - Korean is the enforced convention here. Fork contributions may arrive in clear English and are
    rewritten to the convention when merged.
- Version stays on the `0.0.x` line; only releases bump it, and the tag must match `package.json`. See [docs/operations/release.md](docs/operations/release.md).

## Pull request checklist

- [ ] `npm test` green.
- [ ] Runtime-behavior changes include browser measurements (page, numbers, environment) in the PR description.
- [ ] Public surface changes update `index.d.ts` and README usage in the same change.
- [ ] No engine internals (`HEAPU8`, stack pointers) exposed outside capability contracts.
- [ ] Docs that the change contradicts are updated in the same change.
- [ ] New capability? It graduated through `tests/attempts/` first.

## Reporting issues

Include: what you ran (code or page), expected vs actual, browser + version, whether `crossOriginIsolated` was true, and console output. Performance reports should state hardware (cores, RAM) since parallel speedup claims depend on it.
