import { PROTOCOL_VERSION, shortId, stageKeyOf } from './protocol';
import type { EngineNode } from '../types';

/**
 * The engine node a room is born with.
 *
 * It carries the protocol stamp, the creator's host lease (scoped to their
 * browser tab), revision 1, and the round/phase identities — so the very
 * first engine commit has a revision to increment, every later client can
 * tell which protocol the room speaks before writing anything, and an
 * already-running room can never be adopted by a build that does not
 * understand it.
 *
 * Shared by room creation (state/AppState.tsx) and the test harness, so the
 * shape has exactly one definition.
 */
export function initialEngine(uid: string, instanceId: string, now: number): EngineNode {
  const roundId = shortId();
  const phaseId = shortId();
  return {
    protov: PROTOCOL_VERSION,
    lease: { uid, instanceId, generation: 1, renewedAt: now },
    rev: 1,
    phase: 'lobby',
    round: 0,
    roundId,
    phaseId,
    stageKey: stageKeyOf(roundId, phaseId),
    rotation: [],
    gameIndex: 0,
    turnOrder: [],
    actorUid: null,
    roundUids: null,
    forceNext: false,
    outcome: null,
    gate: null,
    ready: {},
    claims: {},
    game: null,
    awards: { scores: {}, drinks: {} },
    recovery: null,
    fault: null,
    log: [{ at: now, kind: 'created', detail: 'room created', rev: 1 }],
  };
}
