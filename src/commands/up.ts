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
      repoRoot: m.repoRoot,
      db: m.db.engine === "none" ? undefined
        : { engine: m.db.engine, container: m.db.container!, database: m.db.target!.replace("{env}", slug), user: m.db.user!, password: m.db.password },
    });
  }
  const record: EnvRecord = { name: env, slug, offset, createdAt: new Date().toISOString(), repos: repoRecords };

  // Phase 2: materialize each repo (worktree, DB clone, generated config, start).
  for (const repo of record.repos) {
    const m = manifests[repo.name];
    await addWorktree(deps.runner, m.repoRoot, repo.worktreePath, repo.branch).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already exists")) throw err;
    });
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
