import { describe, it, expect } from "vitest";
import { nextOffset, bindPort } from "../src/ports.js";

describe("ports", () => {
  it("nextOffset returns first free multiple of stride", () => {
    expect(nextOffset([], 10)).toBe(10);
    expect(nextOffset([10], 10)).toBe(20);
    expect(nextOffset([10, 30], 10)).toBe(20);
  });

  it("bindPort returns the preferred port when free", async () => {
    const free = async () => true;
    expect(await bindPort(3012, free)).toBe(3012);
  });

  it("bindPort probes upward when occupied", async () => {
    const taken = new Set([3012, 3013]);
    const isFree = async (p: number) => !taken.has(p);
    expect(await bindPort(3012, isFree)).toBe(3014);
  });
});
