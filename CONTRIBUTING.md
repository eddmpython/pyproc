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
2. **Graduated learnings become a plan** in `mainPlan/<initiative>/` (numbered docs + progress ledger). Finished initiatives move to `mainPlan/_done/`.
3. **Only then does code land in `src/`**, where folder = layer and imports only ever point downward: `runtime/` (engine core) <- `capabilities/` (things that attach to a runtime) <- `composition/` (installs the capability registry, exposes the public surface) <- `session/` and `processOs/`. Every edge lowers the rank, so a cycle is impossible. Engine internals stay behind capability contracts.

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
- **Commit message rules** (partially machine-enforced by hooks):
  - State the nature of the change plus what actually changed. Korean is the repository convention; clear English is accepted for external contributions.
  - Write **subject-neutral** messages (no first-person self-reference).
  - If one piece of work mixes intents (new feature plus signature change plus cleanup), **split it into one commit per intent**.
  - **No tool or generation traces**: no model names, tool names, generation markers, or co-author trailers in commit messages, comments, or docs. The commit-msg hook blocks them.
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
