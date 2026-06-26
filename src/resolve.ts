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
