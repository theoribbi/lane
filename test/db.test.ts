import { describe, it, expect } from "vitest";
import { FakeRunner } from "../src/runner.js";
import { cloneDb, dropDb } from "../src/db.js";
import type { DbManifest } from "../src/types.js";

const pg: DbManifest = { engine: "postgres", container: "web-postgres", hostPort: 5533, user: "web", password: "pw", source: "web", target: "web_{env}" };

describe("db postgres", () => {
  it("clone creates the target db then dump-restores into it", async () => {
    const r = new FakeRunner();
    await cloneDb(r, pg, "web_lane_a");
    const cmds = r.calls.map((c) => [c.cmd, ...c.args].join(" "));
    expect(cmds.some((c) => c.includes("createdb") && c.includes("web_lane_a"))).toBe(true);
    expect(cmds.some((c) => c.includes("pg_dump") && c.includes("web"))).toBe(true);
    expect(cmds.some((c) => c.includes("pg_restore") && c.includes("web_lane_a"))).toBe(true);
  });

  it("drop uses WITH (FORCE)", async () => {
    const r = new FakeRunner();
    await dropDb(r, pg, "web_lane_a");
    const joined = r.calls.map((c) => [c.cmd, ...c.args].join(" ")).join(" | ");
    expect(joined).toContain("DROP DATABASE");
    expect(joined).toContain("FORCE");
    expect(joined).toContain("web_lane_a");
  });
});

it("clone rejects when a docker command exits non-zero", async () => {
  const db = { engine: "postgres", container: "pg", user: "u", password: "p", source: "src" } as const;
  const r = new FakeRunner({ "docker exec -e PGPASSWORD pg createdb": { stdout: "", stderr: "boom", exitCode: 1 } });
  await expect(cloneDb(r, db, "tgt")).rejects.toThrow(/failed/i);
});

it("drop rejects when a docker command exits non-zero", async () => {
  const db = { engine: "postgres", container: "pg", user: "u", password: "p", source: "src" } as const;
  const r = new FakeRunner({ "docker exec -e PGPASSWORD pg psql": { stdout: "", stderr: "nope", exitCode: 1 } });
  await expect(dropDb(r, db, "tgt")).rejects.toThrow(/failed/i);
});
