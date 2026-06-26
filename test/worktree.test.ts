import { describe, it, expect } from "vitest";
import { FakeRunner } from "../src/runner.js";
import { addWorktree, isClean, removeWorktree } from "../src/worktree.js";

describe("worktree", () => {
  it("addWorktree runs git worktree add with a new branch", async () => {
    const r = new FakeRunner();
    await addWorktree(r, "/x/gpa", "/x/wt/gpa-lane-a", "lane-a");
    const c = r.calls[0];
    expect(c.cmd).toBe("git");
    expect(c.args).toEqual(["-C", "/x/gpa", "worktree", "add", "-b", "lane-a", "/x/wt/gpa-lane-a"]);
  });

  it("isClean is true when status is empty and nothing is unpushed", async () => {
    const r = new FakeRunner({
      "git -C /x/wt status --porcelain": { stdout: "", stderr: "", exitCode: 0 },
      "git -C /x/wt log": { stdout: "", stderr: "", exitCode: 0 },
    });
    expect(await isClean(r, "/x/wt")).toBe(true);
  });

  it("isClean is false when there are uncommitted changes", async () => {
    const r = new FakeRunner({
      "git -C /x/wt status --porcelain": { stdout: " M src/a.ts", stderr: "", exitCode: 0 },
    });
    expect(await isClean(r, "/x/wt")).toBe(false);
  });

  it("isClean is false when there are unpushed commits", async () => {
    const r = new FakeRunner({
      "git -C /x/wt status --porcelain": { stdout: "", stderr: "", exitCode: 0 },
      "git -C /x/wt log": { stdout: "abc123 wip", stderr: "", exitCode: 0 },
    });
    expect(await isClean(r, "/x/wt")).toBe(false);
  });
});
