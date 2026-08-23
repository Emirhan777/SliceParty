// End-to-end check of the relay the sword rides on.  npm test
//
// It talks to the Realtime Database over its REST API using the built-in fetch,
// so it runs from a clean checkout with nothing installed - and it exercises the
// exact paths and the exact security rules the browser does.
//
// It asserts the three things that would silently break the game:
//   1. a room can be created under rooms/{6 digits}
//   2. input/{pid} can be OVERWRITTEN in place (the sword is a cursor, not a log)
//   3. firebase-rules.json still refuses writes outside rooms/

import { firebaseConfig } from "../firebase-config.js";

const BASE = firebaseConfig.databaseURL.replace(/\/$/, "");
const code = String(Math.floor(100000 + Math.random() * 900000));
const pid = "test_" + Math.random().toString(36).slice(2, 8);

const url = (path) => `${BASE}/${path}.json`;
const put = (path, body) => fetch(url(path), { method: "PUT", body: JSON.stringify(body) });
const get = (path) => fetch(url(path)).then((r) => r.json());
const del = (path) => fetch(url(path), { method: "DELETE" });

let failures = 0;
function check(name, ok, detail = "") {
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (detail ? "  " + detail : ""));
  if (!ok) failures++;
}

const bail = setTimeout(() => {
  console.error("\nTIMEOUT — could not reach the database at " + BASE);
  process.exit(1);
}, 20000);

try {
  console.log("room " + code + ", player " + pid + "\n");

  // 1. the room itself
  let res = await put(`rooms/${code}`, { game: "ninja", status: "lobby", createdAt: Date.now() });
  check("create room", res.ok, "HTTP " + res.status);

  // 2. the blade stream — write, overwrite, and confirm it replaced rather
  //    than accumulated. This is the whole difference from PenDraw's push().
  const samples = [
    { x: 0.10, y: 0.90, vx: 0.0, vy: 0.0, t: Date.now() },
    { x: 0.50, y: 0.50, vx: 2.4, vy: -1.8, t: Date.now() },
    { x: 0.92, y: 0.18, vx: 3.1, vy: -0.4, t: Date.now() },
  ];
  for (const s of samples) {
    res = await put(`rooms/${code}/input/${pid}`, s);
    if (!res.ok) { check("write blade sample", false, "HTTP " + res.status); break; }
  }
  const last = await get(`rooms/${code}/input/${pid}`);
  check("blade sample readable", last && typeof last.x === "number", JSON.stringify(last));
  check("last write wins (no growth)", last?.x === 0.92 && last?.y === 0.18, "x=" + last?.x);
  check("velocity survives the trip", last?.vx === 3.1, "vx=" + last?.vx);

  const inputNode = await get(`rooms/${code}/input`);
  check("one node per player", Object.keys(inputNode || {}).length === 1, Object.keys(inputNode || {}).join(","));

  // 3. the HUD comes back the other way
  await put(`rooms/${code}/hud`, { score: 120, best: 340, lives: 2, combo: 3, status: "playing" });
  const hud = await get(`rooms/${code}/hud`);
  check("hud round trip", hud?.score === 120 && hud?.lives === 2);

  // 4. the rules still hold the line
  res = await put("nope_not_a_room", { x: 1 });
  check("writes outside rooms/ are rejected", res.status === 401 || res.status === 403, "HTTP " + res.status);
  res = await put("rooms/abc", { x: 1 });
  check("non-numeric room codes are rejected", res.status === 401 || res.status === 403, "HTTP " + res.status);

  await del(`rooms/${code}`);
  const gone = await get(`rooms/${code}`);
  check("cleanup", gone === null);

  clearTimeout(bail);
  console.log(failures === 0 ? "\nRELAY TEST: PASS" : `\nRELAY TEST: FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
} catch (e) {
  clearTimeout(bail);
  await del(`rooms/${code}`).catch(() => {});
  console.error("\nRELAY TEST ERROR: " + e.message);
  process.exit(1);
}
