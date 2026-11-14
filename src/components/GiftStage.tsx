import { useEffect, useState } from 'react';
import type { PlayerInfo } from '../engine/types';
import { giftersWaiting, type GiftInput, type GiftStage } from '../engine/gifts';
import { Button, TimerBar, useCountdown } from './ui';
import { GIFT_MS } from '../engine/gifts';

/**
 * The hand-out stage every game shares: whoever did best taps names to deal
 * their drinks, then sends the lot as one input. Everybody else watches who
 * is deciding. Drawn by the shell in place of the game's own View while the
 * game state carries a pending hand-out (engine/gifts.ts).
 */
export function GiftStageView({
  stage,
  me,
  players,
  timerEndsAt,
  submitInput,
}: {
  stage: GiftStage;
  me: PlayerInfo;
  players: PlayerInfo[];
  timerEndsAt: number | null;
  submitInput: (input: GiftInput) => void;
}) {
  const waiting = giftersWaiting(stage);
  const mine = waiting.find((g) => g.uid === me.uid) ?? null;
  const [dealt, setDealt] = useState<string[]>([]);
  const left = useCountdown(timerEndsAt);
  // a fresh hand for whoever holds the phone
  useEffect(() => setDealt([]), [me.uid]);

  const nameOf = (uid: string) => players.find((p) => p.uid === uid)?.name ?? 'Someone';
  const others = players.filter((p) => p.uid !== me.uid);

  if (mine) {
    const remaining = mine.sips - dealt.length;
    const tally = (uid: string) => dealt.filter((d) => d === uid).length;
    const send = () => {
      const gift: Record<string, number> = {};
      for (const uid of dealt) gift[uid] = (gift[uid] ?? 0) + 1;
      submitInput({ gift });
    };
    return (
      <div className="gv gift">
        <span className="fx-tag fx-tag-green">{mine.why ?? 'You did best'}</span>
        <h2 className="fx-title">
          {mine.sips} to hand out
        </h2>
        <p className="gift-line">
          {remaining > 0 ? `${remaining} left. Tap a name for each one.` : 'All dealt. Send them.'}
        </p>
        <div className="gift-people">
          {others.map((p) => (
            <button
              key={p.uid}
              className={`pick-person ${tally(p.uid) > 0 ? 'pick-person-got' : ''}`}
              disabled={remaining <= 0}
              onClick={() => setDealt((d) => [...d, p.uid])}
            >
              <span className="pick-person-emoji">{p.emoji}</span> {p.name}
              {tally(p.uid) > 0 && <b className="gift-count">{tally(p.uid)}</b>}
            </button>
          ))}
        </div>
        <div className="gift-actions">
          <Button variant="ghost" size="md" disabled={dealt.length === 0} onClick={() => setDealt((d) => d.slice(0, -1))}>
            Undo
          </Button>
          <Button variant="gold" size="lg" full disabled={dealt.length === 0} onClick={send}>
            Hand out
          </Button>
        </div>
        <TimerBar deadline={timerEndsAt} totalMs={GIFT_MS} />
        <p className="muted small">
          {left != null ? `${Math.ceil(left / 1000)}s. ` : ''}Anything you have not dealt goes to nobody.
        </p>
      </div>
    );
  }

  return (
    <div className="gv gift">
      <span className="fx-tag">Winner's round</span>
      <h2 className="fx-title">Brace</h2>
      <div className="gift-waiting">
        {stage.givers.map((g) => {
          const done = !!stage.given?.[g.uid];
          const p = players.find((x) => x.uid === g.uid);
          return (
            <div key={g.uid} className={`gift-waiting-row ${done ? 'done' : ''}`}>
              <span className="gift-waiting-who">
                {p?.emoji} {nameOf(g.uid)}
                {g.uid === me.uid ? ' (you)' : ''}
              </span>
              <span className="gift-waiting-what">{done ? 'sent' : `choosing who gets ${g.sips}`}</span>
            </div>
          );
        })}
      </div>
      <TimerBar deadline={timerEndsAt} totalMs={GIFT_MS} />
    </div>
  );
}
