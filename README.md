# lane

Worktree environment orchestrator for parallel multi-repo development.
Spins up an isolated, port-offset stack per `git worktree` — cloned DB,
generated `.env`, no manual port editing.

## Install

```sh
pnpm build && pnpm link --global
```

## `lane.yml` schema

Place `lane.yml` at each repo root and commit it. This file is **load-bearing**:
`lane up` fails fast if the manifest is wrong.

```yaml
# gpa/lane.yml
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

`brokinsoft-api/lane.yml` (native runtime, no DB):

```yaml
name: brokinsoft-api
runtime: native
services:
  api:
    basePort: 3200
db:
  engine: none
```

## Commands

```sh
# Start env lane-a with two repos; provide worktree roots
lane up lane-a gpa brokinsoft-api \
  --root gpa=../gpa,brokinsoft-api=../brokinsoft-api

# Tear down (refuses if worktree is dirty or has unpushed commits)
lane down lane-a

# List active envs with offsets, ports, DB names, dirty status
lane list

# Garbage-collect orphaned containers / databases / worktrees
lane prune
```

## Host-resolution rule

When a `dependsOn` dep **is** part of the env, `lane up` picks the right host:

| Consumer runtime | Producer runtime | Host |
|-----------------|-----------------|------|
| container | native | `host.docker.internal` |
| container | container | service name (same compose project) |
| native | any | `localhost` |

When the dep is **not** in the env, the manifest `fallback` is injected unchanged.

## Drift check

Detect manifest services missing from `docker-compose.yml` before they silently
fail at `up` time.

**One-off:**

```sh
node scripts/check-manifest-drift.mjs lane.yml docker-compose.yml
```

**Pre-commit hook (`.husky/pre-commit` or equivalent):**

```sh
node node_modules/lane/scripts/check-manifest-drift.mjs lane.yml docker-compose.yml
```

Or call `checkDrift` directly in your own scripts:

```ts
import { checkDrift } from "lane/scripts/check-manifest-drift.mjs";
const msgs = checkDrift(manifestYaml, composeYaml);
if (msgs.length) throw new Error(msgs.join("\n"));
```

Returns an array of human-readable messages — empty = no drift.

## Init a manifest from an existing compose file

```sh
lane init gpa -c docker-compose.yml
```

Generates a `lane.yml` draft from the compose service list. Review and set
`basePort`, `db.*`, and `dependsOn` before committing.
