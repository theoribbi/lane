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
