// The transport seam.
//
// Everything that knows about Firebase lives in this file. The game engine and
// both pages talk to createHost() / createController() and never import the SDK
// themselves, so moving the blade stream onto a WebRTC datachannel later is a
// change to ONE file. Look for the "TRANSPORT:" markers.
//
// Wire format, under rooms/{code} (the only tree firebase-rules.json lets us
// write to, so PenDraw and Fruit Ninja share it - game:"ninja" tells them apart):
//
//   game:          "ninja"
//   status:        "lobby" | "playing" | "over"
//   createdAt:     serverTimestamp()
//   players/{pid}: { joinedAt, slot }        slot 0|1 -> blade colour
//   input/{pid}:   { x, y, vx, vy, t }       set() ~50Hz, OVERWRITTEN not appended
//   cmd/{pid}:     { type, at }              "start" | "again" | "center"
//   hud:           { score, best, lives, combo, status }
//
// PenDraw push()es a new child per point because a drawing is a growing list.
// A sword is a cursor: one node, overwritten forever, so a long session costs
// the same as a short one.

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, get, set, remove, onValue, onChildAdded, onChildChanged,
  onChildRemoved, onDisconnect, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "../firebase-config.js";

const db = getDatabase(getApps().length ? getApp() : initializeApp(firebaseConfig));

export const MAX_SLOTS = 2;                     // one phone today, two tomorrow
const HUD_MIN_MS = 200;                         // screen -> phone, ~5Hz is plenty
const BLADE_MIN_MS = 20;                        // phone -> screen, cap at ~50Hz
const BLADE_KEEPALIVE_MS = 250;                 // resend even when perfectly still

const newPid = () => "p_" + Math.random().toString(36).slice(2, 10);

// Find an unused room code.
//
// Reading only `createdAt` keeps this to a few bytes. Reading the whole room
// would drag down every other app sharing this database - PenDraw rooms carry a
// full drawing history - and enumerating all of `rooms/` to garbage-collect
// would be worse still, as well as risking deleting a room that is not ours.
// A code collision is a 1-in-900,000 event: just pick another one. Stale rooms
// are a few dozen bytes and harm nothing.
async function freeCode() {
  for (let i = 0; i < 20; i++) {
    const c = String(Math.floor(100000 + Math.random() * 900000));
    if (!(await get(ref(db, "rooms/" + c + "/createdAt"))).exists()) return c;
  }
  return String(Date.now()).slice(-6);
}

