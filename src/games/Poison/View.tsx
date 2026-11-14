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
            {done && <span className="ps-crew-tick">{done(uid) ? 'in' : '…'}</span>}
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
        <h2>This round is from an older version</h2>
        <p className="muted">The host can skip it.</p>
      </div>
    );
  }

  const sniff = state.sniff ?? null;
  const zone = sniff ? sniffZone(sniff.cup, cups) : [];
  const doses = (n: number) => `${n} ${n === 1 ? 'dose' : 'doses'}`;
  const sniffLine = sniff
    ? cups <= 3
      ? `${doses(sniff.count)} on the table`
      : `${doses(sniff.count)} in cups ${zone.map((c) => c + 1).join(', ')}`
    : null;
  const sniffed = sniff && (
    <span className="ps-sniffed fx-pop">
      <span className="ps-sniffed-n">{sniff.count}</span>
      <span className="ps-sniffed-l">{sniff.count === 1 ? 'dose' : 'doses'} nearby</span>
    </span>
  );
  const victim = (line: string, role?: string) => (
    <span className="ps-victim">
      <span className="ps-victim-emoji">{drinker?.emoji ?? '🍷'}</span>
      <span className="ps-victim-name">{line}</span>
      {role && <span className="ps-victim-role">{role}</span>}
    </span>
  );

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
        <div className="ps-head">
          <span className="fx-tag fx-tag-ink">Cup {pick + 1}</span>
          <h2 className={`fx-title ${!verdict ? '' : outcome === 'hit' ? 'fx-title-red' : 'fx-title-green'}`}>
            {!verdict
              ? `${nameOf(drinkerUid)} drinks`
              : outcome === 'hit'
                ? 'Poisoned'
                : outcome === 'antidote'
                  ? 'Antidote'
                  : 'Clean'}
          </h2>
        </div>
        <Table
          cups={cups}
          tone={verdict ? `ps-table-${outcome}` : ''}
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
              <span className="ps-wait">…</span>
            ) : (
              <span
                className={`fx-stamp ps-stamp ${outcome === 'hit' ? '' : outcome === 'antidote' ? 'fx-stamp-good' : 'fx-stamp-gold'}`}
              >
                {outcome === 'hit' ? 'dead' : outcome === 'antidote' ? 'bounce' : 'safe'}
              </span>
            )
          }
        />
        {verdict && outcome !== 'hit' && <Confetti />}

        {verdict && (
          <div className="fx-paper ps-sheet fx-rise">
            <p className="ps-verdict">{state.note}</p>
            {flipped &&
              order.map((uid) => {
                const cup = poisons[uid];
                const mine = (state.assignments ?? []).find((a) => a.uid === uid);
                return (
                  <div key={uid} className="ps-row">
                    <span className="ps-row-who">
                      {emojiOf(uid)} {nameOf(uid)}
                    </span>
                    <span className="ps-row-cup">{cup == null ? 'no pour' : `cup ${cup + 1}`}</span>
                    <span className={`ps-row-res ${cup === pick ? 'ps-row-hit' : ''}`}>
                      {mine ? `drinks ${mine.sips}` : cup === pick ? 'hit' : 'miss'}
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
        <div className="ps-head">
          <span className="fx-tag fx-tag-red">Your pour</span>
          <h2 className="fx-title">Spike a cup</h2>
          <p className="ps-sub">Only you see this. Share a cup with someone and it hits +{STACK_SIPS} harder.</p>
        </div>
        <Table
          cups={cups}
          onCup={(c) => select(selected === c ? null : c)}
          look={(c) => ({
            emoji: selected === c ? '☠️' : '🥃',
            cls: selected === c ? 'ps-cup-bad' : '',
          })}
          center={victim(nameOf(drinkerUid), 'drinks')}
        />
        <Button
          variant="gold"
          size="lg"
          full
          disabled={selected == null}
          onClick={() => submitInput({ cup: selected as number })}
        >
          {selected == null ? 'Tap a cup' : `Poison cup ${selected + 1}`}
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
        <div className="ps-head">
          <span className="fx-tag fx-tag-green">You drink</span>
          <h2 className="fx-title">{sniffing ? 'Sniff which?' : 'Pick a cup'}</h2>
          <p className="ps-sub">
            {doses(order.length)} in {cups} cups. They can all see where your hand is.
          </p>
        </div>
        <Table
          cups={cups}
          onCup={tap}
          tone={sniffing ? 'ps-table-sniffing' : ''}
          look={(c) => ({
            emoji: '🍷',
            cls: `${hover === c ? 'ps-cup-sel ps-cup-hover' : ''} ${zone.includes(c) ? 'ps-cup-zone' : ''}`,
          })}
          center={sniffed || <span className="ps-wait">?</span>}
        />
        {sniffLine && <p className="ps-sniffline">Sniffed: {sniffLine}.</p>}
        <div className="ps-actions">
          <Button variant="ghost" size="lg" disabled={!!sniff} onClick={() => setSniffing(!sniffing)}>
            {sniff ? 'Sniffed' : sniffing ? 'Cancel' : 'Sniff'}
          </Button>
          <Button
            variant="gold"
            size="lg"
            disabled={hover == null || sniffing}
            onClick={() => submitInput({ cup: hover as number })}
          >
            {hover == null ? 'Tap a cup' : `Drink cup ${hover + 1}`}
          </Button>
        </div>
        <Crew order={order} players={players} reactions={reactions} />
        <p className="ps-sub">
          Poisoned: you drink {SIPS} or more. Clean: they drink {MISS_SIPS} each. One cup is an antidote and sends
          it back at them ({ANTIDOTE_MISS_SIPS} if it was clean).
        </p>
      </div>
    );
  }

  /* ---------- watching ---------- */

  const iDrink = drinkerUid === me.uid;

  if (state.phase === 'pouring') {
    return (
      <div className="gv ps">
        <div className="ps-head">
          {iDrink ? (
            <span className="fx-tag fx-tag-green">You drink</span>
          ) : (
            <span className="fx-tag fx-tag-red">{myPour != null ? `Yours: cup ${myPour + 1}` : 'Poisoner'}</span>
          )}
          <h2 className="fx-title">{iDrink ? 'Look away' : 'Pouring'}</h2>
          <p className="ps-sub">
            {pouredCount} of {order.length} poured.{iDrink ? ` Then you pick from ${cups} cups.` : ''}
          </p>
        </div>
        <Table
          cups={cups}
          look={(c) => ({
            emoji: myPour === c ? '☠️' : '🥃',
            cls: myPour === c ? 'ps-cup-bad' : '',
          })}
          center={iDrink ? <span className="ps-wait">…</span> : victim(nameOf(drinkerUid), 'drinks')}
        />
        <Crew order={order} players={players} done={(uid) => poisons[uid] != null} />
      </div>
    );
  }

  // drinking, and I'm one of the crew: watch the hand, pull a face
  const hover = state.hover ?? null;
  return (
    <div className="gv ps">
      <div className="ps-head">
        <span className="fx-tag fx-tag-red">{myPour != null ? `Yours: cup ${myPour + 1}` : 'Poisoner'}</span>
        <h2 className="fx-title">{nameOf(drinkerUid)} picks</h2>
        <p className="ps-sub">
          {sniffLine
            ? `Sniffed: ${sniffLine}.`
            : hover == null
              ? 'No hand on a cup yet. One sniff left.'
              : `Hand on cup ${hover + 1}. One sniff left.`}
        </p>
      </div>
      <Table
        cups={cups}
        look={(c) => ({
          emoji: myPour === c ? '☠️' : '🥃',
          cls: `${myPour === c ? 'ps-cup-bad' : ''} ${hover === c ? 'ps-cup-sel ps-cup-hover' : ''} ${zone.includes(c) ? 'ps-cup-zone' : ''}`,
        })}
        center={sniffed || victim(hover == null ? 'thinking' : `cup ${hover + 1}?`)}
      />
      <div className="ps-reacts">
        {REACTIONS.map((e) => (
          <button key={e} className="ps-react" onClick={() => submitInput({ react: e })}>
            {e}
          </button>
        ))}
      </div>
      <p className="ps-sub ps-sub-c">Pull a face. Lying is allowed.</p>
      <Crew order={order} players={players} reactions={reactions} />
    </div>
  );
}
