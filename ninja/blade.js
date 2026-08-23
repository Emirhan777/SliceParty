// The sword: how a jittery, laggy stream of phone samples becomes a point that
// feels like it is attached to your wrist.
//
// Three things happen between the network and the pixel:
//
//   1. PREDICT. Every sample carries the velocity the phone measured. The screen
//      pushes the position forward by however long the sample took to arrive, so
//      the blade sits where the phone IS rather than where it was ~80ms ago.
//   2. SMOOTH. Samples land every ~20ms, frames every ~16ms, and the gap is never
//      even. Each frame eases toward the predicted target instead of snapping,
//      which turns packet jitter into a slight weight.
//   3. TRAIL. Rendered positions go into a short ring buffer and are drawn as a
//      tapering ribbon. That ribbon IS the visible sword, and its newest segment
//      is exactly what the slicing test uses - so what you see is what cuts.

const MAX_PREDICT_S = 0.10;    // never extrapolate further ahead in time than this
const MAX_PREDICT_DIST = 0.10; // ...nor further in distance, whatever the velocity says
const SMOOTH_TAU_MS = 26;      // ~90% of the gap closed in 60ms
const TRAIL_MS = 200;          // how much history the ribbon shows
const TRAIL_MAX = 64;

// Two slots, two looks. Slot 0 is the classic white-hot blade.
export const BLADE_COLORS = [
  { core: "#ffffff", glow: "#7fdcff", spark: "#d8f6ff" },
  { core: "#ffffff", glow: "#ff9ad5", spark: "#ffd9ef" },
];

export function createBlade(slot = 0) {
  const colors = BLADE_COLORS[slot % BLADE_COLORS.length];

  // Everything below is in normalized 0..1 space; the renderer scales to pixels.
  let target = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
  let pos = { x: 0.5, y: 0.5 };
  let prev = { x: 0.5, y: 0.5 };
  let lastSampleAt = 0;
  let seen = false;
  const trail = []; // { x, y, t }

  return {
    slot,
    colors,
    get position() { return pos; },
    // The segment cut this frame, in normalized space.
    get segment() { return { x0: prev.x, y0: prev.y, x1: pos.x, y1: pos.y }; },
    get alive() { return seen && performance.now() - lastSampleAt < 2500; },
    get idle() { return performance.now() - lastSampleAt > 900; },

    // A sample straight off the wire.
    feed({ x, y, vx = 0, vy = 0 }) {
      target = { x, y, vx, vy };
      lastSampleAt = performance.now();
      if (!seen) { seen = true; pos = { x, y }; prev = { x, y }; }
    },

    // Local input (mouse on the screen, or the touch fallback) skips prediction:
    // there is no lag to hide.
    feedDirect(x, y) {
      target = { x, y, vx: 0, vy: 0 };
      lastSampleAt = performance.now();
      if (!seen) { seen = true; pos = { x, y }; prev = { x, y }; }
    },

    reset(x = 0.5, y = 0.5) {
      target = { x, y, vx: 0, vy: 0 };
      pos = { x, y }; prev = { x, y };
      trail.length = 0;
    },

    // Advance one frame. dt in seconds.
    step(dt, now = performance.now()) {
      prev = { x: pos.x, y: pos.y };
      if (!seen) return;

      // 1. predict — but keep it on a leash. Extrapolation is only ever a guess,
      // and a guess that can throw the blade across the screen is worse than the
      // lag it was meant to hide.
      const age = Math.min((now - lastSampleAt) / 1000, MAX_PREDICT_S);
      let ax = target.vx * age, ay = target.vy * age;
      const reach = Math.hypot(ax, ay);
      if (reach > MAX_PREDICT_DIST) {
        const k = MAX_PREDICT_DIST / reach;
        ax *= k; ay *= k;
      }
      const px = target.x + ax;
      const py = target.y + ay;

      // 2. smooth (frame-rate independent exponential approach)
      const k = 1 - Math.exp(-(dt * 1000) / SMOOTH_TAU_MS);
      pos = {
        x: pos.x + (Math.min(Math.max(px, 0), 1) - pos.x) * k,
        y: pos.y + (Math.min(Math.max(py, 0), 1) - pos.y) * k,
      };

      // 3. trail
      trail.push({ x: pos.x, y: pos.y, t: now });
      while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();
      while (trail.length > TRAIL_MAX) trail.shift();
    },

    // Speed of the rendered point, in screen-heights per second.
    speed(dt) {
      if (dt <= 0) return 0;
      return Math.hypot(pos.x - prev.x, pos.y - prev.y) / dt;
    },

    draw(ctx, W, H, now = performance.now()) {
      if (!seen || trail.length < 2) {
        if (seen) drawHead(ctx, pos.x * W, pos.y * H, colors, 1);
        return;
      }
      const pts = trail.map((p) => ({ x: p.x * W, y: p.y * H, age: (now - p.t) / TRAIL_MS }));
      const headW = Math.max(8, H * 0.018);

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // glow pass, then a white core on top - two passes is what reads as "hot"
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass === 0 ? colors.glow : colors.core;
        ctx.shadowColor = pass === 0 ? colors.glow : "transparent";
        ctx.shadowBlur = pass === 0 ? headW * 2.2 : 0;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[i - 1];
          const life = 1 - Math.min(a.age, 1);          // 0 at the tail, 1 at the head
          const w = headW * life * (pass === 0 ? 1.5 : 0.55);
          if (w < 0.4) continue;
          ctx.globalAlpha = (pass === 0 ? 0.5 : 0.95) * life;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(a.x, a.y);
          ctx.stroke();
        }
      }
      ctx.restore();

      drawHead(ctx, pos.x * W, pos.y * H, colors, headW / 8);
    },
  };
}

// The bright point at the tip - the thing the player actually aims with.
function drawHead(ctx, x, y, colors, scale) {
  const r = 5 * Math.max(0.8, scale);
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.35, colors.glow + "88");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Geometry used by the slicing test.
// ---------------------------------------------------------------------------

// Shortest distance from point c to the segment a-b.
export function segDist(ax, ay, bx, by, cx, cy) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(cx - ax, cy - ay);
  let t = ((cx - ax) * dx + (cy - ay) * dy) / len2;
  t = Math.min(Math.max(t, 0), 1);
  return Math.hypot(cx - (ax + t * dx), cy - (ay + t * dy));
}
