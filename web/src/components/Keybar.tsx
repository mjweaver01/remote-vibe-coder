import type { ReactNode } from "react";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CornerDownLeft,
  RotateCcw,
  Skull,
} from "./icons.ts";

export type KeySend = (data: string) => void;

const SLASH_COMMANDS = ["/btw", "/clear", "/compact", "/context", "/model", "/plan"] as const;

interface Props {
  onSend: KeySend;
  onKill?: () => void;
  voiceSlot?: ReactNode;
}

export function Keybar({ onSend, onKill, voiceSlot }: Props) {
  return (
    <div className="keybar keybar-mobile" role="toolbar" aria-label="Terminal keys">
      {/* Left — directional d-pad: ↑ top · ← left · → right · ↓ bottom */}
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
          className="gb-dpad-btn gb-dpad-left"
          onClick={() => onSend("\x1b[D")}
          title="Left"
          aria-label="Left"
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div className="gb-dpad-hub" aria-hidden="true" />
        <button
          className="gb-dpad-btn gb-dpad-right"
          onClick={() => onSend("\x1b[C")}
          title="Right"
          aria-label="Right"
        >
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button
          className="gb-dpad-btn gb-dpad-down"
          onClick={() => onSend("\x1b[B")}
          title="Down"
          aria-label="Down"
        >
          <ArrowDown size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Common slash commands — tablet+ only, injects text without submitting */}
      <div className="gb-commands" aria-label="Common commands">
        {SLASH_COMMANDS.map((cmd) => (
          <button
            key={cmd}
            className="gb-cmd-btn"
            onClick={() => onSend(`${cmd} `)}
            title={`Insert ${cmd}`}
            aria-label={`Insert ${cmd}`}
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Right — numeric diamond: 1 top · 2 left · 3 right · 4 bottom */}
      <div className="gb-diamond">
        <button
          className="gb-diamond-btn gb-btn-1"
          onClick={() => onSend("1")}
          title="Option 1"
          aria-label="Option 1"
        >
          <span className="gb-diamond-num">1</span>
        </button>
        <button
          className="gb-diamond-btn gb-btn-2"
          onClick={() => onSend("2")}
          title="Option 2"
          aria-label="Option 2"
        >
          <span className="gb-diamond-num">2</span>
        </button>
        <div className="gb-diamond-hub" aria-hidden="true" />
        <button
          className="gb-diamond-btn gb-btn-3"
          onClick={() => onSend("3")}
          title="Option 3"
          aria-label="Option 3"
        >
          <span className="gb-diamond-num">3</span>
        </button>
        <button
          className="gb-diamond-btn gb-btn-4"
          onClick={() => onSend("4")}
          title="Option 4"
          aria-label="Option 4"
        >
          <span className="gb-diamond-num">4</span>
        </button>
      </div>

      {/* Utility row — Tab · Clear · Kill */}
      <div className="gb-utility">
        <button
          className="gb-util-btn"
          onClick={() => onSend("\t")}
          title="Tab"
          aria-label="Tab"
        >
          Tab
        </button>
        <button
          className="gb-util-btn"
          onClick={() => onSend("\x15")}
          title="Clear input (Ctrl+U)"
          aria-label="Clear input"
        >
          <RotateCcw size={14} aria-hidden="true" />
        </button>
        <button
          className="gb-util-btn gb-util-kill"
          onClick={onKill}
          disabled={!onKill}
          title="Kill session"
          aria-label="Kill session"
        >
          <Skull size={14} aria-hidden="true" />
        </button>
      </div>

      {/* Actions row — Esc · Mic · Enter */}
      <div className="gb-actions">
        <button
          className="gb-action-btn gb-action-esc"
          onClick={() => onSend("\x1b")}
          title="Escape"
          aria-label="Escape"
        >
          Esc
        </button>
        <div className="gb-action-mic">{voiceSlot}</div>
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
