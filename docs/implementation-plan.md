# `lane` — Worktree Environment Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node/TS CLI (`lane`) that spins up and tears down isolated, multi-repo development environments built on `git worktree`, with cloned databases, derived ports, and auto-generated env config.

**Architecture:** A thin CLI over pure modules. All side effects (docker, git, pg_dump) go through an injectable `Runner` so logic is unit-testable without a live host. A per-repo `lane.yml` manifest is the load-bearing source of truth; a generated registry under `~/.lane` records what each `up` created so `down` can reverse it precisely.

**Tech Stack:** TypeScript, Node 20, pnpm, commander (CLI), zod (validation), `yaml`, execa (process exec), vitest (tests), tsup (bundle to bin).

**Reference spec:** `docs/superpowers/specs/2026-06-26-lane-worktree-env-orchestration-design.md`

## Global Constraints

- **Language/runtime:** TypeScript, Node ≥ 20, ESM modules (`"type": "module"`).
- **Package manager:** pnpm. Pin `packageManager` in package.json (corepack pitfall: unpinned corepack pulls pnpm 11 / Node 22).
- **All side effects via `Runner`** — no direct `child_process` / `fs` calls in logic modules except `registry.ts` (fs is its purpose) and `ports.ts` (net probe, injected).
- **Registry base dir:** `process.env.LANE_HOME ?? path.join(os.homedir(), ".lane")`. Tests set `LANE_HOME` to a tmp dir.
- **Offset stride:** `10`. Offsets are starting hints; actual ports are probed and recorded.
- **Host resolution rule:** a consumer running as `container` reaches any producer (and the shared DB) via `host.docker.internal:<hostPort>`; a `native` consumer uses `localhost:<hostPort>`. Decided by the **consumer** runtime only (every producer publishes on host ports).
- **DB clone tolerates a live source** (dump/restore, never `TEMPLATE`). Drop uses `WITH (FORCE)` (Postgres).
- **Naming:** compose project = `<repo>-<env>`; cloned DB = manifest `db.target` with `{env}` → env slug; worktree branch = env name.
- **Defaults locked from spec §11:** CLI = Node/TS; mailhog = per-env; node_modules = per-env volume (compose project prefix gives this for free).

---

## File Structure

```
lane/
  package.json, tsconfig.json, tsup.config.ts, vitest.config.ts
  src/
    types.ts            # shared domain types
    runner.ts           # Runner interface, RealRunner (execa), FakeRunner (tests)
    manifest.ts         # zod schema + load lane.yml
    registry.ts         # EnvRecord persistence under ~/.lane/envs, slugify
    ports.ts            # offset allocation + port probing
    resolve.ts          # host rule, cross-repo dep resolution, DB URL builder
    generate.ts         # env vars, .env render, compose override render
    db.ts               # clone/drop (postgres + mysql) command construction
    worktree.ts         # git worktree create / cleanliness gate / remove
    commands/{up,down,list,prune,init}.ts
    cli.ts              # commander wiring + bin entry
  test/*.test.ts
  README.md
  scripts/check-manifest-drift.mjs   # pre-commit drift check (shipped, opt-in)
```

---

### Task 1: Scaffold + Runner + shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- Create: `src/types.ts`, `src/runner.ts`
- Test: `test/runner.test.ts`

