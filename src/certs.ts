// Self-signed cert management for HTTPS dev / LAN access.
// Certs are cached in ~/.config/remote-vibe-coder/certs/ and regenerated
// when the LAN IP set changes (so they remain valid for the current network).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import selfsigned from "selfsigned";

export interface CertPair {
  cert: string;
  key: string;
  /** True if a new cert was generated this call (worth telling the user). */
  generated: boolean;
}

const CACHE_DIR = join(homedir(), ".config", "remote-vibe-coder", "certs");
const CERT_FILE = join(CACHE_DIR, "cert.pem");
const KEY_FILE = join(CACHE_DIR, "key.pem");
const META_FILE = join(CACHE_DIR, "meta.json");

interface Meta {
  hosts: string[];
  generatedAt: number;
}

function lanIps(): string[] {
  const out: string[] = [];
  const ifs = networkInterfaces();
  for (const list of Object.values(ifs)) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}

function expectedHosts(): string[] {
  return ["localhost", "127.0.0.1", "::1", ...lanIps()];
}

/** Load cached cert/key, or generate a fresh self-signed pair if missing or stale. */
export async function ensureSelfSignedCert(): Promise<CertPair> {
  const hosts = expectedHosts();
  await mkdir(CACHE_DIR, { recursive: true });

  if (existsSync(CERT_FILE) && existsSync(KEY_FILE) && existsSync(META_FILE)) {
    try {
      const meta = JSON.parse(await readFile(META_FILE, "utf8")) as Meta;
      // Reuse the cached cert only if every current host is still covered.
      if (hosts.every((h) => meta.hosts.includes(h))) {
        return {
          cert: await readFile(CERT_FILE, "utf8"),
          key: await readFile(KEY_FILE, "utf8"),
          generated: false,
        };
      }
    } catch {
      // fall through and regenerate
    }
  }

  const attrs = [{ name: "commonName", value: "remote-vibe-coder" }];
  const altNames = hosts.map((h) => {
    const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":");
    return isIp ? ({ type: 7 as const, ip: h }) : ({ type: 2 as const, value: h });
  });
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  const pems = await selfsigned.generate(attrs, {
    notBeforeDate: new Date(),
    notAfterDate: new Date(Date.now() + oneYearMs),
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: false },
      {
        name: "keyUsage",
        digitalSignature: true,
        keyEncipherment: true,
      },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames },
    ],
  });

  await writeFile(CERT_FILE, pems.cert, { mode: 0o600 });
  await writeFile(KEY_FILE, pems.private, { mode: 0o600 });
  await writeFile(META_FILE, JSON.stringify({ hosts, generatedAt: Date.now() } satisfies Meta));

  return { cert: pems.cert, key: pems.private, generated: true };
}

/** Read a user-supplied cert + key. */
export async function loadCertFromFiles(certPath: string, keyPath: string): Promise<CertPair> {
  const [cert, key] = await Promise.all([
    readFile(certPath, "utf8"),
    readFile(keyPath, "utf8"),
  ]);
  return { cert, key, generated: false };
}
