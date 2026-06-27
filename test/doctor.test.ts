import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FakeRunner } from "../src/runner.js";
import { doctor } from "../src/commands/doctor.js";

describe("doctor", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "lane-doc-"));
    await writeFile(path.join(repo, "lane.yml"),
      "name: web\nruntime: container\nservices: { web: { basePort: 3000 } }\ndb: { engine: none }");
    await writeFile(path.join(repo, "docker-compose.yml"),
      "services:\n  web:\n    env_file: .env.local\n");
    return () => rm(repo, { recursive: true, force: true });
  });

  it("predicts a missing gitignored env_file (not tracked, not in copyFiles)", async () => {
    const runner = new FakeRunner({ "git -C": { stdout: "lane.yml\ndocker-compose.yml\n", stderr: "", exitCode: 0 } });
    const findings = await doctor({ repoRoot: repo }, { runner });
    expect(findings.find((f) => f.code === "missing-env-file")).toBeTruthy();
  });

  it("missing-env-file still fires when copyFiles lists the file but it is not on disk", async () => {
    await writeFile(path.join(repo, "lane.yml"),
      "name: web\nruntime: container\nservices: { web: { basePort: 3000 } }\ndb: { engine: none }\ncopyFiles: [.env.local]");
    // .env.local is NOT tracked and NOT on disk
    const runner = new FakeRunner({ "git -C": { stdout: "lane.yml\ndocker-compose.yml\n", stderr: "", exitCode: 0 } });
    const findings = await doctor({ repoRoot: repo }, { runner });
    expect(findings.find((f) => f.code === "missing-env-file")).toBeTruthy();
  });
});
