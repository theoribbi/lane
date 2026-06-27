import { Command } from "commander";
import path from "node:path";
import os from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { RealRunner } from "./runner.js";
import { isPortFreeReal } from "./ports.js";
import { up, bootCommandString } from "./commands/up.js";
import { doctor } from "./commands/doctor.js";
import { loadManifest } from "./manifest.js";
import type { PreflightFinding } from "./preflight.js";
import { down } from "./commands/down.js";
import { listText } from "./commands/list.js";
import { prune } from "./commands/prune.js";
import { bootstrapManifest } from "./commands/init.js";

const runner = new RealRunner();
const worktreeBase = process.env.LANE_WORKTREE_BASE ?? path.join(os.homedir(), "lane-worktrees");

function renderFindings(findings: PreflightFinding[]): void {
  for (const f of findings) console.log(`${f.level === "warn" ? "⚠" : "ℹ"}  ${f.message}`);
}

const program = new Command();
program.name("lane").description("Isolated multi-repo worktree environments");

program.command("up <env> <repos...>")
  .option("--root <pairs>", "comma list of repo=path", "")
  .option("--start", "boot the containers after preparing", false)
  .action(async (env: string, repos: string[], opts: { root: string; start: boolean }) => {
    const repoRoots = Object.fromEntries(
      opts.root.split(",").filter(Boolean).map((p) => p.split("=") as [string, string]),
    );
    for (const r of repos) repoRoots[r] ??= path.resolve(r);
    const { record, findings } = await up({ env, repos, repoRoots, start: opts.start }, { runner, isFree: isPortFreeReal, worktreeBase });
    console.log(`Env ${record.name} ${opts.start ? "up" : "prepared"} (offset ${record.offset}).`);
    renderFindings(findings);
    if (!opts.start && record.repos.some((r) => r.runtime === "container")) {
      console.log("\nBoot it with:");
      for (const repo of record.repos) {
        if (repo.runtime !== "container") continue;
        const m = await loadManifest(repo.repoRoot);
        console.log(`  ${bootCommandString(m, repo)}`);
      }
    }
  });

program.command("down <env>")
  .option("--force", "skip cleanliness gate", false)
  .option("--root <pairs>", "comma list of repo=path", "")
  .action(async (env: string, opts: { force: boolean; root: string }) => {
    const repoRoots = Object.fromEntries(opts.root.split(",").filter(Boolean).map((p) => p.split("=") as [string, string]));
    const res = await down({ env, force: opts.force, repoRoots }, { runner });
    console.log(res.removed ? `Env ${env} removed.` : `Refused: ${res.reason}`);
  });

program.command("list").action(async () => console.log(await listText()));

program.command("prune").action(async () => {
  const { orphans } = await prune({ runner });
  console.log(orphans.length ? `Orphans: ${orphans.join(", ")}` : "No orphans.");
});

program.command("init <name>")
  .option("-c, --compose <file>", "compose file", "docker-compose.yml")
  .action(async (name: string, opts: { compose: string }) => {
    const yaml = bootstrapManifest(await readFile(opts.compose, "utf8"), name);
    await writeFile("lane.yml", yaml, "utf8");
    console.log("Wrote lane.yml — review base ports, db credentials, and dependsOn.");
  });

program.command("doctor <repo>")
  .action(async (repo: string) => {
    const findings = await doctor({ repoRoot: path.resolve(repo) }, { runner });
    if (findings.length === 0) console.log("No preflight findings — looks lane-ready.");
    else renderFindings(findings);
  });

program.parseAsync();
