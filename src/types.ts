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
  /**
   * True when Claude has gone idle waiting for user input (the same edge that
   * fires a push notification). Cleared when any viewer attaches to the
   * session or sends input. Drives the "unread" dot in active session lists.
   */
  awaitingInput?: boolean;
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
  | { type: "kill"; sessionId: string }
  /**
   * Kill the current PTY for `sessionId` and immediately spawn a fresh one
   * against the same conversation, but only after the JSONL has been stable
   * for a short window. Used when another `claude` (e.g. VS Code's) has been
   * appending to the same conversation and the user wants to sync the view.
   */
  | { type: "reload"; sessionId: string; cols: number; rows: number };

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
