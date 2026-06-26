import { execa } from "execa";

export interface RunResult { stdout: string; stderr: string; exitCode: number; }
export interface RunOpts { input?: string; cwd?: string; env?: Record<string, string>; }

export interface Runner {
  run(cmd: string, args: string[], opts?: RunOpts): Promise<RunResult>;
}

export class RealRunner implements Runner {
  async run(cmd: string, args: string[], opts?: RunOpts): Promise<RunResult> {
    const res = await execa(cmd, args, {
      input: opts?.input,
      cwd: opts?.cwd,
      env: opts?.env ? { ...process.env, ...opts.env } : process.env,
      reject: false,
    });
    return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", exitCode: res.exitCode ?? 0 };
  }
}

export class FakeRunner implements Runner {
  calls: Array<{ cmd: string; args: string[]; opts?: RunOpts }> = [];
  constructor(private scripted: Record<string, RunResult> = {}) {}
  async run(cmd: string, args: string[], opts?: RunOpts): Promise<RunResult> {
    this.calls.push({ cmd, args, opts });
    // match on a prefix key like "git rev-parse"
    const key = Object.keys(this.scripted).find((k) =>
      [cmd, ...args].join(" ").startsWith(k),
    );
    return key ? this.scripted[key] : { stdout: "", stderr: "", exitCode: 0 };
  }
}
