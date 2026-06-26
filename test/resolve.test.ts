// test/resolve.test.ts
import { describe, it, expect } from "vitest";
import { hostFor, resolveDeps, dbUrl } from "../src/resolve.js";
import type { Manifest, EnvRecord } from "../src/types.js";

const gpa: Manifest = {
  name: "gpa", runtime: "container", repoRoot: "/x/gpa",
  services: { web: { basePort: 3002 } },
  db: { engine: "postgres", container: "gpa-postgres", hostPort: 5533, user: "gpa", password: "pw", source: "gpa", target: "gpa_{env}" },
  dependsOn: [{ repo: "brokinsoft-api", inject: "BROKINSOFT_API_URL", fallback: "http://host.docker.internal:3200" }],
};

const envWithBk: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "t", repos: [
    { name: "brokinsoft-api", worktreePath: "/x/bk", branch: "lane-a", composeProject: "brokinsoft-api-lane-a", runtime: "native", services: [{ name: "api", port: 3210 }] },
  ],
};
const envWithoutBk: EnvRecord = { ...envWithBk, repos: [] };

describe("resolve", () => {
  it("hostFor depends only on consumer runtime", () => {
    expect(hostFor("container")).toBe("host.docker.internal");
    expect(hostFor("native")).toBe("localhost");
  });

  it("resolves a co-running dep to its env port via the consumer host", () => {
    expect(resolveDeps(gpa, envWithBk)).toEqual([
      { inject: "BROKINSOFT_API_URL", url: "http://host.docker.internal:3210" },
    ]);
  });

  it("falls back when the dep is not in the env", () => {
    expect(resolveDeps(gpa, envWithoutBk)).toEqual([
      { inject: "BROKINSOFT_API_URL", url: "http://host.docker.internal:3200" },
    ]);
  });

  it("builds a DB url for a container consumer", () => {
    expect(dbUrl(gpa.db, "gpa_lane_a", "container"))
      .toBe("postgres://gpa:pw@host.docker.internal:5533/gpa_lane_a");
  });
});
