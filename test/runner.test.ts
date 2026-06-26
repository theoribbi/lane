import { describe, it, expect } from "vitest";
import { FakeRunner } from "../src/runner.js";

describe("FakeRunner", () => {
  it("records calls and returns scripted results", async () => {
    const fake = new FakeRunner({ "git rev-parse": { stdout: "abc", stderr: "", exitCode: 0 } });
    const res = await fake.run("git", ["rev-parse", "HEAD"]);
    expect(res.stdout).toBe("abc");
    expect(fake.calls[0]).toEqual({ cmd: "git", args: ["rev-parse", "HEAD"], opts: undefined });
  });

  it("returns exitCode 0 empty result for unscripted commands", async () => {
    const fake = new FakeRunner();
    const res = await fake.run("docker", ["ps"]);
    expect(res.exitCode).toBe(0);
  });
});
