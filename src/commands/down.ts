import type { Runner } from "../runner.js";
import { readEnv, deleteEnv } from "../registry.js";
import { isClean, removeWorktree } from "../worktree.js";
import { dropDb } from "../db.js";
import type { DbManifest } from "../types.js";

export async function down(
  opts: { env: string; force: boolean; repoRoots: Record<string, string> },
  deps: { runner: Runner },
): Promise<{ removed: boolean; reason?: string }> {
  const { runner } = deps;
  const rec = await readEnv(opts.env);
  if (!rec) return { removed: false, reason: "no such env" };

  // Safety gate: never destroy uncommitted/unpushed work.
  if (!opts.force) {
    for (const repo of rec.repos) {
      if (!(await isClean(runner, repo.worktreePath))) {
        return { removed: false, reason: `worktree dirty: ${repo.worktreePath}` };
      }
    }
  }

  for (const repo of rec.repos) {
    if (repo.runtime === "container") {
      await runner.run("docker", [
        "compose", "-p", repo.composeProject, "down", "-v",
      ], { cwd: repo.worktreePath }).catch(() => {});
    }
    if (repo.db) {
      const db: DbManifest = { engine: repo.db.engine, container: repo.db.container, user: undefined, password: undefined };
      // user/password are not in the record; psql inside the container uses the
      // container's superuser via peer/trust by default. Pass through via env in prod.
      await dropDb(runner, { ...db, user: "postgres" }, repo.db.database).catch(() => {});
    }
    await removeWorktree(runner, opts.repoRoots[repo.name] ?? repo.worktreePath, repo.worktreePath, opts.force).catch(() => {});
  }

  await deleteEnv(opts.env);
  return { removed: true };
}
