<div align="center">

# lane

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
  container hosts a per-env clone (`gpa_lane_a`) next to the seeded source. No
  migration conflicts — each env owns its database.
- **One env = one compose project, app services only.** `main` and worktrees
  run identically (no native-vs-container drift); only ~2 app containers per
  active env.
- **One offset per env, shared by every repo in it.** Cross-repo port wiring is
  correct by construction.
- **The `lane.yml` manifest is load-bearing, not descriptive.** It *generates*
  the real config, so it can't silently rot — a wrong manifest fails `up`.

## Install

```sh
npm install -g @theoribbi/lane
# or: pnpm add -g @theoribbi/lane
```

From source:

```sh
git clone https://github.com/theoribbi/lane.git && cd lane
pnpm install && pnpm build && pnpm link --global
```

## Quick start

```sh
# Generate a manifest draft from an existing compose file
lane init gpa -c docker-compose.yml      # review basePort, db.*, dependsOn

# Spin up env "lane-a" spanning two repos
lane up lane-a gpa brokinsoft-api \
  --root gpa=../gpa,brokinsoft-api=../brokinsoft-api

# See active envs (offsets, ports, DB names, dirty status)
lane list

# Tear down — refuses if a worktree is dirty or has unpushed commits
lane down lane-a
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
name: gpa                       # short id — DB / container / worktree names
runtime: container              # container | native

services:
  web:
    basePort: 3002              # actual port = basePort + env.offset (probed if taken)
    health: "http://localhost:{port}/api/health"
  worker: {}                    # no port

db:
  engine: postgres              # postgres | mysql | none
  container: gpa-postgres       # shared persistent DB server
  hostPort: 5533
  user: gpa
  password: gpa_dev_password
  source: gpa                   # seeded dev DB to clone
  target: "gpa_{env}"           # {env} → sanitized env slug

dependsOn:
  - repo: brokinsoft-api
    inject: BROKINSOFT_API_URL
    fallback: "http://host.docker.internal:3200"  # used when dep not in env
```

A native service with no local DB (e.g. a Rust API over a remote ERP):

```yaml
name: brokinsoft-api
runtime: native
services:
  api: { basePort: 3200 }
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

`up` builds an `EnvRecord` (the generated source of truth under `~/.lane`),
then materializes each repo: create the worktree, clone the DB via
`pg_dump | pg_restore` (tolerates a live source — never `TEMPLATE`), write the
`.env` + `.lane/compose.override.yml`, and start container services. `down`
reverses it precisely from that record, after a cleanliness gate that refuses to
destroy uncommitted or unpushed work.

## Contributing

Contributions welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). In short:
fork, branch, **TDD** (every change ships with a test), `pnpm test` green, open
a PR. All side effects go through the injectable `Runner`, so logic stays
unit-testable without a live host.

## License

[MIT](./LICENSE) © Théo Ribbi
