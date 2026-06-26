// test/init.test.ts
import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { bootstrapManifest } from "../src/commands/init.js";

const COMPOSE = `
services:
  postgres: { image: postgres:16-alpine, ports: ["5533:5432"], environment: { POSTGRES_USER: web, POSTGRES_PASSWORD: web_dev_password, POSTGRES_DB: web } }
  web: { image: node:20-alpine, ports: ["3002:3002"] }
  worker: { image: node:20-alpine }
`;

describe("bootstrapManifest", () => {
  it("derives services and a db block from compose", () => {
    const m = parseYaml(bootstrapManifest(COMPOSE, "web"));
    expect(m.name).toBe("web");
    expect(m.services.web.basePort).toBe(3002);
    expect(m.services).not.toHaveProperty("postgres");
    expect(m.db.engine).toBe("postgres");
    expect(m.db.hostPort).toBe(5533);
    expect(m.db.source).toBe("web");
  });
});
