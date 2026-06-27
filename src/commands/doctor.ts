import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Runner } from "../runner.js";
import { loadManifest } from "../manifest.js";
import { preflight, type PreflightFinding } from "../preflight.js";

export async function doctor(opts: { repoRoot: string }, deps: { runner: Runner }): Promise<PreflightFinding[]> {
  const m = await loadManifest(opts.repoRoot);
  const composeYaml = await readFile(path.join(opts.repoRoot, m.compose ?? "docker-compose.yml"), "utf8").catch(() => "");
  const tracked = await deps.runner.run("git", ["-C", opts.repoRoot, "ls-files"]);
  const trackedSet = new Set(tracked.stdout.split("\n").filter(Boolean));
  const copy = new Set(m.copyFiles ?? []);
  return preflight({ manifest: m, composeYaml, fileExists: (f) => trackedSet.has(f) || (copy.has(f) && existsSync(path.join(opts.repoRoot, f))) });
}
