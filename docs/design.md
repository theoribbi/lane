# `lane` — Worktree Environment Orchestration

**Date:** 2026-06-26
**Status:** Design — pending review
**Working name:** `lane` (provisional, bikeshed later — project-agnostic: Solveo, uwalk, others)

---

## 1. Problem

Multiple coding agents work in parallel on full-stack projects via `git worktree`.
Each project has a running stack (DB, backend, frontend, workers, sometimes
external services like mailhog). Running an isolated stack per worktree today is
painful:

- **Rebuild cost** per worktree (node_modules, `.next`, native binaries).
- **Schema conflicts** when two agents migrate the *same* shared DB.
- **Port collisions** between parallel stacks.
- **Dirty state** left behind by orchestrators (Conductor et al.): dirty repo,
  orphaned containers.
- **Cross-repo wiring**: a session often spans two repos (GPA + brokinsoft-api,
  Connect + brokinsoft-api) and the consumer must point at *this env's*
  producer port, not main's.
- **Env vars by hand** every time — unsustainable.

## 2. Goals / Non-goals

**Goals**
- One command to spin up an isolated, multi-repo environment with cloned data.
- Zero manual env-var editing — everything generated.
- Zero drift: the source of truth is *load-bearing*, not descriptive.
- Clean teardown that cannot destroy uncommitted work.
- main and worktrees execute identically (no native-vs-container drift).

**Non-goals**
- Not a CI/cloud ephemeral-env system (Uffizzi/Okteto). Local dev only.
- Not a monorepo orchestrator. Repos stay independent and autonomous.
- No prod-anon import pipeline (YAGNI; revisit if a dev DB grows large).

## 3. Core model

Three invariants:

1. **The DB server is shared and persistent; databases are cloned.**
   Each project's existing persistent DB container (e.g. `gpa-postgres` on 5533)
   is the shared server for *that project's* lanes. The clone `gpa_lane_a` lives
   inside the same container, next to the seeded dev DB `gpa`. main uses `gpa`,
   lane-a uses `gpa_lane_a` — same server, same port.

2. **An environment = a compose project running app services only.**
   `COMPOSE_PROJECT_NAME=<repo>-<env>`. It runs web/worker/mailhog, bind-mounts
   that worktree's checkout, points at its own cloned DB, on derived ports.
   main is just the `main` env. Container count stays bounded:
   `(persistent DB containers) + ~2 app containers per ACTIVE env`.

3. **An environment owns ONE offset, shared by all its repos.**
   This is what makes cross-repo wiring correct by construction.

This threads the two failure modes: not "native everywhere" (so no binary
drift), not "full stack incl. DB per worktree" (so no container explosion — the
heavy stateful part, the DB, is shared).

## 4. The manifest (per-repo, load-bearing)

`lane.yml` at each repo root, committed with the repo. It **generates** the real
config; if it is wrong, `up` fails and you fix it immediately. There is no
second copy of ports anywhere.

```yaml
# gpa/lane.yml
name: gpa                       # short id — used in DB / container / worktree names
runtime: container              # container | native — how app services run
services:
  web:
    basePort: 3002              # preferred port = basePort + env.offset (probed if taken)
    health: "http://localhost:{port}/api/health"
  worker: {}                    # no port
db:
  engine: postgres              # postgres | mysql | none
  container: gpa-postgres       # the persistent server hosting source + clones
  source: gpa                   # dev seeded DB to clone (point-in-time)
  target: "gpa_{env}"           # naming template; {env} -> sanitized env slug
dependsOn:
  - repo: brokinsoft-api
    inject: BROKINSOFT_API_URL  # env var written into THIS repo's services
    fallback: "http://host.docker.internal:3200"  # used when dep NOT in this env
```

```yaml
# brokinsoft-api/lane.yml — the exception that validates the model
name: brokinsoft-api
runtime: native                 # Rust on host
services:
  api:
    basePort: 3200
db:
  engine: none                  # "DB" is remote HFSQL via ODBC — nothing to clone
```

**Minimal surface.** Only slow-changing facts: which services exist, their base
ports, the source DB, cross-repo deps. Actual ports are *computed*, never hand-
written.

## 5. The registry (global, generated state)

`~/.lane/envs/<env>.json` — written by `up`, read by `list`/`down`, deleted by
`down`. Never hand-edited. This is the precise record of what to undo.

```ts
interface EnvRecord {
  name: string                 // "lane-a"
  slug: string                 // sanitized for identifiers: "lane_a"
  offset: number               // e.g. 10
  createdAt: string            // ISO; stamped by the CLI, not the workflow
  repos: Array<{
    name: string               // "gpa"
    worktreePath: string       // absolute path to the worktree
    branch: string
    composeProject: string     // "gpa-lane-a"
    runtime: "container" | "native"
    services: Array<{ name: string; port: number | null }>  // ACTUAL bound ports
    db?: { engine: "postgres" | "mysql"; container: string; database: string }
  }>
}
```

## 6. Offset allocation & port binding

- Offsets are multiples of a stride (e.g. `10`): `lane-a` → 10, next free → 20…
  The offset is a **human-readable starting hint**, recorded per env.
