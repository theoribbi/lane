import { parse as parseYaml } from "yaml";
import type { Manifest } from "./types.js";

export interface PreflightFinding {
  level: "info" | "warn";
  code: "missing-env-file" | "fixed-container-name" | "bundled-db" | "port-collision" | "copy-missing";
  message: string;
}

const DB_IMAGE = /postgres|mysql|mariadb/;

export function preflight(input: {
  manifest: Manifest;
  composeYaml: string;
  fileExists: (relPath: string) => boolean;
}): PreflightFinding[] {
  const { manifest, fileExists } = input;
  const compose = (parseYaml(input.composeYaml) ?? {}) as { services?: Record<string, any> };
  const services = compose.services ?? {};
  const started = new Set(Object.keys(manifest.services));
  const out: PreflightFinding[] = [];

  for (const [name, svc] of Object.entries(services)) {
    const isStarted = started.has(name);

    if (isStarted && svc?.env_file != null) {
      const targets = Array.isArray(svc.env_file) ? svc.env_file : [svc.env_file];
      for (const f of targets) {
        if (typeof f === "string" && !fileExists(f)) {
          out.push({ level: "warn", code: "missing-env-file",
            message: `service "${name}" reads env_file "${f}" — it won't exist in the worktree; add it to copyFiles in lane.yml` });
        }
      }
    }

    if (isStarted && typeof svc?.container_name === "string") {
      out.push({ level: "info", code: "fixed-container-name",
        message: `service "${name}" has a fixed container_name "${svc.container_name}" — lane overrides it per-env to avoid collisions` });
    }

    if (manifest.db.engine !== "none" && !isStarted) {
      const image = typeof svc?.image === "string" ? svc.image : "";
      if (DB_IMAGE.test(image) || svc?.container_name === manifest.db.container) {
        out.push({ level: "info", code: "bundled-db",
          message: `service "${name}" looks like a bundled database — lane uses the shared server (${manifest.db.container}) and won't start it` });
      }
    }

    if (!isStarted && Array.isArray(svc?.ports)) {
      for (const p of svc.ports) {
        if (typeof p !== "string" || !p.includes(":")) continue;
        const host = p.split(":")[0];
        if (host) out.push({ level: "warn", code: "port-collision",
          message: `service "${name}" publishes host port ${host} which lane does not remap — may collide if started` });
      }
    }
  }
  return out;
}
