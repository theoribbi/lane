import { describe, it, expect } from "vitest";
import { buildEnvVars, renderDotenv, renderComposeOverride } from "../src/generate.js";
import { parse as parseYaml } from "yaml";
import type { Manifest, EnvRecord, RepoRecord } from "../src/types.js";

const gpa: Manifest = {
  name: "gpa", runtime: "container", repoRoot: "/x/gpa",
  services: { web: { basePort: 3002 }, worker: {} },
  db: { engine: "postgres", container: "gpa-postgres", hostPort: 5533, user: "gpa", password: "pw", source: "gpa", target: "gpa_{env}" },
  dependsOn: [{ repo: "brokinsoft-api", inject: "BROKINSOFT_API_URL", fallback: "http://host.docker.internal:3200" }],
};
const repo: RepoRecord = {
  name: "gpa", worktreePath: "/x/wt/gpa", branch: "lane-a", composeProject: "gpa-lane-a",
  runtime: "container",
  services: [{ name: "web", port: 3012 }, { name: "worker", port: null }],
  db: { engine: "postgres", container: "gpa-postgres", database: "gpa_lane_a" },
};
const env: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "t",
  repos: [repo, { name: "brokinsoft-api", worktreePath: "/x/wt/bk", branch: "lane-a", composeProject: "brokinsoft-api-lane-a", runtime: "native", services: [{ name: "api", port: 3210 }] }],
};

describe("generate", () => {
  it("builds env vars with DB url and resolved deps", () => {
    const vars = buildEnvVars(gpa, env, repo);
    expect(vars.DATABASE_URL).toBe("postgres://gpa:pw@host.docker.internal:5533/gpa_lane_a");
    expect(vars.BROKINSOFT_API_URL).toBe("http://host.docker.internal:3210");
  });

  it("renders a dotenv string", () => {
    expect(renderDotenv({ A: "1", B: "two" })).toBe("A=1\nB=two\n");
  });

  it("renders a compose override remapping ports and injecting env", () => {
    const vars = buildEnvVars(gpa, env, repo);
    const yaml = parseYaml(renderComposeOverride(gpa, repo, vars));
    expect(yaml.services.web.ports).toEqual(["3012:3002"]);
    expect(yaml.services.web.environment.DATABASE_URL).toContain("gpa_lane_a");
    expect(yaml.services.web.extra_hosts).toEqual(["host.docker.internal:host-gateway"]);
    expect(yaml.services.worker.ports).toBeUndefined();
  });
});
