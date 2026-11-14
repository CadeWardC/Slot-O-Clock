import { useEffect, useState } from 'react';
import { BigCount } from '../../components/fx';
import { Button, TimerBar, useCountdown } from '../../components/ui';
import type { GameViewProps, PlayerInfo } from '../../engine/types';
import { COUNT_MS, REVEAL_MS, ROUNDS, TALLY_MS, type MlInput, type MlState } from './definition';

/** the prompt, on the card everyone is looking at */
function PromptCard({ idx, prompt, stamp }: { idx: number; prompt: string; stamp?: string | null }) {
  return (
    <div className="fx-paper ml-card" key={prompt}>
      <div className="ml-card-head">
        <span className="ml-no">
          {idx + 1}
          <small>of {ROUNDS}</small>
        </span>
        {stamp && <span className="fx-stamp ml-stamp">{stamp}</span>}
      </div>
      <p className="ml-lead">Most likely to</p>
      <p className="ml-prompt">{prompt}</p>
    </div>
  );
}

export function View({ state, me, players, timerEndsAt, submitInput, variant }: GameViewProps<MlState, MlInput>) {
  const left = useCountdown(timerEndsAt);
  const idx = state.idx ?? 0;
  const prompt = (state.prompts ?? [])[idx] ?? '';
  const rounds = state.rounds ?? [];
  const shared = variant === 'shared';

  // who this phone has ticked as "most fingers", before it is locked in
  const [ticked, setTicked] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    setTicked([]);
    setSent(false);
  }, [idx, state.phase]);

  // a buzz on zero, so nobody has to be looking at the phone to point on time
  const pointNow = state.phase === 'tally' || (state.phase === 'count' && left != null && left <= 0);
  useEffect(() => {
    if (pointNow) navigator.vibrate?.(200);
  }, [pointNow, idx]);

  /* ---------- 1. read it, then 3, 2, 1 ---------- */
  if (state.phase === 'count') {
    const secs = left != null ? Math.ceil(left / 1000) : null;
    const counting = secs != null && secs <= COUNT_MS / 1000;
    return (
      <div className="gv ml">
        <PromptCard idx={idx} prompt={prompt} />
        <div className="ml-stage">
          {pointNow ? (
            <p className="ml-point fx-pop">Point!</p>
          ) : counting ? (
            <>
              <p className="fx-kicker">Point in</p>
              <BigCount n={secs as number} />
            </>
          ) : (
            <>
              <p className="ml-step">Pick someone at the table. Keep it to yourself.</p>
              <p className="ml-status">
                {shared ? 'Read it out loud. ' : ''}Hands down until the count hits zero.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  /* ---------- 3. who drinks ---------- */
  if (state.phase === 'reveal') {
    const round = rounds[rounds.length - 1];
    if (!round) return <div className="gv ml" />;
    const winners = (round.winners ?? [])
      .map((uid) => players.find((p) => p.uid === uid))
      .filter((p): p is PlayerInfo => !!p);
    const iDrink = !shared && winners.some((p) => p.uid === me.uid);
    const names = winners.map((p) => p.name);
    const caller = players.find((p) => p.uid === round.by);
    const line =
      winners.length === 0
        ? 'Nobody got called out. Nobody drinks.'
        : winners.length === 1
          ? `${iDrink ? 'You drink' : `${names[0]} drinks`} ${round.sips}.`
          : `${names.join(' and ')} tied. They drink ${round.sips} each.`;
    return (
      <div className="gv ml">
        <PromptCard
          idx={idx}
          prompt={round.prompt}
          stamp={winners.length === 0 ? null : winners.length === 1 ? names[0] : 'Tie'}
        />
        <p className={`ml-line ${iDrink ? 'ml-line-me' : ''}`}>{line}</p>
        <TimerBar deadline={timerEndsAt} totalMs={REVEAL_MS} />
        <p className="ml-status">
          {caller && !shared ? `Called by ${caller.name}. ` : ''}
          {idx + 1 >= ROUNDS ? 'That was the last one.' : 'Next prompt coming.'}
        </p>
      </div>
    );
  }

  /* ---------- 2. fingers are up: who has the most ---------- */
  const toggle = (uid: string) =>
    setTicked((cur) => (cur.includes(uid) ? cur.filter((u) => u !== uid) : [...cur, uid]));
  const call = (most: string[]) => {
    if (sent) return;
    setSent(true);
    submitInput({ most });
  };
  return (
    <div className="gv ml">
      <PromptCard idx={idx} prompt={prompt} stamp="Point!" />
      <div className="ml-ballot">
        <p className="ml-step">Keep pointing. Who has the most fingers on them?</p>
        <p className="ml-status">
          {shared ? 'Tick them and lock it in.' : 'Any phone can call it.'} A tie? Tick both.
        </p>
        {players.map((p) => {
          const on = ticked.includes(p.uid);
          return (
            <button
              key={p.uid}
              className={`ml-pick ${on ? 'ml-pick-mine' : ''}`}
              disabled={sent}
              aria-pressed={on}
              onClick={() => toggle(p.uid)}
            >
              <span className="ml-box" aria-hidden="true">
                {on ? 'X' : ''}
              </span>
              <span className="ml-pick-name">
                {p.emoji} {p.name}
                {!shared && p.uid === me.uid && <small> (you)</small>}
              </span>
            </button>
          );
        })}
      </div>
      <Button variant="gold" size="lg" full disabled={sent || ticked.length === 0} onClick={() => call(ticked)}>
        {ticked.length === 0
          ? 'Tick who got the most'
          : ticked.length === 1
            ? `${players.find((p) => p.uid === ticked[0])?.name ?? 'They'} drinks`
            : `${ticked.length} of them drink`}
      </Button>
      <Button variant="ghost" size="sm" disabled={sent} onClick={() => call([])}>
        Too close to call, nobody drinks
      </Button>
      <TimerBar deadline={timerEndsAt} totalMs={TALLY_MS} />
    </div>
  );
}
