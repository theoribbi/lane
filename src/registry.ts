import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EnvRecord } from "./types.js";

export function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function registryDir(): string {
  const home = process.env.LANE_HOME ?? path.join(os.homedir(), ".lane");
  return path.join(home, "envs");
}

function envPath(name: string): string {
  return path.join(registryDir(), `${slugify(name)}.json`);
}

export async function writeEnv(rec: EnvRecord): Promise<void> {
  await mkdir(registryDir(), { recursive: true });
  await writeFile(envPath(rec.name), JSON.stringify(rec, null, 2), "utf8");
}

export async function readEnv(name: string): Promise<EnvRecord | null> {
  try {
    return JSON.parse(await readFile(envPath(name), "utf8")) as EnvRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function deleteEnv(name: string): Promise<void> {
  await rm(envPath(name), { force: true });
}

export async function listEnvs(): Promise<EnvRecord[]> {
  let files: string[];
  try {
    files = await readdir(registryDir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: EnvRecord[] = [];
  for (const f of files.filter((f) => f.endsWith(".json"))) {
    out.push(JSON.parse(await readFile(path.join(registryDir(), f), "utf8")) as EnvRecord);
  }
  return out;
}
