import { describe, it, expect } from "vitest";
import { preflight } from "../src/preflight.js";
import type { Manifest } from "../src/types.js";

const base: Manifest = {
  name: "web", runtime: "container", repoRoot: "/x",
  services: { web: { basePort: 3000 }, worker: {} },
  db: { engine: "postgres", container: "app-postgres" },
};

const compose = `
services:
  web:
    container_name: app-web
    env_file: .env.local
  postgres:
    image: postgres:16
    container_name: app-postgres
    ports: ["5533:5432"]
`;

describe("preflight", () => {
  it("warns about a missing env_file on a started service", () => {
    const f = preflight({ manifest: base, composeYaml: compose, fileExists: () => false });
    expect(f.find((x) => x.code === "missing-env-file")?.message).toMatch(/\.env\.local/);
  });

  it("does not warn when the env_file exists", () => {
    const f = preflight({ manifest: base, composeYaml: compose, fileExists: () => true });
    expect(f.find((x) => x.code === "missing-env-file")).toBeUndefined();
  });

  it("flags a fixed container_name on a started service as info", () => {
    const f = preflight({ manifest: base, composeYaml: compose, fileExists: () => true });
    expect(f.find((x) => x.code === "fixed-container-name")?.level).toBe("info");
  });

  it("notes a bundled db and a port collision on a non-started service", () => {
    const f = preflight({ manifest: base, composeYaml: compose, fileExists: () => true });
    expect(f.find((x) => x.code === "bundled-db")?.message).toMatch(/postgres/);
    expect(f.find((x) => x.code === "port-collision")?.message).toMatch(/5533/);
  });

  it("does NOT flag port-collision for bare short-form ports (no host binding)", () => {
    const noHostBindingCompose = `
services:
  web:
    image: node:20
  db:
    image: postgres:16
    ports:
      - "5432"
`;
    const manifestWebOnly: Manifest = {
      name: "web", runtime: "container", repoRoot: "/x",
      services: { web: { basePort: 3000 } },
      db: { engine: "none", container: "" },
    };
    const findings = preflight({ manifest: manifestWebOnly, composeYaml: noHostBindingCompose, fileExists: () => true });
    expect(findings.filter((x) => x.code === "port-collision")).toHaveLength(0);
  });

  it("still flags port-collision for host:container form", () => {
    const hostBindingCompose = `
services:
  web:
    image: node:20
  db:
    image: postgres:16
    ports:
      - "5533:5432"
`;
    const manifestWebOnly: Manifest = {
      name: "web", runtime: "container", repoRoot: "/x",
      services: { web: { basePort: 3000 } },
      db: { engine: "none", container: "" },
    };
    const findings = preflight({ manifest: manifestWebOnly, composeYaml: hostBindingCompose, fileExists: () => true });
    const collision = findings.find((x) => x.code === "port-collision");
    expect(collision?.message).toMatch(/5533/);
  });
});
