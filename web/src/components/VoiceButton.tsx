import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "./icons.ts";
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
  const toast = useToast();

  useEffect(() => {
    setSupported(!!getSpeechRecognition());
  }, []);

  const handleTap = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }

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
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  };

  if (!supported) return null;

  const cls = ["keybar-btn", "keybar-btn-voice", isRecording ? "is-recording" : ""]
    .filter(Boolean)
    .join(" ");

  const ariaLabel = isRecording ? "Stop recording" : "Start voice input";

  return (
    <button
      type="button"
      className={cls}
      title={ariaLabel}
      aria-label={ariaLabel}
      aria-pressed={isRecording}
      onClick={handleTap}
    >
      {isRecording ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
    </button>
  );
}
