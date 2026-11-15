import { useEffect, useReducer, useRef, useState } from 'react';
import { Button, TimerBar, useCountdown } from '../../components/ui';
import { Confetti } from '../../components/fx';
import type { GameViewProps, PlayerInfo } from '../../engine/types';
import { serverNow } from '../../state/serverTime';
import {
  GIFT_MS,
  LAST_THUMB_BONUS,
  MAX_VALUE,
  valueAt,
  type CkInput,
  type CkState,
} from './definition';

/** re-render a few times a second while the counter is live */
function useTicker(on: boolean) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!on) return;
    const iv = window.setInterval(tick, 60);
    return () => window.clearInterval(iv);
  }, [on]);
}

export function View({
  state,
  me,
  players,
  actorUid,
  variant,
  myInput,
  timerEndsAt,
  submitInput,
}: GameViewProps<CkState, CkInput>) {
  const banks = state.banks ?? {};
  const busted = state.busted ?? [];
  const gifts = state.gifts ?? {};
  const phase = state.phase;
  const shared = variant === 'shared';
  // who has a thumb in this round: the table, or one player on a shared phone
  const seats: PlayerInfo[] = shared
    ? players.filter((p) => p.uid === (actorUid ?? me.uid)).slice(0, 1)
    : players;
  const playing = seats.some((p) => p.uid === me.uid);

  useTicker(phase === 'ready' || phase === 'climb');
  const now = serverNow();
  const live = phase === 'climb' && state.climbAt != null ? valueAt(now - state.climbAt) : 0;
  const readyLeft =
    phase === 'ready' && state.climbAt != null ? Math.max(1, Math.ceil((state.climbAt - now) / 1000)) : 0;

  /* ---------- the thumb ---------- */
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  // what this thumb did, shown before the host has answered
  const [localBank, setLocalBank] = useState<number | null>(null);
  const sent = useRef(false);
  useEffect(() => {
    // a new holder (shared phone) or a new round starts clean
    sent.current = false;
    heldRef.current = false;
    setHeld(false);
    setLocalBank(null);
  }, [me.uid, state.climbAt == null]);

  const myBank: number | null = banks[me.uid] ?? localBank;
  const out = myBank != null || (myInput != null && myInput.action === 'bail');

  const bail = () => {
    if (sent.current || phase !== 'climb' || state.climbAt == null || !playing) return;
    sent.current = true;
    const at = serverNow();
    setLocalBank(valueAt(at - state.climbAt));
    submitInput({ action: 'bail', at });
  };

  // the counter started and this thumb is not on the button: that is a bail at 0
  useEffect(() => {
    if (phase === 'climb' && playing && !heldRef.current && banks[me.uid] == null) bail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, me.uid]);

  const press = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (out || (phase !== 'ready' && phase !== 'climb')) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer has nothing to capture */
    }
    heldRef.current = true;
    setHeld(true);
    navigator.vibrate?.(20);
  };
  const release = () => {
    if (!heldRef.current) return;
    heldRef.current = false;
    setHeld(false);
    bail();
  };
  // a thumb that leaves with the page (app switch, lock screen) has let go
  useEffect(() => {
    const drop = () => release();
    window.addEventListener('blur', drop);
    return () => window.removeEventListener('blur', drop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, state.climbAt]);

  /* ---------- the table: who is still on ---------- */
  const board = (
    <div className="ck-board">
      {seats.map((p) => {
        const bank = banks[p.uid];
        const bust = busted.includes(p.uid);
        const last = state.lastThumb === p.uid;
        return (
          <div
            key={p.uid}
            className={`ck-row ${bust ? 'ck-row-bust' : bank != null ? 'ck-row-out' : ''}`}
          >
            <span className="ck-row-who">
              {p.emoji} {p.name}
              {p.uid === me.uid && !shared ? ' (you)' : ''}
            </span>
            <span className="ck-row-what">
              {bust
                ? `drinks ${state.bustValue ?? 0}`
                : last
                  ? `last thumb, ${bank}`
                  : bank != null
                    ? bank > 0
                      ? `out at ${bank}`
                      : 'out at 0'
                    : phase === 'ready'
                      ? 'in'
                      : 'holding'}
            </span>
          </div>
        );
      })}
    </div>
  );

  /* ---------- hand-outs ---------- */
  const [give, setGive] = useState<Record<string, number>>({});
  useEffect(() => setGive({}), [me.uid, phase]);
  const giftLeft = useCountdown(phase === 'gift' ? timerEndsAt : null);

  if (phase === 'gift') {
    const bankers = seats.filter((p) => (banks[p.uid] ?? 0) > 0);
    const mine = banks[me.uid] ?? 0;
    const iGive = mine > 0;
    const myGift = gifts[me.uid];
    const given = Object.values(give).reduce((a, b) => a + b, 0);
    const left = mine - given;
    const incoming: Record<string, number> = {};
    for (const g of Object.values(gifts)) {
      for (const [uid, n] of Object.entries(g ?? {})) {
        if (n > 0) incoming[uid] = (incoming[uid] ?? 0) + n;
      }
    }
    return (
      <div className="gv ck">
        {iGive && !myGift && <Confetti />}
        <span className={`fx-tag ${iGive ? 'fx-tag-green' : ''}`}>
          {state.lastThumb === me.uid ? (mine >= MAX_VALUE ? `Last thumb, the full ${MAX_VALUE}` : `Last thumb +${LAST_THUMB_BONUS}`) : iGive ? 'Banked' : 'Paying out'}
        </span>
        <h2 className="fx-title">{iGive ? `You have ${mine} to give` : 'They got out'}</h2>
        {busted.length > 0 && (
          <p className="ck-line">
            It bust at {state.bustValue}. {busted.map((uid) => players.find((p) => p.uid === uid)?.name ?? '?').join(', ')}{' '}
            {busted.length === 1 ? 'drinks' : 'drink'} it.
          </p>
        )}
        {timerEndsAt != null && <TimerBar deadline={timerEndsAt} totalMs={GIFT_MS} />}
        {iGive ? (
          myGift ? (
            <p className="ck-line">
              Sent.{' '}
              {Object.entries(myGift)
                .filter(([, n]) => n > 0)
                .map(([uid, n]) => `${players.find((p) => p.uid === uid)?.name ?? '?'} gets ${n}`)
                .join(', ') || 'You kept them all back'}
              .
            </p>
          ) : (
            <>
              <p className="pick-call">
                <b className="ck-left">{left}</b> of {mine} left. Tap a name to give one.
              </p>
              <div className="pick-people">
                {players
                  .filter((p) => p.uid !== me.uid)
                  .map((p) => (
                    <button
                      key={p.uid}
                      className={`pick-person ${give[p.uid] ? 'pick-person-got' : ''}`}
                      disabled={left <= 0}
                      onClick={() => setGive({ ...give, [p.uid]: (give[p.uid] ?? 0) + 1 })}
                    >
                      <span className="pick-person-emoji">{p.emoji}</span> {p.name}
                      {give[p.uid] ? <span className="ck-give-n">+{give[p.uid]}</span> : null}
                      {incoming[p.uid] ? <span className="pick-person-flag">has {incoming[p.uid]}</span> : null}
                    </button>
                  ))}
              </div>
              <div className="ck-give-actions">
                <Button variant="ghost" size="md" disabled={given === 0} onClick={() => setGive({})}>
                  Undo
                </Button>
                <Button
                  variant="gold"
                  size="md"
                  full
                  disabled={given === 0}
                  onClick={() => submitInput({ action: 'gift', give })}
                >
                  {given === 0 ? 'Hand out' : `Hand out ${given}`}
                </Button>
              </div>
              {giftLeft != null && (
                <p className="muted small ck-note">
                  {Math.ceil(giftLeft / 1000)}s. Anything you have not dealt goes to nobody.
                </p>
              )}
            </>
          )
        ) : (
          <p className="ck-line">
            {bankers.map((p) => p.name).join(' and ')} {bankers.length === 1 ? 'is' : 'are'} picking who
            drinks.
          </p>
        )}
        {board}
      </div>
    );
  }

  /* ---------- the bust ---------- */
  if (phase === 'bust') {
    const iBust = busted.includes(me.uid);
    return (
      <div className="gv ck">
        <div className={`ck-slab ck-slab-bust ${iBust ? 'fx-shake' : ''}`}>
          <span className="fx-stamp ck-stamp">Bust</span>
          <span className="ck-slab-num">{state.bustValue}</span>
          <span className="ck-slab-sub">
            {iBust
              ? `You held on. Drink ${state.bustValue}.`
              : myBank != null
                ? `You got out at ${myBank}.`
                : `${busted.length} still holding.`}
          </span>
        </div>
        {board}
      </div>
    );
  }

  /* ---------- ready + climb ---------- */
  const climbing = phase === 'climb';
  const capped = live >= MAX_VALUE;
  return (
    <div className="gv ck">
      <div className="ck-head">
        <span className={`fx-tag ${climbing ? 'fx-tag-red' : ''}`}>
          {climbing ? (capped ? 'Maxed out' : 'Climbing') : 'Get ready'}
        </span>
        <span className="ck-head-sub">{climbing ? 'drinks on the button' : 'thumb down before zero'}</span>
      </div>

      <div className="ck-counter">
        {climbing ? (
          <span key={live} className={`fx-count ck-num ${live >= 7 ? 'fx-count-hot' : ''}`}>
            {live}
          </span>
        ) : (
          <span key={readyLeft} className="fx-count ck-num ck-num-ready">
            {readyLeft}
          </span>
        )}
      </div>

      {!playing ? (
        <p className="ck-line">{seats[0]?.name ?? 'Someone'} is on the button.</p>
      ) : out ? (
        <div className="fx-paper ck-banked">
          <span className="fx-tag fx-tag-green">Out</span>
          <p className="ck-banked-big">
            {myBank != null && myBank > 0 ? `Banked ${myBank}` : 'Banked nothing'}
          </p>
          <p className="ck-banked-sub">
            {myBank != null && myBank > 0
              ? 'Yours to hand out once the rest are done.'
              : 'Your thumb was not on the button.'}
          </p>
        </div>
      ) : (
        <button
          className={`ck-slab ck-slab-hold ${held ? 'ck-slab-down' : ''}`}
          onPointerDown={press}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="ck-slab-word">{held ? (climbing ? 'Holding' : 'Hold it') : 'Hold'}</span>
          <span className="ck-slab-sub">
            {held
              ? climbing
                ? live > 0
                  ? `Let go to bank ${live}.`
                  : 'Let go now and you bank nothing.'
                : 'Keep it down. Counter starts at zero.'
              : 'Press and keep your thumb here.'}
          </span>
        </button>
      )}

      {board}
    </div>
  );
}
