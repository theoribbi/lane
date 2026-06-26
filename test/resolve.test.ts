// test/resolve.test.ts
import { describe, it, expect } from "vitest";
import { hostFor, resolveDeps, dbUrl } from "../src/resolve.js";
import type { Manifest, EnvRecord } from "../src/types.js";

const web: Manifest = {
  name: "web", runtime: "container", repoRoot: "/x/web",
  services: { web: { basePort: 3002 } },
  db: { engine: "postgres", container: "web-postgres", hostPort: 5533, user: "web", password: "pw", source: "web", target: "web_{env}" },
  dependsOn: [{ repo: "api", inject: "API_URL", fallback: "http://host.docker.internal:3200" }],
};

const envWithBk: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "t", repos: [
    { name: "api", worktreePath: "/x/api", branch: "lane-a", composeProject: "api-lane-a", runtime: "native", services: [{ name: "api", port: 3210 }] },
  ],
};
const envWithoutBk: EnvRecord = { ...envWithBk, repos: [] };

describe("resolve", () => {
  it("hostFor depends only on consumer runtime", () => {
    expect(hostFor("container")).toBe("host.docker.internal");
    expect(hostFor("native")).toBe("localhost");
  });

  it("resolves a co-running dep to its env port via the consumer host", () => {
    expect(resolveDeps(web, envWithBk)).toEqual([
      { inject: "API_URL", url: "http://host.docker.internal:3210" },
    ]);
  });

  it("falls back when the dep is not in the env", () => {
    expect(resolveDeps(web, envWithoutBk)).toEqual([
      { inject: "API_URL", url: "http://host.docker.internal:3200" },
    ]);
  });

  it("builds a DB url for a container consumer", () => {
    expect(dbUrl(web.db, "web_lane_a", "container"))
      .toBe("postgres://web:pw@host.docker.internal:5533/web_lane_a");
  });
});
