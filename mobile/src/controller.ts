import { getApp, getApps, initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, remove, onValue, onDisconnect, runTransaction, push } from 'firebase/database';
import { firebaseConfig } from '../../firebase-config';
import { GAME_ID, parseRoom, claimPlayer, type Hud, type Point } from './protocol';
import { createSwordSender } from './sender';

const db = getDatabase(getApps().length ? getApp() : initializeApp(firebaseConfig));
export type Controller = { send: (sample: Point) => void; command: (type: 'start' | 'again' | 'center') => void; destroy: () => void };

type Callbacks = { onHud: (hud: Hud) => void; onStatus: (status: string) => void; onClosed: (reason: string) => void };
export async function joinRoom(code: string, callbacks: Callbacks, signal: AbortSignal): Promise<Controller> {
  const base = 'rooms/' + parseRoom(code);
  const pid = push(ref(db, base + '/players')).key!;
  const nodes = ['players', 'input', 'cmd'].map(part => ref(db, `${base}/${part}/${pid}`));
  const disconnects = nodes.map(node => onDisconnect(node));
  const offs: (() => void)[] = [];
  let sender: ReturnType<typeof createSwordSender> | undefined;
  let disposed = false, closing = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    sender?.destroy();
    offs.forEach(off => off());
    signal.removeEventListener('abort', destroy);
    // Keep onDisconnect armed until the explicit removal is acknowledged.
    nodes.forEach((node, i) => { void remove(node).then(() => disconnects[i].cancel()).catch(() => {}); });
  };
  const closed = (reason: string) => {
    if (disposed || closing) return;
    closing = true;
    destroy();
    callbacks.onClosed(reason);
  };
  const active = () => { if (disposed || signal.aborted) throw new Error('Connection cancelled.'); };
  signal.addEventListener('abort', destroy, { once: true });
  try {
    active();
    const snapshot = await get(ref(db, base));
    active();
    const room = snapshot.val();
    if (!room?.createdAt) throw new Error('That room has closed. Scan the screen again.');
    if (room.game !== GAME_ID) throw new Error('That room belongs to a different game.');
    if (room.status === 'waiting-screen') throw new Error('Open the shared link on your big screen first.');
    await Promise.all(disconnects.map(handle => handle.remove()));
    active();
    const result = await runTransaction(ref(db, base + '/players'), players => {
      if (disposed || signal.aborted) return undefined;
      return claimPlayer(players, pid);
    }, { applyLocally: false });
    // An abort during the transaction may race its acknowledgement: remove again.
    if (disposed || signal.aborted) { await remove(nodes[0]); active(); }
    if (!result.committed) throw new Error('This room already has two swords. Try another room.');
    const current = await get(ref(db, base + '/createdAt'));
    active();
    if (current.val() !== room.createdAt) throw new Error('The big screen changed rooms. Scan its new QR.');
    offs.push(onValue(ref(db, base + '/hud'), s => callbacks.onHud(s.val() || {})));
    offs.push(onValue(ref(db, base + '/status'), s => callbacks.onStatus(s.val() || 'lobby')));
    offs.push(onValue(ref(db, base + '/createdAt'), s => {
      if (s.val() !== room.createdAt) closed('The big screen closed this room. Scan the new QR to reconnect.');
    }));
    let wasConnected = false;
    offs.push(onValue(ref(db, '.info/connected'), s => {
      if (s.val()) wasConnected = true;
      else if (wasConnected) closed('Connection lost. Rejoin when your internet is back.');
    }));
    sender = createSwordSender(wire => {
      void set(nodes[1], wire).catch(() => closed('Could not send sword movement. Please rejoin.'));
    });
    return {
      send(sample) {
        if (disposed) return;
        sender!.send(sample);
      },
      command(type) {
        if (!disposed) void set(nodes[2], { type, at: Date.now() }).catch(() => closed('Connection lost. Please rejoin.'));
      },
      destroy,
    };
  } catch (error) { destroy(); throw error; }
}
