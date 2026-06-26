// test/drift.test.ts
import { describe, it, expect } from "vitest";
import { checkDrift } from "../scripts/check-manifest-drift.mjs";

const manifest = `name: web\nruntime: container\nservices: { web: { basePort: 3002 }, ghost: {} }\ndb: { engine: none }`;
const compose = `services: { web: { image: x }, worker: { image: y }, postgres: { image: postgres } }`;

describe("checkDrift", () => {
  it("flags a manifest service missing from compose", () => {
    const msgs = checkDrift(manifest, compose);
    expect(msgs.join(" ")).toContain("ghost");
  });
});
