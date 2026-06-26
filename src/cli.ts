import { Command } from "commander";
import path from "node:path";
import os from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { RealRunner } from "./runner.js";
import { isPortFreeReal } from "./ports.js";
import { up } from "./commands/up.js";
import { down } from "./commands/down.js";
import { listText } from "./commands/list.js";
import { prune } from "./commands/prune.js";
import { bootstrapManifest } from "./commands/init.js";

const runner = new RealRunner();
const worktreeBase = process.env.LANE_WORKTREE_BASE ?? path.join(os.homedir(), "lane-worktrees");

const program = new Command();
program.name("lane").description("Isolated multi-repo worktree environments");

program.command("up <env> <repos...>")
  .option("--root <pairs>", "comma list of repo=path", "")
  .action(async (env: string, repos: string[], opts: { root: string }) => {
    const repoRoots = Object.fromEntries(
      opts.root.split(",").filter(Boolean).map((p) => p.split("=") as [string, string]),
    );
    for (const r of repos) repoRoots[r] ??= path.resolve(r);
    const rec = await up({ env, repos, repoRoots }, { runner, isFree: isPortFreeReal, worktreeBase });
    console.log(`Env ${rec.name} up (offset ${rec.offset}).`);
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

program.parseAsync();
