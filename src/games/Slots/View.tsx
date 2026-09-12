import { useEffect, useState } from 'react';
import { TimerBar, useCountdown } from '../../components/ui';
import type { GameViewProps } from '../../engine/types';
import { HOLD_MS, SYMBOLS, type SlotsInput, type SlotsState, type SpinResult } from './definition';

function Reel({ sym, spinning, index }: { sym: number; spinning: boolean; index: number }) {
  return (
    <div className={`reel ${spinning ? 'reel-spinning' : ''} ${!spinning && sym >= 0 ? 'reel-landed' : ''}`}>
      {spinning ? (
        <div className="reel-strip" style={{ animationDelay: `${index * 0.13}s` }}>
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

function Machine({ spin, spinning }: { spin: SpinResult | undefined; spinning: boolean }) {
  const reels = spin?.reels ?? [-1, -1, -1];
  return (
    <div className={`slots-cabinet ${spin && !spinning && spin.sips === 0 ? 'slots-win' : ''}`}>
      <div className="slots-reels">
        {reels.map((s, i) => (
          <Reel key={i} sym={s} spinning={spinning} index={i} />
        ))}
      </div>
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
  const canSpin = !mine;
  /** the levers are closed and the reels are sitting still for inspection */
  const holding = state.phase === 'hold';

  // short local animation while the result lands
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    if (!spinning) return;
    const t = window.setTimeout(() => setSpinning(false), 1200);
    return () => window.clearTimeout(t);
  }, [spinning]);

  const others = players.filter((p) => p.uid !== me.uid && spins[p.uid]);
  const left = useCountdown(timerEndsAt);
  const actor = players.find((p) => p.uid === actorUid);
  const shared = variant === 'shared';

  /* ---------- hold: nothing is moving, this is your result ---------- */
  if (holding) {
    return (
      <div className="gv">
        <Machine spin={mine} spinning={spinning} />

        {mine ? (
          <>
            <h2 className="slots-line slots-line-pop">{mine.line}</h2>
            <p className={mine.sips > 0 ? 'slots-owe' : 'slots-safe'}>
              {mine.sips > 0
                ? `🍺 ${mine.sips} SIP${mine.sips === 1 ? '' : 'S'} — that's you`
                : '✅ safe — nothing to drink'}
            </p>
          </>
        ) : (
          <p className="slots-no-spin">you never pulled the lever — no result this round</p>
        )}

        <TimerBar deadline={timerEndsAt} totalMs={HOLD_MS} />
        <p className="slots-hold-note">
          reels held so you can read them{left != null ? ` — ${Math.ceil(left / 1000)}s` : ''}
        </p>

        {others.length > 0 && (
          <div className="tr-verdicts">
            {others.map((p) => (
              <span key={p.uid} className={`tr-verdict ${spins[p.uid].sips > 0 ? 'tr-bad' : 'tr-ok'}`}>
                {p.emoji} {p.name}: {spins[p.uid].line}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ---------- spin window ---------- */
  return (
    <div className="gv">
      <Machine spin={mine} spinning={spinning} />

      {canSpin ? (
        shared && me.uid !== actorUid ? (
          <p className="muted">only {actor?.name ?? 'the actor'} spins this round</p>
        ) : (
          <button
            className="btn btn-gold btn-lg btn-full slots-lever"
            onClick={() => {
              setSpinning(true);
              submitInput({ action: 'spin' });
            }}
          >
            SPIN 🎰
          </button>
        )
      ) : (
        <>
          <h2 className={`slots-line ${spinning ? '' : 'slots-line-pop'}`}>
            {spinning ? '…' : mine.line}
          </h2>
          <p className="slots-hold-note">
            {others.length > 0 || players.length === 1
              ? 'your reels hold still when the round closes'
              : "waiting on the rest of the table — the reels hold once everyone's in"}
          </p>
        </>
      )}

      {shared && actor && (
        <p className="muted">
          {actor.uid === me.uid ? 'Your spin!' : `${actor.emoji} ${actor.name} spun`}
        </p>
      )}

      {variant === 'party' && (
        <p className="muted small">
          {Object.keys(spins).length}/{players.length} spun
          {left != null ? ` · ${Math.ceil(left / 1000)}s` : ''}
        </p>
      )}

      {others.length > 0 && (
        <div className="tr-verdicts">
          {others.map((p) => (
            <span key={p.uid} className={`tr-verdict ${spins[p.uid].sips > 0 ? 'tr-bad' : 'tr-ok'}`}>
              {p.emoji} {p.name}: {spins[p.uid].line}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
