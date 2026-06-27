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

  it("prepares (no docker compose up) and wires web to the env's api port", async () => {
    const runner = new FakeRunner();
    await mkdir(path.join(wtBase, "web-lane-a"), { recursive: true });
    await mkdir(path.join(wtBase, "api-lane-a"), { recursive: true });
    const { record } = await up(
      { env: "lane-a", repos: ["web", "api"], repoRoots: { web: webRoot, api: apiRoot } },
      { runner, isFree: async () => true, worktreeBase: wtBase },
    );
    expect(record.offset).toBe(10);
    const dotenv = await readFile(path.join(wtBase, "web-lane-a", ".env"), "utf8");
    expect(dotenv).toContain("API_URL=http://host.docker.internal:3210");
    expect(dotenv).toContain("DATABASE_URL=postgres://web:pw@host.docker.internal:5533/web_lane_a");
    const web = record.repos.find((r) => r.name === "web")!;
    expect(web.repoRoot).toBe(webRoot);
    expect(web.db?.user).toBe("web");
    // default up does NOT boot containers
    expect(runner.calls.find((c) => c.cmd === "docker" && c.args.includes("up"))).toBeUndefined();
  });

  it("boots with --no-deps when start is true", async () => {
    const runner = new FakeRunner();
    await mkdir(path.join(wtBase, "web-lane-a"), { recursive: true });
    await mkdir(path.join(wtBase, "api-lane-a"), { recursive: true });
    await up(
      { env: "lane-a", repos: ["web", "api"], repoRoots: { web: webRoot, api: apiRoot }, start: true },
      { runner, isFree: async () => true, worktreeBase: wtBase },
    );
    const boot = runner.calls.find((c) => c.cmd === "docker" && c.args.includes("up") && c.args.includes("web"))!;
    expect(boot.args).toContain("--no-deps");
    expect(boot.args).toContain("docker-compose.yml");
  });

  it("fails loud when the boot exits non-zero", async () => {
    const runner = new FakeRunner({ "docker compose -f docker-compose.yml": { stdout: "", stderr: "bad compose", exitCode: 1 } });
    await mkdir(path.join(wtBase, "web-lane-a"), { recursive: true });
    await mkdir(path.join(wtBase, "api-lane-a"), { recursive: true });
    await expect(up(
      { env: "lane-a", repos: ["web", "api"], repoRoots: { web: webRoot, api: apiRoot }, start: true },
      { runner, isFree: async () => true, worktreeBase: wtBase },
    )).rejects.toThrow(/compose up failed/i);
  });

  it("copies copyFiles into the worktree", async () => {
    await writeFile(path.join(webRoot, "lane.yml"), WEB.replace("runtime: container", "runtime: container\ncopyFiles: [secret.env]"));
    await writeFile(path.join(webRoot, "secret.env"), "TOKEN=abc");
    const runner = new FakeRunner();
    await mkdir(path.join(wtBase, "web-lane-a"), { recursive: true });
    await mkdir(path.join(wtBase, "api-lane-a"), { recursive: true });
    await up(
      { env: "lane-a", repos: ["web", "api"], repoRoots: { web: webRoot, api: apiRoot } },
      { runner, isFree: async () => true, worktreeBase: wtBase },
    );
    const copied = await readFile(path.join(wtBase, "web-lane-a", "secret.env"), "utf8");
    expect(copied).toBe("TOKEN=abc");
  });
});
