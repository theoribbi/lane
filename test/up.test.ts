import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeRunner } from "../src/runner.js";
import { up } from "../src/commands/up.js";

const WEB = `
name: web
runtime: container
services: { web: { basePort: 3002 }, worker: {} }
db: { engine: postgres, container: web-postgres, hostPort: 5533, user: web, password: pw, source: web, target: "web_{env}" }
dependsOn: [{ repo: api, inject: API_URL, fallback: "http://host.docker.internal:3200" }]
`;
const API = `
name: api
runtime: native
services: { api: { basePort: 3200 } }
db: { engine: none }
`;

describe("up", () => {
  let root: string, wtBase: string, webRoot: string, apiRoot: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lane-up-"));
    process.env.LANE_HOME = path.join(root, "home");
    wtBase = path.join(root, "wt");
    webRoot = path.join(root, "src", "web");
    apiRoot = path.join(root, "src", "api");
    await mkdir(webRoot, { recursive: true });
    await mkdir(apiRoot, { recursive: true });
    await writeFile(path.join(webRoot, "lane.yml"), WEB);
    await writeFile(path.join(apiRoot, "lane.yml"), API);
    return () => rm(root, { recursive: true, force: true });
  });

  it("creates a record wiring web to the env's api port", async () => {
    const runner = new FakeRunner();
    // make worktree paths exist so .env writes succeed
    await mkdir(path.join(wtBase, "web-lane-a"), { recursive: true });
    await mkdir(path.join(wtBase, "api-lane-a"), { recursive: true });
    const rec = await up(
      { env: "lane-a", repos: ["web", "api"], repoRoots: { web: webRoot, "api": apiRoot } },
      { runner, isFree: async () => true, worktreeBase: wtBase },
    );
    expect(rec.offset).toBe(10);
    const api = rec.repos.find((r) => r.name === "api")!;
    expect(api.services.find((s) => s.name === "api")!.port).toBe(3210);
    const dotenv = await readFile(path.join(wtBase, "web-lane-a", ".env"), "utf8");
    expect(dotenv).toContain("API_URL=http://host.docker.internal:3210");
    expect(dotenv).toContain("DATABASE_URL=postgres://web:pw@host.docker.internal:5533/web_lane_a");
    // new fields: repoRoot and db credentials must be persisted into the record
    const web = rec.repos.find((r) => r.name === "web")!;
    expect(web.repoRoot).toBe(webRoot);
    expect(web.db?.user).toBe("web");
    expect(web.db?.password).toBe("pw");
    expect(api.repoRoot).toBe(apiRoot);
  });
});
