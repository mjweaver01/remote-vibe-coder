import { randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export function tokensMatch(expected: string | null, provided: string | null): boolean {
  if (!expected) return true;
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
