import { useEffect, useState } from 'react';
import { Button, TimerBar } from '../../components/ui';
import { serverNow } from '../../state/serverTime';
import type { GameViewProps } from '../../engine/types';
import {
  BASE_MS,
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

/** The field is held at the gate for this long before the tape goes up. */
const GATE_MS = 900;
/** How long the starter's call stays over the track. */
const CALL_MS = 420;
/**
 * How far a runner drifts off an even pace — a visual jostle for position.
 * The surge is zero at the gate and at the line, so crossing times (and the
 * finishing order the engine computes) never move.
 */
const SURGE = 0.02;
/** Where the run starts, and how much ground it covers, as a % of the lane. */
const START_PCT = 7;
const SPAN_PCT = 83;
/**
 * The ground rolls under the field so speed still reads on a narrow phone.
 * GROUND_TILE must match the stripe period of `.hr-ground` in styles.css.
 */
const GROUND_PX_PER_S = 42;
const GROUND_TILE = 26;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function fmt(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Racing silks: the one thing that reliably tells runners apart on a track. */
function Silk({ horse, small }: { horse: HrHorse; small?: boolean }) {
  return (
    <span
      className={`hr-silk ${small ? 'hr-silk-sm' : ''}`}
      style={{ backgroundColor: horse.silk }}
    >
      {horse.n}
    </span>
  );
}

/** The colour rail every card and row wears down its left edge. */
function SilkRail({ horse }: { horse: HrHorse }) {
  return (
    <span
      className="hr-rail"
      aria-hidden="true"
      style={{ background: horse.silk, boxShadow: `0 0 12px ${horse.silk}` }}
    />
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

  const running = horses.map((horse) => {
    // the gate holds the field, then every runner covers its own finishing time,
    // so a horse still reaches the line exactly when its `timeMs` says it does
    const run = clamp01((elapsed - GATE_MS) / Math.max(1, horse.timeMs - GATE_MS));
    const surge = SURGE * Math.sin(2 * Math.PI * (1 + (horse.n % 3)) * run);
    // ground rolls at this runner's own pace, and stops the moment they're home
    const rolled = Math.min(Math.max(0, elapsed - GATE_MS), Math.max(0, horse.timeMs - GATE_MS));
    return {
      horse,
      p: clamp01(run + surge),
      home: run >= 1,
      ground: -(((rolled / 1000) * GROUND_PX_PER_S * (BASE_MS / horse.timeMs)) % GROUND_TILE),
      backers: players.filter((x) => bets[x.uid] === horse.id),
    };
  });

  const ranked = [...running].sort((a, b) => b.p - a.p || a.horse.timeMs - b.horse.timeMs);
  const place: Record<string, number> = {};
  ranked.forEach((x, i) => {
    place[x.horse.id] = i + 1;
  });

  const off = elapsed >= GATE_MS;
  const leaderId = off && ranked.length > 0 ? ranked[0].horse.id : null;
  const allHome = running.length > 0 && running.every((x) => x.home);
  const call = elapsed < GATE_MS ? 'ON YOUR MARKS' : elapsed < GATE_MS + CALL_MS ? 'GO!' : null;

  return (
    <div className="hr-trackwrap">
      <span className="hr-track-head">
        <span>🏇 the field</span>
        <span className="hr-track-flag">🏁 finish</span>
      </span>
      <div className={`hr-track ${off ? 'hr-track-off' : ''} ${allHome ? 'hr-track-done' : ''}`}>
        {running.map(({ horse, p, home, ground, backers }) => {
          const lead = horse.id === leaderId;
          return (
            <div key={horse.id} className={`hr-lane ${horse.id === myBet ? 'hr-lane-mine' : ''}`}>
              <span className="hr-lane-tag">
                <b className="hr-lane-place">{place[horse.id]}</b>
                <Silk horse={horse} small />
                <span className="hr-lane-name">{horse.name}</span>
                <span className="hr-lane-backers">{backers.map((x) => x.emoji).join('')}</span>
              </span>
              <span className="hr-road">
                <span className="hr-ground" style={{ backgroundPosition: `${ground}px 0` }} />
                <span
                  className={`hr-racer ${lead ? 'hr-racer-lead' : ''} ${home ? 'hr-racer-home' : ''}`}
                  style={{
                    left: `${START_PCT + p * SPAN_PCT}%`,
                    backgroundColor: horse.silk,
                    color: horse.silk,
                    animationDuration: `${0.34 + (horse.n % 4) * 0.04}s`,
                    animationDelay: `-${(horse.n * 0.11).toFixed(2)}s`,
                  }}
                >
                  <span className="hr-racer-n">{horse.n}</span>
                  {lead && <span className="hr-racer-crown">👑</span>}
                </span>
              </span>
            </div>
          );
        })}
        {call && (
          <span key={call} className={`hr-call ${call === 'GO!' ? 'hr-call-go' : ''}`}>
            {call}
          </span>
        )}
        {allHome && <span className="hr-call hr-call-done">🏁 FINISH!</span>}
      </div>
      <p className="muted small hr-note">worst-placed pick drinks 3 · next-worst drinks 1</p>
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
          {horses.map((horse, i) => {
            const backers = backersOf(horse.id);
            const mine = myBet === horse.id;
            return (
              <button
                key={horse.id}
                className={`hr-card ${mine ? 'hr-card-mine' : ''} ${myBet && !mine ? 'hr-card-dim' : ''}`}
                style={{ animationDelay: `${i * 0.045}s` }}
                disabled={!!myBet}
                onClick={() => submitInput({ action: 'bet', horseId: horse.id })}
              >
                <SilkRail horse={horse} />
                <Silk horse={horse} />
                <span className="hr-name">🐎 {horse.name}</span>
                <span className="hr-backers">{backers.map((p) => p.emoji).join('')}</span>
                {mine && <span className="hr-pick">your pick</span>}
              </button>
            );
          })}
        </div>
        <div className="hr-hint">
          <p className="muted small">
            {myBet
              ? `🔒 your money's on ${myHorse?.name} — ${betCount}/${players.length} bets in`
              : 'tap a horse to back it'}
          </p>
          <span className="hr-progress">
            <span
              className="hr-progress-fill"
              style={{ width: `${players.length > 0 ? (betCount / players.length) * 100 : 0}%` }}
            />
          </span>
        </div>
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
    const giftedTo = new Set(Object.values(gifts));

    return (
      <div className="gv">
        <span className="pr-rule-badge">🎁 THE WINNERS PAY OUT</span>
        {winnerHorse && (
          <div className="hr-winner">
            <Silk horse={winnerHorse} />
            <span className="hr-winner-text">
              <span className="hr-winner-name">🏆 {winnerHorse.name}</span>
              <span className="hr-winner-sub">
                backed by {gifters.map((p) => p.emoji).join(' ') || 'nobody'}
              </span>
            </span>
          </div>
        )}
        {state.note && <p className="muted small hr-note">{state.note}</p>}
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
                      className={`pick-person ${giftedTo.has(p.uid) ? 'pick-person-got' : ''}`}
                      onClick={() => submitInput({ action: 'gift', uid: p.uid })}
                    >
                      <span className="pick-person-emoji">{p.emoji}</span> {p.name}
                      {giftedTo.has(p.uid) && <span className="pick-person-flag">🍺</span>}
                    </button>
                  ))}
              </div>
              <span className="hr-progress">
                <span
                  className="hr-progress-fill"
                  style={{
                    width: `${gifters.length > 0 ? (handedOut / gifters.length) * 100 : 0}%`,
                  }}
                />
              </span>
              <p className="muted small">{handedOut}/{gifters.length} handed out</p>
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
  const podium = ['hr-row-win', 'hr-row-second', 'hr-row-third'];

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
              className={`hr-row ${podium[i] ?? ''} ${penalty ? 'hr-row-lose' : ''}`}
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <SilkRail horse={horse} />
              <span className="hr-row-place">{['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`}</span>
              <Silk horse={horse} small />
              <span className="hr-row-who">
                <span className="hr-row-name">{horse.name}</span>
                <span className="hr-row-backers">
                  {backers.length > 0 ? backers.map((p) => p.emoji).join('') : '—'}
                </span>
                {horse.id === myBet && <span className="hr-row-chip">your pick</span>}
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
            <p
              key={`${a.uid}-${a.reason}`}
              className={`hr-drink ${a.uid === me.uid ? 'hr-drink-me' : ''}`}
            >
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
