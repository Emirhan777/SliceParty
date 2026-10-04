// Explicit live integration test. Only creates and removes its own game room.
import assert from 'node:assert/strict';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getDatabase, get, onValue, ref, remove, runTransaction, set } from 'firebase/database';
import { firebaseConfig } from '../../firebase-config';
import { joinRoom } from '../src/controller';

const db = getDatabase(getApps().length ? getApp() : initializeApp(firebaseConfig));
async function main() {
const code = String(Math.floor(100000 + Math.random() * 900000));
const roomRef = ref(db, 'rooms/' + code);
const bail = setTimeout(() => { console.error('Native relay check timed out.'); process.exit(1); }, 20000);
const aborts = [new AbortController(), new AbortController(), new AbortController()];
const offs: (() => void)[] = [];
let owned = false;
function waitFor(path: string, predicate: (value: any) => boolean) {
  return new Promise<void>(resolve => {
    const off = onValue(ref(db, path), s => { if (predicate(s.val())) resolve(); });
    offs.push(off);
  });
}
try {
  const claim = await runTransaction(roomRef, current => current === null ? { game: 'ninja', status: 'lobby', createdAt: Date.now() } : undefined);
  assert(claim.committed, 'test room collision; rerun'); owned = true;
  let score = -1;
  const callbacks = { onHud: (hud: { score?: number }) => { score = hud.score ?? -1; }, onStatus: () => {}, onClosed: () => {} };
  const [one, two] = await Promise.all(aborts.slice(0, 2).map(a => joinRoom(code, callbacks, a.signal)));
  const players = (await get(ref(db, `rooms/${code}/players`))).val();
  assert.equal(Object.keys(players).length, 2);
  assert.deepEqual(Object.values(players).map((p: any) => p.slot).sort(), [0, 1]);
  await assert.rejects(joinRoom(code, callbacks, aborts[2].signal), /two swords/);
  const blade = waitFor(`rooms/${code}/input`, inputs => Object.values(inputs || {}).some((p: any) => p.x === .85 && p.y === .2 && p.vx === 0));
  one.send({ x: .85, y: .2 }); await blade;
  const cmd = waitFor(`rooms/${code}/cmd`, commands => Object.values(commands || {}).some((c: any) => c.type === 'start'));
  one.command('start'); await cmd;
  await set(ref(db, `rooms/${code}/hud`), { score: 123, best: 200, lives: 2 });
  await waitFor(`rooms/${code}/hud`, data => data?.score === 123);
  await new Promise<void>(resolve => {
    const timer = setInterval(() => { if (score === 123) { clearInterval(timer); resolve(); } }, 10);
  });
  one.destroy(); two.destroy();
  await waitFor(`rooms/${code}/players`, value => value === null);
  await waitFor(`rooms/${code}/input`, value => value === null);
  await waitFor(`rooms/${code}/cmd`, value => value === null);
  console.log('NATIVE RELAY PASS: atomic two-player join, room limit, movement, start, score, and disconnect cleanup.');
} finally {
  aborts.forEach(a => a.abort()); offs.forEach(off => off());
  if (owned) await remove(roomRef);
  clearTimeout(bail);
}
process.exit(0);
}
void main().catch(error => { console.error(error); process.exit(1); });
