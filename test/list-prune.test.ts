// test/list-prune.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeEnv } from "../src/registry.js";
import { listText } from "../src/commands/list.js";
import { prune } from "../src/commands/prune.js";
import { FakeRunner } from "../src/runner.js";
import type { EnvRecord } from "../src/types.js";

const rec: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "t",
  repos: [{ name: "gpa", worktreePath: "/x/wt/gpa-lane-a", branch: "lane-a", composeProject: "gpa-lane-a", runtime: "container", services: [{ name: "web", port: 3012 }] }],
};

describe("list/prune", () => {
  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lane-lp-"));
    process.env.LANE_HOME = dir;
    await writeEnv(rec);
    return () => rm(dir, { recursive: true, force: true });
  });

  it("listText includes env, offset, and a port", async () => {
    const out = await listText();
    expect(out).toContain("lane-a");
    expect(out).toContain("10");
    expect(out).toContain("3012");
  });

  it("prune reports docker compose projects not in the registry as orphans", async () => {
    const runner = new FakeRunner({
      "docker compose ls": { stdout: "gpa-lane-a\nconnect-ghost\n", stderr: "", exitCode: 0 },
    });
    const res = await prune({ runner });
    expect(res.orphans).toContain("connect-ghost");
    expect(res.orphans).not.toContain("gpa-lane-a");
  });
});
