import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "packages", "db"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function rootEnv(): Record<string, string> {
  const file = join(repoRoot(), ".env");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    out[key] = value;
  }
  return out;
}

const shared = rootEnv();
if (!process.env.STORAGE_PATH && shared.STORAGE_PATH) {
  process.env.STORAGE_PATH = shared.STORAGE_PATH;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@qb/db", "@qb/shared"],
};
export default nextConfig;
