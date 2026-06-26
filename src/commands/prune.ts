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
