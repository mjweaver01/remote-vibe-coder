import { useEffect, useRef, useState } from "react";
import { Mic } from "./icons.ts";
import { useToast } from "../hooks/useToast.ts";

interface Props {
  onText(text: string): void;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface ISpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
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
    // iOS routes the mic to the system speech service when SpeechRecognition is
    // active. Holding our own MediaStream in parallel causes a "service-not-allowed"
    // error from the recognizer. Fall back to the CSS pulse animation there.
    const ua = navigator.userAgent;
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (isIOS) return;
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

  const warmedUpRef = useRef(false);
  const wantRecordingRef = useRef(false);

  const warmupMicPermission = async () => {
    // iOS Safari's webkitSpeechRecognition routes through Siri's dictation service
    // and never triggers its own mic-permission prompt. Without an explicit
    // getUserMedia call first, start() returns "service-not-allowed" with no UI.
    if (warmedUpRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      warmedUpRef.current = true;
    } catch {
      // User denied or no mic — let start() fail naturally and surface its error.
    }
  };

  const spawnRecognition = (SR: SpeechRecognitionCtor) => {
    const recognition = new SR();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (ev) => {
      const results = ev.results;
      for (let i = ev.resultIndex; i < results.length; i++) {
        const r = results[i];
        if (!r?.isFinal) continue;
        const text = r[0]?.transcript?.trim() ?? "";
        if (text) onText(text + " ");
      }
    };

    recognition.onerror = (ev) => {
      if (ev.error === "no-speech" || ev.error === "aborted") return;
      toast.push("error", `Speech error: ${ev.error}`);
    };

    recognition.onend = () => {
      // Recognizer auto-stops after silence. Restart while the user has it on.
      // start() must be deferred — calling it synchronously inside onend throws
      // InvalidStateError because the previous session hasn't finished tearing down.
      if (wantRecordingRef.current) {
        const SR2 = getSpeechRecognition();
        if (SR2) {
          const next = spawnRecognition(SR2);
          recognitionRef.current = next;
          window.setTimeout(() => {
            if (recognitionRef.current !== next || !wantRecordingRef.current) return;
            try {
              next.start();
            } catch {
              wantRecordingRef.current = false;
              recognitionRef.current = null;
              setIsRecording(false);
              stopLevelMonitor();
            }
          }, 150);
          return;
        }
      }
      setIsRecording(false);
      recognitionRef.current = null;
      stopLevelMonitor();
    };

    return recognition;
  };

  const startRecording = async () => {
    if (isRecording) return;

    const SR = getSpeechRecognition();
    if (!SR) return;

    await warmupMicPermission();

    wantRecordingRef.current = true;
    const recognition = spawnRecognition(SR);
    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
    void startLevelMonitor();
  };

  const stopRecording = () => {
    wantRecordingRef.current = false;
    const rec = recognitionRef.current;
    if (!rec) return;
    recognitionRef.current = null;
    setIsRecording(false);
    stopLevelMonitor();
    try {
      rec.stop();
    } catch {
      try {
        rec.abort();
      } catch {}
    }
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
      title={isRecording ? "Click to stop" : "Click to speak"}
      aria-label={isRecording ? "Click to stop" : "Click to speak"}
      aria-pressed={isRecording}
      onClick={() => (isRecording ? stopRecording() : startRecording())}
    >
      <Mic size={14} aria-hidden="true" />
    </button>
  );
}