- At `up`, each service's **preferred** port = `basePort + offset`. If occupied,
  probe upward to the next free port. The **actual** bound port is recorded in
  the registry — which stays the source of truth. No arithmetic collision can
  survive a probe.
- Because your projects already use distinct non-default base ports, services
  within one env never collide; the probe handles the rare cross-env edge.

## 7. Cross-repo resolution (the payoff)

`lane up lane-a gpa brokinsoft-api` (offset 10):

| Repo | Service | Base | `lane-a` |
|------|---------|------|----------|
| brokinsoft-api | api | 3200 | **3210** |
| gpa | web | 3002 | 3012 |

For each `dependsOn` entry, `up` asks: *is the dep repo part of this env?*

- **Yes** → inject the dep's **resolved env port**. The CLI knows the consumer's
  `runtime` and the producer's `runtime`, so it picks the right host:
  GPA (container) → brokinsoft (native host) ⇒
  `BROKINSOFT_API_URL=http://host.docker.internal:3210`.
- **No** → inject the manifest `fallback` (main `:3200` / staging).

You never write a port. The `host.docker.internal` vs `localhost` choice — the
one GPA's compose hand-codes today — is derived from the two runtimes.

## 8. Lifecycle commands

### `lane up <env> <repo...>`
1. Allocate (or reuse) the env's offset; probe & bind actual ports.
2. For each repo: create/reuse the `git worktree` + branch.
3. Clone each DB: `pg_dump --format=custom <source> | pg_restore --dbname=<target>`
   (Postgres) / `mysqldump <source> | mysql <target>` (MySQL). Tolerates a live
   source (main keeps running). Sub-second at current data sizes.
4. Generate each repo's `.env` (DB URL → clone, derived ports, resolved
   cross-repo URLs) + a compose override (`COMPOSE_PROJECT_NAME`, ports,
   bind-mount, per-env node_modules volume).
5. Start app services; wait on `health`.
6. Write the `EnvRecord`.

### `lane down <env>`
1. **Safety gate first.** For each worktree: `git status --porcelain` empty AND
   no unpushed commits. If dirty → stop, list it, refuse (override `--force`).
   Directly prevents the "dirty repo destroyed" failure.
2. `docker compose -p <repo>-<env> down -v` → remove app containers + that env's
   node_modules volume. Shared DB server untouched.
3. `DROP DATABASE <target> WITH (FORCE)` (Postgres ≥13 kills residual
   connections → teardown never hangs). `none`-engine repos skip this.
4. `git worktree remove` (only now that it's confirmed clean). Generated `.env`
   files go with it.
5. Delete the `EnvRecord` → offset freed for reuse.

Idempotent: a `down` on a half-removed env completes, skipping missing pieces.

### `lane list`
Active envs: offset, repos, branches, actual ports, DB names, dirty status. The
old wiki port-table — but generated and always true.

### `lane prune` (a.k.a. `doctor`)
Garbage collector: diff reality (containers / databases / worktrees) against the
registry. Surface orphans (half-dead `up`, manually deleted worktree) and offer
to clean. The safety net against mid-flight death.

## 9. Anti-rot principles (why this is not a gas factory)

1. **Single source of truth, load-bearing** — the port you read anywhere was
   produced by the manifest. No second place to sync.
2. **Derive, don't enumerate** — manifest declares base ports + service list
   only; real ports computed. Registry is generated, not edited.
3. **Minimal surface** — ~15-line manifest, only what genuinely varies per repo.
4. **Co-located + validated** — manifest lives in the repo; a pre-commit/CI
   check compares declared services vs the compose file and fails on drift.
5. **Bootstrapped from reality** — initial manifests generated from the existing
   compose files, so day-one state is correct.

The wiki rotted because it was descriptive (no consequence to being wrong). Here
a stale manifest means a broken `up` — fresh by mechanical necessity.

## 10. Special cases

- **brokinsoft-api**: `db.engine: none`. No clone, no drop — just a port offset
  and HTTP service. Proves the per-repo manifest handles asymmetry.
- **MySQL (apps)**: clone via `mysqldump | mysql`; create target DB + grants for
  the app user before restore.
- **mailhog**: stateless sink — may be shared across envs, OR run per-env behind
  the offset if isolation of captured mail matters. Default: per-env (cheap,
  fully isolated). *(Decision: confirm during planning.)*
- **Native consumers ↔ container producers**: host resolution derived from each
  service's `runtime`.

## 11. Open questions (resolve in planning)

- **CLI implementation language**: Node/TS (shares ecosystem, ships as a small
  bin) vs a shell script vs Rust. Leaning Node/TS for cross-repo ergonomics.
- **mailhog**: shared vs per-env default (above).
- **node_modules strategy per env**: per-env named volume (simple, more disk) vs
  a shared pnpm store volume hardlinked across envs (bounded disk, same FS
  constraint). Leaning per-env volume first; optimize only if disk hurts.
- **Pre-commit drift check**: ship in v1 or follow-up?

## 12. Out of scope (YAGNI)

- Prod-anon data pipeline / `*_template` refresh (only if a dev DB grows large).
- Remote/cloud envs.
- Non-git VCS.
