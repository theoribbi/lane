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
