// The game itself: spawning, physics, slicing, effects, scoring, state.
//
// The engine owns the canvas and the requestAnimationFrame loop and knows
// nothing about Firebase. It is fed blade samples through input()/inputLocal()
// and reports back through the callbacks handed to createGame(). That is what
// lets the same engine run off a phone, off a mouse, or off a future WebRTC
// datachannel without noticing the difference.

import { FRUITS, BOMB, randomFruit, drawFruit, makeHalf, drawBakedHalf } from "./fruits.js";
import { createBlade, segDist } from "./blade.js";

const BEST_KEY = "ninja.best";

// --- tuning ----------------------------------------------------------------
const GRAVITY = 1.5;            // in screen-heights per second squared
const FRUIT_R = 0.064;          // base radius as a fraction of screen height
const START_LIVES = 3;
const MIN_SLICE_SPEED = 0.5;    // normalized units/sec - below this the sword rests
const MAX_SUBSTEPS = 4;         // anti-tunnelling for fast flicks
const COMBO_MS = 420;
const GRACE_WAVES = 3;          // no bombs while you find your sword
const SPLAT_MAX = 26;
const RESTART_ARM_MS = 900;      // grace before the restart circle listens

const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

const loadBest = () => { try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch { return 0; } };
const saveBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch {} };

