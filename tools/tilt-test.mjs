// Does the sword hold still?  npm run test:tilt
//
// You cannot feel a jittery blade from a unit test, but you can measure it.
// This drives a SMOOTH, PHYSICAL motion - the phone held upright and swung
// left and right about the vertical, which is exactly how you hold a sword -
// adds a realistic pinch of sensor noise, and measures how far the on-screen
// point moves between consecutive samples.
//
// A smooth input must produce a smooth output. Any single step much bigger than
// the average is a visible jump.
//
// The comparison is against the obvious implementation (alpha -> x, beta -> y),
// which is what this game used to do and which falls apart near beta = 90
// degrees: there alpha and gamma describe the same rotation, so the fusion is
// free to trade one for the other and alpha alone becomes meaningless.

import { pointingVector, YAW_GAIN, PITCH_GAIN, wrapPi } from "../ninja/tilt.js";

const DEG = Math.PI / 180;
const mul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];

// What the browser reports, given a device->Earth rotation matrix.
// These are the standard inverse formulas, ill-conditioned exactly where the
// bug lives: as cos(beta) -> 0 both atan2 arguments collapse to zero.
function eulerFromMatrix(R) {
  const beta = Math.asin(Math.max(-1, Math.min(1, R[2][1])));
  const alpha = Math.atan2(-R[0][1], R[1][1]);
  const gamma = Math.atan2(-R[2][0], R[2][2]);
  return { alpha: alpha / DEG, beta: beta / DEG, gamma: gamma / DEG };
}

// A small random rotation, to stand in for real sensor noise.
function jiggle(R, deg) {
  const r = () => (Math.random() * 2 - 1) * deg * DEG;
  return mul(mul(mul(Rz(r()), Rx(r())), Ry(r())), R);
}

// ---- the model this game used to use --------------------------------------
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
function oldModel(a, b, cal) {
  const yaw = a * DEG, pitch = b * DEG;
  return {
    x: clamp01(0.5 - (wrapPi(yaw - cal.yaw) * YAW_GAIN) / Math.PI),
    y: clamp01(0.5 - ((pitch - cal.pitch) * PITCH_GAIN) / Math.PI),
  };
}

// ---- the model it uses now -------------------------------------------------
function newModel(a, b, g, cal) {
  const p = pointingVector(a, b, g);
  const el = Math.asin(Math.max(-1, Math.min(1, p.z)));
  const az = Math.atan2(p.x, p.y);
  return {
    x: clamp01(0.5 + (wrapPi(az - cal.az) * YAW_GAIN) / Math.PI),
    y: clamp01(0.5 - ((el - cal.el) * PITCH_GAIN) / Math.PI),
  };
}

// ---------------------------------------------------------------------------
// The motion: phone upright, swung smoothly through 40 degrees of yaw.
// `uprightOffset` backs the phone off dead-vertical, because dead-vertical is
// the worst case and a real hand is never exactly there.
// ---------------------------------------------------------------------------
function run(label, uprightOffsetDeg, noiseDeg, steps = 400) {
  const base = mul(Rx((90 - uprightOffsetDeg) * DEG), Ry(0));
  const poses = [];
  for (let i = 0; i < steps; i++) {
    const yaw = (-20 + (40 * i) / (steps - 1)) * DEG;   // smooth sweep
    poses.push(eulerFromMatrix(jiggle(mul(Rz(yaw), base), noiseDeg)));
  }

  const first = poses[0];
  const p0 = pointingVector(first.alpha, first.beta, first.gamma);
  const calNew = { az: Math.atan2(p0.x, p0.y), el: Math.asin(Math.max(-1, Math.min(1, p0.z))) };
  const calOld = { yaw: first.alpha * DEG, pitch: first.beta * DEG };

  const stats = (model) => {
    let prev = null, max = 0, sum = 0, n = 0, big = 0;
    for (const e of poses) {
      const q = model(e);
      if (prev) {
        const d = Math.hypot(q.x - prev.x, q.y - prev.y);
        max = Math.max(max, d); sum += d; n++;
        if (d > 0.05) big++;              // >5% of the screen in one sample = a visible jump
      }
      prev = q;
    }
    return { max, mean: sum / n, big };
  };

  const o = stats((e) => oldModel(e.alpha, e.beta, calOld));
  const w = stats((e) => newModel(e.alpha, e.beta, e.gamma, calNew));
  console.log(
    "  " + label.padEnd(30) +
    " old: max " + o.max.toFixed(3).padStart(6) + "  mean " + o.mean.toFixed(4) + "  jumps " + String(o.big).padStart(3) +
    "   |   new: max " + w.max.toFixed(3).padStart(6) + "  mean " + w.mean.toFixed(4) + "  jumps " + String(w.big).padStart(3)
  );
  return { o, w };
}

console.log("\nSmooth 40-degree swing, phone held upright. Numbers are fractions of the");
console.log("screen moved between consecutive samples. 'jumps' counts steps over 5%.\n");

let failures = 0;
for (const [label, offset] of [["dead upright (worst case)", 0.5], ["1 degree off upright", 1], ["5 degrees off upright", 5], ["25 degrees off upright", 25]]) {
  const { w } = run(label, offset, 0.15);
  // The new model has to stay smooth in every one of these poses.
  if (w.big > 0) { failures++; console.log("      FAIL: new model produced " + w.big + " visible jumps"); }
  if (w.max > 0.05) { failures++; console.log("      FAIL: new model max step " + w.max.toFixed(3)); }
}

console.log("\n" + (failures === 0 ? "TILT TEST: PASS" : "TILT TEST: FAIL (" + failures + ")"));
process.exit(failures === 0 ? 0 : 1);
