import { describe, it, expect } from "vitest";
import { buildEnvVars, renderDotenv, renderComposeOverride } from "../src/generate.js";
import { parse as parseYaml } from "yaml";
import type { Manifest, EnvRecord, RepoRecord } from "../src/types.js";

const web: Manifest = {
  name: "web", runtime: "container", repoRoot: "/x/web",
  services: { web: { basePort: 3002 }, worker: {} },
  db: { engine: "postgres", container: "web-postgres", hostPort: 5533, user: "web", password: "pw", source: "web", target: "web_{env}" },
  dependsOn: [{ repo: "api", inject: "API_URL", fallback: "http://host.docker.internal:3200" }],
};
const repo: RepoRecord = {
  name: "web", worktreePath: "/x/wt/web", branch: "lane-a", composeProject: "web-lane-a",
  runtime: "container",
  services: [{ name: "web", port: 3012 }, { name: "worker", port: null }],
  db: { engine: "postgres", container: "web-postgres", database: "web_lane_a" },
};
const env: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "t",
  repos: [repo, { name: "api", worktreePath: "/x/wt/api", branch: "lane-a", composeProject: "api-lane-a", runtime: "native", services: [{ name: "api", port: 3210 }] }],
};

describe("generate", () => {
  it("builds env vars with DB url and resolved deps", () => {
    const vars = buildEnvVars(web, env, repo);
    expect(vars.DATABASE_URL).toBe("postgres://web:pw@host.docker.internal:5533/web_lane_a");
    expect(vars.API_URL).toBe("http://host.docker.internal:3210");
  });

  it("renders a dotenv string", () => {
    expect(renderDotenv({ A: "1", B: "two" })).toBe("A=1\nB=two\n");
  });

  it("renders a compose override remapping ports and injecting env", () => {
    const vars = buildEnvVars(web, env, repo);
    const yaml = parseYaml(renderComposeOverride(web, repo, vars));
    expect(yaml.services.web.ports).toEqual(["3012:3002"]);
    expect(yaml.services.web.environment.DATABASE_URL).toContain("web_lane_a");
    expect(yaml.services.web.extra_hosts).toEqual(["host.docker.internal:host-gateway"]);
    expect(yaml.services.worker.ports).toBeUndefined();
  });
});