export function createGame(canvas, { onHud, onState } = {}) {
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;

  let state = "lobby";          // lobby | countdown | playing | over
  let score = 0, lives = START_LIVES, best = loadBest();
  let combo = 0, lastCutAt = 0, comboScored = 0;
  let countdownLeft = 0;
  let waveTimer = 0, waveNo = 0;
  let shake = 0, flash = 0;
  let raf = 0, lastFrame = 0;

  const blades = new Map();     // pid -> blade
  const fruits = [];
  const halves = [];
  const bits = [];              // juice particles
  const splats = [];            // fading decals on the background
  const slashes = [];           // the white streak left by a cut
  const popups = [];            // "COMBO x3"
  const pending = [];           // staggered spawns waiting for their moment
  let restartTarget = null;

  // -------------------------------------------------------------------------
  // canvas sizing
  // -------------------------------------------------------------------------
  function resize() {
    const oldW = W, oldH = H;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Everything in flight is stored in pixels, so carry it across the resize.
    if (oldW > 0 && oldH > 0 && (oldW !== W || oldH !== H)) {
      const sx = W / oldW, sy = H / oldH;
      for (const list of [fruits, halves, bits]) {
        for (const o of list) { o.x *= sx; o.y *= sy; o.vx *= sx; o.vy *= sy; }
      }
      for (const s of splats) { s.x *= sx; s.y *= sy; }
    }
  }
  const onResize = () => resize();
  window.addEventListener("resize", onResize);
  resize();

  // -------------------------------------------------------------------------
  // blades
  // -------------------------------------------------------------------------
  function ensureBlade(pid, slot = 0) {
    let b = blades.get(pid);
    if (!b) { b = createBlade(slot); blades.set(pid, b); }
    return b;
  }

  // -------------------------------------------------------------------------
  // spawning
  //
  // Rather than guessing a launch velocity, aim: pick a point the fruit should
  // sail through and a flight time, then solve for the velocity that gets there
  // under gravity. Works identically for a fruit tossed up from the bottom and
  // one thrown in from the side, which is why both feel like the same throw.
  // -------------------------------------------------------------------------
  function difficulty() { return clamp(score / 650, 0, 1); }

  function launch(kind) {
    const g = GRAVITY * H;
    const r = FRUIT_R * H * kind.radius;
    const side = Math.random();
    let x0, y0;
    if (side < 0.62) {                      // up from the bottom
      x0 = rand(W * 0.12, W * 0.88);
      y0 = H + r;
    } else if (side < 0.81) {               // in from the left
      x0 = -r;
      y0 = rand(H * 0.55, H * 0.95);
    } else {                                // in from the right
      x0 = W + r;
      y0 = rand(H * 0.55, H * 0.95);
    }

    // Aim the APEX of the arc, not a point along it. Solving for "be at (tx,ty)
    // after T seconds" looks reasonable but overshoots wildly on the way up -
    // the fruit sails off the top of the screen and spends half its life
    // invisible. Pick the peak height instead and solve for the launch speed.
    const apexY = rand(H * 0.1, H * 0.38);
    const rise = Math.max(H * 0.2, y0 - apexY);
    const vy = -Math.sqrt(2 * g * rise);
    const tApex = -vy / g;
    const apexX = x0 < 0 ? rand(W * 0.35, W * 0.85)
                : x0 > W ? rand(W * 0.15, W * 0.65)
                : x0 + rand(-W * 0.22, W * 0.22);

    fruits.push({
      kind, r,
      x: x0, y: y0,
      vx: (clamp(apexX, r, W - r) - x0) / tApex,
      vy,
      rot: rand(0, Math.PI * 2),
      av: rand(-3.2, 3.2),
      cut: false,
      bomb: kind === BOMB,
    });
  }

  function scheduleWave(now) {
    waveNo++;
    const playing = state === "playing";
    const d = difficulty();
    // Lobby waves are ambience: sparse, and never a bomb, because there is no
    // run to end and nobody has agreed to play yet.
    // A real wave throws a small handful - one lone fruit at a time leaves the
    // board empty and makes combos impossible until late in a run.
    const count = playing ? clamp(Math.round(lerp(1.9, 3.7, d) * rand(0.7, 1.25)), 1, 5) : 1;
    const bombChance = playing && waveNo > GRACE_WAVES ? lerp(0.06, 0.2, d) : 0;
    for (let i = 0; i < count; i++) {
      const isBomb = Math.random() < bombChance;
      pending.push({ at: now + i * rand(60, 190), kind: isBomb ? BOMB : randomFruit() });
    }
    waveTimer = playing ? lerp(1.45, 0.62, d) * rand(0.85, 1.15) : rand(1.3, 2.4);
  }

  // -------------------------------------------------------------------------
  // slicing
  // -------------------------------------------------------------------------
  function cutFruit(f, angle, now) {
    f.cut = true;

    if (f.bomb) { blowUp(f); return; }

    // Two halves, baked once, then they are just images that tumble.
    const nx = Math.cos(angle + Math.PI / 2);
    const ny = Math.sin(angle + Math.PI / 2);
    const push = rand(0.1, 0.2) * H;
    for (const s of [1, -1]) {
      halves.push({
        baked: makeHalf(f.kind, f.r, f.rot, angle, s, dpr),
        x: f.x, y: f.y,
        vx: f.vx + nx * push * s + Math.cos(angle) * rand(-0.05, 0.05) * H,
        vy: f.vy + ny * push * s - rand(0.02, 0.09) * H,
        rot: 0,
        av: f.av + rand(-2.5, 2.5),
        life: 0,
      });
    }

    burst(f.x, f.y, f.kind.juice, 16 + Math.floor(Math.random() * 8));
    splats.push(makeSplat(f.x, f.y, f.r, f.kind.juice));
    while (splats.length > SPLAT_MAX) splats.shift();
    slashes.push({ x: f.x, y: f.y, angle, len: f.r * 3.4, life: 0 });

    // Cutting works in the lobby too - it is how you find your sword before the
    // run starts - but only a real run keeps score.
    if (state !== "playing") return;

    combo = now - lastCutAt < COMBO_MS ? combo + 1 : 1;
    lastCutAt = now;
    score += f.kind.score;
    if (combo >= 2 && combo > comboScored) {
      comboScored = combo;
      const bonus = combo * 10;
      score += bonus;
      popups.push({ x: f.x, y: f.y - f.r, text: "COMBO x" + combo + "  +" + bonus, life: 0, ttl: 1.1 });
    }
    if (combo === 1) comboScored = 0;
    publishHud();
  }

  function blowUp(f) {
    burst(f.x, f.y, "#ff8a1a", 34, 1.5);
    burst(f.x, f.y, "#4a4a55", 18, 1.1);
    shake = 1;
    flash = 1;
    gameOver();
  }

  // A splat is a spray of small droplets fixed at birth, not a few big discs -
  // discs read as geometry sitting on the screen, droplets read as mess.
  function makeSplat(x, y, r, color) {
    const drops = [];
    const n = 9 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const d = Math.pow(Math.random(), 0.6) * r * 1.5;
      drops.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.85, rr: r * rand(0.05, 0.2) });
    }
    return { x, y, color, drops, life: 0, ttl: 2.4 };
  }

  function burst(x, y, color, n, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(0.12, 0.62) * H * power;
      bits.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - rand(0, 0.18) * H,
        r: rand(0.004, 0.011) * H,
        color, life: 0, ttl: rand(0.45, 0.95),
      });
    }
  }

  function sliceWith(blade, dt) {
    if (blade.speed(dt) < MIN_SLICE_SPEED) return;
    const s = blade.segment;
    const x0 = s.x0 * W, y0 = s.y0 * H, x1 = s.x1 * W, y1 = s.y1 * H;
    const len = Math.hypot(x1 - x0, y1 - y0);
    // A fast flick can jump clean past a small fruit in one frame, so walk the
    // segment in pieces no longer than a twelfth of the screen.
    const steps = clamp(Math.ceil(len / (H / 12)), 1, MAX_SUBSTEPS);
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const now = performance.now();

    for (let i = 0; i < steps; i++) {
      const ax = lerp(x0, x1, i / steps), ay = lerp(y0, y1, i / steps);
      const bx = lerp(x0, x1, (i + 1) / steps), by = lerp(y0, y1, (i + 1) / steps);
      for (const f of fruits) {
        if (f.cut) continue;
        if (segDist(ax, ay, bx, by, f.x, f.y) < f.r) cutFruit(f, angle, now);
      }
      // You are almost always mid-swing at the moment you die, so the restart
      // circle stays inert for a beat - otherwise the same slash that killed you
      // immediately starts the next run.
      if (restartTarget && state === "over" && now - restartTarget.armedAt > RESTART_ARM_MS) {
        const t = restartTarget;
        if (segDist(ax, ay, bx, by, t.x, t.y) < t.r) { start(); return; }
      }
    }
  }

  // -------------------------------------------------------------------------
  // state
  // -------------------------------------------------------------------------
  function publishHud() {
    onHud?.({ score, best: Math.max(best, score), lives, combo, status: state });
  }
  function setState(s) {
    if (state === s) return;
    state = s;
    onState?.(s);
    publishHud();
  }

  function clearBoard() {
    fruits.length = 0; halves.length = 0; bits.length = 0;
    splats.length = 0; slashes.length = 0; popups.length = 0; pending.length = 0;
  }

  function start() {
    clearBoard();
    score = 0; lives = START_LIVES; combo = 0; comboScored = 0;
    waveNo = 0; waveTimer = 0.35; countdownLeft = 3.2;
    restartTarget = null; shake = 0; flash = 0;
    for (const b of blades.values()) b.reset();
    setState("countdown");
  }

  function gameOver() {
    if (state === "over") return;
    if (score > best) { best = score; saveBest(best); }
    restartTarget = { x: W / 2, y: H * 0.72, r: Math.max(70, H * 0.105), armedAt: performance.now() };
    setState("over");
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------
  function update(dt, now) {
    const g = GRAVITY * H;

    for (const b of blades.values()) b.step(dt, now);

    if (state === "countdown") {
      countdownLeft -= dt;
      if (countdownLeft <= 0) setState("playing");
    }

    if (state === "playing" || state === "lobby") {
      waveTimer -= dt;
      if (waveTimer <= 0) scheduleWave(now);
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      if (now >= pending[i].at) { launch(pending[i].kind); pending.splice(i, 1); }
    }

    for (const b of blades.values()) if (b.alive) sliceWith(b, dt);

    // fruit
    for (let i = fruits.length - 1; i >= 0; i--) {
      const f = fruits[i];
      f.vy += g * dt;
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.rot += f.av * dt;
      if (f.cut) { fruits.splice(i, 1); continue; }
      const gone = f.y - f.r > H + f.r * 2 && f.vy > 0;
      const sideGone = f.x < -f.r * 4 || f.x > W + f.r * 4;
      if (gone || sideGone) {
        fruits.splice(i, 1);
        // Only a fruit dropped out of the BOTTOM counts against you. Bombs are
        // supposed to fall away untouched.
        if (gone && !f.bomb && state === "playing") {
          lives--;
          shake = Math.max(shake, 0.45);
          if (lives <= 0) gameOver(); else publishHud();
        }
      }
    }

    // halves
    for (let i = halves.length - 1; i >= 0; i--) {
      const h = halves[i];
      h.vy += g * dt;
      h.x += h.vx * dt; h.y += h.vy * dt;
      h.rot += h.av * dt;
      h.life += dt;
      if (h.y - h.baked.half > H + 40 || h.life > 3) halves.splice(i, 1);
    }

    // juice
    for (let i = bits.length - 1; i >= 0; i--) {
      const p = bits[i];
      p.vy += g * 0.75 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life += dt;
      if (p.life > p.ttl) bits.splice(i, 1);
    }

    for (let i = splats.length - 1; i >= 0; i--) {
      splats[i].life += dt;
      if (splats[i].life > splats[i].ttl) splats.splice(i, 1);
    }
    for (let i = slashes.length - 1; i >= 0; i--) {
      slashes[i].life += dt;
      if (slashes[i].life > 0.16) slashes.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      popups[i].life += dt;
      popups[i].y -= 28 * dt;
      if (popups[i].life > popups[i].ttl) popups.splice(i, 1);
    }

    if (combo && now - lastCutAt > COMBO_MS) { combo = 0; comboScored = 0; }
    shake = Math.max(0, shake - dt * 2.4);
    flash = Math.max(0, flash - dt * 2.6);
  }

  // -------------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------------
  function render(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (shake > 0) {
      const m = shake * shake * H * 0.03;
      ctx.translate(rand(-m, m), rand(-m, m));
    }

    // backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#141026");
    bg.addColorStop(0.55, "#0d0b1a");
    bg.addColorStop(1, "#07060f");
    ctx.fillStyle = bg;
    ctx.fillRect(-H, -H, W + H * 2, H * 3);

    // juice left on the "lens"
    for (const s of splats) {
      const k = 1 - s.life / s.ttl;
      ctx.save();
      ctx.globalAlpha = 0.22 * k * k;
      ctx.fillStyle = s.color;
      for (const d of s.drops) {
        ctx.beginPath();
        ctx.arc(s.x + d.dx, s.y + d.dy, d.rr, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    for (const h of halves) {
      drawBakedHalf(ctx, h.baked, h.x, h.y, h.rot, clamp(3 - h.life, 0, 1));
    }

    for (const f of fruits) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = f.r * 0.5;
      ctx.shadowOffsetY = f.r * 0.15;
      drawFruit(ctx, f.kind, f.r, f.rot);
      ctx.restore();
    }

    for (const p of bits) {
      const k = 1 - p.life / p.ttl;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (0.4 + k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const s of slashes) {
      const k = 1 - s.life / 0.16;
      ctx.save();
      ctx.globalAlpha = k * 0.85;
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-s.len / 2, -1.5, s.len, 3);
      ctx.restore();
    }

    for (const b of blades.values()) b.draw(ctx, W, H, now);

    for (const p of popups) {
      const k = 1 - p.life / p.ttl;
      ctx.save();
      ctx.globalAlpha = k;
      ctx.font = "800 " + Math.round(H * 0.032) + "px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffe27a";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 10;
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }

    if (state === "countdown") drawCountdown();
    if (state === "over") drawGameOver();

    if (flash > 0) {
      ctx.fillStyle = "rgba(255,240,210," + (flash * 0.85) + ")";
      ctx.fillRect(-H, -H, W + H * 2, H * 3);
    }
  }

  function drawCountdown() {
    const n = Math.ceil(countdownLeft - 0.2);
    const label = n <= 0 ? "GO!" : String(Math.min(n, 3));
    const frac = 1 - ((countdownLeft - 0.2) % 1);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = clamp(1.25 - frac * 0.6, 0, 1);
    ctx.font = "900 " + Math.round(H * (0.2 + frac * 0.04)) + "px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 26;
    ctx.fillText(label, W / 2, H * 0.42);
    ctx.restore();
  }

  function drawGameOver() {
    ctx.save();
    ctx.fillStyle = "rgba(6,5,12,0.72)";
    ctx.fillRect(-H, -H, W + H * 2, H * 3);
    ctx.textAlign = "center";

    ctx.fillStyle = "#fff";
    ctx.font = "900 " + Math.round(H * 0.1) + "px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText("GAME OVER", W / 2, H * 0.3);

    ctx.fillStyle = "#ffe27a";
    ctx.font = "800 " + Math.round(H * 0.075) + "px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(String(score), W / 2, H * 0.42);

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "600 " + Math.round(H * 0.026) + "px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(score >= best ? "NEW BEST" : "BEST  " + best, W / 2, H * 0.49);

    // The restart button is a thing you SLICE - no reaching for a keyboard.
    const t = restartTarget;
    if (t) {
      const pulse = 1 + Math.sin(performance.now() / 260) * 0.045;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(pulse, pulse);
      ctx.beginPath();
      ctx.arc(0, 0, t.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.setLineDash([10, 9]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.fillStyle = "#fff";
      ctx.font = "800 " + Math.round(H * 0.026) + "px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText("SLASH", t.x, t.y - H * 0.004);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "600 " + Math.round(H * 0.02) + "px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText("to play again", t.x, t.y + H * 0.032);
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // loop
  // -------------------------------------------------------------------------
  function frame(now) {
    raf = requestAnimationFrame(frame);
    // A backgrounded tab hands back a huge dt; cap it so nothing teleports.
    const dt = Math.min((now - lastFrame) / 1000 || 0, 0.05);
    lastFrame = now;
    update(dt, now);
    render(now);
  }
  raf = requestAnimationFrame((t) => { lastFrame = t; frame(t); });

  publishHud();

  return {
    get state() { return state; },
    get score() { return score; },
    get lives() { return lives; },
    get best() { return best; },
    get width() { return W; },
    get height() { return H; },

    addPlayer(pid, slot) { ensureBlade(pid, slot); },
    removePlayer(pid) { blades.delete(pid); },
    hasPlayer(pid) { return blades.has(pid); },
    get playerCount() { return blades.size; },

    // A sample off the wire: carries velocity, so it gets extrapolated.
    input(pid, sample, slot = 0) { ensureBlade(pid, slot).feed(sample); },
    // Local input (the screen's own mouse): no lag, no prediction.
    inputLocal(pid, x, y, slot = 0) { ensureBlade(pid, slot).feedDirect(x, y); },

    start,
    gameOver,
    restart: start,
    // Back to the QR screen - the last phone hung up.
    lobby() {
      clearBoard();
      restartTarget = null;
      combo = 0; comboScored = 0;
      waveTimer = 0.6; waveNo = 0;
      setState("lobby");
    },

    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    },
  };
}

export { FRUITS, BOMB };
