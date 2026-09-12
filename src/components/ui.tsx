import {
  useEffect,
  useReducer,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { EMOJI_CHOICES } from '../types';
import { serverNow } from '../state/serverTime';
import type { PlayerInfo } from '../engine/types';

/* ---------- countdown ---------- */

/** Live ms-remaining for a server-time deadline; re-renders ~10x/s. */
export function useCountdown(deadline?: number | null): number | null {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (deadline == null) return;
    const iv = window.setInterval(tick, 100);
    return () => window.clearInterval(iv);
  }, [deadline]);
  return deadline == null ? null : Math.max(0, deadline - serverNow());
}

export function TimerBar({
  deadline,
  totalMs,
}: {
  deadline: number | null | undefined;
  totalMs: number;
}) {
  const left = useCountdown(deadline);
  if (left == null) return null;
  const pct = Math.max(0, Math.min(100, (left / totalMs) * 100));
  return (
    <div className="timerbar" role="timer">
      <div className="timerbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---------- buttons ---------- */

type ButtonVariant = 'primary' | 'gold' | 'ghost' | 'danger' | 'claim';

export function Button({
  variant = 'primary',
  size = 'md',
  full,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  full?: boolean;
}) {
  return (
    <button
      className={`btn btn-${variant} btn-${size} ${full ? 'btn-full' : ''} ${className}`}
      {...rest}
    />
  );
}

/* ---------- player chips ---------- */

export function PlayerChip({
  player,
  drinks,
  crown,
  muted,
  note,
  badge,
  onClick,
}: {
  player: PlayerInfo;
  drinks?: number;
  crown?: boolean;
  muted?: boolean;
  /** short suffix, e.g. "phone off" — used instead of greying a player out */
  note?: string;
  badge?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className={`chip ${muted ? 'chip-muted' : ''} ${onClick ? 'chip-click' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <span className="chip-emoji">{player.emoji}</span>
      <span className="chip-name">{player.name}</span>
      {crown && <span className="chip-crown" title="host">👑</span>}
      {note && <span className="chip-note">({note})</span>}
      {badge}
      {drinks != null && drinks > 0 && <span className="chip-drinks">🍺{drinks}</span>}
    </div>
  );
}

/* ---------- modal ---------- */

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-x" onClick={onClose} aria-label="close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- name + emoji form (create / join / add player) ---------- */

export function PlayerForm({
  initialName = '',
  initialEmoji = '',
  submitLabel,
  onSubmit,
  busy = false,
}: {
  initialName?: string;
  initialEmoji?: string;
  submitLabel: string;
  onSubmit: (name: string, emoji: string) => void;
  busy?: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState(initialEmoji || EMOJI_CHOICES[0]);
  const valid = name.trim().length >= 1;

  return (
    <form
      className="pform"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) onSubmit(name.trim(), emoji);
      }}
    >
      <input
        className="input name-input"
        placeholder="Your name"
        value={name}
        maxLength={20}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <div className="emoji-grid">
        {EMOJI_CHOICES.map((e) => (
          <button
            type="button"
            key={e}
            className={`emoji-cell ${emoji === e ? 'emoji-cell-on' : ''}`}
            onClick={() => setEmoji(e)}
          >
            {e}
          </button>
        ))}
      </div>
      <Button type="submit" variant="gold" size="lg" full disabled={!valid || busy}>
        {busy ? '…' : submitLabel}
      </Button>
    </form>
  );
}

/* ---------- misc ---------- */

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="toast">{text}</div>;
}
