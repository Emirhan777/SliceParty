import { getApp, getApps, initializeApp } from 'firebase/app';
import { getDatabase, ref, runTransaction, onValue } from 'firebase/database';
import { firebaseConfig } from '../../firebase-config';
import { LAUNCH_TTL_MS, cancelLaunch } from '../../ninja/launch';
import { GAME_URL } from './protocol';

const db = getDatabase(getApps().length ? getApp() : initializeApp(firebaseConfig));
export type Launch = { code: string; url: string; expiresAt: number; watch: (ready: () => void, failed: (message: string) => void) => () => void; cancel: () => Promise<void> };

export async function reserveScreen(token: string, signal: AbortSignal): Promise<Launch> {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('Could not create a game link. Try again.');
  for (let i = 0; i < 20; i++) {
    if (signal.aborted) throw new Error('Cancelled.');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const room = ref(db, 'rooms/' + code);
    const expiresAt = Date.now() + LAUNCH_TTL_MS;
    const result = await runTransaction(room, current => current === null && !signal.aborted
      ? { game: 'ninja', createdAt: Date.now(), status: 'waiting-screen', launch: { token, expiresAt } }
      : undefined, { applyLocally: false });
    if (!result.committed) continue;
    const cancel = async () => { await runTransaction(room, value => value === null ? null : cancelLaunch(value, token), { applyLocally: false }); };
    if (signal.aborted) { await cancel(); throw new Error('Cancelled.'); }
    return {
      code, expiresAt, url: `${GAME_URL}#launch=${code}.${token}`, cancel,
      watch(ready, failed) {
        // Pairing does not need the high-frequency input or HUD branches.
        return onValue(ref(db, `rooms/${code}/launch`), snapshot => {
          const value = snapshot.val();
          if (value?.token !== token) failed('This game link has closed. Create a new link.');
          else if (value.claimed) ready();
        }, () => failed('Could not reach the screen. Check your connection and try again.'));
      },
    };
  }
  throw new Error('Could not prepare a game link. Check your internet and try again.');
}
