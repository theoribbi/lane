// test/manifest.test.ts
import { describe, it, expect } from "vitest";
import { parseManifest } from "../src/manifest.js";

const GPA = `
name: gpa
runtime: container
services:
  web: { basePort: 3002, health: "http://localhost:{port}/api/health" }
  worker: {}
db:
  engine: postgres
  container: gpa-postgres
  hostPort: 5533
  user: gpa
  password: gpa_dev_password
  source: gpa
  target: "gpa_{env}"
dependsOn:
  - { repo: brokinsoft-api, inject: BROKINSOFT_API_URL, fallback: "http://host.docker.internal:3200" }
`;

describe("parseManifest", () => {
  it("parses a valid manifest and attaches repoRoot", () => {
    const m = parseManifest(GPA, "/x/gpa");
    expect(m.name).toBe("gpa");
    expect(m.runtime).toBe("container");
    expect(m.services.web.basePort).toBe(3002);
    expect(m.db.target).toBe("gpa_{env}");
    expect(m.dependsOn?.[0].inject).toBe("BROKINSOFT_API_URL");
    expect(m.repoRoot).toBe("/x/gpa");
  });

  it("rejects a manifest missing name", () => {
    expect(() => parseManifest("runtime: native\nservices: {}\ndb: { engine: none }", "/x"))
      .toThrow();
  });

  it("allows db.engine none with no source", () => {
    const m = parseManifest("name: bk\nruntime: native\nservices:\n  api: { basePort: 3200 }\ndb: { engine: none }", "/x/bk");
    expect(m.db.engine).toBe("none");
  });
});
