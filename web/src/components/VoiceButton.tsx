import { useEffect, useRef, useState } from "react";
import { Mic } from "./icons.ts";
import { useToast } from "../hooks/useToast.ts";

interface Props {
  onText(text: string): void;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface ISpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => ISpeechRecognition;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  return (
    (window as unknown as Record<string, SpeechRecognitionCtor>)["SpeechRecognition"] ??
    (window as unknown as Record<string, SpeechRecognitionCtor>)["webkitSpeechRecognition"] ??
    null
  );
}

export function VoiceButton({ onText }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const toast = useToast();

  useEffect(() => {
    setSupported(!!getSpeechRecognition());
  }, []);

  const stopLevelMonitor = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    buttonRef.current?.style.setProperty("--vol", "0");
    buttonRef.current?.classList.remove("has-vol");
  };

  const startLevelMonitor = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      buttonRef.current?.classList.add("has-vol");
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i]! - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        // Speech RMS is typically 0.05–0.25; scale into [0, 1] with a cap.
        const norm = Math.min(1, rms * 4);
        buttonRef.current?.style.setProperty("--vol", norm.toFixed(3));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Permission denied or no mic — the speech recognizer still works, just
      // without volume feedback. Keep the keyframe pulse as a fallback.
    }
  };

  const startRecording = () => {
    if (isRecording) return;

    const SR = getSpeechRecognition();
    if (!SR) return;

    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (ev) => {
      const text = ev.results[0]?.[0]?.transcript?.trim() ?? "";
      if (text) onText(text);
      else toast.push("info", "No speech detected");
    };

    recognition.onerror = (ev) => {
      if (ev.error !== "aborted") toast.push("error", `Speech error: ${ev.error}`);
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
      stopLevelMonitor();
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    void startLevelMonitor();
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
  };

  // Tear down on unmount in case the user navigates away mid-recording.
  useEffect(() => stopLevelMonitor, []);

  if (!supported) return null;

  const cls = ["keybar-btn", "keybar-btn-voice", isRecording ? "is-recording" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={buttonRef}
      type="button"
      className={cls}
      title={isRecording ? "Release to send" : "Hold to speak"}
      aria-label={isRecording ? "Release to send" : "Hold to speak"}
      aria-pressed={isRecording}
      onPointerDown={startRecording}
      onPointerUp={stopRecording}
      onPointerCancel={stopRecording}
      onPointerLeave={stopRecording}
      style={{ touchAction: "none" }}
    >
      <Mic size={14} aria-hidden="true" />
    </button>
  );
}
