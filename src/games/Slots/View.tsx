import { useEffect, useReducer, useState } from 'react';
import { TimerBar, useCountdown } from '../../components/ui';
import { Confetti } from '../../components/fx';
import type { GameViewProps, PlayerInfo } from '../../engine/types';
import { serverNow } from '../../state/serverTime';
import {
  HOLD_MS,
  REEL_STOP_MS,
  REEL_TEASE_MS,
  SYMBOLS,
  isTease,
  type SlotsInput,
  type SlotsState,
  type SpinResult,
} from './definition';

/** when each reel of this spin lands, in ms after the pull */
function stopsFor(spin: SpinResult): number[] {
  const reels = spin.reels ?? [];
  return [REEL_STOP_MS[0], REEL_STOP_MS[1], isTease(reels) ? REEL_TEASE_MS : REEL_STOP_MS[2]];
}

/** how many reels of this spin have landed by now (3 = the result is readable) */
function landedCount(spin: SpinResult | undefined, now: number): number {
  if (!spin) return 0;
  if (spin.spunAt == null) return 3; // a spin from an older build: just show it
  const elapsed = now - spin.spunAt;
  return stopsFor(spin).filter((ms) => elapsed >= ms).length;
}

function Reel({ sym, spinning, index, tease }: { sym: number; spinning: boolean; index: number; tease: boolean }) {
  return (
    <div
      className={`reel ${spinning ? 'reel-spinning' : ''} ${!spinning && sym >= 0 ? 'reel-landed' : ''} ${
        tease ? 'reel-tease' : ''
      }`}
    >
      {spinning ? (
        <div className="reel-strip" style={{ animationDelay: `${index * -0.13}s` }}>
          {[...SYMBOLS, ...SYMBOLS].map((s, i) => (
            <span key={i}>{s}</span>
          ))}
        </div>
      ) : (
        <span className="reel-final">{sym >= 0 ? SYMBOLS[sym] : '❔'}</span>
      )}
    </div>
  );
}

function Machine({
  spin,
  landed,
  pulled,
  canPull,
  onPull,
}: {
  spin: SpinResult | undefined;
  landed: number;
  pulled: boolean;
  canPull: boolean;
  onPull: () => void;
}) {
  const reels = spin?.reels ?? [-1, -1, -1];
  const rolling = pulled && landed < 3;
  const settled = !!spin && landed >= 3;
  const tone = !settled ? '' : spin.sips === 0 ? 'slots-win' : spin.sips >= 5 ? 'slots-doom' : 'slots-lose';
  // two reels down and they match: the third one is the whole show
  const tease = !!spin && landed === 2 && isTease(reels);
  return (
    <div className={`slots-machine ${tone} ${rolling ? 'slots-rolling' : ''}`}>
      <div className="slots-cabinet">
        <div className="slots-marquee">
          <span className="slots-bulbs" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </span>
          <span className="slots-brand">SLOT-O-MATIC</span>
          <span className="slots-bulbs" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <i key={i} style={{ animationDelay: `${(7 - i) * 0.12}s` }} />
            ))}
          </span>
        </div>
        <div className="slots-reels">
          {reels.map((s, i) => (
            <Reel key={i} sym={s} spinning={pulled && i >= landed} index={i} tease={tease && i === 2} />
          ))}
          <span className="slots-payline" aria-hidden="true" />
        </div>
        <div className="slots-pays">
          <span>💀💀💀 finish</span>
          <span>pair 2</span>
          <span>miss 1</span>
          <span>triple safe</span>
        </div>
      </div>
      <button
        type="button"
        className={`slots-arm ${pulled ? 'slots-arm-down' : ''}`}
        onClick={onPull}
        disabled={!canPull}
        aria-label="pull the lever"
      >
        <span className="slots-arm-knob" />
        <span className="slots-arm-rod" />
      </button>
    </div>
  );
}

