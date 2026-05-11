import type { ReactNode } from "react";
import { ArrowUp, CornerDownLeft, RotateCcw, Skull } from "./icons.ts";

export type KeySend = (data: string) => void;

interface Props {
  onSend: KeySend;
  voiceSlot?: ReactNode;
}

export function Keybar({ onSend, voiceSlot }: Props) {
  return (
    <div className="keybar keybar-mobile" role="toolbar" aria-label="Terminal keys">
      {/* Left — answer diamond: 1 top · 2 left · 3 right · mic bottom */}
      <div className="gb-diamond">
        <button
          className="gb-diamond-btn gb-btn-yes"
          onClick={() => onSend("1")}
          title="Yes (1)"
          aria-label="Yes (1)"
        >
          <span className="gb-diamond-num">1</span>
          <span className="gb-diamond-cap">yes</span>
        </button>
        <button
          className="gb-diamond-btn gb-btn-no"
          onClick={() => onSend("2")}
          title="No (2)"
          aria-label="No (2)"
        >
          <span className="gb-diamond-num">2</span>
          <span className="gb-diamond-cap">no</span>
        </button>
        <div className="gb-diamond-hub" aria-hidden="true" />
        <button
          className="gb-diamond-btn gb-btn-other"
          onClick={() => onSend("3")}
          title="Other (3)"
          aria-label="Other (3)"
        >
          <span className="gb-diamond-num">3</span>
          <span className="gb-diamond-cap">other</span>
        </button>
        <div className="gb-diamond-mic">{voiceSlot}</div>
      </div>

      {/* Right — d-pad cross: Up top · Tab left · Kill right · Clear bottom */}
      <div className="gb-dpad">
        <button
          className="gb-dpad-btn gb-dpad-up"
          onClick={() => onSend("\x1b[A")}
          title="Up"
          aria-label="Up"
        >
          <ArrowUp size={16} aria-hidden="true" />
        </button>
        <button
          className="gb-dpad-btn gb-dpad-tab"
          onClick={() => onSend("\t")}
          title="Tab"
          aria-label="Tab"
        >
          Tab
        </button>
        <div className="gb-dpad-hub" aria-hidden="true" />
        <button
          className="gb-dpad-btn gb-dpad-kill"
          onClick={() => onSend("\x03")}
          title="Ctrl+C"
          aria-label="Ctrl+C"
        >
          <Skull size={14} aria-hidden="true" />
        </button>
        <button
          className="gb-dpad-btn gb-dpad-clr"
          onClick={() => onSend("\x15")}
          title="Clear input (Ctrl+U)"
          aria-label="Clear input"
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      </div>

      {/* Bottom — Esc + Enter spanning both columns */}
      <div className="gb-actions">
        <button
          className="gb-action-btn gb-action-esc"
          onClick={() => onSend("\x1b")}
          title="Escape"
          aria-label="Escape"
        >
          Esc
        </button>
        <button
          className="gb-action-btn gb-action-enter"
          onClick={() => onSend("\r")}
          title="Enter"
          aria-label="Enter"
        >
          <CornerDownLeft size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
