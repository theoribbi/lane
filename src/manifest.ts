import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Manifest } from "./types.js";

const ServiceSchema = z.object({
  basePort: z.number().int().positive().optional(),
  health: z.string().optional(),
});

const DbSchema = z.object({
  engine: z.enum(["postgres", "mysql", "none"]),
  container: z.string().optional(),
  hostPort: z.number().int().positive().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  source: z.string().optional(),
  target: z.string().optional(),
});

const DependsOnSchema = z.object({
  repo: z.string(),
  inject: z.string(),
  fallback: z.string(),
});

const ManifestSchema = z.object({
  name: z.string().min(1),
  runtime: z.enum(["container", "native"]),
  compose: z.string().optional(),
  services: z.record(ServiceSchema),
  db: DbSchema,
  dependsOn: z.array(DependsOnSchema).optional(),
});

export function parseManifest(yamlText: string, repoRoot: string): Manifest {
  const raw = parseYaml(yamlText);
  const parsed = ManifestSchema.parse(raw);
  return { ...parsed, repoRoot };
}

export async function loadManifest(repoRoot: string): Promise<Manifest> {
  const text = await readFile(path.join(repoRoot, "lane.yml"), "utf8");
  return parseManifest(text, repoRoot);
}
