import assert from "node:assert/strict";
import { createTracker } from "../ninja/tilt.js";
import { createPhoneMotion } from "../ninja/motion.js";
import { createBlade } from "../ninja/blade.js";

// Match the copied HarryPotterSpells mechanism, including heading wrap,
// fixed gains, calibration, and ignoring roll/velocity.
const tr = createTracker();
assert.deepEqual(tr.push(350, 45), { x: .5, y: .5, vx: 0, vy: 0 });
assert(tr.push(315, 45).x > .8, "right turn must move the blade right");
assert(tr.push(25, 45).x < .2, "left turn across compass wrap must move left");
assert(tr.push(350, 70).y < .1, "upward swing must move up");
assert(tr.push(350, 20).y > .9, "downward swing must move down");
assert.deepEqual(tr.push(350, 45, 85), tr.push(350, 45, -85), "roll must not affect the copied mapping");
tr.center();
assert.deepEqual(tr.push(100, 30), { x: .5, y: .5, vx: 0, vy: 0 });
assert.equal(tr.push(null, 30), null);
assert.deepEqual(tr.pushPoint(-1, 2), { x: 0, y: 1, vx: 0, vy: 0 });

function sensorEnvironment() {
  let time = 0, interval = null;
  const listeners = new Map(), requested = [];
  const env = {
    isSecureContext: true,
    performance: { now: () => time },
    DeviceOrientationEvent: { requestPermission() { requested.push("orientation"); return Promise.resolve("granted"); } },
    DeviceMotionEvent: { requestPermission() { requested.push("motion"); return Promise.resolve("granted"); } },
    addEventListener: (name, cb) => listeners.set(name, cb),
    removeEventListener: name => listeners.delete(name),
    setInterval: cb => { interval = cb; return 1; },
    clearInterval: () => { interval = null; },
  };
  return {
    env, requested, listeners,
    tick(t) { time = t; interval?.(); },
    emit(name, data) { listeners.get(name)?.(data); },
  };
}
const sim = sensorEnvironment(), samples = [];
let mode;
const sensors = createPhoneMotion({ tracker: createTracker(), env: sim.env, onSample: p => samples.push(p), onMode: m => { mode = m; } });
const starting = sensors.start();
assert.deepEqual(sim.requested, ["orientation"], "orientation permission requested synchronously in the user gesture");
await starting;
assert.equal(mode, "waiting");
sim.emit("deviceorientation", { alpha: null, beta: null, gamma: null });
assert.equal(samples.length, 0);
sim.tick(6000);
assert.equal(mode, "touch");
sim.emit("deviceorientation", { alpha: 0, beta: 90, gamma: 0 });
assert.equal(mode, "motion", "late sensors must recover automatically");
for (let i = 0; i < 400; i++) {
  sim.tick(6000 + i * 20);
  sim.emit("deviceorientation", { alpha: 0, beta: 90, gamma: 0 });
}
assert.equal(mode, "motion", "holding still must not be mistaken for a dead sensor");
sensors.stop();
assert.equal(sim.listeners.size, 0);
sim.env.DeviceOrientationEvent.requestPermission = () => Promise.resolve("denied");
await sensors.start();
assert.equal(mode, "touch", "denied orientation permission must offer touch");
assert.equal(sim.listeners.size, 0);
sensors.stop();

const blade = createBlade();
blade.feed({ x: 0.3, y: 0.5, vx: 4, latencyMs: 150 }, 0);
blade.step(1 / 60, 16);
assert.equal(blade.position.x, 0.3, "velocity must never extrapolate beyond a measured point");
blade.feed({ x: 0.7, y: 0.2, vx: 4, vy: -4 }, 20);
for (let i = 0; i < 30; i++) {
  blade.step(1 / 60, 20 + i * 1000 / 60);
  assert(blade.position.x >= .3 && blade.position.x <= .7);
  assert(blade.position.y >= .2 && blade.position.y <= .5);
}
assert(Math.abs(blade.position.x - .7) < 1e-6);
assert(Math.abs(blade.position.y - .2) < 1e-6);
console.log("MOTION TEST: PASS - copied heading/pitch mapping, recentering, permissions, recovery, and screen easing");
