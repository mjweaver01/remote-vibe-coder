// Web Push: VAPID keys, subscription store, and a send() helper.
// Notifications fire when Claude appears to be waiting for input.
//
// Storage lives under ~/.rvc/ — keys in `vapid.json`, subscriptions in
// `push-subscriptions.json`. Keys are generated once on first run.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Optional label so users can see "iPhone" vs "Mac Safari" in the future. */
  ua?: string;
  createdAt: number;
}

export interface PushPayload {
  title: string;
  body: string;
  /** URL to open when the user taps the notification. */
  url?: string;
  sessionId?: string;
  tag?: string;
}

const RVC_DIR = join(homedir(), ".rvc");
const KEYS_FILE = join(RVC_DIR, "vapid.json");
const SUBS_FILE = join(RVC_DIR, "push-subscriptions.json");

export class PushService {
  private publicKey: string | null = null;
  private subs = new Map<string, PushSubscriptionRecord>();
  private subject: string;
  private loaded = false;

  constructor(subject = "mailto:rvc@localhost") {
    this.subject = subject;
  }

  /** Load (or generate) VAPID keys + load subscriptions. */
  async init(): Promise<void> {
    if (this.loaded) return;
    await mkdir(RVC_DIR, { recursive: true });

    let keys: { publicKey: string; privateKey: string };
    if (existsSync(KEYS_FILE)) {
      keys = JSON.parse(await readFile(KEYS_FILE, "utf8"));
    } else {
      keys = webpush.generateVAPIDKeys();
      await writeFile(KEYS_FILE, JSON.stringify(keys, null, 2), { mode: 0o600 });
    }
    this.publicKey = keys.publicKey;
    webpush.setVapidDetails(this.subject, keys.publicKey, keys.privateKey);

    if (existsSync(SUBS_FILE)) {
      try {
        const list: PushSubscriptionRecord[] = JSON.parse(await readFile(SUBS_FILE, "utf8"));
        for (const s of list) this.subs.set(s.endpoint, s);
      } catch {
        // corrupt file — start fresh
      }
    }
    this.loaded = true;
  }

  getPublicKey(): string {
    if (!this.publicKey) throw new Error("PushService not initialized");
    return this.publicKey;
  }

  async subscribe(sub: WebPushSubscription, ua?: string): Promise<void> {
    const record: PushSubscriptionRecord = {
      endpoint: sub.endpoint,
      keys: sub.keys,
      ua,
      createdAt: Date.now(),
    };
    this.subs.set(record.endpoint, record);
    await this.persist();
  }

  async unsubscribe(endpoint: string): Promise<void> {
    if (this.subs.delete(endpoint)) await this.persist();
  }

  hasSubscribers(): boolean {
    return this.subs.size > 0;
  }

  /** Fan out to all subscribers; drop dead endpoints (404/410). */
  async send(payload: PushPayload): Promise<void> {
    const debug = !!process.env.RVC_DEBUG;
    if (this.subs.size === 0) {
      if (debug) console.log(`[push] send skipped (no subscribers) tag=${payload.tag}`);
      return;
    }
    if (debug)
      console.log(
        `[push] send tag=${payload.tag} subs=${this.subs.size} title=${JSON.stringify(payload.title)}`
      );
    const body = JSON.stringify(payload);
    const dead: string[] = [];
    await Promise.all(
      [...this.subs.values()].map(async (rec) => {
        try {
          await webpush.sendNotification({ endpoint: rec.endpoint, keys: rec.keys }, body, {
            TTL: 60,
          });
          if (debug) console.log(`[push]   ok endpoint=${rec.endpoint.slice(0, 60)}…`);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (debug)
            console.log(
              `[push]   FAIL status=${status} endpoint=${rec.endpoint.slice(0, 60)}… err=${(err as Error).message}`
            );
          if (status === 404 || status === 410) dead.push(rec.endpoint);
        }
      })
    );
    if (dead.length > 0) {
      for (const e of dead) this.subs.delete(e);
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    const list = [...this.subs.values()];
    await writeFile(SUBS_FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
  }
}
