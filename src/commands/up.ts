import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
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
import { preflight, type PreflightFinding } from "../preflight.js";

export interface UpDeps { runner: Runner; isFree: PortChecker; worktreeBase: string; }

export function bootArgs(manifest: Manifest, repo: RepoRecord): string[] {
  const compose = manifest.compose ?? "docker-compose.yml";
  return ["compose", "-f", compose, "-f", ".lane/compose.override.yml",
    "-p", repo.composeProject, "up", "-d", "--no-deps", ...repo.services.map((s) => s.name)];
}

export function bootCommandString(manifest: Manifest, repo: RepoRecord): string {
  return `cd "${repo.worktreePath}" && docker ${bootArgs(manifest, repo).join(" ")}`;
}

export async function up(
  opts: { env: string; repos: string[]; repoRoots: Record<string, string>; start?: boolean },
  deps: UpDeps,
): Promise<{ record: EnvRecord; findings: PreflightFinding[] }> {
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

  // Phase 2: materialize (worktree, copyFiles, DB clone, generated config).
  const findings: PreflightFinding[] = [];
  for (const repo of record.repos) {
    const m = manifests[repo.name];
    await addWorktree(deps.runner, m.repoRoot, repo.worktreePath, repo.branch).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already exists")) throw err;
    });
    for (const f of m.copyFiles ?? []) {
      await mkdir(path.dirname(path.join(repo.worktreePath, f)), { recursive: true });
      await copyFile(path.join(m.repoRoot, f), path.join(repo.worktreePath, f)).catch(() => {
        findings.push({ level: "warn", code: "copy-missing",
          message: `copyFiles source "${f}" not found in ${repo.name} — skipped` });
      });
    }
    if (repo.db) await cloneDb(deps.runner, m.db, repo.db.database);
    const vars = buildEnvVars(m, record, repo);
    await mkdir(path.join(repo.worktreePath, ".lane"), { recursive: true });
    await writeFile(path.join(repo.worktreePath, ".env"), renderDotenv(vars), "utf8");
    await writeFile(path.join(repo.worktreePath, ".lane", "compose.override.yml"), renderComposeOverride(m, repo, vars), "utf8");
  }

  await writeEnv(record);

  // Advisory preflight per container repo (never throws).
  for (const repo of record.repos) {
    const m = manifests[repo.name];
    if (m.runtime !== "container") continue;
    const composeYaml = await readFile(path.join(repo.worktreePath, m.compose ?? "docker-compose.yml"), "utf8").catch(() => "");
    findings.push(...preflight({ manifest: m, composeYaml, fileExists: (f) => existsSync(path.join(repo.worktreePath, f)) }));
  }

  // Optional boot (fail loud).
  if (opts.start) {
    for (const repo of record.repos) {
      const m = manifests[repo.name];
      if (m.runtime !== "container") continue;
      const res = await deps.runner.run("docker", bootArgs(m, repo), { cwd: repo.worktreePath });
      if (res.exitCode !== 0) throw new Error(`lane: docker compose up failed for ${repo.name}: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
    }
  }

  return { record, findings };
}
