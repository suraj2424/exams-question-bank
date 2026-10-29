import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config } from "./config";

export function storageRoot(): string {
  return resolve(config.storagePath || "./storage");
}

export function storagePath(...parts: string[]): string {
  return join(storageRoot(), ...parts);
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeFileRelative(relativePath: string, data: Buffer | string): string {
  const full = storagePath(relativePath);
  ensureDir(dirname(full));
  writeFileSync(full, data);
  return relativePath;
}

export function readFileRelative(relativePath: string): Buffer {
  return readFileSync(storagePath(relativePath));
}

export function fileExistsRelative(relativePath: string): boolean {
  return existsSync(storagePath(relativePath));
}
