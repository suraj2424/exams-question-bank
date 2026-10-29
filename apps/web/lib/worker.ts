import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export function findWorkerCli(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "apps", "worker", "src", "cli.ts");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function workerRoot(): string | null {
  const cli = findWorkerCli();
  if (!cli) return null;
  return resolve(cli, "..", "..", "..", "..");
}

export function storageRoot(): string {
  const root = workerRoot() ?? process.cwd();
  const configured = process.env.STORAGE_PATH;
  if (!configured) return join(root, "storage");
  return isAbsolute(configured) ? configured : resolve(root, configured);
}

export function absoluteStoragePath(relativePath: string | null | undefined): string | null {
  if (!relativePath) return null;
  return resolve(storageRoot(), relativePath);
}

export function runWorker(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const cli = findWorkerCli();
    if (!cli) {
      done({ code: 1, stdout: "", stderr: "worker CLI not found" });
      return;
    }
    const child = spawn("bun", ["run", cli, ...args], {
      cwd: workerRoot() ?? process.cwd(),
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => done({ code: 1, stdout, stderr: String(err) }));
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

export function runWorkerDetached(args: string[]): { started: boolean; error?: string } {
  const cli = findWorkerCli();
  if (!cli) return { started: false, error: "worker CLI not found" };
  try {
    const child = spawn("bun", ["run", cli, ...args], {
      cwd: workerRoot() ?? process.cwd(),
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { started: true };
  } catch (err) {
    return { started: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function parseJsonOutput(stdout: string): unknown {
  const start = stdout.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return null;
  }
}
