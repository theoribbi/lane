import type { Runner } from "./runner.js";

export async function addWorktree(runner: Runner, repoRoot: string, dest: string, branch: string): Promise<void> {
  const res = await runner.run("git", ["-C", repoRoot, "worktree", "add", "-b", branch, dest]);
  if (res.exitCode !== 0) throw new Error(`git worktree add failed: ${res.stderr}`);
}

export async function isClean(runner: Runner, worktreePath: string): Promise<boolean> {
  const status = await runner.run("git", ["-C", worktreePath, "status", "--porcelain"]);
  if (status.stdout.trim() !== "") return false;
  // commits on HEAD not present on any remote tracking branch
  const unpushed = await runner.run("git", ["-C", worktreePath, "log", "--branches", "--not", "--remotes", "--oneline"]);
  return unpushed.stdout.trim() === "";
}

export async function removeWorktree(runner: Runner, repoRoot: string, worktreePath: string, force: boolean): Promise<void> {
  const args = ["-C", repoRoot, "worktree", "remove", worktreePath];
  if (force) args.push("--force");
  const res = await runner.run("git", args);
  if (res.exitCode !== 0) throw new Error(`git worktree remove failed: ${res.stderr}`);
}
