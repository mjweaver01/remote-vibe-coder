import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "./icons.ts";
import { useToast } from "../hooks/useToast.ts";

interface Props {
  onText(text: string): void;
}

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

function getSpeechRecognition(): typeof SpeechRecognition | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function VoiceButton({ onText }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
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
