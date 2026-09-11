import { useEffect, useState } from 'react';
import { Button, TimerBar } from '../../components/ui';
import { serverNow } from '../../state/serverTime';
import type { GameViewProps } from '../../engine/types';
import {
  BET_MS,
  GIFT_MS,
  RACE_MS,
  type HrHorse,
  type HrInput,
  type HrState,
} from './definition';

/**
 * Smoothly interpolates the race against the engine's server-synced
 * deadline, so every phone draws the same positions at the same moment.
 */
function useRaceElapsed(deadline: number | null | undefined, totalMs: number): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (deadline == null) {
      setElapsed(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      setElapsed(Math.max(0, Math.min(totalMs, totalMs - (deadline - serverNow()))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deadline, totalMs]);
  return elapsed;
}

function fmt(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Racing silks: the one thing that reliably tells runners apart on a track. */
function Silk({ horse, small }: { horse: HrHorse; small?: boolean }) {
  return (
    <span className={`hr-silk ${small ? 'hr-silk-sm' : ''}`} style={{ background: horse.silk }}>
      {horse.n}
    </span>
  );
}

function Track({
  state,
  players,
  deadline,
  myBet,
}: {
  state: HrState;
  players: GameViewProps<HrState, HrInput>['players'];
  deadline: number | null;
  myBet: string | undefined;
}) {
  const elapsed = useRaceElapsed(deadline, RACE_MS);
  const horses = state.horses ?? [];
  const bets = state.bets ?? {};
  const running = horses.map((horse) => ({
    horse,
    p: Math.max(0, Math.min(1, elapsed / horse.timeMs)),
  }));

  const place: Record<string, number> = {};
  [...running]
    .sort((a, b) => b.p - a.p || a.horse.timeMs - b.horse.timeMs)
    .forEach((x, i) => {
      place[x.horse.id] = i + 1;
    });

  return (
    <div className="hr-track">
      {running.map(({ horse, p }) => (
        <div key={horse.id} className={`hr-lane ${horse.id === myBet ? 'hr-lane-mine' : ''}`}>
          <span className="hr-lane-tag">
            <b className="hr-lane-place">{place[horse.id]}</b>
            <Silk horse={horse} small />
            <span className="hr-lane-name">{horse.name}</span>
            <span className="hr-lane-backers">
              {players
                .filter((x) => bets[x.uid] === horse.id)
                .map((x) => x.emoji)
                .join('')}
            </span>
          </span>
          <span className="hr-road">
            <span className="hr-racer" style={{ left: `${4 + p * 88}%`, background: horse.silk }}>
              {horse.n}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function View({
  state,
  me,
  players,
  variant,
  timerEndsAt,
  submitInput,
}: GameViewProps<HrState, HrInput>) {
  const horses = state.horses ?? [];
  const bets = state.bets ?? {};
  const gifts = state.gifts ?? {};
  const myBet = bets[me.uid];
  const backersOf = (horseId: string) => players.filter((p) => bets[p.uid] === horseId);
  const nameOf = (uid: string) => players.find((p) => p.uid === uid)?.name ?? '?';

  /* ---------- place your bet ---------- */
  if (state.phase === 'betting') {
    const betCount = Object.keys(bets).length;
    const myHorse = horses.find((h) => h.id === myBet);
    return (
      <div className="gv">
        <span className="pr-rule-badge">🏇 PLACE YOUR BET</span>
        <div className="hr-field">
          {horses.map((horse) => {
            const backers = backersOf(horse.id);
            const mine = myBet === horse.id;
            return (
              <button
                key={horse.id}
                className={`hr-card ${mine ? 'hr-card-mine' : ''}`}
                disabled={!!myBet}
                onClick={() => submitInput({ action: 'bet', horseId: horse.id })}
              >
                <Silk horse={horse} />
                <span className="hr-name">🐎 {horse.name}</span>
                <span className="hr-backers">{backers.map((p) => p.emoji).join('')}</span>
              </button>
            );
          })}
        </div>
        {myBet ? (
          <p className="muted">
            🔒 your money's on {myHorse?.name} ({betCount}/{players.length} bets in)
          </p>
        ) : (
          <p className="muted">tap a horse to back it</p>
        )}
        <TimerBar deadline={timerEndsAt} totalMs={BET_MS} />
      </div>
    );
  }

  /* ---------- the race ---------- */
  if (state.phase === 'racing') {
    return (
      <div className="gv">
        <span className="pr-rule-badge">🏁 AND THEY'RE OFF</span>
        <Track state={state} players={players} deadline={timerEndsAt} myBet={myBet} />
        <p className="muted small">worst-placed pick drinks 3 · next-worst drinks 1</p>
      </div>
    );
  }

  /* ---------- the winners pay out ---------- */
  if (state.phase === 'gifting') {
    const winnerHorse = horses.find((h) => h.id === state.winnerHorseId);
    const gifters = winnerHorse ? backersOf(winnerHorse.id) : [];
    const iGift = gifters.some((p) => p.uid === me.uid);
    const myGift = gifts[me.uid];
    const handedOut = Object.keys(gifts).length;

    return (
      <div className="gv">
        <span className="pr-rule-badge">🎁 THE WINNERS PAY OUT</span>
        <div className="gate-emoji">🎁</div>
        <h2>{state.note}</h2>
        {iGift ? (
          myGift ? (
            <p className="muted">
              you gave it to {nameOf(myGift)} — waiting ({handedOut}/{gifters.length})
            </p>
          ) : (
            <>
              <p className="pick-call">You backed the winner — who drinks?</p>
              <div className="pick-people">
                {players
                  .filter((p) => p.uid !== me.uid)
                  .map((p) => (
                    <button
                      key={p.uid}
                      className="pick-person"
                      onClick={() => submitInput({ action: 'gift', uid: p.uid })}
                    >
                      <span className="pick-person-emoji">{p.emoji}</span> {p.name}
                    </button>
                  ))}
              </div>
              <p className="muted small">
                {handedOut}/{gifters.length} handed out
              </p>
            </>
          )
        ) : (
          <p className="muted">
            {gifters.map((p) => p.name).join(' & ')} {gifters.length > 1 ? 'are' : 'is'} choosing who
            drinks…
          </p>
        )}
        {variant === 'shared' && !iGift && (
          <Button variant="ghost" size="lg" full onClick={() => submitInput({ action: 'wait' })}>
            PASS IT ON ➡️
          </Button>
        )}
        <TimerBar deadline={timerEndsAt} totalMs={GIFT_MS} />
      </div>
    );
  }

  /* ---------- the finish ---------- */
  const order = state.order ?? [];
  const assignments = state.assignments ?? [];
  const penalties = state.penalties ?? {};
  const autoBets = Object.keys(state.auto ?? {});

  return (
    <div className="gv">
      <span className="pr-rule-badge">🏁 FINISH</span>
      <h2>{state.note}</h2>
      <div className="hr-results">
        {order.map((horseId, i) => {
          const horse = horses.find((h) => h.id === horseId);
          if (!horse) return null;
          const backers = backersOf(horse.id);
          const penalty = penalties[horse.id];
          return (
            <div
              key={horse.id}
              className={`hr-row ${i === 0 ? 'hr-row-win' : ''} ${penalty ? 'hr-row-lose' : ''}`}
            >
              <span className="hr-row-place">{['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`}</span>
              <Silk horse={horse} small />
              <span className="hr-row-who">
                {horse.name}
                <span className="hr-row-backers">
                  {backers.length > 0 ? backers.map((p) => p.emoji).join('') : '—'}
                </span>
              </span>
              {penalty && <span className="hr-row-sips">🍺{penalty}</span>}
              <span className="hr-row-time">{fmt(horse.timeMs)}</span>
            </div>
          );
        })}
      </div>
      {assignments.length > 0 && (
        <div className="hr-drinks">
          {assignments.map((a) => (
            <p key={`${a.uid}-${a.reason}`} className="hr-drink">
              🍺 <b>{nameOf(a.uid)}</b> ×{a.sips} <span className="muted">— {a.reason}</span>
            </p>
          ))}
        </div>
      )}
      {autoBets.length > 0 && (
        <p className="muted small">
          🤖 the house bet for {autoBets.map(nameOf).join(', ')}
        </p>
      )}
    </div>
  );
}
