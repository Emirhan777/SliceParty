// Does the pointer hold still?  npm run test:tilt
//
// You cannot feel a jittery pointer from a unit test, but you can measure it.
// This drives a smooth, physical 40-degree swing through the real mapping in
// game/tilt.js and measures how far the on-screen point moves between
// consecutive samples. A smooth input must produce a smooth output; any single
// step much bigger than the average is a visible jump.
//
// Sensor noise is applied the physically right way: as a small random ROTATION
// of the device, after which the browser's own inverse formulas turn the rotation
// into alpha/beta/gamma. Adding noise to each angle independently looks similar
// and is wrong - it cannot reproduce how the angles misbehave near the poles.
//
// The mapping is PenDrawOnline's: alpha -> x, beta -> y. Its one known weakness
// is the phone standing dead upright, where beta = 90 degrees and alpha and gamma
// describe the same rotation, so alpha alone stops meaning anything. This test
// asserts the pointer is smooth in every pose you actually hold the phone in
// here - tipped back to look at the cast pad - and prints the upright numbers
// too, so the weakness stays on record instead of being forgotten.

import { orientationToPoint } from "../ninja/tilt.js";

const DEG = Math.PI / 180;
const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];

// What the browser reports, given a device->Earth rotation matrix. These are the
// standard inverse formulas, ill-conditioned exactly where the weakness lives:
// as cos(beta) -> 0 both atan2 arguments collapse to zero.
function eulerFromMatrix(R) {
  const beta = Math.asin(Math.max(-1, Math.min(1, R[2][1])));
  const alpha = Math.atan2(-R[0][1], R[1][1]);
  const gamma = Math.atan2(-R[2][0], R[2][2]);
  return { alpha: alpha / DEG, beta: beta / DEG, gamma: gamma / DEG };
}

// A small random rotation, standing in for real sensor noise. Seeded, so the
// test gives the same answer every run.
let seed = 0x7117;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function jiggle(R, deg) {
  const r = () => (rnd() * 2 - 1) * deg * DEG;
  return mul(mul(mul(Rz(r()), Rx(r())), Ry(r())), R);
}

// The motion: the phone tipped back `betaDeg` from flat (0 = lying screen-up,
// 90 = standing upright) and swung smoothly through 40 degrees of turn.
function run(label, betaDeg, noiseDeg = 0.15, steps = 400) {
  const base = mul(Rx(betaDeg * DEG), Ry(0));
  const poses = [];
  for (let i = 0; i < steps; i++) {
    const yaw = (-20 + (40 * i) / (steps - 1)) * DEG;
    poses.push(eulerFromMatrix(jiggle(mul(Rz(yaw), base), noiseDeg)));
  }
  const cal = { yaw: poses[0].alpha * DEG, pitch: poses[0].beta * DEG };

  let prev = null, max = 0, sum = 0, n = 0, jumps = 0;
  for (const e of poses) {
    const q = orientationToPoint(e.alpha, e.beta, cal);
    if (prev) {
      const d = Math.hypot(q.x - prev.x, q.y - prev.y);
      max = Math.max(max, d); sum += d; n++;
      if (d > 0.05) jumps++;          // over 5% of the screen in one sample = a visible jump
    }
    prev = q;
  }
  console.log("  " + label.padEnd(34) + "max " + max.toFixed(4).padStart(7) +
    "   mean " + (sum / n).toFixed(4) + "   jumps " + String(jumps).padStart(3));
  return { max, jumps };
}

console.log("\nSmooth 40-degree swing through PenDraw's mapping. Numbers are fractions of");
console.log("the screen moved between consecutive samples; 'jumps' counts steps over 5%.\n");

let failures = 0;

// Every pose you hold the phone in while you can see its screen. These must be
// smooth - this is the whole job of the pointer.
for (const [label, beta] of [
  ["flat on your palm", 5],
  ["tipped back 20 degrees", 20],
  ["tipped back 45 (looking at the pad)", 45],
  ["tipped back 60 degrees", 60],
  ["tipped back 75 degrees", 75],
]) {
  const { max, jumps } = run(label, beta);
  if (jumps > 0) { failures++; console.log("      FAIL: " + jumps + " visible jumps"); }
  if (max > 0.02) { failures++; console.log("      FAIL: max step " + max.toFixed(4) + " (budget 0.02)"); }
}

// The known weakness, printed rather than asserted. Hold the phone straight up
// like a microphone and alpha comes apart; in this game you would have to turn
// the phone's screen away from yourself to get there. If a future version of
// the game ever asks you to hold the phone upright, this is where it will show.
console.log("\n  known weak pose - standing the phone upright:");
for (const [label, beta] of [["tipped back 85 degrees", 85], ["dead upright", 89.5]]) {
  run(label, beta);
}

console.log("\n" + (failures === 0 ? "TILT TEST: PASS" : "TILT TEST: FAIL (" + failures + ")"));
process.exit(failures === 0 ? 0 : 1);
