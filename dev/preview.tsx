/**
 * ============================================================
 *  Dev-only game preview — no Firebase, no room
 * ============================================================
 * Runs one game's real reducer in memory and renders its real View once per
 * player, so a game can be played and looked at without a room:
 *
 *   npm run dev   →   /Slot-O-Clock/dev/preview.html?game=slots&n=4
 *
 * Query: game=<id>  n=<players>  mode=party|shared  me=<index, or "all">  seed=<n>
 *
 * It is a stand-in for the engine, not a copy of it: effects are applied the
 * way state/engine.ts applies them (a phase change or CLEAR_INPUTS opens a new
 * input stage; TIMER arms the countdown; END shows the outcome), but none of
 * the protocol (leases, acks, gates) exists here. `window.pv` exposes the
 * round for scripts: pv.input(uid, input), pv.timeUp(), pv.state(), pv.restart().
 * This page is not part of the production build.
 */
import { StrictMode, useEffect, useMemo, useReducer, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { allGames as games, gameById } from '../src/games';
import { hashSeed, mulberry32 } from '../src/engine/rng';
import { giftStageOf, reduceWithGifts } from '../src/engine/gifts';
import { GiftStageView } from '../src/components/GiftStage';
import type {
  DrinkAssignment,
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  OutcomeRecap,
  PlayerInfo,
  RoomMode,
} from '../src/engine/types';

import.meta.glob('../src/games/*/styles.css', { eager: true });

const q = new URLSearchParams(location.search);
const gameId = q.get('game') ?? games[0].id;
const n = Math.max(1, Math.min(10, Number(q.get('n') ?? 4)));
const mode = (q.get('mode') === 'shared' ? 'shared' : 'party') as RoomMode;
const meParam = q.get('me') ?? 'all';
const seed = Number(q.get('seed') ?? 1);

const NAMES = ['Cade', 'Riley', 'Sam', 'Jordan', 'Alex', 'Morgan', 'Taylor', 'Casey', 'Quinn', 'Drew'];
const EMOJI = ['🦊', '🐸', '🦄', '🐙', '🦖', '🐼', '🦁', '🐧', '🐝', '🦩'];
const players: PlayerInfo[] = Array.from({ length: n }, (_, i) => ({
  uid: `p${i}`,
  name: NAMES[i],
  emoji: EMOJI[i],
  isHost: i === 0,
  connected: true,
  local: mode === 'shared',
  drinkCount: 0,
  score: 0,
  joinedAt: i,
}));

interface Round {
  state: any;
  inputs: { uid: string; input: unknown }[];
  timerEndsAt: number | null;
  phaseNo: number;
  roundNo: number;
  feed: DrinkAssignment[];
  outcome: { assignments: DrinkAssignment[]; note?: string | null; recap?: OutcomeRecap } | null;
}

function makeStore(def: GameDefinition) {
  let round: Round;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let roundNo = 0;
  const listeners = new Set<() => void>();

  const ctx = (): GameContext => ({
    players,
    actorUid: players[roundNo % players.length].uid,
    turnOrder: players.map((p) => p.uid),
    settings: { mode, pointsMode: false, sipMultiplier: 1, enabledGames: [def.id] },
    // one rng per round, like the engine: the same call sequence replays the same round
    rng: mulberry32(hashSeed(`pv:${seed}:${roundNo}`)),
    now: Date.now(),
    roundId: `r${roundNo}`,
    phaseId: `ph${round?.phaseNo ?? 0}`,
    revision: 0,
  });

  const apply = (res: { state: any; effects?: Effect[] }) => {
    const effects = res.effects ?? [];
    const newStage =
      effects.some((fx) => fx.type === 'CLEAR_INPUTS') || res.state?.phase !== round.state?.phase;
    const end = effects.find((fx) => fx.type === 'END');
    const timerFx = [...effects].reverse().find((fx) => fx.type === 'TIMER');
    round = {
      ...round,
      state: res.state,
      inputs: newStage ? [] : round.inputs,
      phaseNo: newStage ? round.phaseNo + 1 : round.phaseNo,
      feed: [
        ...round.feed,
        ...effects.flatMap((fx) => (fx.type === 'DRINKS' ? fx.assignments : [])),
      ],
    };
    if (timerFx && timerFx.type === 'TIMER') {
      if (timer) clearTimeout(timer);
      round.timerEndsAt = Date.now() + timerFx.ms;
      timer = setTimeout(() => dispatch({ type: 'TIME_UP', now: Date.now() }), timerFx.ms);
    } else if (newStage || end) {
      if (timer) clearTimeout(timer);
      timer = null;
      round.timerEndsAt = null;
    }
    if (end && end.type === 'END') {
      round.outcome = { assignments: end.assignments ?? [], note: end.note, recap: end.recap };
    }
    listeners.forEach((l) => l());
  };

  const dispatch = (event: GameEvent) => {
    if (round.outcome) return;
    if (event.type === 'INPUT') round.inputs = [...round.inputs, { uid: event.uid, input: event.input }];
    apply(reduceWithGifts(def, round.state, event, ctx()));
  };

  const restart = (next = false) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (next) roundNo += 1;
    round = { state: null, inputs: [], timerEndsAt: null, phaseNo: 0, roundNo, feed: [], outcome: null };
    round.state = def.createInitialState(ctx());
    apply(reduceWithGifts(def, round.state, { type: 'BEGIN' }, ctx()));
  };
  restart();

  return {
    get: () => round,
    actorUid: () => players[roundNo % players.length].uid,
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
    input: (uid: string, input: unknown) => dispatch({ type: 'INPUT', uid, input }),
    timeUp: () => dispatch({ type: 'TIME_UP', now: Date.now() }),
    restart,
  };
}

