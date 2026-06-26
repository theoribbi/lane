import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeRunner } from "../src/runner.js";
import { up } from "../src/commands/up.js";

const GPA = `
name: gpa
runtime: container
services: { web: { basePort: 3002 }, worker: {} }
db: { engine: postgres, container: gpa-postgres, hostPort: 5533, user: gpa, password: pw, source: gpa, target: "gpa_{env}" }
dependsOn: [{ repo: brokinsoft-api, inject: BROKINSOFT_API_URL, fallback: "http://host.docker.internal:3200" }]
`;
const BK = `
name: brokinsoft-api
runtime: native
services: { api: { basePort: 3200 } }
db: { engine: none }
`;

describe("up", () => {
  let root: string, wtBase: string, gpaRoot: string, bkRoot: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lane-up-"));
    process.env.LANE_HOME = path.join(root, "home");
    wtBase = path.join(root, "wt");
    gpaRoot = path.join(root, "src", "gpa");
    bkRoot = path.join(root, "src", "brokinsoft-api");
    await mkdir(gpaRoot, { recursive: true });
    await mkdir(bkRoot, { recursive: true });
    await writeFile(path.join(gpaRoot, "lane.yml"), GPA);
    await writeFile(path.join(bkRoot, "lane.yml"), BK);
    return () => rm(root, { recursive: true, force: true });
  });

  it("creates a record wiring gpa to the env's brokinsoft port", async () => {
    const runner = new FakeRunner();
    // make worktree paths exist so .env writes succeed
    await mkdir(path.join(wtBase, "gpa-lane-a"), { recursive: true });
    await mkdir(path.join(wtBase, "brokinsoft-api-lane-a"), { recursive: true });
    const rec = await up(
      { env: "lane-a", repos: ["gpa", "brokinsoft-api"], repoRoots: { gpa: gpaRoot, "brokinsoft-api": bkRoot } },
      { runner, isFree: async () => true, worktreeBase: wtBase },
    );
    expect(rec.offset).toBe(10);
    const bk = rec.repos.find((r) => r.name === "brokinsoft-api")!;
    expect(bk.services.find((s) => s.name === "api")!.port).toBe(3210);
    const dotenv = await readFile(path.join(wtBase, "gpa-lane-a", ".env"), "utf8");
    expect(dotenv).toContain("BROKINSOFT_API_URL=http://host.docker.internal:3210");
    expect(dotenv).toContain("DATABASE_URL=postgres://gpa:pw@host.docker.internal:5533/gpa_lane_a");
    // new fields: repoRoot and db credentials must be persisted into the record
    const gpa = rec.repos.find((r) => r.name === "gpa")!;
    expect(gpa.repoRoot).toBe(gpaRoot);
    expect(gpa.db?.user).toBe("gpa");
    expect(gpa.db?.password).toBe("pw");
    expect(bk.repoRoot).toBe(bkRoot);
  });
});
