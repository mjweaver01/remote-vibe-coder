import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff } from "./icons.ts";
import { useToast } from "../hooks/useToast.ts";
import { transcribe, loadTranscriber, type LoadProgress } from "../lib/whisper.ts";

type State =
  | { kind: "idle" }
  | { kind: "loading"; progress: number }
  | { kind: "recording"; startedAt: number }
  | { kind: "transcribing" };

interface Props {
  /** Called with the transcribed text when recording stops & transcription completes. */
  onText(text: string): void;
}

export function VoiceButton({ onText }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [hasMic, setHasMic] = useState(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const toast = useToast();

  useEffect(() => {
    setHasMic(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const handleTap = async () => {
    if (state.kind === "recording") {
      stopRecording();
      return;
    }
    if (state.kind !== "idle") return; // already loading/transcribing
    await startRecording();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Kick off model load in parallel — usually fast on second use.
      void loadTranscriber((p: LoadProgress) => {
        if (
          state.kind === "loading" &&
          typeof p.loaded === "number" &&
          typeof p.total === "number" &&
          p.total > 0
        ) {
          setState({ kind: "loading", progress: Math.min(1, p.loaded / p.total) });
        }
      }).catch(() => {
        // Errors surface when we actually try to transcribe.
      });

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        void runTranscription(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setState({ kind: "recording", startedAt: Date.now() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not access microphone";
      toast.push("error", msg);
      setState({ kind: "idle" });
    }
  };

  const stopRecording = () => {
    setState({ kind: "transcribing" });
    recorderRef.current?.stop();
    recorderRef.current = null;
  };

  const runTranscription = async (blob: Blob) => {
    try {
      const text = await transcribe(blob, (p) => {
        if (typeof p.loaded === "number" && typeof p.total === "number" && p.total > 0) {
          setState({ kind: "loading", progress: Math.min(1, p.loaded / p.total) });
        }
      });
      if (text) onText(text);
      else toast.push("info", "No speech detected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transcription failed";
      toast.push("error", msg);
    } finally {
      setState({ kind: "idle" });
    }
  };

  if (!hasMic) return null;

  const isRecording = state.kind === "recording";
  const isBusy = state.kind === "loading" || state.kind === "transcribing";

  const cls = [
    "keybar-btn",
    "keybar-btn-voice",
    isRecording ? "is-recording" : "",
    isBusy ? "is-busy" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const ariaLabel = isRecording ? "Stop recording" : isBusy ? "Transcribing" : "Start voice input";

  return (
    <button
      type="button"
      className={cls}
      title={ariaLabel}
      aria-label={ariaLabel}
      aria-pressed={isRecording}
      disabled={isBusy}
      onClick={handleTap}
    >
      {isBusy ? (
        <Loader2 size={14} className="spin" aria-hidden="true" />
      ) : isRecording ? (
        <MicOff size={14} aria-hidden="true" />
      ) : (
        <Mic size={14} aria-hidden="true" />
      )}
    </button>
  );
}
