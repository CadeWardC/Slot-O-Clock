import {
  endAt,
  get,
  orderByValue,
  query,
  ref,
  remove,
  type Database,
} from 'firebase/database';

/**
 * Abandoned-room garbage collection.
 *
 * There is no server (GitHub Pages hosting), so cleanup is lazy: every room
 * carries an `expiresAt` TTL (refreshed by the host while the room lives)
 * and is listed in `roomIndex/{code}`. Any client that opens the app sweeps
 * entries past their TTL — the security rules only allow deleting a room
 * whose `meta/expiresAt` is already in the past, so a live room can never
 * be collected.
 */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

export async function sweepExpiredRooms(db: Database): Promise<void> {
  try {
    const snap = await get(query(ref(db, 'roomIndex'), orderByValue(), endAt(Date.now())));
    const stale: string[] = [];
    snap.forEach((child) => {
      if (child.key) stale.push(child.key);
    });
    await Promise.all(
      stale.map((code) =>
        remove(ref(db, `rooms/${code}`))
          .catch(() => {})
          .then(() => remove(ref(db, `roomIndex/${code}`)).catch(() => {})),
      ),
    );
  } catch {
    // rules not deployed / offline — cleanup is best-effort
  }
}
