<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/theoribbi/lane/main/assets/lane-logo-dark.svg">
  <img src="https://raw.githubusercontent.com/theoribbi/lane/main/assets/lane-logo.png" alt="lane" width="560">
</picture>

**Isolated multi-repo worktree dev environments — cloned DBs, derived ports, zero env wiring.**

[![CI](https://github.com/theoribbi/lane/actions/workflows/ci.yml/badge.svg)](https://github.com/theoribbi/lane/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@theoribbi/lane.svg)](https://www.npmjs.com/package/@theoribbi/lane)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

</div>

---

`lane` lets multiple coding agents (or humans) work in parallel on full-stack
projects without stepping on each other. Each environment gets its own git
worktree, a database **cloned from your seeded dev DB**, derived ports, and
generated `.env` + compose overrides — wired across repos by a single shared
offset. One command up, one command down (with a safety gate that refuses to
destroy uncommitted work), and nothing left dirty in your repo or your
containers.

## Why

Running an isolated stack per worktree is painful: rebuilds, port collisions,
and — the real killer — two agents migrating the *same* shared database. Heavier
orchestrators give each agent a full container stack and leave your repo and
Docker dirty.

`lane` takes a lighter point in the design space:

- **Share the DB *server*, clone the *database*.** Your existing persistent DB
  container hosts a per-env clone (`app_feat_x`) next to the seeded source. No
  migration conflicts — each env owns its database.
- **One env = one compose project, app services only.** `main` and worktrees
  run identically (no native-vs-container drift); only ~2 app containers per
  active env.
- **One offset per env, shared by every repo in it.** Cross-repo port wiring is
  correct by construction.
- **The `lane.yml` manifest is load-bearing, not descriptive.** It *generates*
  the real config, so it can't silently rot — a wrong manifest fails `up`.

## Install

**As a Claude Code plugin** (recommended — bundles the `lane` workflow skill so
agents reach for it automatically):

```text
/plugin marketplace add theoribbi/lane
/plugin install lane@lane
```

**As a skill, any agent** ([skills.sh](https://www.skills.sh) — Claude Code,
Cursor, Codex, Copilot, Windsurf, Gemini…):

```sh
npx skills add theoribbi/lane
```

**As a CLI** (npm):

```sh
npm install -g @theoribbi/lane
# or: pnpm add -g @theoribbi/lane
```

**From source:**

```sh
git clone https://github.com/theoribbi/lane.git && cd lane
pnpm install && pnpm build && pnpm link --global
```

> The plugin and the CLI are complementary: the plugin gives agents the *skill*
> (when/how to use lane), the npm package provides the `lane` *binary* the skill
> drives. Install both for the full experience.

## Quick start

```sh
# Generate a manifest draft from an existing compose file
lane init web -c docker-compose.yml      # review basePort, db.*, dependsOn

# Spin up env "feat-x" spanning two repos
lane up feat-x web api \
  --root web=../web,api=../api

# See active envs (offsets, ports, DB names, dirty status)
lane list

# Tear down — refuses if a worktree is dirty or has unpushed commits
lane down feat-x
```

## Commands

| Command | Does |
|---------|------|
| `lane up <env> <repos...>` | worktree + cloned DB + derived ports + generated `.env`/compose per repo, then start |
| `lane down <env>` | safety-gated teardown: containers, DB drop, worktree, registry entry |
| `lane list` | active envs with offsets, ports, DB names |
| `lane prune` | report orphaned compose projects not backed by the registry |
| `lane init <name>` | bootstrap a `lane.yml` draft from `docker-compose.yml` |

`--root <repo=path,...>` on `up`/`down` points at each repo's main checkout
(defaults to a cwd-relative path).

## `lane.yml`

Place at each repo root and commit it. **Load-bearing**: `lane up` fails fast if
it's wrong, so it can't drift like a wiki.

```yaml
name: web                       # short id — DB / container / worktree names
runtime: container              # container | native

services:
  web:
    basePort: 3000              # actual port = basePort + env.offset (probed if taken)
    health: "http://localhost:{port}/api/health"
  worker: {}                    # no port

db:
  engine: postgres              # postgres | mysql | none
  container: app-postgres       # shared persistent DB server
  hostPort: 5432
  user: app
  password: app_dev_password
  source: app                   # seeded dev DB to clone
  target: "app_{env}"           # {env} → sanitized env slug

dependsOn:
  - repo: api
    inject: API_URL
    fallback: "http://host.docker.internal:4000"  # used when dep not in env
```

A native service with no local DB (e.g. a backend that talks to a remote system):

```yaml
name: api
runtime: native
services:
  api: { basePort: 4000 }
db: { engine: none }
```

## Host resolution

The host injected for a `dependsOn` dep and for the DB URL is decided by the
**consumer's** runtime — every producer publishes on host ports:

| Consumer runtime | Host |
|------------------|------|
| `container` | `host.docker.internal` |
| `native` | `localhost` |

When a dep **is** part of the env, its env-offset port is injected; otherwise the
manifest `fallback` is used unchanged.

## Drift check

Catch manifest services missing from `docker-compose.yml` before they fail at
`up` time. Wire it into a pre-commit hook:

```sh
node node_modules/@theoribbi/lane/scripts/check-manifest-drift.mjs lane.yml docker-compose.yml
```

Or call it programmatically:

```ts
import { checkDrift } from "@theoribbi/lane/scripts/check-manifest-drift.mjs";
const msgs = checkDrift(manifestYaml, composeYaml); // [] = no drift
```

## How it works

Two commands and one generated record under `~/.lane` that tracks exactly what
each env created.

`lane up <env> <repos…>`, for the env:

1. Allocate one offset; bind each service to `basePort + offset` (probe upward if
   the port is taken).
2. Create the git worktree for each repo.
3. Clone its database from the live seeded source into `<db>_<env>` —
   `pg_dump | pg_restore` (Postgres) or `mysqldump | mysql` (MySQL). Never
   `TEMPLATE`, so the source can stay running.
4. Write the worktree's `.env` and `.lane/compose.override.yml`, resolving each
   cross-repo URL from the shared offset.
5. Start the container services. Native services (no container) you run yourself
   against the generated `.env`.

`lane down <env>` reverses what the record says — stop containers, drop the
cloned DB, remove the worktree — but only after a gate that refuses if any
worktree has uncommitted or unpushed work (`--force` to override). Because the
record names everything `up` made, `down` is exact and `lane prune` can spot what
an interrupted run left behind.

## Limitations

`lane` is young and intentionally small. Where it's thin today:

- **DB cloning covers Postgres and MySQL.** Other engines use `engine: none` —
  you still get the worktree, ports, and generated `.env`; lane just doesn't
  clone the data (fine for Redis, SQLite, or a DB you manage yourself). Adding an
  engine is one branch in `src/db.ts` and a test.
- **Local only.** No remote or cloud environments — it drives your local Docker
  and checkouts.
- **`health` is declared but not awaited.** `up` starts services and returns; it
  doesn't yet poll the manifest's `health` URL.

None of these are load-bearing decisions — they're just where the work stopped.
The project is built to grow; these make good first PRs. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

## The bundled skill

The plugin ships a skill ([`skills/lane/SKILL.md`](./skills/lane/SKILL.md)) that
teaches agents *when* and *how* to reach for `lane` — start isolated/parallel
multi-repo work, run the up/down lifecycle, respect the cleanliness gate. It's
installed automatically by the plugin (see [Install](#install)). Want the skill
without the plugin? Copy it in:

```sh
mkdir -p ~/.claude/skills/lane && cp skills/lane/SKILL.md ~/.claude/skills/lane/
```

## Contributing

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). In short:
fork, branch, **TDD** (every change ships with a test), `pnpm test` green, open
a PR. All side effects go through the injectable `Runner`, so logic stays
unit-testable without a live host.

## License

[MIT](./LICENSE) © Théo Ribbi