// ---------------------------------------------------------------------------
// HOST - the big screen. Owns the room and the game state.
// ---------------------------------------------------------------------------
export async function createHost({ onJoin, onLeave, onBlade, onCmd } = {}) {
  const code = await freeCode();
  const base = "rooms/" + code;
  const room = ref(db, base);
  await set(room, { game: "ninja", status: "lobby", createdAt: serverTimestamp() });
  // Self-deleting room: when this tab closes, refreshes or drops its connection,
  // Firebase removes the whole thing. Abandoned rooms never accumulate.
  onDisconnect(room).remove();

  const offs = [];
  const players = new Map(); // pid -> slot

  offs.push(onChildAdded(ref(db, base + "/players"), (s) => {
    const slot = s.val()?.slot ?? 0;
    players.set(s.key, slot);
    onJoin?.(s.key, slot);
  }));
  offs.push(onChildRemoved(ref(db, base + "/players"), (s) => {
    players.delete(s.key);
    onLeave?.(s.key);
  }));

  // TRANSPORT: this pair of listeners is the blade stream. A WebRTC datachannel
  // would replace exactly these two lines, calling onBlade() with the same shape.
  const blade = (s) => { const v = s.val(); if (v && typeof v.x === "number") onBlade?.(s.key, v); };
  offs.push(onChildAdded(ref(db, base + "/input"), blade));
  offs.push(onChildChanged(ref(db, base + "/input"), blade));

  const cmd = (s) => { const v = s.val(); if (v?.type) onCmd?.(s.key, v.type, v); };
  offs.push(onChildAdded(ref(db, base + "/cmd"), cmd));
  offs.push(onChildChanged(ref(db, base + "/cmd"), cmd));

  let hudAt = 0, hudPending = null, hudTimer = 0;
  function flushHud() {
    hudTimer = 0;
    if (!hudPending) return;
    hudAt = performance.now();
    set(ref(db, base + "/hud"), hudPending).catch(() => {});
    hudPending = null;
  }

  return {
    code,
    // Where the QR points. Resolved against this page so it works the same on
    // localhost, a LAN IP, a tunnel, or GitHub Pages.
    get joinUrl() { return new URL("play.html?room=" + code, location.href).href; },
    get playerCount() { return players.size; },

    // Mirror of the on-screen HUD, throttled - the phone only glances at it.
    setHud(o) {
      hudPending = o;
      const wait = HUD_MIN_MS - (performance.now() - hudAt);
      if (wait <= 0) flushHud();
      else if (!hudTimer) hudTimer = setTimeout(flushHud, wait);
    },

    setStatus(status) { set(ref(db, base + "/status"), status).catch(() => {}); },

    // Drop stale input so a reconnecting phone starts from a clean slate.
    clearInput(pid) { remove(ref(db, base + "/input/" + pid)).catch(() => {}); },

    destroy() {
      offs.forEach((off) => off());
      if (hudTimer) clearTimeout(hudTimer);
      remove(room).catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------
// CONTROLLER - the phone. Streams the blade, reads the HUD.
// ---------------------------------------------------------------------------
export async function createController(code, { onHud, onStatus, onClosed } = {}) {
  const base = "rooms/" + code;
  const snap = await get(ref(db, base));
  if (!snap.exists()) throw new Error("That game is over. Scan the QR on the screen again.");
  const room = snap.val();
  if (room.game && room.game !== "ninja") throw new Error("That code belongs to a different game.");

  // Claim the lowest free slot. Slot decides the blade colour on the big screen.
  const taken = new Set(Object.values(room.players || {}).map((p) => p?.slot));
  let slot = 0;
  while (taken.has(slot) && slot < MAX_SLOTS) slot++;
  if (slot >= MAX_SLOTS) throw new Error("This game already has all its players.");

  const pid = newPid();
  await set(ref(db, base + "/players/" + pid), { joinedAt: serverTimestamp(), slot });
  // Leave nothing behind when this phone locks, closes or wanders off wifi.
  onDisconnect(ref(db, base + "/players/" + pid)).remove();
  onDisconnect(ref(db, base + "/input/" + pid)).remove();
  onDisconnect(ref(db, base + "/cmd/" + pid)).remove();

  const offs = [];
  if (onHud) offs.push(onValue(ref(db, base + "/hud"), (s) => onHud(s.val() || {})));
  if (onStatus) offs.push(onValue(ref(db, base + "/status"), (s) => onStatus(s.val())));
  // The host holds onDisconnect().remove() on the room, so the room vanishing
  // IS the "big screen went away" signal.
  if (onClosed) offs.push(onValue(ref(db, base + "/createdAt"), (s) => { if (!s.exists()) onClosed(); }));

  const inputRef = ref(db, base + "/input/" + pid);
  let lastAt = 0, lastX = 0, lastY = 0;

  return {
    pid, slot,

    // TRANSPORT: the one write that carries the sword. Fire-and-forget - a
    // dropped sample is irrelevant, the next one is 20ms behind it.
    sendBlade({ x, y, vx = 0, vy = 0 }) {
      const now = performance.now();
      const since = now - lastAt;
      if (since < BLADE_MIN_MS) return false;
      // Perfectly still? Still tick occasionally, so the screen can tell the
      // difference between "not moving" and "phone fell off the network".
      const moved = Math.abs(x - lastX) + Math.abs(y - lastY) > 0.0015;
      if (!moved && since < BLADE_KEEPALIVE_MS) return false;
      lastAt = now; lastX = x; lastY = y;
      set(inputRef, { x, y, vx, vy, t: Date.now() }).catch(() => {});
      return true;
    },

    sendCmd(type) {
      set(ref(db, base + "/cmd/" + pid), { type, at: Date.now() }).catch(() => {});
    },

    destroy() {
      offs.forEach((off) => off());
      remove(ref(db, base + "/players/" + pid)).catch(() => {});
      remove(ref(db, base + "/input/" + pid)).catch(() => {});
      remove(ref(db, base + "/cmd/" + pid)).catch(() => {});
    },
  };
}

// Handy in the browser console while tuning.
export { db, ref, set, get, remove };
