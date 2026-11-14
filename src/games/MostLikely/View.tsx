import { TimerBar, useCountdown } from '../../components/ui';
import type { GameViewProps, PlayerInfo } from '../../engine/types';
import {
  REVEAL_MS,
  ROUNDS,
  SHARED_VOTE_MS_EACH,
  VOTE_MS,
  tally,
  type MlInput,
  type MlRound,
  type MlState,
} from './definition';

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

/** the votes, turned over: most first, with who named whom */
function Tally({
  round,
  players,
  meUid,
}: {
  round: MlRound;
  players: PlayerInfo[];
  meUid: string;
}) {
  const votes = round.votes ?? {};
  const counts = tally(votes, players);
  const winners = new Set(round.winners ?? []);
  const rows = [...players].sort((a, b) => (counts[b.uid] ?? 0) - (counts[a.uid] ?? 0));
  const byUid = new Map(players.map((p) => [p.uid, p] as const));
  return (
    <div className="fx-paper ml-tally">
      {rows.map((p, i) => {
        const voters = Object.entries(votes)
          .filter(([, target]) => target === p.uid)
          .map(([voter]) => byUid.get(voter))
          .filter((v): v is PlayerInfo => !!v);
        const won = winners.has(p.uid);
        return (
          <div
            key={p.uid}
            className={`ml-row ${won ? 'ml-row-won' : ''} ${voters.length === 0 ? 'ml-row-none' : ''}`}
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <span className="ml-row-who">
              {p.emoji} {p.name}
              {p.uid === meUid && <small> (you)</small>}
            </span>
            <span className="ml-voters" aria-label={`${voters.length} votes`}>
              {voters.map((v) => (
                <span key={v.uid} title={v.name}>
                  {v.emoji}
                </span>
              ))}
            </span>
            <span className="ml-count">{voters.length}</span>
            {won && <span className="fx-tag fx-tag-red ml-drinks">Drinks {round.sips}</span>}
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
  variant,
}: GameViewProps<MlState, MlInput>) {
  const left = useCountdown(timerEndsAt);
  const idx = state.idx ?? 0;
  const prompt = (state.prompts ?? [])[idx] ?? '';
  const votes = state.votes ?? {};
  const rounds = state.rounds ?? [];
  const shared = variant === 'shared';

  /* ---------- the reveal ---------- */
  if (state.phase === 'reveal') {
    const round = rounds[rounds.length - 1];
    if (!round) return <div className="gv ml" />;
    const winners = (round.winners ?? [])
      .map((uid) => players.find((p) => p.uid === uid))
      .filter((p): p is PlayerInfo => !!p);
    const iDrink = !shared && winners.some((p) => p.uid === me.uid);
    const names = winners.map((p) => p.name);
    const line =
      winners.length === 0
        ? 'Nobody voted. Nobody drinks.'
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
        <Tally round={round} players={players} meUid={shared ? '' : me.uid} />
        <p className={`ml-line ${iDrink ? 'ml-line-me' : ''}`}>{line}</p>
        <TimerBar deadline={timerEndsAt} totalMs={REVEAL_MS} />
        <p className="ml-status">
          {idx + 1 >= ROUNDS ? 'That was the last one.' : 'Next prompt coming.'}
        </p>
      </div>
    );
  }

  /* ---------- the vote ---------- */
  const mine = votes[me.uid];
  const voted = typeof mine === 'string';
  const inCount = players.filter((p) => typeof votes[p.uid] === 'string').length;
  const secs = left != null ? Math.ceil(left / 1000) : null;
  return (
    <div className="gv ml">
      <PromptCard idx={idx} prompt={prompt} />
      <div className="ml-ballot">
        <p className="fx-kicker">{voted ? 'Your vote is in' : shared ? `${me.name}, pick one` : 'Pick one'}</p>
        {players.map((p) => (
          <button
            key={p.uid}
            className={`ml-pick ${mine === p.uid ? 'ml-pick-mine' : ''}`}
            disabled={voted}
            onClick={() => submitInput({ vote: p.uid })}
          >
            <span className="ml-box" aria-hidden="true">
              {mine === p.uid ? 'X' : ''}
            </span>
            <span className="ml-pick-name">
              {p.emoji} {p.name}
              {p.uid === me.uid && <small> (you)</small>}
            </span>
          </button>
        ))}
      </div>
      <TimerBar
        deadline={timerEndsAt}
        totalMs={shared ? SHARED_VOTE_MS_EACH * Math.max(1, players.length) : VOTE_MS}
      />
      <p className="ml-status">
        {inCount} of {players.length} in{secs != null ? `, ${secs}s left` : ''}.
        {voted ? ' Votes turn over together.' : ' Nobody sees your vote until then.'}
      </p>
    </div>
  );
}
