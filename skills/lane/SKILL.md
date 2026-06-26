---
name: lane
description: Use when starting parallel or multi-repo development work that needs isolation — spinning up an isolated dev environment with its own database and ports, or running multiple coding agents on the same project(s) without collisions. Wraps the `lane` CLI (isolated git-worktree environments with cloned DBs, derived ports, generated env config). Triggers on "isolated environment", "parallel agents", "work on a feature without touching main's stack", "spin up a worktree with its own DB", "tear down the env".
---

# Using lane

`lane` gives a piece of work its own isolated, runnable environment: a git
worktree, a database cloned from the seeded dev DB, derived ports, and generated
`.env` + compose overrides — wired across repos by one shared offset. Use it so
parallel work (especially multiple agents) never collides on ports or migrations,
and so teardown leaves nothing dirty.

## When to use

- Starting feature work that needs to run the stack without disturbing `main`'s
  running containers or database.
- Coordinating multiple agents/sessions on the same repo(s) in parallel.
- Any task spanning two repos that must talk to each other (e.g. a frontend that
  calls a backend you're also editing) — `lane` wires the consumer to *this
  env's* producer port automatically.

If the work is a quick read or a single-file edit, you don't need an env. Use
`lane` when the task needs the app actually running in isolation.

## Prerequisites

Each participating repo must have a committed `lane.yml` at its root. If one is
missing, generate a draft and review it before proceeding:

```sh
lane init <name> -c docker-compose.yml   # then set basePort, db.*, dependsOn
```

The persistent DB server container (e.g. `gpa-postgres`) and the seeded source
DB named in `lane.yml` must already be running — `lane` clones *from* it.

## Lifecycle

**Spin up** an env (name it after the task/branch). List every repo the work
touches in one command so they share one offset and resolve each other:

```sh
lane up <env> <repo...> --root <repo>=<path>,<repo>=<path>
# e.g.
lane up feat-xyz gpa brokinsoft-api --root gpa=../gpa,brokinsoft-api=../brokinsoft-api
```

After `up`, work inside the generated worktrees (paths shown by `lane list`).
The `.env` is generated — never hand-edit env vars or ports.

**Inspect** what's running:

```sh
lane list    # envs, offsets, ports, DB names, dirty status
```

**Tear down** when the work is merged or abandoned:

```sh
lane down <env>
```

`down` has a safety gate: it **refuses** if any worktree has uncommitted changes
or unpushed commits, and leaves the env intact. Commit/push first, then re-run.
Use `--force` only when you intend to discard that work.

**Recover** from a half-dead env (a crashed `up`, a manually deleted worktree):

```sh
lane prune   # reports orphaned compose projects not backed by the registry
```

## Rules

- **Never hand-edit a generated `.env` or pick a port manually** — `lane`
  derives both. If you need a different value, fix the `lane.yml` and re-`up`.
- **One `up` per env name.** To add a repo to an existing env, tear down and
  re-`up` with the full repo list (so the shared offset stays consistent).
- **Always `lane down` when finished** — it drops the cloned DB and removes the
  worktree. Don't leave envs leaking databases.
- **Don't run a destructive `down --force`** unless the user explicitly wants to
  discard uncommitted work; the gate exists to protect it.
- The `lane.yml` is load-bearing: if `up` fails complaining about the manifest,
  fix the manifest — don't work around it.
