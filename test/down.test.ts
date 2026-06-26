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
    repoRoot: "/x/gpa",
    db: { engine: "postgres", container: "gpa-postgres", database: "gpa_lane_a", user: "gpa", password: "pw" },
  }],
};

const mysqlRec: EnvRecord = {
  name: "lane-b", slug: "lane_b", offset: 20, createdAt: "t",
  repos: [{
    name: "myapp", worktreePath: "/x/wt/myapp-lane-b", branch: "lane-b", composeProject: "myapp-lane-b",
    runtime: "native", services: [],
    repoRoot: "/x/myapp",
    db: { engine: "mysql", container: "myapp-mysql", database: "myapp_lane_b", user: "myapp_user", password: "secret" },
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

  it("tears down containers, drops db via record user, removes worktree, deletes record when clean", async () => {
    const runner = new FakeRunner(); // all status empty -> clean
    const res = await down({ env: "lane-a", force: false, repoRoots: { gpa: "/x/gpa" } }, { runner });
    expect(res.removed).toBe(true);
    const cmds = runner.calls.map((c) => [c.cmd, ...c.args].join(" "));
    expect(cmds.some((c) => c.includes("compose") && c.includes("down") && c.includes("-v"))).toBe(true);
    // drop must use the record's user (gpa), not hardcoded postgres
    expect(cmds.some((c) => c.includes("DROP DATABASE") && c.includes("gpa_lane_a") && c.includes("gpa"))).toBe(true);
    expect(cmds.some((c) => c.includes("worktree") && c.includes("remove"))).toBe(true);
    expect(await readEnv("lane-a")).toBeNull();
  });
});

describe("down mysql", () => {
  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lane-down-mysql-"));
    process.env.LANE_HOME = dir;
    await writeEnv(mysqlRec);
    return () => rm(dir, { recursive: true, force: true });
  });

  it("drops mysql db via record user and uses repoRoot as worktree parent when no override", async () => {
    const runner = new FakeRunner();
    // pass empty repoRoots so the fallback to repo.repoRoot is exercised
    const res = await down({ env: "lane-b", force: true, repoRoots: {} }, { runner });
    expect(res.removed).toBe(true);
    const cmds = runner.calls.map((c) => [c.cmd, ...c.args].join(" "));
    // drop must use the record user (myapp_user), not silently no-op or use wrong user
    expect(cmds.some((c) => c.includes("DROP DATABASE") && c.includes("myapp_lane_b") && c.includes("myapp_user"))).toBe(true);
    // removeWorktree must be called with repoRoot from the record, not the worktree path itself
    expect(cmds.some((c) => c.includes("worktree") && c.includes("remove") && c.includes("/x/myapp"))).toBe(true);
  });
});
