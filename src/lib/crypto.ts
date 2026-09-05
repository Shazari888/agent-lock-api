import { createHash, randomBytes } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function createApiKeyMaterial() {
  const raw = `alk_${randomBytes(24).toString("hex")}`;
  const hash = sha256(raw);
  const prefix = raw.slice(0, 12);
  return { raw, hash, prefix };
}

