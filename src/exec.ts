import { spawn } from "child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

export class ExecError extends Error {
  constructor(
    message: string,
    public readonly result: ExecResult,
  ) {
    super(message);
    this.name = "ExecError";
  }
}

export function spawnWithTimeout(
  cmd: string,
  args: string[],
  timeoutMs: number,
  opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const result: ExecResult = { stdout, stderr, code, timedOut };
      if (timedOut) {
        reject(new ExecError(`Command ${cmd} timed out after ${timeoutMs}ms`, result));
        return;
      }
      if (code !== 0) {
        reject(new ExecError(`Command ${cmd} exited with code ${code}: ${stderr.trim()}`, result));
        return;
      }
      resolve(result);
    });
  });
}

export async function which(cmd: string, timeoutMs = 1000): Promise<string | null> {
  try {
    const r = await spawnWithTimeout("/usr/bin/env", ["which", cmd], timeoutMs);
    const path = r.stdout.trim().split("\n")[0];
    return path || null;
  } catch {
    return null;
  }
}
