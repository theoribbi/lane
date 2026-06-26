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
