import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { slugify, writeEnv, readEnv, deleteEnv, listEnvs } from "../src/registry.js";
import type { EnvRecord } from "../src/types.js";

const rec: EnvRecord = {
  name: "lane-a", slug: "lane_a", offset: 10, createdAt: "2026-06-26T00:00:00Z", repos: [],
};

describe("registry", () => {
  beforeEach(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lane-"));
    process.env.LANE_HOME = dir;
    return () => rm(dir, { recursive: true, force: true });
  });

  it("slugifies names to safe identifiers", () => {
    expect(slugify("lane-a")).toBe("lane_a");
    expect(slugify("Feat/XYZ 1")).toBe("feat_xyz_1");
  });

  it("writes, reads, lists, deletes an env record", async () => {
    expect(await readEnv("lane-a")).toBeNull();
    await writeEnv(rec);
    expect((await readEnv("lane-a"))?.offset).toBe(10);
    expect(await listEnvs()).toHaveLength(1);
    await deleteEnv("lane-a");
    expect(await readEnv("lane-a")).toBeNull();
    expect(await listEnvs()).toHaveLength(0);
  });

  it("deleteEnv is idempotent on a missing record", async () => {
    await expect(deleteEnv("nope")).resolves.toBeUndefined();
  });
});
