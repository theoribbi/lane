import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeRunner } from "../src/runner.js";
import { writeEnv, readEnv } from "../src/registry.js";
import { down } from "../src/commands/down.js";
import type { EnvRecord } from "../src/types.js";

const rec: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "t",
  repos: [{
    name: "gpa", worktreePath: "/x/wt/gpa-lane-a", branch: "lane-a", composeProject: "gpa-lane-a",
    runtime: "container", services: [{ name: "web", port: 3012 }],
    db: { engine: "postgres", container: "gpa-postgres", database: "gpa_lane_a" },
  }],
};

describe("down", () => {
  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lane-down-"));
    process.env.LANE_HOME = dir;
    await writeEnv(rec);
    return () => rm(dir, { recursive: true, force: true });
  });

  it("refuses when a worktree is dirty and leaves the record", async () => {
    const runner = new FakeRunner({ "git -C /x/wt/gpa-lane-a status --porcelain": { stdout: " M a.ts", stderr: "", exitCode: 0 } });
    const res = await down({ env: "lane-a", force: false, repoRoots: { gpa: "/x/gpa" } }, { runner });
    expect(res.removed).toBe(false);
    expect(await readEnv("lane-a")).not.toBeNull();
  });

  it("tears down containers, drops db, removes worktree, deletes record when clean", async () => {
    const runner = new FakeRunner(); // all status empty -> clean
    const res = await down({ env: "lane-a", force: false, repoRoots: { gpa: "/x/gpa" } }, { runner });
    expect(res.removed).toBe(true);
    const cmds = runner.calls.map((c) => [c.cmd, ...c.args].join(" "));
    expect(cmds.some((c) => c.includes("compose") && c.includes("down") && c.includes("-v"))).toBe(true);
    expect(cmds.some((c) => c.includes("DROP DATABASE") && c.includes("gpa_lane_a"))).toBe(true);
    expect(cmds.some((c) => c.includes("worktree") && c.includes("remove"))).toBe(true);
    expect(await readEnv("lane-a")).toBeNull();
  });
});
