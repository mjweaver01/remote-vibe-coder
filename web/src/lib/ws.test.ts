import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WsClient } from "./ws.ts";

// Minimal WebSocket double we can drive from tests.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  url: string;
  sent: string[] = [];
  listeners: Record<string, Array<(ev: any) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: any) => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  emit(type: string, ev: any = {}) {
    for (const fn of this.listeners[type] ?? []) fn(ev);
  }
  fireOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }
  fireMessage(data: unknown) {
    this.emit("message", { data: typeof data === "string" ? data : JSON.stringify(data) });
  }
  fireClose() {
    this.readyState = 3;
    this.emit("close");
  }
}

const RealWS = globalThis.WebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  (globalThis as any).WebSocket = FakeWebSocket;
  // ws.ts compares socket.readyState to WebSocket.OPEN — keep the constant aligned
  (FakeWebSocket as any).OPEN = 1;
});

afterEach(() => {
  (globalThis as any).WebSocket = RealWS;
  vi.useRealTimers();
});

describe("WsClient", () => {
  it("connects on start and transitions to open", () => {
    const client = new WsClient();
    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s));
    client.start();
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0]!.fireOpen();
    expect(client.getStatus()).toBe("open");
    expect(statuses).toContain("connecting");
    expect(statuses).toContain("open");
  });

  it("dispatches parsed messages to subscribers", () => {
    const client = new WsClient();
    client.start();
    FakeWebSocket.instances[0]!.fireOpen();
    const seen: any[] = [];
    client.onMessage((m) => seen.push(m));
    FakeWebSocket.instances[0]!.fireMessage({ type: "error", message: "x" });
    expect(seen).toEqual([{ type: "error", message: "x" }]);
  });

  it("ignores invalid JSON messages", () => {
    const client = new WsClient();
    client.start();
    FakeWebSocket.instances[0]!.fireOpen();
    const seen: any[] = [];
    client.onMessage((m) => seen.push(m));
    FakeWebSocket.instances[0]!.fireMessage("not-json");
    expect(seen).toEqual([]);
  });

  it("tracks the latest session list and notifies subscribers", () => {
    const client = new WsClient();
    client.start();
    FakeWebSocket.instances[0]!.fireOpen();
    const seen: any[] = [];
    client.onSessions((s) => seen.push(s));
    FakeWebSocket.instances[0]!.fireMessage({ type: "sessions", sessions: [{ id: "a" }] });
    expect(client.getSessions()).toEqual([{ id: "a" }]);
    // Initial empty + the new one
    expect(seen[seen.length - 1]).toEqual([{ id: "a" }]);
  });

  it("only sends when the socket is open", () => {
    const client = new WsClient();
    client.start();
    client.send({ type: "list" });
    expect(FakeWebSocket.instances[0]!.sent).toHaveLength(0);
    FakeWebSocket.instances[0]!.fireOpen();
    client.send({ type: "list" });
    expect(FakeWebSocket.instances[0]!.sent).toEqual([JSON.stringify({ type: "list" })]);
  });

  it("schedules a reconnect after close and reconnects on timer", () => {
    vi.useFakeTimers();
    const client = new WsClient();
    client.start();
    FakeWebSocket.instances[0]!.fireOpen();
    FakeWebSocket.instances[0]!.fireClose();
    expect(client.getStatus()).toBe("reconnecting");
    vi.advanceTimersByTime(600);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("gives up after MAX_RETRIES and transitions to dead", () => {
    vi.useFakeTimers();
    const client = new WsClient();
    client.start();
    // Each failure schedules another, doubling the delay up to 8s.
    for (let i = 0; i < 12; i++) {
      const inst = FakeWebSocket.instances.at(-1);
      if (inst) inst.fireClose();
      vi.advanceTimersByTime(10_000);
    }
    expect(client.getStatus()).toBe("dead");
  });

  it("destroy stops reconnection and closes the socket", () => {
    vi.useFakeTimers();
    const client = new WsClient();
    client.start();
    FakeWebSocket.instances[0]!.fireOpen();
    client.destroy();
    expect(client.getStatus()).toBe("closed");
    FakeWebSocket.instances[0]!.fireClose();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("onMessage returns an unsubscribe that stops further notifications", () => {
    const client = new WsClient();
    client.start();
    FakeWebSocket.instances[0]!.fireOpen();
    const seen: any[] = [];
    const off = client.onMessage((m) => seen.push(m));
    FakeWebSocket.instances[0]!.fireMessage({ type: "error", message: "1" });
    off();
    FakeWebSocket.instances[0]!.fireMessage({ type: "error", message: "2" });
    expect(seen).toHaveLength(1);
  });
});
