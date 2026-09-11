import { useCountdown } from '../../components/ui';
import type { GameViewProps } from '../../engine/types';
import { CUP_COUNT, HOUSE_NAME, SIPS, type PoisonInput, type PoisonPair, type PoisonState } from './definition';

export function View({
  state,
  me,
  players,
  myInput,
  answeredUids,
  timerEndsAt,
  submitInput,
  variant,
}: GameViewProps<PoisonState, PoisonInput>) {
  const left = useCountdown(timerEndsAt);
  const poisons = state.poisons ?? {};
  const picks = state.picks ?? {};
  const pairs = state.pairs ?? [];

  const nameOf = (uid: string) => players.find((p) => p.uid === uid);
  const poisonerName = (pair: PoisonPair) =>
    pair.poisonerUid == null ? HOUSE_NAME : (nameOf(pair.poisonerUid)?.name ?? '?');

  if (state.phase === 'reveal') {
    return (
      <div className="gv">
        <h2>☠️ Bottoms up</h2>
        {pairs.map((pair) => {
          const poisoned =
            pair.poisonerUid != null ? poisons[pair.poisonerUid] : pair.houseCup ?? 0;
          const picked = picks[pair.drinkerUid] ?? 0;
          const hit = poisoned === picked;
          const drinker = nameOf(pair.drinkerUid);
          return (
            <div key={pair.drinkerUid} className={`ps-reveal ${hit ? 'ps-hit' : 'ps-dodge'}`}>
              <p className="ps-reveal-names">
                ☠️ {poisonerName(pair)} <span className="ps-vs">vs</span> 🍷 {drinker?.name ?? '?'}
              </p>
              <div className="ps-reveal-cups">
                {Array.from({ length: CUP_COUNT }, (_, c) => (
                  <span
                    key={c}
                    className={`ps-mini ${c === poisoned ? 'ps-mini-poison' : ''} ${c === picked ? 'ps-mini-pick' : ''}`}
                  >
                    {c === poisoned ? '☠️' : c === picked ? '🍷' : '🥃'}
                  </span>
                ))}
              </div>
              <p className="ps-verdict">
                {hit
                  ? `💀 ${drinker?.name ?? '?'} drank the poison — ${SIPS} sips`
                  : pair.poisonerUid == null
                    ? `🎲 dodged ${HOUSE_NAME} — nobody drinks`
                    : `🍷 dodged it — ${poisonerName(pair)} drinks ${SIPS}`}
              </p>
            </div>
          );
        })}
        {state.note && <p className="muted small">{state.note}</p>}
      </div>
    );
  }

  /* ---------- pouring phase ---------- */

  const myPair = pairs.find((p) => p.drinkerUid === me.uid || p.poisonerUid === me.uid) ?? null;
  const iPoison = myPair?.poisonerUid === me.uid;
  const iDrink = myPair?.drinkerUid === me.uid;
  const mine = myInput != null && Number.isInteger(myInput.cup);
  // party mode keeps the drama: a drinker chooses only once their
  // poisoner has locked in; the shared phone can't control pass order,
  // so there the pick is double-blind instead
  const poisonReady =
    myPair == null || myPair.poisonerUid == null || poisons[myPair.poisonerUid] != null;
  const canPick = !mine && (iPoison || (iDrink && (variant === 'shared' || poisonReady)));

  return (
    <div className="gv">
      {iPoison ? (
        <span className="ps-badge ps-badge-poison">☠️ POISONER</span>
      ) : iDrink ? (
        <span className="ps-badge ps-badge-drink">🍷 DRINKER</span>
      ) : (
        <span className="ps-badge">👀 WATCHING</span>
      )}

      {myPair && (
        <>
          {iPoison ? (
            <h2>
              Spike ONE of {nameOf(myPair.drinkerUid)?.name ?? '?'}'s {CUP_COUNT} cups
            </h2>
          ) : iDrink && !poisonReady && variant === 'party' ? (
            <h2>
              ☠️ {poisonerName(myPair)} is poisoning your cups…
            </h2>
          ) : iDrink ? (
            <h2>
              {poisonerName(myPair)} poisoned one of these — pick your drink
            </h2>
          ) : (
            <h2>Watch the pour 👀</h2>
          )}

          <div className="ps-cups">
            {Array.from({ length: CUP_COUNT }, (_, c) => (
              <button
                key={c}
                className="ps-cup"
                disabled={!canPick}
                onClick={() => submitInput({ cup: c })}
              >
                <span className="ps-cup-emoji">🥃</span>
                <span className="ps-cup-num">{c + 1}</span>
              </button>
            ))}
          </div>

          {mine && (
            <p className="muted">
              {iPoison
                ? variant === 'party'
                  ? `Poison poured into cup ${(myInput?.cup ?? 0) + 1} — waiting for ${nameOf(myPair.drinkerUid)?.name ?? '?'}…`
                  : 'Poison poured — pass the phone 📱'
                : 'Cup chosen — waiting…'}
            </p>
          )}
        </>
      )}

      <div className="ps-pairs">
        {pairs.map((pair) => {
          const poisonDone = pair.poisonerUid == null || poisons[pair.poisonerUid] != null;
          const pickDone = picks[pair.drinkerUid] != null;
          return (
            <div key={pair.drinkerUid} className="ps-pair">
              <span>
                ☠️ {poisonerName(pair)} {poisonDone && <span className="ps-done">✔</span>}
              </span>
              <span className="ps-vs">→</span>
              <span>
                🍷 {nameOf(pair.drinkerUid)?.name ?? '?'} {pickDone && <span className="ps-done">✔</span>}
              </span>
            </div>
          );
        })}
      </div>

      {variant === 'party' && (
        <p className="muted small">
          {answeredUids.length}/{players.length} decided
          {left != null ? ` · ${Math.ceil(left / 1000)}s` : ''}
        </p>
      )}
      {left != null && variant !== 'party' && (
        <p className="muted small">{Math.ceil(left / 1000)}s</p>
      )}
    </div>
  );
}