function Preview({ def }: { def: GameDefinition }) {
  const store = useRef<ReturnType<typeof makeStore>>(null);
  if (!store.current) store.current = makeStore(def);
  const s = store.current;
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => s.subscribe(bump), [s]);
  useEffect(() => {
    (window as any).pv = { ...s, state: () => s.get().state, players };
  }, [s]);

  const round = s.get();
  const actorUid = s.actorUid();
  const answeredUids = useMemo(() => [...new Set(round.inputs.map((i) => i.uid))], [round.inputs]);
  const shown =
    meParam === 'all' ? players : [players[Math.max(0, Math.min(n - 1, Number(meParam) || 0))]];
  const nameOf = (uid: string) => players.find((p) => p.uid === uid)?.name ?? uid;

  return (
    <div className="pv">
      <style>{`
        .pv { padding: 10px; }
        .pv-bar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; font:600 12px system-ui; color:#9d92c4; margin-bottom:10px; }
        .pv-bar a, .pv-bar button { font:inherit; color:#fff; background:#2a2152; border:1px solid #4a3c86; border-radius:8px; padding:4px 9px; cursor:pointer; text-decoration:none; }
        .pv-bar a.on { background:#ff4fa3; }
        .pv-phones { display:flex; flex-wrap:wrap; gap:14px; align-items:flex-start; }
        .pv-phone { width:390px; min-height:720px; border:1px solid #3b2d6e; border-radius:22px; overflow:hidden; display:flex; flex-direction:column; position:relative; }
        .pv-tag { font:700 11px system-ui; color:#9d92c4; padding:6px 12px; border-bottom:1px solid #3b2d6e; }
        .pv-body { flex:1; display:flex; flex-direction:column; padding:14px 16px; }
        .pv-out { font:600 13px system-ui; padding:12px; border:1px dashed #ffc94d; border-radius:12px; margin-bottom:10px; }
      `}</style>
      <div className="pv-bar">
        {games.map((g) => (
          <a key={g.id} className={g.id === def.id ? 'on' : ''} href={`?game=${g.id}&n=${n}&mode=${mode}&me=${meParam}`}>
            {g.emoji} {g.name}
          </a>
        ))}
        <button onClick={() => s.restart()}>↻ restart</button>
        <button onClick={() => s.restart(true)}>next actor</button>
        <button onClick={() => s.timeUp()}>⏱ fire TIME_UP</button>
        <span>
          phase: <b>{String(round.state?.phase ?? '—')}</b> · actor: {nameOf(actorUid)} · timer:{' '}
          {round.timerEndsAt ? `${Math.max(0, round.timerEndsAt - Date.now())}ms` : 'none'}
        </span>
      </div>
      {round.feed.length > 0 && (
        <div className="pv-out">
          mid-game drinks: {round.feed.map((a, i) => <span key={i}>{nameOf(a.uid)} ×{a.sips} ({a.reason}) · </span>)}
        </div>
      )}
      {round.outcome && (
        <div className="pv-out" data-pv="outcome">
          <b>END</b> — {round.outcome.note ?? ''}
          <ul>
            {round.outcome.assignments.map((a, i) => (
              <li key={i}>{nameOf(a.uid)} ×{a.sips} — {a.reason}</li>
            ))}
          </ul>
          {round.outcome.recap && (
            <div>
              recap: {round.outcome.recap.title}{' '}
              {round.outcome.recap.groups.map((g, i) => (
                <div key={i}>[{g.tone ?? 'neutral'}] {g.label}: {g.uids.map(nameOf).join(', ')}</div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="pv-phones">
        {shown.map((me) => {
          const mine = round.inputs.filter((i) => i.uid === me.uid);
          return (
            <div className="pv-phone" key={me.uid} data-pv={me.uid}>
              <div className="pv-tag">
                {me.emoji} {me.name} ({me.uid}){me.uid === actorUid ? ' · actor' : ''}
              </div>
              <div className="pv-body">
                {giftStageOf(round.state) ? (
                  <GiftStageView
                    stage={giftStageOf(round.state)!}
                    me={me}
                    players={players}
                    timerEndsAt={round.timerEndsAt}
                    submitInput={(input: unknown) => s.input(me.uid, input)}
                  />
                ) : (
                <def.View
                  state={round.state}
                  me={me}
                  players={players}
                  actorUid={actorUid}
                  isActor={me.uid === actorUid}
                  isAuthority={me.uid === 'p0'}
                  myInput={mine.length ? mine[mine.length - 1].input : null}
                  answeredUids={answeredUids}
                  timerEndsAt={round.timerEndsAt}
                  submitInput={(input: unknown) => s.input(me.uid, input)}
                  variant={mode}
                />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const def = gameById.get(gameId) ?? games[0];
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview def={def} />
  </StrictMode>,
);