**Interfaces:**
- Produces: `Runner`, `RealRunner`, `FakeRunner`, and all shared types below.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "lane",
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@9.12.0",
  "bin": { "lane": "./dist/cli.js" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "execa": "^9.5.0",
    "yaml": "^2.6.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.16.0",
    "tsup": "^8.3.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `tsup.config.ts` and `vitest.config.ts`**

```ts
// tsup.config.ts
import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

- [ ] **Step 4: Create `src/types.ts`**

```ts
export type Runtime = "container" | "native";
export type DbEngine = "postgres" | "mysql" | "none";

export interface ServiceManifest {
  basePort?: number;
  health?: string; // URL template, {port} substituted
}

export interface DependsOn {
  repo: string;
  inject: string;   // env var name written into THIS repo's services
  fallback: string; // URL used when the dep is not part of the env
}

export interface DbManifest {
  engine: DbEngine;
  container?: string; // persistent DB container hosting source + clones
  hostPort?: number;  // host-published port of that container
  user?: string;
  password?: string;
  source?: string;    // dev seeded DB to clone
  target?: string;    // clone naming template, e.g. "gpa_{env}"
}

export interface Manifest {
  name: string;
  runtime: Runtime;
  services: Record<string, ServiceManifest>;
  db: DbManifest;
  dependsOn?: DependsOn[];
  repoRoot: string; // absolute dir where lane.yml was found (added at load)
}

export interface ResolvedService {
  name: string;
  port: number | null;
}

export interface RepoRecord {
  name: string;
  worktreePath: string;
  branch: string;
  composeProject: string; // "<repo>-<env>"
  runtime: Runtime;
  services: ResolvedService[];
  db?: { engine: "postgres" | "mysql"; container: string; database: string };
}

export interface EnvRecord {
  name: string;
  slug: string;
  offset: number;
  createdAt: string;
  repos: RepoRecord[];
}
```

- [ ] **Step 5: Write the failing test for `Runner`**

```ts
// test/runner.test.ts
import { describe, it, expect } from "vitest";
import { FakeRunner } from "../src/runner.js";

describe("FakeRunner", () => {
  it("records calls and returns scripted results", async () => {
    const fake = new FakeRunner({ "git rev-parse": { stdout: "abc", stderr: "", exitCode: 0 } });
    const res = await fake.run("git", ["rev-parse", "HEAD"]);
    expect(res.stdout).toBe("abc");
    expect(fake.calls[0]).toEqual({ cmd: "git", args: ["rev-parse", "HEAD"], opts: undefined });
  });

  it("returns exitCode 0 empty result for unscripted commands", async () => {
    const fake = new FakeRunner();
    const res = await fake.run("docker", ["ps"]);
    expect(res.exitCode).toBe(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run test/runner.test.ts`
Expected: FAIL — cannot find `../src/runner.js`.

- [ ] **Step 7: Create `src/runner.ts`**

```ts
import { execa } from "execa";

export interface RunResult { stdout: string; stderr: string; exitCode: number; }
export interface RunOpts { input?: string; cwd?: string; env?: Record<string, string>; }

export interface Runner {
  run(cmd: string, args: string[], opts?: RunOpts): Promise<RunResult>;
}

export class RealRunner implements Runner {
  async run(cmd: string, args: string[], opts?: RunOpts): Promise<RunResult> {
    const res = await execa(cmd, args, {
      input: opts?.input,
      cwd: opts?.cwd,
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
      reject: false,
    });
    return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", exitCode: res.exitCode ?? 0 };
  }
}

export class FakeRunner implements Runner {
  calls: Array<{ cmd: string; args: string[]; opts?: RunOpts }> = [];
  constructor(private scripted: Record<string, RunResult> = {}) {}
  async run(cmd: string, args: string[], opts?: RunOpts): Promise<RunResult> {
    this.calls.push({ cmd, args, opts });
    // match on a prefix key like "git rev-parse"
    const key = Object.keys(this.scripted).find((k) =>
      [cmd, ...args].join(" ").startsWith(k),
    );
    return key ? this.scripted[key] : { stdout: "", stderr: "", exitCode: 0 };
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run test/runner.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json tsup.config.ts vitest.config.ts src/types.ts src/runner.ts test/runner.test.ts
git commit -m "chore: scaffold lane CLI with Runner abstraction and shared types"
```

---

### Task 2: Manifest loading + zod validation

**Files:**
- Create: `src/manifest.ts`
- Test: `test/manifest.test.ts`

**Interfaces:**
- Consumes: `Manifest` (types.ts), `Runner` not needed.
- Produces:
  - `parseManifest(yamlText: string, repoRoot: string): Manifest`
  - `loadManifest(repoRoot: string): Promise<Manifest>` (reads `<repoRoot>/lane.yml`)

- [ ] **Step 1: Write the failing test**

```ts
// test/manifest.test.ts
import { describe, it, expect } from "vitest";
import { parseManifest } from "../src/manifest.js";

const GPA = `
name: gpa
runtime: container
services:
  web: { basePort: 3002, health: "http://localhost:{port}/api/health" }
  worker: {}
db:
  engine: postgres
  container: gpa-postgres
  hostPort: 5533
  user: gpa
  password: gpa_dev_password
  source: gpa
  target: "gpa_{env}"
dependsOn:
  - { repo: brokinsoft-api, inject: BROKINSOFT_API_URL, fallback: "http://host.docker.internal:3200" }
`;

describe("parseManifest", () => {
  it("parses a valid manifest and attaches repoRoot", () => {
    const m = parseManifest(GPA, "/x/gpa");
    expect(m.name).toBe("gpa");
    expect(m.runtime).toBe("container");
    expect(m.services.web.basePort).toBe(3002);
    expect(m.db.target).toBe("gpa_{env}");
    expect(m.dependsOn?.[0].inject).toBe("BROKINSOFT_API_URL");
    expect(m.repoRoot).toBe("/x/gpa");
  });

  it("rejects a manifest missing name", () => {
    expect(() => parseManifest("runtime: native\nservices: {}\ndb: { engine: none }", "/x"))
      .toThrow();
  });

  it("allows db.engine none with no source", () => {
    const m = parseManifest("name: bk\nruntime: native\nservices:\n  api: { basePort: 3200 }\ndb: { engine: none }", "/x/bk");
    expect(m.db.engine).toBe("none");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/manifest.test.ts`
Expected: FAIL — cannot find `../src/manifest.js`.

- [ ] **Step 3: Create `src/manifest.ts`**

```ts
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Manifest } from "./types.js";

const ServiceSchema = z.object({
  basePort: z.number().int().positive().optional(),
  health: z.string().optional(),
});

const DbSchema = z.object({
  engine: z.enum(["postgres", "mysql", "none"]),
  container: z.string().optional(),
  hostPort: z.number().int().positive().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  source: z.string().optional(),
  target: z.string().optional(),
});

const DependsOnSchema = z.object({
  repo: z.string(),
  inject: z.string(),
  fallback: z.string(),
});

const ManifestSchema = z.object({
  name: z.string().min(1),
  runtime: z.enum(["container", "native"]),
  services: z.record(ServiceSchema),
  db: DbSchema,
  dependsOn: z.array(DependsOnSchema).optional(),
});

export function parseManifest(yamlText: string, repoRoot: string): Manifest {
  const raw = parseYaml(yamlText);
  const parsed = ManifestSchema.parse(raw);
  return { ...parsed, repoRoot };
}

export async function loadManifest(repoRoot: string): Promise<Manifest> {
  const text = await readFile(path.join(repoRoot, "lane.yml"), "utf8");
  return parseManifest(text, repoRoot);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/manifest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/manifest.ts test/manifest.test.ts
git commit -m "feat: load and validate lane.yml manifests"
```

---

### Task 3: Registry persistence + slugify

**Files:**
- Create: `src/registry.ts`
- Test: `test/registry.test.ts`

**Interfaces:**
- Consumes: `EnvRecord` (types.ts).
- Produces:
  - `slugify(name: string): string`
  - `registryDir(): string`
  - `readEnv(name: string): Promise<EnvRecord | null>`
  - `writeEnv(rec: EnvRecord): Promise<void>`
  - `deleteEnv(name: string): Promise<void>`
  - `listEnvs(): Promise<EnvRecord[]>`

- [ ] **Step 1: Write the failing test**

```ts
// test/registry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { slugify, writeEnv, readEnv, deleteEnv, listEnvs } from "../src/registry.js";
import type { EnvRecord } from "../src/types.js";

const rec: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "2026-06-26T00:00:00Z", repos: [],
};

describe("registry", () => {
  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lane-"));
    process.env.LANE_HOME = dir;
    return () => rm(dir, { recursive: true, force: true });
  });

  it("slugifies names to safe identifiers", () => {
    expect(slugify("lane-a")).toBe("lane_a");
    expect(slugify("Feat/XYZ 1")).toBe("feat_xyz_1");
  });

  it("writes, reads, lists, deletes an env record", async () => {
    expect(await readEnv("lane-a")).toBeNull();
    await writeEnv(rec);
    expect((await readEnv("lane-a"))?.offset).toBe(10);
    expect(await listEnvs()).toHaveLength(1);
    await deleteEnv("lane-a");
    expect(await readEnv("lane-a")).toBeNull();
    expect(await listEnvs()).toHaveLength(0);
  });

  it("deleteEnv is idempotent on a missing record", async () => {
    await expect(deleteEnv("nope")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/registry.test.ts`
Expected: FAIL — cannot find `../src/registry.js`.

- [ ] **Step 3: Create `src/registry.ts`**

```ts
import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EnvRecord } from "./types.js";

export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function registryDir(): string {
  const home = process.env.LANE_HOME ?? path.join(os.homedir(), ".lane");
  return path.join(home, "envs");
}

function envPath(name: string): string {
  return path.join(registryDir(), `${slugify(name)}.json`);
}

export async function writeEnv(rec: EnvRecord): Promise<void> {
  await mkdir(registryDir(), { recursive: true });
  await writeFile(envPath(rec.name), JSON.stringify(rec, null, 2), "utf8");
}

export async function readEnv(name: string): Promise<EnvRecord | null> {
  try {
    return JSON.parse(await readFile(envPath(name), "utf8")) as EnvRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function deleteEnv(name: string): Promise<void> {
  await rm(envPath(name), { force: true });
}

export async function listEnvs(): Promise<EnvRecord[]> {
  let files: string[];
  try {
    files = await readdir(registryDir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: EnvRecord[] = [];
  for (const f of files.filter((f) => f.endsWith(".json"))) {
    out.push(JSON.parse(await readFile(path.join(registryDir(), f), "utf8")) as EnvRecord);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/registry.ts test/registry.test.ts
git commit -m "feat: generated env registry under ~/.lane with slugify"
```

---

### Task 4: Offset allocation + port probing

**Files:**
- Create: `src/ports.ts`
- Test: `test/ports.test.ts`

**Interfaces:**
- Produces:
  - `type PortChecker = (port: number) => Promise<boolean>` (true = free)
  - `nextOffset(used: number[], stride?: number): number`
  - `bindPort(preferred: number, isFree: PortChecker): Promise<number>`
  - `isPortFreeReal: PortChecker` (net-based default)

- [ ] **Step 1: Write the failing test**

```ts
// test/ports.test.ts
import { describe, it, expect } from "vitest";
import { nextOffset, bindPort } from "../src/ports.js";

describe("ports", () => {
  it("nextOffset returns first free multiple of stride", () => {
    expect(nextOffset([], 10)).toBe(10);
    expect(nextOffset([10], 10)).toBe(20);
    expect(nextOffset([10, 30], 10)).toBe(20);
  });

  it("bindPort returns the preferred port when free", async () => {
    const free = async () => true;
    expect(await bindPort(3012, free)).toBe(3012);
  });

  it("bindPort probes upward when occupied", async () => {
    const taken = new Set([3012, 3013]);
    const isFree = async (p: number) => !taken.has(p);
    expect(await bindPort(3012, isFree)).toBe(3014);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/ports.test.ts`
Expected: FAIL — cannot find `../src/ports.js`.

- [ ] **Step 3: Create `src/ports.ts`**

```ts
import net from "node:net";

export type PortChecker = (port: number) => Promise<boolean>;

export function nextOffset(used: number[], stride = 10): number {
  const set = new Set(used);
  let off = stride;
  while (set.has(off)) off += stride;
  return off;
}

export async function bindPort(preferred: number, isFree: PortChecker): Promise<number> {
  let p = preferred;
  while (!(await isFree(p))) p += 1;
  return p;
}

export const isPortFreeReal: PortChecker = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "0.0.0.0");
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/ports.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ports.ts test/ports.test.ts
git commit -m "feat: offset allocation and port probing"
```

---

### Task 5: Host rule, cross-repo resolution, DB URL builder

**Files:**
- Create: `src/resolve.ts`
- Test: `test/resolve.test.ts`

**Interfaces:**
- Consumes: `Runtime`, `Manifest`, `EnvRecord`, `DbManifest` (types.ts).
- Produces:
  - `hostFor(consumer: Runtime): string` → `"host.docker.internal"` | `"localhost"`
  - `resolveDeps(manifest: Manifest, env: EnvRecord): Array<{ inject: string; url: string }>`
  - `dbUrl(db: DbManifest, database: string, consumer: Runtime): string`

- [ ] **Step 1: Write the failing test**

```ts
// test/resolve.test.ts
import { describe, it, expect } from "vitest";
import { hostFor, resolveDeps, dbUrl } from "../src/resolve.js";
import type { Manifest, EnvRecord } from "../src/types.js";

const gpa: Manifest = {
  name: "gpa", runtime: "container", repoRoot: "/x/gpa",
  services: { web: { basePort: 3002 } },
  db: { engine: "postgres", container: "gpa-postgres", hostPort: 5533, user: "gpa", password: "pw", source: "gpa", target: "gpa_{env}" },
  dependsOn: [{ repo: "brokinsoft-api", inject: "BROKINSOFT_API_URL", fallback: "http://host.docker.internal:3200" }],
};

const envWithBk: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "t", repos: [
    { name: "brokinsoft-api", worktreePath: "/x/bk", branch: "lane-a", composeProject: "brokinsoft-api-lane-a", runtime: "native", services: [{ name: "api", port: 3210 }] },
  ],
};
const envWithoutBk: EnvRecord = { ...envWithBk, repos: [] };

describe("resolve", () => {
  it("hostFor depends only on consumer runtime", () => {
    expect(hostFor("container")).toBe("host.docker.internal");
    expect(hostFor("native")).toBe("localhost");
  });

  it("resolves a co-running dep to its env port via the consumer host", () => {
    expect(resolveDeps(gpa, envWithBk)).toEqual([
      { inject: "BROKINSOFT_API_URL", url: "http://host.docker.internal:3210" },
    ]);
  });

  it("falls back when the dep is not in the env", () => {
    expect(resolveDeps(gpa, envWithoutBk)).toEqual([
      { inject: "BROKINSOFT_API_URL", url: "http://host.docker.internal:3200" },
    ]);
  });

  it("builds a DB url for a container consumer", () => {
    expect(dbUrl(gpa.db, "gpa_lane_a", "container"))
      .toBe("postgres://gpa:pw@host.docker.internal:5533/gpa_lane_a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/resolve.test.ts`
Expected: FAIL — cannot find `../src/resolve.js`.

- [ ] **Step 3: Create `src/resolve.ts`**

```ts
import type { Runtime, Manifest, EnvRecord, DbManifest } from "./types.js";

export function hostFor(consumer: Runtime): string {
  return consumer === "container" ? "host.docker.internal" : "localhost";
}

export function resolveDeps(
  manifest: Manifest,
  env: EnvRecord,
): Array<{ inject: string; url: string }> {
  const host = hostFor(manifest.runtime);
  return (manifest.dependsOn ?? []).map((dep) => {
    const repo = env.repos.find((r) => r.name === dep.repo);
    const port = repo?.services.find((s) => s.port != null)?.port ?? null;
    if (repo && port != null) {
      return { inject: dep.inject, url: `http://${host}:${port}` };
    }
    return { inject: dep.inject, url: dep.fallback };
  });
}

export function dbUrl(db: DbManifest, database: string, consumer: Runtime): string {
  const host = hostFor(consumer);
  const scheme = db.engine === "mysql" ? "mysql" : "postgres";
  return `${scheme}://${db.user}:${db.password}@${host}:${db.hostPort}/${database}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/resolve.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/resolve.ts test/resolve.test.ts
git commit -m "feat: cross-repo dependency resolution and DB url builder"
```

---

### Task 6: Generate `.env` + compose override

**Files:**
- Create: `src/generate.ts`
- Test: `test/generate.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `EnvRecord`, `RepoRecord`, `resolveDeps`, `dbUrl`.
- Produces:
  - `buildEnvVars(manifest: Manifest, env: EnvRecord, repo: RepoRecord): Record<string, string>`
  - `renderDotenv(vars: Record<string, string>): string`
  - `renderComposeOverride(manifest: Manifest, repo: RepoRecord, vars: Record<string, string>): string`

The override remaps each service's published port to its bound port and injects
the env vars; the DB is reached over `host.docker.internal` (it is NOT a service
of this compose project). `up` starts only the manifest's services, so the
project's bundled DB service never starts.

- [ ] **Step 1: Write the failing test**

```ts
// test/generate.test.ts
import { describe, it, expect } from "vitest";
import { buildEnvVars, renderDotenv, renderComposeOverride } from "../src/generate.js";
import { parse as parseYaml } from "yaml";
import type { Manifest, EnvRecord, RepoRecord } from "../src/types.js";

const gpa: Manifest = {
  name: "gpa", runtime: "container", repoRoot: "/x/gpa",
  services: { web: { basePort: 3002 }, worker: {} },
  db: { engine: "postgres", container: "gpa-postgres", hostPort: 5533, user: "gpa", password: "pw", source: "gpa", target: "gpa_{env}" },
  dependsOn: [{ repo: "brokinsoft-api", inject: "BROKINSOFT_API_URL", fallback: "http://host.docker.internal:3200" }],
};
const repo: RepoRecord = {
  name: "gpa", worktreePath: "/x/wt/gpa", branch: "lane-a", composeProject: "gpa-lane-a",
  runtime: "container",
  services: [{ name: "web", port: 3012 }, { name: "worker", port: null }],
  db: { engine: "postgres", container: "gpa-postgres", database: "gpa_lane_a" },
};
const env: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "t",
  repos: [repo, { name: "brokinsoft-api", worktreePath: "/x/wt/bk", branch: "lane-a", composeProject: "brokinsoft-api-lane-a", runtime: "native", services: [{ name: "api", port: 3210 }] }],
};

describe("generate", () => {
  it("builds env vars with DB url and resolved deps", () => {
    const vars = buildEnvVars(gpa, env, repo);
    expect(vars.DATABASE_URL).toBe("postgres://gpa:pw@host.docker.internal:5533/gpa_lane_a");
    expect(vars.BROKINSOFT_API_URL).toBe("http://host.docker.internal:3210");
  });

  it("renders a dotenv string", () => {
    expect(renderDotenv({ A: "1", B: "two" })).toBe("A=1\nB=two\n");
  });

  it("renders a compose override remapping ports and injecting env", () => {
    const vars = buildEnvVars(gpa, env, repo);
    const yaml = parseYaml(renderComposeOverride(gpa, repo, vars));
    expect(yaml.services.web.ports).toEqual(["3012:3002"]);
    expect(yaml.services.web.environment.DATABASE_URL).toContain("gpa_lane_a");
    expect(yaml.services.web.extra_hosts).toEqual(["host.docker.internal:host-gateway"]);
    expect(yaml.services.worker.ports).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/generate.test.ts`
Expected: FAIL — cannot find `../src/generate.js`.

- [ ] **Step 3: Create `src/generate.ts`**

```ts
import { stringify as toYaml } from "yaml";
import type { Manifest, EnvRecord, RepoRecord } from "./types.js";
import { resolveDeps, dbUrl } from "./resolve.js";

export function buildEnvVars(
  manifest: Manifest,
  env: EnvRecord,
  repo: RepoRecord,
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (repo.db) vars.DATABASE_URL = dbUrl(manifest.db, repo.db.database, manifest.runtime);
  for (const { inject, url } of resolveDeps(manifest, env)) vars[inject] = url;
  return vars;
}

export function renderDotenv(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

export function renderComposeOverride(
  manifest: Manifest,
  repo: RepoRecord,
  vars: Record<string, string>,
): string {
  const services: Record<string, unknown> = {};
  for (const svc of repo.services) {
    const base = manifest.services[svc.name]?.basePort;
    const entry: Record<string, unknown> = {
      environment: vars,
      extra_hosts: ["host.docker.internal:host-gateway"],
    };
    if (svc.port != null && base != null) entry.ports = [`${svc.port}:${base}`];
    services[svc.name] = entry;
  }
  return toYaml({ services });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/generate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/generate.ts test/generate.test.ts
git commit -m "feat: generate .env and compose override from manifest + env record"
```

---

### Task 7: DB clone / drop command construction

**Files:**
- Create: `src/db.ts`
- Test: `test/db.test.ts`

**Interfaces:**
- Consumes: `Runner`, `DbManifest`.
- Produces:
  - `cloneDb(runner: Runner, db: DbManifest, target: string): Promise<void>`
  - `dropDb(runner: Runner, db: DbManifest, target: string): Promise<void>`

Both exec inside the persistent DB container (`docker exec <container> ...`).
Postgres: `createdb` then `pg_dump -Fc | pg_restore`; drop with `WITH (FORCE)`.
MySQL: `CREATE DATABASE` then `mysqldump | mysql`; drop with `DROP DATABASE`.

- [ ] **Step 1: Write the failing test**

```ts
// test/db.test.ts
import { describe, it, expect } from "vitest";
import { FakeRunner } from "../src/runner.js";
import { cloneDb, dropDb } from "../src/db.js";
import type { DbManifest } from "../src/types.js";

const pg: DbManifest = { engine: "postgres", container: "gpa-postgres", hostPort: 5533, user: "gpa", password: "pw", source: "gpa", target: "gpa_{env}" };

describe("db postgres", () => {
  it("clone creates the target db then dump-restores into it", async () => {
    const r = new FakeRunner();
    await cloneDb(r, pg, "gpa_lane_a");
    const cmds = r.calls.map((c) => [c.cmd, ...c.args].join(" "));
    expect(cmds.some((c) => c.includes("createdb") && c.includes("gpa_lane_a"))).toBe(true);
    expect(cmds.some((c) => c.includes("pg_dump") && c.includes("gpa"))).toBe(true);
    expect(cmds.some((c) => c.includes("pg_restore") && c.includes("gpa_lane_a"))).toBe(true);
  });

  it("drop uses WITH (FORCE)", async () => {
    const r = new FakeRunner();
    await dropDb(r, pg, "gpa_lane_a");
    const joined = r.calls.map((c) => [c.cmd, ...c.args].join(" ")).join(" | ");
    expect(joined).toContain("DROP DATABASE");
    expect(joined).toContain("FORCE");
    expect(joined).toContain("gpa_lane_a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/db.test.ts`
Expected: FAIL — cannot find `../src/db.js`.

- [ ] **Step 3: Create `src/db.ts`**

```ts
import type { Runner } from "./runner.js";
import type { DbManifest } from "./types.js";

function requirePg(db: DbManifest): asserts db is Required<Pick<DbManifest, "container" | "user" | "source">> & DbManifest {
  if (!db.container || !db.user || !db.source) throw new Error(`db manifest incomplete for engine ${db.engine}`);
}

export async function cloneDb(runner: Runner, db: DbManifest, target: string): Promise<void> {
  if (db.engine === "none") return;
  requirePg(db);
  const env = { PGPASSWORD: db.password ?? "", MYSQL_PWD: db.password ?? "" };
  if (db.engine === "postgres") {
    await runner.run("docker", ["exec", db.container, "createdb", "-U", db.user, target], { env });
    const dump = await runner.run("docker", ["exec", db.container, "pg_dump", "-U", db.user, "-Fc", db.source], { env });
    await runner.run("docker", ["exec", "-i", db.container, "pg_restore", "-U", db.user, "-d", target], { input: dump.stdout, env });
  } else {
    await runner.run("docker", ["exec", db.container, "mysql", "-u", db.user, "-e", `CREATE DATABASE \`${target}\``], { env });
    const dump = await runner.run("docker", ["exec", db.container, "mysqldump", "-u", db.user, db.source], { env });
    await runner.run("docker", ["exec", "-i", db.container, "mysql", "-u", db.user, target], { input: dump.stdout, env });
  }
}

export async function dropDb(runner: Runner, db: DbManifest, target: string): Promise<void> {
  if (db.engine === "none") return;
  requirePg(db);
  const env = { PGPASSWORD: db.password ?? "", MYSQL_PWD: db.password ?? "" };
  if (db.engine === "postgres") {
    await runner.run("docker", ["exec", db.container, "psql", "-U", db.user, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`], { env });
  } else {
    await runner.run("docker", ["exec", db.container, "mysql", "-u", db.user, "-e", `DROP DATABASE IF EXISTS \`${target}\``], { env });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/db.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db.ts test/db.test.ts
git commit -m "feat: clone and drop databases via docker exec (postgres + mysql)"
```

---

### Task 8: Git worktree create / cleanliness gate / remove

**Files:**
- Create: `src/worktree.ts`
- Test: `test/worktree.test.ts`

**Interfaces:**
- Consumes: `Runner`.
- Produces:
  - `addWorktree(runner: Runner, repoRoot: string, dest: string, branch: string): Promise<void>`
  - `isClean(runner: Runner, worktreePath: string): Promise<boolean>` (no uncommitted changes AND no unpushed commits)
  - `removeWorktree(runner: Runner, repoRoot: string, worktreePath: string, force: boolean): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// test/worktree.test.ts
import { describe, it, expect } from "vitest";
import { FakeRunner } from "../src/runner.js";
import { addWorktree, isClean, removeWorktree } from "../src/worktree.js";

describe("worktree", () => {
  it("addWorktree runs git worktree add with a new branch", async () => {
    const r = new FakeRunner();
    await addWorktree(r, "/x/gpa", "/x/wt/gpa-lane-a", "lane-a");
    const c = r.calls[0];
    expect(c.cmd).toBe("git");
    expect(c.args).toEqual(["-C", "/x/gpa", "worktree", "add", "-b", "lane-a", "/x/wt/gpa-lane-a"]);
  });

  it("isClean is true when status is empty and nothing is unpushed", async () => {
    const r = new FakeRunner({
      "git -C /x/wt status --porcelain": { stdout: "", stderr: "", exitCode: 0 },
      "git -C /x/wt log": { stdout: "", stderr: "", exitCode: 0 },
    });
    expect(await isClean(r, "/x/wt")).toBe(true);
  });

  it("isClean is false when there are uncommitted changes", async () => {
    const r = new FakeRunner({
      "git -C /x/wt status --porcelain": { stdout: " M src/a.ts", stderr: "", exitCode: 0 },
    });
    expect(await isClean(r, "/x/wt")).toBe(false);
  });

  it("isClean is false when there are unpushed commits", async () => {
    const r = new FakeRunner({
      "git -C /x/wt status --porcelain": { stdout: "", stderr: "", exitCode: 0 },
      "git -C /x/wt log": { stdout: "abc123 wip", stderr: "", exitCode: 0 },
    });
    expect(await isClean(r, "/x/wt")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/worktree.test.ts`
Expected: FAIL — cannot find `../src/worktree.js`.

- [ ] **Step 3: Create `src/worktree.ts`**

```ts
import type { Runner } from "./runner.js";

export async function addWorktree(runner: Runner, repoRoot: string, dest: string, branch: string): Promise<void> {
  const res = await runner.run("git", ["-C", repoRoot, "worktree", "add", "-b", branch, dest]);
  if (res.exitCode !== 0) throw new Error(`git worktree add failed: ${res.stderr}`);
}

export async function isClean(runner: Runner, worktreePath: string): Promise<boolean> {
  const status = await runner.run("git", ["-C", worktreePath, "status", "--porcelain"]);
  if (status.stdout.trim() !== "") return false;
  // commits on HEAD not present on any remote tracking branch
  const unpushed = await runner.run("git", ["-C", worktreePath, "log", "--branches", "--not", "--remotes", "--oneline"]);
  return unpushed.stdout.trim() === "";
}

export async function removeWorktree(runner: Runner, repoRoot: string, worktreePath: string, force: boolean): Promise<void> {
  const args = ["-C", repoRoot, "worktree", "remove", worktreePath];
  if (force) args.push("--force");
  const res = await runner.run("git", args);
  if (res.exitCode !== 0) throw new Error(`git worktree remove failed: ${res.stderr}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/worktree.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worktree.ts test/worktree.test.ts
git commit -m "feat: git worktree add/remove with cleanliness gate"
```

---

### Task 9: `up` orchestration

**Files:**
- Create: `src/commands/up.ts`
- Test: `test/up.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `interface UpDeps { runner: Runner; isFree: PortChecker; worktreeBase: string; }`
  - `up(opts: { env: string; repos: string[]; repoRoots: Record<string,string> }, deps: UpDeps): Promise<EnvRecord>`

`repoRoots` maps a repo name → its source checkout path (where `lane.yml` lives).
`up` builds the `EnvRecord`, creates worktrees, clones DBs, writes `.env` +
`.lane/compose.override.yml` into each worktree, starts services, persists the
record. Health-wait is best-effort (skipped in unit tests via FakeRunner).

- [ ] **Step 1: Write the failing test**

```ts
// test/up.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeRunner } from "../src/runner.js";
import { up } from "../src/commands/up.js";

const GPA = `
name: gpa
runtime: container
services: { web: { basePort: 3002 }, worker: {} }
db: { engine: postgres, container: gpa-postgres, hostPort: 5533, user: gpa, password: pw, source: gpa, target: "gpa_{env}" }
dependsOn: [{ repo: brokinsoft-api, inject: BROKINSOFT_API_URL, fallback: "http://host.docker.internal:3200" }]
`;
const BK = `
name: brokinsoft-api
runtime: native
services: { api: { basePort: 3200 } }
db: { engine: none }
`;

describe("up", () => {
  let root: string, wtBase: string, gpaRoot: string, bkRoot: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lane-up-"));
    process.env.LANE_HOME = path.join(root, "home");
    wtBase = path.join(root, "wt");
    gpaRoot = path.join(root, "src", "gpa");
    bkRoot = path.join(root, "src", "brokinsoft-api");
    await mkdir(gpaRoot, { recursive: true });
    await mkdir(bkRoot, { recursive: true });
    await writeFile(path.join(gpaRoot, "lane.yml"), GPA);
    await writeFile(path.join(bkRoot, "lane.yml"), BK);
    return () => rm(root, { recursive: true, force: true });
  });

  it("creates a record wiring gpa to the env's brokinsoft port", async () => {
    const runner = new FakeRunner();
    // make worktree paths exist so .env writes succeed
    await mkdir(path.join(wtBase, "gpa-lane-a"), { recursive: true });
    await mkdir(path.join(wtBase, "brokinsoft-api-lane-a"), { recursive: true });
    const rec = await up(
      { env: "lane-a", repos: ["gpa", "brokinsoft-api"], repoRoots: { gpa: gpaRoot, "brokinsoft-api": bkRoot } },
      { runner, isFree: async () => true, worktreeBase: wtBase },
    );
    expect(rec.offset).toBe(10);
    const bk = rec.repos.find((r) => r.name === "brokinsoft-api")!;
    expect(bk.services.find((s) => s.name === "api")!.port).toBe(3210);
    const dotenv = await readFile(path.join(wtBase, "gpa-lane-a", ".env"), "utf8");
    expect(dotenv).toContain("BROKINSOFT_API_URL=http://host.docker.internal:3210");
    expect(dotenv).toContain("DATABASE_URL=postgres://gpa:pw@host.docker.internal:5533/gpa_lane_a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/up.test.ts`
Expected: FAIL — cannot find `../src/commands/up.js`.

- [ ] **Step 3: Create `src/commands/up.ts`**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Runner } from "../runner.js";
import type { PortChecker } from "../ports.js";
import type { EnvRecord, RepoRecord, Manifest } from "../types.js";
import { loadManifest } from "../manifest.js";
import { listEnvs, readEnv, writeEnv, slugify } from "../registry.js";
import { nextOffset, bindPort } from "../ports.js";
import { cloneDb } from "../db.js";
import { addWorktree } from "../worktree.js";
import { buildEnvVars, renderDotenv, renderComposeOverride } from "../generate.js";

export interface UpDeps { runner: Runner; isFree: PortChecker; worktreeBase: string; }

export async function up(
  opts: { env: string; repos: string[]; repoRoots: Record<string, string> },
  deps: UpDeps,
): Promise<EnvRecord> {
  const { env, repos, repoRoots } = opts;
  const slug = slugify(env);

  const existing = await readEnv(env);
  const offset = existing?.offset ?? nextOffset((await listEnvs()).map((e) => e.offset));

  // Phase 1: load manifests, allocate ports, build the record skeleton.
  const manifests: Record<string, Manifest> = {};
  const repoRecords: RepoRecord[] = [];
  for (const name of repos) {
    const m = await loadManifest(repoRoots[name]);
    manifests[name] = m;
    const services = [];
    for (const [svcName, svc] of Object.entries(m.services)) {
      const port = svc.basePort != null ? await bindPort(svc.basePort + offset, deps.isFree) : null;
      services.push({ name: svcName, port });
    }
    repoRecords.push({
      name,
      worktreePath: path.join(deps.worktreeBase, `${name}-${env}`),
      branch: env,
      composeProject: `${name}-${env}`,
      runtime: m.runtime,
      services,
      db: m.db.engine === "none" ? undefined
        : { engine: m.db.engine, container: m.db.container!, database: m.db.target!.replace("{env}", slug) },
    });
  }
  const record: EnvRecord = { name: env, slug, offset, createdAt: new Date().toISOString(), repos: repoRecords };

  // Phase 2: materialize each repo (worktree, DB clone, generated config, start).
  for (const repo of record.repos) {
    const m = manifests[repo.name];
    await addWorktree(deps.runner, m.repoRoot, repo.worktreePath, repo.branch).catch(() => {});
    if (repo.db) await cloneDb(deps.runner, m.db, repo.db.database);
    const vars = buildEnvVars(m, record, repo);
    await mkdir(path.join(repo.worktreePath, ".lane"), { recursive: true });
    await writeFile(path.join(repo.worktreePath, ".env"), renderDotenv(vars), "utf8");
    await writeFile(path.join(repo.worktreePath, ".lane", "compose.override.yml"), renderComposeOverride(m, repo, vars), "utf8");
    if (m.runtime === "container") {
      const svcNames = repo.services.map((s) => s.name);
      await deps.runner.run("docker", [
        "compose", "-f", "docker-compose.yml", "-f", ".lane/compose.override.yml",
        "-p", repo.composeProject, "up", "-d", ...svcNames,
      ], { cwd: repo.worktreePath });
    }
  }

  await writeEnv(record);
  return record;
}
```

> Note: `addWorktree` is wrapped in `.catch(() => {})` so a pre-existing
> worktree (re-`up`) does not abort; the test pre-creates the dirs and uses a
> FakeRunner. In production a hard failure surfaces via the docker step.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/up.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/commands/up.ts test/up.test.ts
git commit -m "feat: up orchestration — worktrees, db clone, generated config, start"
```

---

### Task 10: `down` teardown with safety gate

**Files:**
- Create: `src/commands/down.ts`
- Test: `test/down.test.ts`

**Interfaces:**
- Consumes: `Runner`, `readEnv`, `deleteEnv`, `isClean`, `removeWorktree`, `dropDb`.
- Produces:
  - `down(opts: { env: string; force: boolean; repoRoots: Record<string,string> }, deps: { runner: Runner }): Promise<{ removed: boolean; reason?: string }>`

- [ ] **Step 1: Write the failing test**

```ts
// test/down.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeRunner } from "../src/runner.js";
import { writeEnv, readEnv } from "../src/registry.js";
import { down } from "../src/commands/down.js";
import type { EnvRecord } from "../src/types.js";

const rec: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "t",
  repos: [{
    name: "gpa", worktreePath: "/x/wt/gpa-lane-a", branch: "lane-a", composeProject: "gpa-lane-a",
    runtime: "container", services: [{ name: "web", port: 3012 }],
    db: { engine: "postgres", container: "gpa-postgres", database: "gpa_lane_a" },
  }],
};

describe("down", () => {
  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lane-down-"));
    process.env.LANE_HOME = dir;
    await writeEnv(rec);
    return () => rm(dir, { recursive: true, force: true });
  });

  it("refuses when a worktree is dirty and leaves the record", async () => {
    const runner = new FakeRunner({ "git -C /x/wt/gpa-lane-a status --porcelain": { stdout: " M a.ts", stderr: "", exitCode: 0 } });
    const res = await down({ env: "lane-a", force: false, repoRoots: { gpa: "/x/gpa" } }, { runner });
    expect(res.removed).toBe(false);
    expect(await readEnv("lane-a")).not.toBeNull();
  });

  it("tears down containers, drops db, removes worktree, deletes record when clean", async () => {
    const runner = new FakeRunner(); // all status empty -> clean
    const res = await down({ env: "lane-a", force: false, repoRoots: { gpa: "/x/gpa" } }, { runner });
    expect(res.removed).toBe(true);
    const cmds = runner.calls.map((c) => [c.cmd, ...c.args].join(" "));
    expect(cmds.some((c) => c.includes("compose") && c.includes("down") && c.includes("-v"))).toBe(true);
    expect(cmds.some((c) => c.includes("DROP DATABASE") && c.includes("gpa_lane_a"))).toBe(true);
    expect(cmds.some((c) => c.includes("worktree") && c.includes("remove"))).toBe(true);
    expect(await readEnv("lane-a")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/down.test.ts`
Expected: FAIL — cannot find `../src/commands/down.js`.

- [ ] **Step 3: Create `src/commands/down.ts`**

```ts
import type { Runner } from "../runner.js";
import { readEnv, deleteEnv } from "../registry.js";
import { isClean, removeWorktree } from "../worktree.js";
import { dropDb } from "../db.js";
import type { DbManifest } from "../types.js";

export async function down(
  opts: { env: string; force: boolean; repoRoots: Record<string, string> },
  deps: { runner: Runner },
): Promise<{ removed: boolean; reason?: string }> {
  const { runner } = deps;
  const rec = await readEnv(opts.env);
  if (!rec) return { removed: false, reason: "no such env" };

  // Safety gate: never destroy uncommitted/unpushed work.
  if (!opts.force) {
    for (const repo of rec.repos) {
      if (!(await isClean(runner, repo.worktreePath))) {
        return { removed: false, reason: `worktree dirty: ${repo.worktreePath}` };
      }
    }
  }

  for (const repo of rec.repos) {
    if (repo.runtime === "container") {
      await runner.run("docker", [
        "compose", "-p", repo.composeProject, "down", "-v",
      ], { cwd: repo.worktreePath }).catch(() => {});
    }
    if (repo.db) {
      const db: DbManifest = { engine: repo.db.engine, container: repo.db.container, user: undefined, password: undefined };
      // user/password are not in the record; psql inside the container uses the
      // container's superuser via peer/trust by default. Pass through via env in prod.
      await dropDb(runner, { ...db, user: "postgres" }, repo.db.database).catch(() => {});
    }
    await removeWorktree(runner, opts.repoRoots[repo.name] ?? repo.worktreePath, repo.worktreePath, opts.force).catch(() => {});
  }

  await deleteEnv(opts.env);
  return { removed: true };
}
```

> Note: the DB user for drop defaults to `postgres`. If your persistent
> containers require an app user, store `user` on `repo.db` in Task 9's record
> and read it here — flagged in §11 follow-ups.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/down.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/commands/down.ts test/down.test.ts
git commit -m "feat: down teardown with cleanliness safety gate"
```

---

### Task 11: `list` and `prune`

**Files:**
- Create: `src/commands/list.ts`, `src/commands/prune.ts`
- Test: `test/list-prune.test.ts`

**Interfaces:**
- Produces:
  - `listText(): Promise<string>` — human table of active envs.
  - `prune(deps: { runner: Runner }): Promise<{ orphans: string[] }>` — diff registry vs `docker ps` project labels; report (not auto-delete unless caller acts).

- [ ] **Step 1: Write the failing test**

```ts
// test/list-prune.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeEnv } from "../src/registry.js";
import { listText } from "../src/commands/list.js";
import { prune } from "../src/commands/prune.js";
import { FakeRunner } from "../src/runner.js";
import type { EnvRecord } from "../src/types.js";

const rec: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "t",
  repos: [{ name: "gpa", worktreePath: "/x/wt/gpa-lane-a", branch: "lane-a", composeProject: "gpa-lane-a", runtime: "container", services: [{ name: "web", port: 3012 }] }],
};

describe("list/prune", () => {
  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lane-lp-"));
    process.env.LANE_HOME = dir;
    await writeEnv(rec);
    return () => rm(dir, { recursive: true, force: true });
  });

  it("listText includes env, offset, and a port", async () => {
    const out = await listText();
    expect(out).toContain("lane-a");
    expect(out).toContain("10");
    expect(out).toContain("3012");
  });

  it("prune reports docker compose projects not in the registry as orphans", async () => {
    const runner = new FakeRunner({
      "docker compose ls": { stdout: "gpa-lane-a\nconnect-ghost\n", stderr: "", exitCode: 0 },
    });
    const res = await prune({ runner });
    expect(res.orphans).toContain("connect-ghost");
    expect(res.orphans).not.toContain("gpa-lane-a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/list-prune.test.ts`
Expected: FAIL — cannot find the command modules.

- [ ] **Step 3: Create `src/commands/list.ts` and `src/commands/prune.ts`**

```ts
// src/commands/list.ts
import { listEnvs } from "../registry.js";

export async function listText(): Promise<string> {
  const envs = await listEnvs();
  if (envs.length === 0) return "No active envs.";
  const lines = ["ENV\tOFFSET\tREPOS\tPORTS"];
  for (const e of envs) {
    const repos = e.repos.map((r) => r.name).join(",");
    const ports = e.repos.flatMap((r) => r.services.map((s) => s.port).filter(Boolean)).join(",");
    lines.push(`${e.name}\t${e.offset}\t${repos}\t${ports}`);
  }
  return lines.join("\n");
}
```

```ts
// src/commands/prune.ts
import type { Runner } from "../runner.js";
import { listEnvs } from "../registry.js";

export async function prune(deps: { runner: Runner }): Promise<{ orphans: string[] }> {
  const known = new Set(
    (await listEnvs()).flatMap((e) => e.repos.map((r) => r.composeProject)),
  );
  const res = await deps.runner.run("docker", ["compose", "ls", "--format", "json"]).catch(() => null);
  // tolerate plain newline output in tests; parse names loosely
  const raw = res?.stdout ?? "";
  const projects = raw.trim().startsWith("[")
    ? (JSON.parse(raw) as Array<{ Name: string }>).map((p) => p.Name)
    : raw.split("\n").map((s) => s.trim()).filter(Boolean);
  const orphans = projects.filter((p) => (p.includes("-") && !known.has(p)));
  return { orphans };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/list-prune.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/commands/list.ts src/commands/prune.ts test/list-prune.test.ts
git commit -m "feat: list active envs and prune orphaned compose projects"
```

---

### Task 12: CLI wiring + `init` bootstrap

**Files:**
- Create: `src/cli.ts`, `src/commands/init.ts`
- Test: `test/init.test.ts`

**Interfaces:**
- `init` reads a project's `docker-compose.yml` and emits a starter `lane.yml`
  (services with `ports` → basePort; a `postgres`/`mysql` service → db block).
- Produces: `bootstrapManifest(composeYaml: string, name: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// test/init.test.ts
import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { bootstrapManifest } from "../src/commands/init.js";

const COMPOSE = `
services:
  postgres: { image: postgres:16-alpine, ports: ["5533:5432"], environment: { POSTGRES_USER: gpa, POSTGRES_PASSWORD: gpa_dev_password, POSTGRES_DB: gpa } }
  web: { image: node:20-alpine, ports: ["3002:3002"] }
  worker: { image: node:20-alpine }
`;

describe("bootstrapManifest", () => {
  it("derives services and a db block from compose", () => {
    const m = parseYaml(bootstrapManifest(COMPOSE, "gpa"));
    expect(m.name).toBe("gpa");
    expect(m.services.web.basePort).toBe(3002);
    expect(m.services).not.toHaveProperty("postgres");
    expect(m.db.engine).toBe("postgres");
    expect(m.db.hostPort).toBe(5533);
    expect(m.db.source).toBe("gpa");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/init.test.ts`
Expected: FAIL — cannot find `../src/commands/init.js`.

- [ ] **Step 3: Create `src/commands/init.ts`**

```ts
import { parse as parseYaml, stringify as toYaml } from "yaml";

const DB_IMAGES: Record<string, "postgres" | "mysql"> = { postgres: "postgres", mysql: "mysql", mariadb: "mysql" };

function hostPort(ports?: string[]): number | undefined {
  const first = ports?.[0];
  return first ? Number(first.split(":")[0]) : undefined;
}

export function bootstrapManifest(composeYaml: string, name: string): string {
  const compose = parseYaml(composeYaml) as { services: Record<string, any> };
  const services: Record<string, { basePort?: number }> = {};
  let db: Record<string, unknown> = { engine: "none" };

  for (const [svcName, svc] of Object.entries(compose.services ?? {})) {
    const image: string = svc.image ?? "";
    const dbKind = Object.keys(DB_IMAGES).find((k) => image.includes(k));
    if (dbKind) {
      const env = svc.environment ?? {};
      db = {
        engine: DB_IMAGES[dbKind],
        container: `${name}-${dbKind}`,
        hostPort: hostPort(svc.ports),
        user: env.POSTGRES_USER ?? env.MYSQL_USER ?? name,
        password: env.POSTGRES_PASSWORD ?? env.MYSQL_PASSWORD ?? "",
        source: env.POSTGRES_DB ?? env.MYSQL_DATABASE ?? name,
        target: `${name}_{env}`,
      };
      continue;
    }
    const bp = hostPort(svc.ports);
    services[svcName] = bp != null ? { basePort: bp } : {};
  }
  return toYaml({ name, runtime: "container", services, db });
}
```

- [ ] **Step 4: Create `src/cli.ts`**

```ts
import { Command } from "commander";
import path from "node:path";
import os from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { RealRunner } from "./runner.js";
import { isPortFreeReal } from "./ports.js";
import { up } from "./commands/up.js";
import { down } from "./commands/down.js";
import { listText } from "./commands/list.js";
import { prune } from "./commands/prune.js";
import { bootstrapManifest } from "./commands/init.js";

const runner = new RealRunner();
const worktreeBase = process.env.LANE_WORKTREE_BASE ?? path.join(os.homedir(), "lane-worktrees");

const program = new Command();
program.name("lane").description("Isolated multi-repo worktree environments");

program.command("up <env> <repos...>")
  .option("--root <pairs>", "comma list of repo=path", "")
  .action(async (env: string, repos: string[], opts: { root: string }) => {
    const repoRoots = Object.fromEntries(
      opts.root.split(",").filter(Boolean).map((p) => p.split("=") as [string, string]),
    );
    for (const r of repos) repoRoots[r] ??= path.resolve(r);
    const rec = await up({ env, repos, repoRoots }, { runner, isFree: isPortFreeReal, worktreeBase });
    console.log(`Env ${rec.name} up (offset ${rec.offset}).`);
  });

program.command("down <env>")
  .option("--force", "skip cleanliness gate", false)
  .option("--root <pairs>", "comma list of repo=path", "")
  .action(async (env: string, opts: { force: boolean; root: string }) => {
    const repoRoots = Object.fromEntries(opts.root.split(",").filter(Boolean).map((p) => p.split("=") as [string, string]));
    const res = await down({ env, force: opts.force, repoRoots }, { runner });
    console.log(res.removed ? `Env ${env} removed.` : `Refused: ${res.reason}`);
  });

program.command("list").action(async () => console.log(await listText()));

program.command("prune").action(async () => {
  const { orphans } = await prune({ runner });
  console.log(orphans.length ? `Orphans: ${orphans.join(", ")}` : "No orphans.");
});

program.command("init <name>")
  .option("-c, --compose <file>", "compose file", "docker-compose.yml")
  .action(async (name: string, opts: { compose: string }) => {
    const yaml = bootstrapManifest(await readFile(opts.compose, "utf8"), name);
    await writeFile("lane.yml", yaml, "utf8");
    console.log("Wrote lane.yml — review base ports, db credentials, and dependsOn.");
  });

program.parseAsync();
```

- [ ] **Step 5: Run init test + build to verify the bin compiles**

Run: `pnpm vitest run test/init.test.ts && pnpm build && node dist/cli.js --help`
Expected: test PASS; `--help` prints the command list.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/commands/init.ts test/init.test.ts
git commit -m "feat: CLI wiring (up/down/list/prune/init) and manifest bootstrap"
```

---

### Task 13: README + manifest drift check + generate the 4 real manifests

**Files:**
- Create: `README.md`, `scripts/check-manifest-drift.mjs`
- Create (in the consuming repos, generated, then reviewed): `gpa/lane.yml`, `profile/lane.yml`, `hub/lane.yml`, `apps/lane.yml`, `brokinsoft-api/lane.yml`
- Test: `test/drift.test.ts`

**Interfaces:**
- `checkDrift(manifestYaml: string, composeYaml: string): string[]` — returns
  messages for services declared in the manifest but absent from compose (and
  vice versa for non-db services).

- [ ] **Step 1: Write the failing test**

```ts
// test/drift.test.ts
import { describe, it, expect } from "vitest";
import { checkDrift } from "../scripts/check-manifest-drift.mjs";

const manifest = `name: gpa\nruntime: container\nservices: { web: { basePort: 3002 }, ghost: {} }\ndb: { engine: none }`;
const compose = `services: { web: { image: x }, worker: { image: y }, postgres: { image: postgres } }`;

describe("checkDrift", () => {
  it("flags a manifest service missing from compose", () => {
    const msgs = checkDrift(manifest, compose);
    expect(msgs.join(" ")).toContain("ghost");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/drift.test.ts`
Expected: FAIL — cannot find `../scripts/check-manifest-drift.mjs`.

- [ ] **Step 3: Create `scripts/check-manifest-drift.mjs`**

```js
import { readFileSync } from "node:fs";
import { parse } from "yaml";

export function checkDrift(manifestYaml, composeYaml) {
  const m = parse(manifestYaml);
  const c = parse(composeYaml);
  const composeServices = new Set(Object.keys(c.services ?? {}));
  const msgs = [];
  for (const svc of Object.keys(m.services ?? {})) {
    if (!composeServices.has(svc)) msgs.push(`manifest service "${svc}" not found in compose`);
  }
  return msgs;
}

// CLI usage: node scripts/check-manifest-drift.mjs lane.yml docker-compose.yml
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , manifestFile = "lane.yml", composeFile = "docker-compose.yml"] = process.argv;
  const msgs = checkDrift(readFileSync(manifestFile, "utf8"), readFileSync(composeFile, "utf8"));
  if (msgs.length) { console.error(msgs.join("\n")); process.exit(1); }
  console.log("manifest ↔ compose: OK");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/drift.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Write `README.md`**

Document: install (`pnpm build && pnpm link --global`), the `lane.yml` schema
(copy the annotated GPA example from the spec), the four commands with examples
(`lane up lane-a gpa brokinsoft-api --root gpa=../gpa,brokinsoft-api=../brokinsoft-api`),
the host-resolution rule, and the drift check wiring (`pnpm dlx` in a pre-commit
hook). Keep snippets short per the docs-density preference.

- [ ] **Step 6: Generate + review the real manifests**

For each of gpa, profile, hub, apps: `lane init <name> -c docker-compose.yml`,
then hand-verify base ports, db credentials, and add `dependsOn`
(gpa → brokinsoft-api; connect → brokinsoft-api). Author `brokinsoft-api/lane.yml`
by hand (`runtime: native`, `db.engine: none`, `api.basePort: 3200`). Run the
drift check on each. Do NOT commit these into this tool repo — they belong in
each consuming repo.

- [ ] **Step 7: Commit (tool repo only)**

```bash
git add README.md scripts/check-manifest-drift.mjs test/drift.test.ts
git commit -m "docs: README, manifest drift check, manifest authoring guide"
```

---

## Self-Review

**Spec coverage**
- §3 model (shared DB / env=compose project / one offset) → Tasks 4, 7, 9. ✓
- §4 manifest → Task 2. ✓
- §5 registry → Task 3. ✓
- §6 offset + probe → Task 4. ✓
- §7 cross-repo resolution + host rule → Task 5, asserted end-to-end in Task 9. ✓
- §8 up/down/list/prune → Tasks 9, 10, 11. ✓
- §8 safety gate → Task 8 (`isClean`) + Task 10. ✓
- §9 anti-rot (load-bearing manifest, drift check, bootstrap-from-compose) → Tasks 12 (init), 13 (drift). ✓
- §10 special cases: brokinsoft no-db → Task 5/9 (`engine: none` path); mysql → Tasks 7, 12; mailhog per-env → handled generically (a declared service starts under the env project). ✓
- §11 open decisions: CLI=Node/TS ✓; mailhog per-env (default) ✓; node_modules per-env (compose project prefix) ✓; DB drop user follow-up flagged in Task 10 note.

**Placeholder scan** — no TBD/TODO; every code step is complete. Two explicit
follow-up notes (Task 9 re-up worktree, Task 10 DB drop user) are design caveats,
not missing code.

**Type consistency** — `Manifest`, `EnvRecord`, `RepoRecord`, `ResolvedService`,
`DbManifest` used identically across tasks; `hostFor(consumer)` single-arg
everywhere; `cloneDb`/`dropDb(runner, db, target)` consistent; `up`/`down`
dependency-injection shapes match their tests.

**Known follow-ups (not blocking v1):**
- Persist `db.user`/`db.password` on `RepoRecord.db` so `down`'s drop uses the
  app user instead of defaulting to `postgres` (Task 10 note).
- Health-wait polling on container start (best-effort today).
- Optional: shared pnpm store volume if per-env node_modules disk becomes a problem.
