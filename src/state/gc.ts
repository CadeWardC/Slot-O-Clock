import { get, ref, remove, type Database } from 'firebase/database';
import { ROOM_TTL_MS } from './protocol';
import { serverNow } from './serverTime';

export { ROOM_TTL_MS };

/** Clean up a known room only. The global index is private to prevent discovery.
 * Unvisited abandoned rooms require scheduled cleanup with a trusted backend.
 * Rules independently enforce expiry before a non-owner can delete a room.
 */
export async function sweepExpiredRooms(db: Database, code?: string): Promise<void> {
  if (!code || !/^[A-Z0-9]{4}$/.test(code)) return;
  try {
    const roomRef = ref(db, 'rooms/' + code);
    const snap = await get(roomRef);
    const expiresAt: unknown = snap.child('meta/expiresAt').val();
    if (snap.exists() && !(typeof expiresAt === 'number' && expiresAt < serverNow() - 5000)) return;
    if (snap.exists()) await remove(roomRef);
    await remove(ref(db, 'roomIndex/' + code));
  } catch {
    // Offline, already collected, or refreshed by the host: cleanup is best-effort.
  }
}
