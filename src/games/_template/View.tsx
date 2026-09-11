import { useCountdown } from '../../components/ui';
import type { GameViewProps } from '../../engine/types';
import type { CoinInput, CoinState } from './definition';

/**
 * Rendered identically on every phone. Distinguish roles with
 * `isActor` / `isAuthority` / `variant`, and gate your own input UI
 * with `myInput` (already submitted?) and `answeredUids`.
 */
export function View({ state, isActor, myInput, timerEndsAt, submitInput }: GameViewProps<CoinState, CoinInput>) {
  const left = useCountdown(timerEndsAt);
  const actorCanFlip = isActor && state.phase === 'ready' && !myInput;

  return (
    <div className="gv">
      <div className={`coin ${state.phase === 'flipping' ? 'coin-flip' : ''} ${state.phase === 'result' ? 'coin-land' : ''}`}>
        {state.phase === 'result' ? (state.result === 'heads' ? '🪙' : '🌘') : '🪙'}
      </div>

      {state.phase === 'ready' && (
        <>
          <h2>{isActor ? 'Flip the coin!' : 'Waiting for the flip…'}</h2>
          {actorCanFlip && (
            <button className="btn btn-gold btn-lg btn-full" onClick={() => submitInput({ action: 'flip' })}>
              FLIP 🪙
            </button>
          )}
        </>
      )}

      {state.phase === 'flipping' && <h2>Flipping…</h2>}
      {state.phase === 'result' && (
        <h2 className="coin-result">
          {state.result === 'heads' ? 'HEADS — everyone else drinks!' : 'TAILS — the flipper drinks!'}
        </h2>
      )}

      {left != null && <p className="muted">{Math.ceil(left / 1000)}s</p>}
    </div>
  );
}
