import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUp, CornerDownLeft, Keyboard, Skull } from "./icons.ts";

export type KeySend = (data: string) => void;

interface Props {
  onSend: KeySend;
  onSummonKeyboard(): void;
  voiceSlot?: ReactNode;
}

interface KeyDef {
  id: string;
  label?: string;
  icon?: LucideIcon;
  data?: string;
  variant?: "yes" | "no" | "other";
  title: string;
}

const KEYS: KeyDef[] = [
  { id: "1", label: "1", data: "1", variant: "yes", title: "Yes (1)" },
  { id: "2", label: "2", data: "2", variant: "no", title: "No (2)" },
  { id: "3", label: "3", data: "3", variant: "other", title: "Other (3)" },
  { id: "enter", icon: CornerDownLeft, data: "\r", title: "Enter" },
  { id: "esc", label: "Esc", data: "\x1b", title: "Escape" },
  { id: "tab", label: "Tab", data: "\t", title: "Tab" },
  { id: "up", icon: ArrowUp, data: "\x1b[A", title: "Up" },
  { id: "ctrlc", icon: Skull, data: "\x03", title: "Ctrl+C" },
];

export function Keybar({ onSend, onSummonKeyboard, voiceSlot }: Props) {
  return (
    <>
      {/* ── Desktop: horizontal scroll strip ───────────────────── */}
      <div className="keybar keybar-desktop" role="toolbar" aria-label="Terminal keys">
        {KEYS.map((k) => {
          const cls = ["keybar-btn"];
          if (k.variant) cls.push(`keybar-btn-${k.variant}`);
          return (
            <button
              key={k.id}
              type="button"
              className={cls.join(" ")}
              title={k.title}
              aria-label={k.title}
              onClick={() => k.data && onSend(k.data)}
            >
              {k.icon ? <k.icon size={14} aria-hidden="true" /> : null}
              {k.label ? <span>{k.label}</span> : null}
            </button>
          );
        })}
        {voiceSlot}
        <button
          type="button"
          className="keybar-btn"
          title="Open soft keyboard"
          aria-label="Open soft keyboard"
          onClick={onSummonKeyboard}
        >
          <Keyboard size={14} aria-hidden="true" />
        </button>
      </div>

      {/* ── Mobile: gameboy layout ──────────────────────────────── */}
      <div className="keybar keybar-mobile" role="toolbar" aria-label="Terminal keys">
        {/* Far left — Up arrow */}
        <button className="gb-up" onClick={() => onSend("\x1b[A")} title="Up" aria-label="Up">
          <ArrowUp size={22} aria-hidden="true" />
        </button>

        {/* Centre — answer diamond: 1 top · 2 left · 3 right · Enter bottom */}
        <div className="gb-diamond">
          <button
            className="gb-diamond-btn gb-btn-yes"
            onClick={() => onSend("1")}
            title="Yes (1)"
            aria-label="Yes (1)"
          >
            1
          </button>
          <button
            className="gb-diamond-btn gb-btn-no"
            onClick={() => onSend("2")}
            title="No (2)"
            aria-label="No (2)"
          >
            2
          </button>
          <div className="gb-diamond-hub" aria-hidden="true" />
          <button
            className="gb-diamond-btn gb-btn-other"
            onClick={() => onSend("3")}
            title="Other (3)"
            aria-label="Other (3)"
          >
            3
          </button>
          <button
            className="gb-diamond-btn gb-btn-enter"
            onClick={() => onSend("\r")}
            title="Enter"
            aria-label="Enter"
          >
            <CornerDownLeft size={19} aria-hidden="true" />
          </button>
        </div>

        {/* Right — secondary controls */}
        <div className="gb-secondary">
          <button
            className="gb-sec-btn"
            onClick={() => onSend("\x1b")}
            title="Escape"
            aria-label="Escape"
          >
            Esc
          </button>
          <button className="gb-sec-btn" onClick={() => onSend("\t")} title="Tab" aria-label="Tab">
            Tab
          </button>
          {voiceSlot}
          <button
            className="gb-sec-btn"
            onClick={onSummonKeyboard}
            title="Open soft keyboard"
            aria-label="Open soft keyboard"
          >
            <Keyboard size={14} aria-hidden="true" />
          </button>
          <button
            className={`gb-sec-btn gb-sec-kill${voiceSlot ? " gb-sec-span" : ""}`}
            onClick={() => onSend("\x03")}
            title="Ctrl+C"
            aria-label="Ctrl+C"
          >
            <Skull size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  );
}
