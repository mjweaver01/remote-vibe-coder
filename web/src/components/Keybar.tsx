import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CornerDownLeft,
  Keyboard,
  Skull,
} from './icons.ts';

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
  variant?: 'yes' | 'no' | 'other';
  title: string;
}

const KEYS: KeyDef[] = [
  { id: '1', label: '1', data: '1', variant: 'yes', title: 'Yes (1)' },
  { id: '2', label: '2', data: '2', variant: 'no', title: 'No (2)' },
  { id: '3', label: '3', data: '3', variant: 'other', title: 'Other (3)' },
  { id: 'enter', icon: CornerDownLeft, data: '\r', title: 'Enter' },
  { id: 'esc', label: 'Esc', data: '\x1b', title: 'Escape' },
  { id: 'tab', label: 'Tab', data: '\t', title: 'Tab' },
  { id: 'up', icon: ArrowUp, data: '\x1b[A', title: 'Up' },
  { id: 'down', icon: ArrowDown, data: '\x1b[B', title: 'Down' },
  { id: 'left', icon: ArrowLeft, data: '\x1b[D', title: 'Left' },
  { id: 'right', icon: ArrowRight, data: '\x1b[C', title: 'Right' },
  { id: 'ctrlc', icon: Skull, data: '\x03', title: 'Ctrl+C' },
];

export function Keybar({ onSend, onSummonKeyboard, voiceSlot }: Props) {
  return (
    <div className="keybar" role="toolbar" aria-label="Terminal keys">
      {KEYS.map((k) => {
        const cls = ['keybar-btn'];
        if (k.variant) cls.push(`keybar-btn-${k.variant}`);
        return (
          <button
            key={k.id}
            type="button"
            className={cls.join(' ')}
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
  );
}