/** everybody else's machine, one line each */
function Floor({
  players,
  spins,
  meUid,
  now,
}: {
  players: PlayerInfo[];
  spins: Record<string, SpinResult>;
  meUid: string;
  now: number;
}) {
  const rest = players.filter((p) => p.uid !== meUid);
  if (rest.length === 0) return null;
  return (
    <div className="slots-floor">
      <p className="fx-kicker">the rest of the floor</p>
      {rest.map((p) => {
        const sp = spins[p.uid];
        const landed = landedCount(sp, now);
        const done = !!sp && landed >= 3;
        return (
          <div
            key={p.uid}
            className={`slots-seat ${done ? (sp.sips > 0 ? 'slots-seat-bad' : 'slots-seat-ok') : ''}`}
          >
            <span className="slots-seat-who">
              {p.emoji} {p.name}
            </span>
            <span className="slots-seat-reels">
              {sp
                ? (sp.reels ?? []).map((s, i) => (
                    <b key={i} className={i < landed ? '' : 'slots-seat-blur'}>
                      {i < landed ? SYMBOLS[s] : '🎰'}
                    </b>
                  ))
                : '· · ·'}
            </span>
            <span className="slots-seat-pay">
              {!sp ? 'hasn’t pulled' : !done ? 'spinning…' : sp.sips > 0 ? `🍺 ×${sp.sips}` : '✅ safe'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function View({
  state,
  me,
  players,
  actorUid,
  variant,
  timerEndsAt,
  submitInput,
}: GameViewProps<SlotsState, SlotsInput>) {
  const spins = state.spins ?? {};
  const mine = spins[me.uid];
  const holding = state.phase === 'hold';
  const shared = variant === 'shared';
  const actor = players.find((p) => p.uid === actorUid);
  const myTurn = !shared || me.uid === actorUid;

  // the lever goes down the instant it is pulled; the reels come from the host
  const [pulledLocal, setPulledLocal] = useState(false);
  useEffect(() => setPulledLocal(false), [me.uid, state.startedAt]);

  // redraw while any reel anywhere is still turning
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const now = serverNow();
  const anyRolling = pulledLocal && !mine ? true : Object.values(spins).some((sp) => landedCount(sp, now) < 3);
  useEffect(() => {
    if (!anyRolling) return;
    const iv = window.setInterval(tick, 80);
    return () => window.clearInterval(iv);
  }, [anyRolling]);

  const landed = landedCount(mine, now);
  const settled = !!mine && landed >= 3;
  const pulled = pulledLocal || !!mine;
  const canPull = !pulled && !holding && myTurn;
  const left = useCountdown(timerEndsAt);

  const pull = () => {
    if (!canPull) return;
    setPulledLocal(true);
    navigator.vibrate?.(40);
    submitInput({ action: 'spin' });
  };

  const tease = !!mine && landed === 2 && isTease(mine.reels ?? []);

  return (
    <div className="gv slots">
      <Machine spin={mine} landed={landed} pulled={pulled} canPull={canPull} onPull={pull} />

      {settled && mine.sips === 0 && <Confetti emojis={['🪙', '✨', '🎰', '🍒', '💰']} />}
      {settled && mine.sips >= 5 && <Confetti emojis={['💀', '🍺', '☠️']} count={18} />}

      <div className="slots-readout">
        {settled ? (
          <>
            <h2 key="line" className="slots-line fx-pop">
              {mine.line}
            </h2>
            <p className={`slots-pay fx-rise ${mine.sips > 0 ? 'slots-owe' : 'slots-safe'}`}>
              {mine.sips > 0
                ? `🍺 ${mine.sips} sip${mine.sips === 1 ? '' : 's'} — that’s you`
                : '✅ safe — nothing to drink'}
            </p>
          </>
        ) : pulled ? (
          <h2 className={`slots-line ${tease ? 'slots-line-tease fx-pulse' : ''}`}>
            {tease ? 'ooooh… one more!' : 'rolling…'}
          </h2>
        ) : holding ? (
          <p className="slots-no-spin">you never pulled the lever — no result this round</p>
        ) : !myTurn ? (
          <p className="muted">only {actor?.name ?? 'the actor'} spins this round</p>
        ) : (
          <button className="btn btn-gold btn-lg btn-full slots-lever fx-pulse" onClick={pull}>
            PULL THE LEVER 🎰
          </button>
        )}
      </div>

      {holding ? (
        <>
          <TimerBar deadline={timerEndsAt} totalMs={HOLD_MS} />
          <p className="slots-hold-note">
            reels held so everyone can read them{left != null ? ` — ${Math.ceil(left / 1000)}s` : ''}
          </p>
        </>
      ) : (
        variant === 'party' && (
          <p className="muted small">
            {Object.keys(spins).length}/{players.length} pulled
            {left != null ? ` · ${Math.ceil(left / 1000)}s` : ''}
          </p>
        )
      )}

      {!shared && <Floor players={players} spins={spins} meUid={me.uid} now={now} />}
    </div>
  );
}
