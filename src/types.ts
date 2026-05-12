// Wire types shared between server and web client.

export interface FolderEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface SessionInfo {
  id: string;
  cwd: string;
  cwdLabel: string;
  createdAt: number;
  cols: number;
  rows: number;
  viewers: number;
  /** First user message of the bound Claude Code conversation, if known. */
  title?: string;
  /** Bound Claude Code conversation id, if known. */
  conversationId?: string;
  /**
   * True when the conversation JSONL has grown from outside this PTY (e.g.
   * another `claude` process is appending to the same conversation). The
   * terminal here can't show those changes until the session is reloaded.
   */
  externallyUpdated?: boolean;
}

export type CreateMode =
  | { kind: "new" }
  | { kind: "continue" }
  | { kind: "resume"; conversationId: string };

export type ClientMessage =
  | { type: "list" }
  | { type: "create"; cwd: string; cols: number; rows: number; mode?: CreateMode }
  | { type: "join"; sessionId: string; cols: number; rows: number }
  | { type: "detach"; sessionId: string }
  | { type: "input"; sessionId: string; data: string }
  | { type: "resize"; sessionId: string; cols: number; rows: number }
  | { type: "kill"; sessionId: string };

export interface PastSessionInfo {
  id: string;
  preview: string;
  mtime: number;
  sizeBytes: number;
}

export type ServerMessage =
  | { type: "sessions"; sessions: SessionInfo[] }
  | { type: "created"; session: SessionInfo }
  | { type: "attached"; sessionId: string; replay: string }
  | { type: "output"; sessionId: string; data: string }
  | { type: "ended"; sessionId: string; exitCode: number }
  | { type: "error"; message: string };
