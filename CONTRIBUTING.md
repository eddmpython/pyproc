# Contributing to pyproc

Language: English | [한국어](CONTRIBUTING.ko.md)

pyproc is a reusable browser Python runtime (processes, parallelism, restore-based reactivity on top of Pyodide). Thanks for your interest. This document is the contract for participating in the repository.

## License status (read first)

The license is **not decided yet** (pending an owner decision). Until a LICENSE file lands in the repository root:

- **Code contributions (pull requests) are on hold.** We cannot merge external code without a clear license and contribution terms; doing so would poison the history.
- **Everything else is welcome**: bug reports, browser measurements (please include Chrome/Edge version and hardware), reproduction pages, documentation fixes via issues, design discussion.

When the license lands, this section will be replaced by the actual terms.

## Scope (so you do not waste effort)

- **Chromium / Edge only.** pyproc requires JSPI, SharedArrayBuffer, and `crossOriginIsolated`. Firefox/Safari support is out of scope by design; PRs adding compatibility shims will be declined.
- **No product UI or domain logic.** pyproc ships runtime primitives and capability contracts only. Products build their own surface on top.
- **No build step, ever.** Native ESM `.js` plus a hand-maintained `index.d.ts`. Bundlers and transpilers will not be introduced.

## How work flows here

1. **New capabilities start in `tests/attempts/<category>/`**, never directly in `src/`. A category is one question with a hypothesis and an explicit graduation gate, proven by browser measurements. See [tests/attempts/README.md](tests/attempts/README.md).
2. **Graduated learnings become a plan** in `mainPlan/<initiative>/` (numbered docs + progress ledger). Finished initiatives move to `mainPlan/_done/`.
3. **Only then does code land in `src/`**, which is layered by folder: `src/runtime/`, `src/capabilities/`, `src/processOs/`. Imports flow one way (toward Layer 0), and engine internals stay behind capability contracts.

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
- **No em dash (U+2014)** in any `*.md` or `*.js`. Use a hyphen, a comma, or rewrite the sentence. The pre-commit hook blocks it.
- **No tool or generation traces** in commit messages, comments, or docs (the commit-msg hook blocks a specific trace-term list). Write commit messages yourself: category of change plus what changed. Korean is the repository convention; clear English is accepted for external contributions.
- Version stays on the `0.0.x` line; only releases bump it, and the tag must match `package.json`. See [docs/operations/release.md](docs/operations/release.md).

## Pull request checklist (once the license lands)

- [ ] `npm test` green.
- [ ] Runtime-behavior changes include browser measurements (page, numbers, environment) in the PR description.
- [ ] Public surface changes update `index.d.ts` and README usage in the same change.
- [ ] No engine internals (`HEAPU8`, stack pointers) exposed outside capability contracts.
- [ ] Docs that the change contradicts are updated in the same change.
- [ ] New capability? It graduated through `tests/attempts/` first.

## Reporting issues

Include: what you ran (code or page), expected vs actual, browser + version, whether `crossOriginIsolated` was true, and console output. Performance reports should state hardware (cores, RAM) since parallel speedup claims depend on it.
