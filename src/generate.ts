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
