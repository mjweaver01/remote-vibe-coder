import { useEffect, useRef, useState } from "react";
import { useOutletContext, useParams } from "react-router";
import { Keybar } from "../components/Keybar.tsx";
import { VoiceButton } from "../components/VoiceButton.tsx";
import { XTerm, type XTermHandle } from "../components/XTerm.tsx";
import { useToast } from "../hooks/useToast.ts";
import { useWs } from "../hooks/useWs.ts";
import type { SessionInfo, ServerMessage } from "../../../src/types.ts";

interface OutletCtx {
  session: SessionInfo;
}

export function SessionTerminal() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const { session } = useOutletContext<OutletCtx>();
  const ws = useWs();
  const toast = useToast();

  const [replayBanner, setReplayBanner] = useState(false);
  const termRef = useRef<XTermHandle | null>(null);
  const kbdTrapRef = useRef<HTMLInputElement | null>(null);
  const joinedRef = useRef(false);

  // Pipe terminal events into the websocket
  const handleData = (data: string) => ws.send({ type: "input", sessionId, data });
  const handleResize = (cols: number, rows: number) =>
    ws.send({ type: "resize", sessionId, cols, rows });

  // Subscribe to messages targeting this session
  useEffect(() => {
    const off = ws.onMessage((m: ServerMessage) => {
      if ("sessionId" in m && m.sessionId !== sessionId) return;
      switch (m.type) {
        case "attached":
          if (m.replay) {
            termRef.current?.write(m.replay);
            setReplayBanner(true);
            window.setTimeout(() => setReplayBanner(false), 1800);
          }
          break;
        case "output":
          termRef.current?.write(m.data);
          break;
        case "ended":
          termRef.current?.writeln("");
          termRef.current?.writeln(`\x1b[33m[session ended — exit ${m.exitCode}]\x1b[0m`);
          break;
        case "error":
          toast.push("error", m.message);
          break;
      }
    });
    return off;
  }, [ws, sessionId, toast]);

  // Join the session once on mount, detach on unmount
  useEffect(() => {
    if (joinedRef.current) return;
    joinedRef.current = true;
    // Use the size we already know about — XTerm will refit shortly after.
    ws.send({
      type: "join",
      sessionId,
      cols: session.cols || 80,
      rows: session.rows || 24,
    });
    return () => {
      ws.send({ type: "detach", sessionId });
      joinedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Wire the soft-keyboard trap input
  useEffect(() => {
    const trap = kbdTrapRef.current;
    if (!trap) return;
    const onInput = () => {
      if (trap.value) {
        ws.send({ type: "input", sessionId, data: trap.value });
        trap.value = "";
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ws.send({ type: "input", sessionId, data: "\r" });
      } else if (e.key === "Backspace" && !trap.value) {
        ws.send({ type: "input", sessionId, data: "\x7f" });
      }
    };
    trap.addEventListener("input", onInput);
    trap.addEventListener("keydown", onKey);
    return () => {
      trap.removeEventListener("input", onInput);
      trap.removeEventListener("keydown", onKey);
    };
  }, [ws, sessionId]);

  const sendKey = (data: string) => ws.send({ type: "input", sessionId, data });
  const sendVoiceText = (text: string) => ws.send({ type: "input", sessionId, data: text });

  return (
    <section className="tab-pane tab-pane-terminal">
      <div
        className="term-host-wrapper"
        onPointerDown={(e) => {
          // Route mobile/touch input to the trap so the OS keyboard's dictation
          // commits land in a real <input> (xterm's textarea drops them).
          if (e.pointerType === "touch") {
            queueMicrotask(() => kbdTrapRef.current?.focus());
          }
        }}
      >
        <XTerm ref={termRef} onData={handleData} onResize={handleResize} />
        {replayBanner && (
          <div className="term-replay-banner" role="status" aria-live="polite">
            <span className="term-replay-dot" aria-hidden="true" />
            Joined session — replay loaded
          </div>
        )}
      </div>
      <Keybar
        onSend={sendKey}
        voiceSlot={<VoiceButton onText={sendVoiceText} />}
      />
      <input
        ref={kbdTrapRef}
        className="kbd-trap"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-hidden="true"
      />
    </section>
  );
}
