import { describe, it, expect } from "vitest";
import { FakeRunner } from "../src/runner.js";
import { cloneDb, dropDb } from "../src/db.js";
import type { DbManifest } from "../src/types.js";

const pg: DbManifest = { engine: "postgres", container: "gpa-postgres", hostPort: 5533, user: "gpa", password: "pw", source: "gpa", target: "gpa_{env}" };

describe("db postgres", () => {
  it("clone creates the target db then dump-restores into it", async () => {
    const r = new FakeRunner();
    await cloneDb(r, pg, "gpa_lane_a");
    const cmds = r.calls.map((c) => [c.cmd, ...c.args].join(" "));
    expect(cmds.some((c) => c.includes("createdb") && c.includes("gpa_lane_a"))).toBe(true);
    expect(cmds.some((c) => c.includes("pg_dump") && c.includes("gpa"))).toBe(true);
    expect(cmds.some((c) => c.includes("pg_restore") && c.includes("gpa_lane_a"))).toBe(true);
  });

  it("drop uses WITH (FORCE)", async () => {
    const r = new FakeRunner();
    await dropDb(r, pg, "gpa_lane_a");
    const joined = r.calls.map((c) => [c.cmd, ...c.args].join(" ")).join(" | ");
    expect(joined).toContain("DROP DATABASE");
    expect(joined).toContain("FORCE");
    expect(joined).toContain("gpa_lane_a");
  });
});
