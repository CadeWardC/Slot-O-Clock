import { useEffect, useReducer, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui';
import { Confetti } from '../../components/fx';
import { serverNow } from '../../state/serverTime';
import type { GameViewProps, PlayerInfo } from '../../engine/types';
import {
  ANTIDOTE_MISS_SIPS,
  CUP_BONUS,
  MISS_SIPS,
  REACTIONS,
  SIPS,
  STACK_SIPS,
  sniffZone,
  type PoisonInput,
  type PoisonState,
} from './definition';

/** reveal staging, in ms after `revealAt` — identical on every phone */
const T_VERDICT = 2800;
const T_FLIP = 4600;

/** re-render ~8×/s until `until` (server time) has passed */
function useTickUntil(until: number | null) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (until == null || serverNow() >= until) return;
    const iv = window.setInterval(() => {
      tick();
      if (serverNow() >= until) window.clearInterval(iv);
    }, 120);
    return () => window.clearInterval(iv);
  }, [until]);
}

interface CupLook {
  emoji: string;
  cls?: string;
  /** little faces pinned to the cup (the poisoners, once revealed) */
  tags?: string[];
}

/**
 * The table: the cups in a ring, something in the middle. Every phase draws
 * this same table so the round reads as one scene, not five screens.
 */
function Table({
  cups,
  look,
  onCup,
  center,
  tone = '',
}: {
  cups: number;
  look: (c: number) => CupLook;
  onCup?: (c: number) => void;
  center: ReactNode;
  tone?: string;
}) {
  const size = cups <= 5 ? 66 : cups <= 7 ? 58 : cups <= 9 ? 50 : 44;
  return (
    <div className={`ps-table ${tone}`} style={{ ['--ps-cup' as string]: `${size}px` }}>
      <div className="ps-felt" />
      <div className="ps-center">{center}</div>
      {Array.from({ length: cups }, (_, c) => {
        const a = (c / cups) * Math.PI * 2 - Math.PI / 2;
        const l = look(c);
        const body = (
          <>
            <span className="ps-cup-emoji">{l.emoji}</span>
            <span className="ps-cup-num">{c + 1}</span>
            {l.tags && l.tags.length > 0 && <span className="ps-cup-tags">{l.tags.join('')}</span>}
          </>
        );
        const style = { left: `${50 + 39 * Math.cos(a)}%`, top: `${50 + 39 * Math.sin(a)}%` };
        return onCup ? (
          <button key={c} className={`ps-cup ${l.cls ?? ''}`} style={style} onClick={() => onCup(c)}>
            {body}
          </button>
        ) : (
          <div key={c} className={`ps-cup ps-cup-still ${l.cls ?? ''}`} style={style}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** the crew, and whatever face each of them is pulling right now */
function Crew({
  order,
  players,
  reactions,
  done,
}: {
  order: string[];
  players: PlayerInfo[];
  reactions?: Record<string, { e: string; at: number }>;
  done?: (uid: string) => boolean;
}) {
  return (
    <div className="ps-crew">
      {order.map((uid) => {
        const p = players.find((x) => x.uid === uid);
        const r = reactions?.[uid];
        return (
          <span key={uid} className={`ps-crew-chip ${done?.(uid) ? 'ps-crew-done' : ''}`}>
            <span>{p?.emoji ?? '☠️'}</span>
            <span className="ps-crew-name">{p?.name ?? '?'}</span>
            {done && <span className="ps-crew-tick">{done(uid) ? '✔' : '…'}</span>}
            {r && (
              <span key={r.at} className="ps-crew-react">
                {r.e}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/**
 * One victim, everyone else pouring. The pourer's own cup is the only cup
 * this component ever renders knowably: `poisons[me.uid]` — never anybody
 * else's entry, and never the antidote. The reveal is the first moment the
 * table sees them all.
 */
export function View({ state, me, players, submitInput, variant }: GameViewProps<PoisonState, PoisonInput>) {
  const cups = state?.cups ?? players.length + CUP_BONUS;
  const poisons = state?.poisons ?? {};
  const order = state?.order ?? [];
  const drinkerUid = state?.drinkerUid ?? '';
  const reactions = state?.reactions ?? {};
  const drinker = players.find((p) => p.uid === drinkerUid);
  const nameOf = (uid: string | null) => (uid ? (players.find((p) => p.uid === uid)?.name ?? '?') : '?');
  const emojiOf = (uid: string) => players.find((p) => p.uid === uid)?.emoji ?? '☠️';
  const pouredCount = order.filter((uid) => poisons[uid] != null).length;

  // A phone that picked a cup and then handed itself over must never leak
  // the selection: the choice is keyed to the turn it was made in.
  const turnKey = `${me.uid}:${state?.phase}:${pouredCount}`;
  const [sel, setSel] = useState<{ key: string; cup: number | null }>({ key: turnKey, cup: null });
  const selected = sel.key === turnKey ? sel.cup : null;
  const select = (cup: number | null) => setSel({ key: turnKey, cup });
  const [sniffing, setSniffing] = useState(false);

  const revealAt = state?.phase === 'reveal' ? (state.revealAt ?? 0) : null;
  useTickUntil(revealAt != null ? revealAt + T_FLIP + 200 : null);

  // a round left running from the old pairing rules can't be rendered
  if (!drinkerUid) {
    return (
      <div className="gv">
        <div className="gate-emoji pulse">☠️</div>
        <h2>This round is from an older version</h2>
        <p className="muted">the host can skip it ⏭</p>
      </div>
    );
  }

  const sniff = state.sniff ?? null;
  const zone = sniff ? sniffZone(sniff.cup, cups) : [];
  const sniffLine = sniff
    ? cups <= 3
      ? `${sniff.count} ${sniff.count === 1 ? 'dose' : 'doses'} on the table`
      : `${sniff.count} ${sniff.count === 1 ? 'dose' : 'doses'} in cups ${zone.map((c) => c + 1).join(' · ')}`
    : null;

  /* ---------- the reveal ---------- */

  if (state.phase === 'reveal') {
    const pick = state.pick ?? 0;
    const t = serverNow() - (revealAt ?? 0);
    const verdict = t >= T_VERDICT;
    const flipped = t >= T_FLIP;
    const outcome = state.outcome ?? (Object.values(poisons).includes(pick) ? 'hit' : 'clean');
    const inCup = (c: number) => order.filter((uid) => poisons[uid] === c);
    const antidoteCup = state.antidoteCup ?? -1;

    return (
      <div className="gv ps">
        <p className="fx-kicker">☠️ bottoms up</p>
        <h2 className={`fx-title ${!verdict ? '' : outcome === 'hit' ? 'fx-title-red' : 'fx-title-green'}`}>
          {!verdict
            ? `${nameOf(drinkerUid)} lifts cup ${pick + 1}…`
            : outcome === 'hit'
              ? 'Poisoned!'
              : outcome === 'antidote'
                ? 'The antidote!'
                : 'Clean!'}
        </h2>
        <Table
          cups={cups}
          tone={verdict ? `ps-table-${outcome}` : 'ps-table-drum'}
          look={(c) => {
            if (c === pick) {
              if (!verdict) return { emoji: '🍷', cls: 'ps-cup-lift' };
              return {
                emoji: outcome === 'hit' ? '💀' : outcome === 'antidote' ? '💚' : '🍷',
                cls: `ps-cup-picked ps-cup-${outcome}`,
                tags: inCup(c).map(emojiOf),
              };
            }
            if (!flipped) return { emoji: '🥃', cls: verdict ? '' : 'ps-cup-dim' };
            const n = inCup(c).length;
            return {
              emoji: c === antidoteCup ? '💚' : n > 0 ? '☠️' : '🥃',
              cls: `ps-cup-flip ${n > 0 ? 'ps-cup-wasbad' : c === antidoteCup ? 'ps-cup-wasanti' : 'ps-cup-dim'}`,
              tags: inCup(c).map(emojiOf),
            };
          }}
          center={
            !verdict ? (
              <span className="ps-drum">🥁</span>
            ) : (
              <span
                className={`fx-stamp ps-stamp ${outcome === 'hit' ? '' : outcome === 'antidote' ? 'fx-stamp-good' : 'fx-stamp-gold'}`}
              >
                {outcome === 'hit' ? 'dead' : outcome === 'antidote' ? 'bounce' : 'safe'}
              </span>
            )
          }
        />
        {verdict && <p className="ps-verdict fx-rise">{state.note}</p>}
        {verdict && (outcome === 'hit' ? <Confetti emojis={['💀', '☠️', '🧪']} count={18} /> : <Confetti />)}

        {flipped && (
          <div className="ps-pairs fx-rise">
            {order.map((uid) => {
              const cup = poisons[uid];
              const mine = (state.assignments ?? []).find((a) => a.uid === uid);
              return (
                <div
                  key={uid}
                  className={`ps-pair ${cup === pick ? 'ps-pair-hit' : ''} ${mine ? 'ps-pair-miss' : ''}`}
                >
                  <span>
                    {emojiOf(uid)} {nameOf(uid)}
                  </span>
                  <span className="ps-vs">→</span>
                  <span>
                    {cup == null ? 'never poured' : `cup ${cup + 1}`}
                    {cup === pick ? ' 🎯' : ''}
                    {mine ? ` 🍺 +${mine.sips}` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ---------- my pour ---------- */

  const myPour = poisons[me.uid];
  const iPour = order.includes(me.uid);
  const myTurnToPour =
    state.phase === 'pouring' &&
    iPour &&
    myPour == null &&
    (variant !== 'shared' || order.find((uid) => poisons[uid] == null) === me.uid);

  if (myTurnToPour) {
    return (
      <div className="gv ps">
        <span className="ps-badge ps-badge-poison">☠️ YOUR POUR</span>
        <h2 className="fx-title fx-title-red">Spike a cup</h2>
        <p className="muted small">
          only you see this — pile onto a friend's cup and it hits harder (+{STACK_SIPS} each)
        </p>
        <Table
          cups={cups}
          onCup={(c) => select(selected === c ? null : c)}
          look={(c) => ({
            emoji: selected === c ? '☠️' : '🥃',
            cls: `ps-cup-spike ${selected === c ? 'ps-cup-sel' : ''}`,
          })}
          center={
            <span className="ps-victim">
              <span className="ps-victim-emoji fx-float">{drinker?.emoji ?? '🍷'}</span>
              <span className="ps-victim-name">{nameOf(drinkerUid)}</span>
              <span className="ps-victim-role">drinks</span>
            </span>
          }
        />
        <Button
          variant="gold"
          size="lg"
          full
          disabled={selected == null}
          onClick={() => submitInput({ cup: selected as number })}
        >
          {selected == null ? 'TAP A CUP' : `POISON CUP ${selected + 1} 🔒`}
        </Button>
      </div>
    );
  }

  /* ---------- the victim's pick ---------- */

  if (state.phase === 'drinking' && drinkerUid === me.uid) {
    const hover = state.hover ?? null;
    const tap = (c: number) => {
      if (sniffing && !sniff) {
        setSniffing(false);
        submitInput({ sniff: c });
        return;
      }
      const next = hover === c ? null : c;
      submitInput({ hover: next });
    };
    return (
      <div className="gv ps">
        <span className="ps-badge ps-badge-drink">🍷 YOU DRINK</span>
        <h2 className="fx-title">{sniffing ? 'Sniff which cup?' : 'Pick your poison'}</h2>
        <p className="muted small">
          {order.length} {order.length === 1 ? 'dose is' : 'doses are'} in there. Everyone can see where your hand
          is — watch their faces.
        </p>
        <Table
          cups={cups}
          onCup={tap}
          tone={sniffing ? 'ps-table-sniffing' : ''}
          look={(c) => ({
            emoji: '🍷',
            cls: `ps-cup-drink ${hover === c ? 'ps-cup-sel ps-cup-hover' : ''} ${zone.includes(c) ? 'ps-cup-zone' : ''}`,
          })}
          center={
            sniff ? (
              <span className="ps-sniffed fx-pop">
                <span className="ps-sniffed-n">{sniff.count}</span>
                <span className="ps-sniffed-l">👃 {sniff.count === 1 ? 'dose' : 'doses'} nearby</span>
              </span>
            ) : (
              <span className="ps-victim">
                <span className="ps-victim-emoji fx-wiggle">🤔</span>
              </span>
            )
          }
        />
        {sniffLine && <p className="ps-sniffline">👃 {sniffLine}</p>}
        <div className="ps-actions">
          <Button
            variant="ghost"
            size="md"
            disabled={!!sniff}
            className={sniffing ? 'ps-sniff-on' : ''}
            onClick={() => setSniffing(!sniffing)}
          >
            {sniff ? '👃 used' : sniffing ? 'cancel' : '👃 SNIFF ×1'}
          </Button>
          <Button
            variant="gold"
            size="lg"
            disabled={hover == null || sniffing}
            onClick={() => submitInput({ cup: hover as number })}
          >
            {hover == null ? 'TAP A CUP' : `DRINK CUP ${hover + 1} 🍺`}
          </Button>
        </div>
        <Crew order={order} players={players} reactions={reactions} />
        <p className="muted small">
          poisoned → you drink {SIPS}+ · clean → they drink {MISS_SIPS} · antidote 💚 → it bounces back (
          {ANTIDOTE_MISS_SIPS})
        </p>
      </div>
    );
  }

  /* ---------- watching ---------- */

  const iDrink = drinkerUid === me.uid;

  if (state.phase === 'pouring') {
    return (
      <div className="gv ps">
        {iDrink ? (
          <span className="ps-badge ps-badge-drink">🍷 YOU'RE DRINKING</span>
        ) : myPour != null ? (
          <span className="ps-badge ps-badge-poison">☠️ POURED — CUP {myPour + 1}</span>
        ) : (
          <span className="ps-badge">☠️ POISONER</span>
        )}
        <h2 className="fx-title fx-title-pink">
          {iDrink ? "They're spiking your drinks…" : 'The crew is pouring…'}
        </h2>
        <Table
          cups={cups}
          look={(c) => ({
            emoji: myPour === c ? '☠️' : '🥃',
            cls: myPour === c ? 'ps-cup-mine' : '',
          })}
          center={
            <span className="ps-victim">
              <span className="ps-victim-emoji fx-float">{iDrink ? '🙈' : (drinker?.emoji ?? '🍷')}</span>
              <span className="ps-victim-name">{iDrink ? 'no peeking' : nameOf(drinkerUid)}</span>
              {!iDrink && <span className="ps-victim-role">drinks</span>}
            </span>
          }
        />
        <p className="muted">
          {pouredCount}/{order.length} poured
          {iDrink ? ` — then you choose from all ${cups} cups` : ''}
        </p>
        <Crew order={order} players={players} done={(uid) => poisons[uid] != null} />
      </div>
    );
  }

  // drinking, and I'm one of the crew: watch the hand, pull a face
  const hover = state.hover ?? null;
  return (
    <div className="gv ps">
      <span className="ps-badge ps-badge-poison">
        ☠️ {myPour != null ? `YOUR POISON — CUP ${myPour + 1}` : 'POISONER'}
      </span>
      <h2 className="fx-title fx-title-pink">{nameOf(drinkerUid)} is choosing…</h2>
      <Table
        cups={cups}
        look={(c) => ({
          emoji: myPour === c ? '☠️' : '🥃',
          cls: `${myPour === c ? 'ps-cup-mine' : ''} ${hover === c ? 'ps-cup-sel ps-cup-hover' : ''} ${zone.includes(c) ? 'ps-cup-zone' : ''}`,
        })}
        center={
          sniff ? (
            <span className="ps-sniffed fx-pop">
              <span className="ps-sniffed-n">{sniff.count}</span>
              <span className="ps-sniffed-l">👃 {sniff.count === 1 ? 'dose' : 'doses'} nearby</span>
            </span>
          ) : (
            <span className="ps-victim">
              <span className="ps-victim-emoji fx-wiggle">{drinker?.emoji ?? '🍷'}</span>
              <span className="ps-victim-name">{hover == null ? 'thinking…' : `hand on cup ${hover + 1}`}</span>
            </span>
          )
        }
      />
      {sniffLine ? (
        <p className="ps-sniffline">
          👃 {nameOf(drinkerUid)} sniffed: {sniffLine}
        </p>
      ) : (
        <p className="muted small">they still have a sniff 👃 left</p>
      )}
      <div className="ps-reacts">
        {REACTIONS.map((e) => (
          <button key={e} className="ps-react" onClick={() => submitInput({ react: e })}>
            {e}
          </button>
        ))}
      </div>
      <p className="muted small">pull a face — bluff them onto your cup 🤫</p>
      <Crew order={order} players={players} reactions={reactions} />
    </div>
  );
}
