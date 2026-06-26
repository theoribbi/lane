// test/manifest.test.ts
import { describe, it, expect } from "vitest";
import { parseManifest } from "../src/manifest.js";

const WEB = `
name: web
runtime: container
services:
  web: { basePort: 3002, health: "http://localhost:{port}/api/health" }
  worker: {}
db:
  engine: postgres
  container: web-postgres
  hostPort: 5533
  user: web
  password: web_dev_password
  source: web
  target: "web_{env}"
dependsOn:
  - { repo: api, inject: API_URL, fallback: "http://host.docker.internal:3200" }
`;

describe("parseManifest", () => {
  it("parses a valid manifest and attaches repoRoot", () => {
    const m = parseManifest(WEB, "/x/web");
    expect(m.name).toBe("web");
    expect(m.runtime).toBe("container");
    expect(m.services.web.basePort).toBe(3002);
    expect(m.db.target).toBe("web_{env}");
    expect(m.dependsOn?.[0].inject).toBe("API_URL");
    expect(m.repoRoot).toBe("/x/web");
  });

  it("rejects a manifest missing name", () => {
    expect(() => parseManifest("runtime: native\nservices: {}\ndb: { engine: none }", "/x"))
      .toThrow();
  });

  it("allows db.engine none with no source", () => {
    const m = parseManifest("name: api\nruntime: native\nservices:\n  api: { basePort: 3200 }\ndb: { engine: none }", "/x/api");
    expect(m.db.engine).toBe("none");
  });
});
