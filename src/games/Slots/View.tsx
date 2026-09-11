import type { GameViewProps } from '../../engine/types';
import { SYMBOLS, type SlotsInput, type SlotsState } from './definition';

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

export function View({ state, isActor, myInput, submitInput }: GameViewProps<SlotsState, SlotsInput>) {
  const canSpin = isActor && state.phase === 'idle' && !myInput;

  return (
    <div className="gv">
      <div className={`slots-cabinet ${state.phase === 'result' ? 'slots-win' : ''}`}>
        <div className="slots-reels">
          {state.reels.map((s, i) => (
            <Reel key={i} sym={s} spinning={state.phase === 'spinning'} index={i} />
          ))}
        </div>
      </div>

      {state.phase === 'idle' && (
        <>
          <h2>{isActor ? 'Pull the lever!' : 'Waiting for the spinner…'}</h2>
          {canSpin && (
            <button className="btn btn-gold btn-lg btn-full slots-lever" onClick={() => submitInput({ action: 'spin' })}>
              SPIN 🎰
            </button>
          )}
        </>
      )}

      {state.phase === 'spinning' && <h2 className="slots-line">…</h2>}

      {state.phase === 'result' && <h2 className="slots-line slots-line-pop">{state.line}</h2>}
    </div>
  );
}
