# Contributing to lane

Thanks for considering a contribution! `lane` is small and deliberately
focused — the bar is correctness, tests, and keeping the surface lean.

## Setup

```sh
git clone https://github.com/theoribbi/lane.git && cd lane
pnpm install
pnpm test        # vitest — should be green
pnpm typecheck   # tsc --noEmit
pnpm build       # tsup → dist/cli.js
```

Requires Node ≥ 20 and pnpm (pinned via `packageManager`).

## Architecture in one minute

- **Pure logic modules** (`manifest`, `registry`, `ports`, `resolve`,
  `generate`) have no side effects and are unit-tested directly.
- **Side-effecting modules** (`db`, `worktree`, the `commands/*`) go through the
  injectable [`Runner`](./src/runner.ts). Tests use `FakeRunner` to assert on the
  *constructed* docker/git commands — no live host needed.
- The per-repo `lane.yml` **manifest** is load-bearing: it generates the real
  config. The `EnvRecord` under `~/.lane` is the generated record of what each
  `up` created, so `down` can reverse it precisely.

Keep each file to one clear responsibility. New side effects must route through
`Runner`.

## Workflow

1. **Open an issue first** for anything non-trivial — let's agree on the shape
   before code.
2. Fork and branch (`feat/…`, `fix/…`).
3. **Write a test first** (TDD). Every behavioral change ships with a test that
   would fail without it. For command builders, assert on the args via
   `FakeRunner`.
4. `pnpm test` and `pnpm typecheck` must be green; keep test output pristine.
5. Match the existing style (ESM, `.js` import extensions, no raw
   `child_process`).
6. Open a PR with a clear description and the reasoning behind the change.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `chore:`, `test:`, `refactor:`. Keep them imperative and scoped.

## Scope & philosophy

`lane` is intentionally lighter than container-per-agent orchestrators. PRs that
add heavyweight runtime assumptions, hardcode a specific stack, or broaden the
manifest beyond "what genuinely varies per repo" will likely be asked to slim
down. Bug fixes, new DB engines, and ergonomics improvements are very welcome.

By contributing you agree your work is licensed under the project's
[MIT License](./LICENSE).
