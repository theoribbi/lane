import type { Runner } from "./runner.js";
import type { DbManifest } from "./types.js";

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
    await runner.run("docker", ["exec", db.container, "createdb", "-U", db.user, target], { env });
    const dump = await runner.run("docker", ["exec", db.container, "pg_dump", "-U", db.user, "-Fc", db.source], { env });
    await runner.run("docker", ["exec", "-i", db.container, "pg_restore", "-U", db.user, "-d", target], { input: dump.stdout, env });
  } else {
    await runner.run("docker", ["exec", db.container, "mysql", "-u", db.user, "-e", `CREATE DATABASE \`${target}\``], { env });
    const dump = await runner.run("docker", ["exec", db.container, "mysqldump", "-u", db.user, db.source], { env });
    await runner.run("docker", ["exec", "-i", db.container, "mysql", "-u", db.user, target], { input: dump.stdout, env });
  }
}

export async function dropDb(runner: Runner, db: DbManifest, target: string): Promise<void> {
  if (db.engine === "none") return;
  requireDrop(db);
  const env = { PGPASSWORD: db.password ?? "", MYSQL_PWD: db.password ?? "" };
  if (db.engine === "postgres") {
    await runner.run("docker", ["exec", db.container, "psql", "-U", db.user, "-d", "postgres", "-c", `DROP DATABASE IF EXISTS "${target}" WITH (FORCE)`], { env });
  } else {
    await runner.run("docker", ["exec", db.container, "mysql", "-u", db.user, "-e", `DROP DATABASE IF EXISTS \`${target}\``], { env });
  }
}
