import { createHash } from "node:crypto";

export function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function sha256String(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
