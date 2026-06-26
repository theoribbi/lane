export type Runtime = "container" | "native";
export type DbEngine = "postgres" | "mysql" | "none";

export interface ServiceManifest {
  basePort?: number;
  health?: string; // URL template, {port} substituted
}

export interface DependsOn {
  repo: string;
  inject: string;   // env var name written into THIS repo's services
  fallback: string; // URL used when the dep is not part of the env
}

export interface DbManifest {
  engine: DbEngine;
  container?: string; // persistent DB container hosting source + clones
  hostPort?: number;  // host-published port of that container
  user?: string;
  password?: string;
  source?: string;    // dev seeded DB to clone
  target?: string;    // clone naming template, e.g. "web_{env}"
}

export interface Manifest {
  name: string;
  runtime: Runtime;
  compose?: string; // compose file path relative to repo root (default docker-compose.yml)
  services: Record<string, ServiceManifest>;
  db: DbManifest;
  dependsOn?: DependsOn[];
  repoRoot: string; // absolute dir where lane.yml was found (added at load)
}

export interface ResolvedService {
  name: string;
  port: number | null;
}

export interface RepoRecord {
  name: string;
  worktreePath: string;
  branch: string;
  composeProject: string; // "<repo>-<env>"
  runtime: Runtime;
  services: ResolvedService[];
  repoRoot: string;
  db?: { engine: "postgres" | "mysql"; container: string; database: string; user: string; password?: string };
}

export interface EnvRecord {
  name: string;
  slug: string;
  offset: number;
  createdAt: string;
  repos: RepoRecord[];
}
