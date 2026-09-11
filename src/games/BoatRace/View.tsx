import { useEffect, useState } from 'react';
import { Button, TimerBar } from '../../components/ui';
import { serverNow } from '../../state/serverTime';
import type { GameViewProps } from '../../engine/types';
import { RACE_MS, SET_SAIL_MS, type BrInput, type BrState } from './definition';

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

function Track({
  state,
  players,
  deadline,
}: {
  state: BrState;
  players: GameViewProps<BrState, BrInput>['players'];
  deadline: number | null;
}) {
  const elapsed = useRaceElapsed(deadline, RACE_MS);
  const legs = state.legs ?? [];
  const running = legs.map((leg) => ({ leg, p: Math.max(0, Math.min(1, elapsed / leg.timeMs)) }));

  const place: Record<string, number> = {};
  [...running]
    .sort((a, b) => b.p - a.p || a.leg.timeMs - b.leg.timeMs)
    .forEach((x, i) => {
      place[x.leg.uid] = i + 1;
    });

  return (
    <div className="br-track">
      {running.map(({ leg, p }) => {
        const player = players.find((x) => x.uid === leg.uid);
        if (!player) return null;
        return (
          <div key={leg.uid} className="br-lane">
            <span className="br-lane-tag">
              <b>{place[leg.uid]}</b> {leg.vessel} {leg.vesselName}
              {leg.handicap ? ' 🍺' : ''}
            </span>
            <span className="br-road">
              <span className="br-racer" style={{ left: `${4 + p * 88}%` }}>
                {player.emoji}
              </span>
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
  timerEndsAt,
  submitInput,
}: GameViewProps<BrState, BrInput>) {
  const legs = state.legs ?? [];

  /* ---------- the starting line ---------- */
  if (state.phase === 'mounting') {
    const sailed = state.sailed ?? {};
    const sailedCount = Object.keys(sailed).length;
    const locked = !!sailed[me.uid];
    return (
      <div className="gv">
        <span className="pr-rule-badge">🏁 AT THE STARTING LINE</span>
        <div className="br-paddock">
          {legs.map((leg) => {
            const player = players.find((p) => p.uid === leg.uid);
            if (!player) return null;
            return (
              <div key={leg.uid} className={`br-mount ${leg.uid === me.uid ? 'br-mount-me' : ''}`}>
                <span className="br-vessel">{leg.vessel}</span>
                <span className="br-mount-who">
                  {player.emoji} {player.name}
                </span>
                <span className="br-vessel-name">
                  {leg.vesselName}
                  {leg.handicap ? ' 🍺' : ''}
                </span>
                {!!sailed[leg.uid] && <span className="br-ready">✅</span>}
              </div>
            );
          })}
        </div>
        {locked ? (
          <p className="muted">
            🔒 you're in — waiting for the others ({sailedCount}/{legs.length})
          </p>
        ) : (
          <Button variant="gold" size="lg" full onClick={() => submitInput({ action: 'sail' })}>
            SET SAIL ⛵
          </Button>
        )}
        {legs.some((l) => l.handicap) && (
          <p className="muted small">🍺 whoever has drunk the most starts a length behind</p>
        )}
        <TimerBar deadline={timerEndsAt} totalMs={SET_SAIL_MS} />
      </div>
    );
  }

  /* ---------- the race ---------- */
  if (state.phase === 'racing') {
    return (
      <div className="gv">
        <span className="pr-rule-badge">🌊 AND THEY'RE OFF</span>
        <Track state={state} players={players} deadline={timerEndsAt} />
        <p className="muted small">first past the post wins — last two drink 🍺</p>
      </div>
    );
  }

  /* ---------- the finish ---------- */
  const order = state.order ?? [];
  const assignments = state.assignments ?? [];
  const nameOf = (uid: string) => players.find((p) => p.uid === uid)?.name ?? '?';
  return (
    <div className="gv">
      <span className="pr-rule-badge">🏁 FINISH</span>
      <div className={`gate-emoji ${order[0] === me.uid ? 'pulse' : ''}`}>
        {order[0] === me.uid ? '🏆' : '⛵'}
      </div>
      <h2>{state.note}</h2>
      <div className="br-results">
        {order.map((uid, i) => {
          const leg = legs.find((l) => l.uid === uid);
          const player = players.find((p) => p.uid === uid);
          if (!leg || !player) return null;
          const mine = assignments.find((a) => a.uid === uid);
          return (
            <div
              key={uid}
              className={`br-result-row ${i === 0 ? 'br-result-win' : ''} ${mine ? 'br-result-bad' : ''}`}
            >
              <span className="br-result-place">{['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`}</span>
              <span className="br-result-who">
                {leg.vessel} {player.emoji} {player.name}
              </span>
              <span className="br-result-time">{fmt(leg.timeMs)}</span>
              {mine && <span className="br-result-sips">🍺{mine.sips}</span>}
            </div>
          );
        })}
      </div>
      {assignments.length > 0 && (
        <p className="cat-pool">
          {assignments.map((a) => `🍺 ${nameOf(a.uid)} ×${a.sips}`).join(' · ')}
        </p>
      )}
    </div>
  );
}
