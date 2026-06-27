import type { Runner, RunResult } from "./runner.js";
import type { DbManifest } from "./types.js";

function check(res: RunResult, what: string): RunResult {
  if (res.exitCode !== 0) throw new Error(`lane: ${what} failed: ${res.stderr.trim() || `exit ${res.exitCode}`}`);
  return res;
}

function requireClone(db: DbManifest): asserts db is Required<Pick<DbManifest, "container" | "user" | "source">> & DbManifest {
  if (!db.container || !db.user || !db.source) throw new Error(`db manifest incomplete for engine ${db.engine}`);
}

function requireDrop(db: DbManifest): asserts db is Required<Pick<DbManifest, "container" | "user">> & DbManifest {
  if (!db.container || !db.user) throw new Error(`db manifest incomplete for engine ${db.engine}`);
}

export async function cloneDb(runner: Runner, db: DbManifest, target: string): Promise<void> {
  if (db.engine === "none") return;
  requireClone(db);
  const env = { PGPASSWORD: db.password ?? "", MYSQL_PWD: db.password ?? "" };
  if (db.engine === "postgres") {
    check(await runner.run("docker", ["exec", "-e", "PGPASSWORD", db.container, "createdb", "-U", db.user, target], { env }), `create database "${target}"`);
    const dump = check(await runner.run("docker", ["exec", "-e", "PGPASSWORD", db.container, "pg_dump", "-U", db.user, "-Fc", db.source], { env }), `dump "${db.source}"`);
    check(await runner.run("docker", ["exec", "-i", "-e", "PGPASSWORD", db.container, "pg_restore", "-U", db.user, "-d", target], { input: dump.stdout, env }), `restore into "${target}"`);
  } else {
    check(await runner.run("docker", ["exec", "-e", "MYSQL_PWD", db.container, "mysql", "-u", db.user, "-e", `CREATE DATABASE \`${target}\``], { env }), `create database "${target}"`);
    const dump = check(await runner.run("docker", ["exec", "-e", "MYSQL_PWD", db.container, "mysqldump", "-u", db.user, db.source], { env }), `dump "${db.source}"`);
    check(await runner.run("docker", ["exec", "-i", "-e", "MYSQL_PWD", db.container, "mysql", "-u", db.user, target], { input: dump.stdout, env }), `restore into "${target}"`);
  }
}

export async function dropDb(runner: Runner, db: DbManifest, target: string): Promise<void> {
  if (db.engine === "none") return;
  requireDrop(db);
  const env = { PGPASSWORD: db.password ?? "", MYSQL_PWD: db.password ?? "" };
  if (db.engine === "postgres") {
    check(await runner.run("docker", ["exec", "-e", "PGPASSWORD", db.container, "psql", "-U", db.user, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`], { env }), `drop database "${target}"`);
  } else {
    check(await runner.run("docker", ["exec", "-e", "MYSQL_PWD", db.container, "mysql", "-u", db.user, "-e", `DROP DATABASE IF EXISTS \`${target}\``], { env }), `drop database "${target}"`);
  }
}
