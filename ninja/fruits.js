// Procedural fruit. No image assets anywhere.
//
// Every fruit is one draw(ctx, r) function that paints the whole fruit centred
// on the origin, sized to radius r. Halves come from clipping THAT SAME function
// against a half-plane along the actual slash angle (see makeHalf below), which
// is why a cut looks right at any angle instead of only the few a sprite sheet
// could pre-bake.

const TAU = Math.PI * 2;

// Small deterministic scatter so seeds and dimples do not crawl between frames.
function scatter(n, seed) {
  const out = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const a = (s / 233280) * TAU;
    s = (s * 9301 + 49297) % 233280;
    const rad = Math.sqrt(s / 233280);
    out.push([Math.cos(a) * rad, Math.sin(a) * rad]);
  }
  return out;
}

function circle(ctx, x, y, r, fill) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

// A soft top-left highlight, the one trick that stops flat fills looking flat.
function sheen(ctx, r, alpha = 0.28) {
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.05, 0, 0, r * 1.25);
  g.addColorStop(0, "rgba(255,255,255," + alpha + ")");
  g.addColorStop(0.55, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
}

function leaf(ctx, r, angle = -0.6, len = 0.85, wide = 0.34) {
  ctx.save();
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(r * len * 0.55, -r * wide, r * len, 0);
  ctx.quadraticCurveTo(r * len * 0.55, r * wide, 0, 0);
  ctx.fillStyle = "#3f9d3a";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = Math.max(1, r * 0.04);
  ctx.stroke();
  ctx.restore();
}

function stalk(ctx, r, h = 0.42, w = 0.1) {
  ctx.beginPath();
  ctx.lineWidth = Math.max(2, r * w);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#6b4525";
  ctx.moveTo(0, -r * 0.82);
  ctx.quadraticCurveTo(r * 0.1, -r * (0.82 + h * 0.6), r * 0.02, -r * (0.82 + h));
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// The catalog.
//   radius: size multiplier against the board's base fruit radius
//   flesh:  colour of the exposed cut face
//   juice:  colour of the particle burst and the splatter it leaves behind
// ---------------------------------------------------------------------------
export const FRUITS = [
  {
    name: "watermelon", radius: 1.35, flesh: "#f0486b", juice: "#e8305a", score: 10,
    draw(ctx, r) {
      circle(ctx, 0, 0, r, "#2f7d3a");
      // rind stripes, drawn as clipped arcs so they curve with the body
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.clip();
      ctx.strokeStyle = "#1d5527";
      ctx.lineWidth = r * 0.17;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        const x = i * r * 0.34;
        ctx.moveTo(x, -r * 1.2);
        ctx.quadraticCurveTo(x * 1.5, 0, x, r * 1.2);
        ctx.stroke();
      }
      ctx.restore();
      sheen(ctx, r, 0.22);
    },
  },
  {
    name: "apple", radius: 1.0, flesh: "#fdf3d8", juice: "#e63946", score: 10,
    draw(ctx, r) {
      // Two overlapping lobes with a dip at the top - reads as an apple where a
      // plain circle reads as a ball.
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.62);
      ctx.bezierCurveTo(-r * 0.55, -r * 1.05, -r * 1.05, -r * 0.35, -r * 0.98, r * 0.16);
      ctx.bezierCurveTo(-r * 0.92, r * 0.86, -r * 0.36, r * 1.02, 0, r * 0.8);
      ctx.bezierCurveTo(r * 0.36, r * 1.02, r * 0.92, r * 0.86, r * 0.98, r * 0.16);
      ctx.bezierCurveTo(r * 1.05, -r * 0.35, r * 0.55, -r * 1.05, 0, -r * 0.62);
      ctx.fillStyle = "#e63946";
      ctx.fill();
      sheen(ctx, r * 0.95, 0.3);
      stalk(ctx, r, 0.3, 0.09);
      ctx.save();
      ctx.translate(r * 0.05, -r * 0.92);
      leaf(ctx, r, -0.5, 0.7, 0.3);
      ctx.restore();
    },
  },
  {
    name: "orange", radius: 1.02, flesh: "#ffb43f", juice: "#ff9a1f", score: 10,
    draw(ctx, r) {
      circle(ctx, 0, 0, r, "#f5871f");
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.clip();
      ctx.fillStyle = "rgba(0,0,0,0.09)";
      for (const [dx, dy] of scatter(26, 77)) circle(ctx, dx * r * 0.9, dy * r * 0.9, r * 0.055, "rgba(150,70,0,0.22)");
      ctx.restore();
      sheen(ctx, r, 0.26);
      ctx.save();
      ctx.translate(0, -r * 0.88);
      leaf(ctx, r, -0.9, 0.6, 0.3);
      ctx.restore();
    },
  },
  {
    name: "lemon", radius: 0.92, flesh: "#fff3b0", juice: "#ffd93d", score: 10,
    draw(ctx, r) {
      ctx.save();
      ctx.rotate(-0.35);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.12, r * 0.78, 0, 0, TAU);
      ctx.fillStyle = "#ffd93d";
      ctx.fill();
      // the little nubs at each end
      circle(ctx, -r * 1.1, 0, r * 0.12, "#f0c52e");
      circle(ctx, r * 1.1, 0, r * 0.12, "#f0c52e");
      ctx.restore();
      sheen(ctx, r * 0.9, 0.3);
    },
  },
  {
    name: "banana", radius: 1.12, flesh: "#fff8e2", juice: "#ffe27a", score: 10,
    draw(ctx, r) {
      ctx.save();
      ctx.rotate(0.3);
      // A crescent: outer arc out, inner arc back, tapering to points.
      ctx.beginPath();
      ctx.moveTo(-r * 1.05, r * 0.28);
      ctx.quadraticCurveTo(0, -r * 1.18, r * 1.05, r * 0.28);
      ctx.quadraticCurveTo(r * 0.9, r * 0.5, r * 0.78, r * 0.46);
      ctx.quadraticCurveTo(0, -r * 0.5, -r * 0.78, r * 0.46);
      ctx.quadraticCurveTo(-r * 0.9, r * 0.5, -r * 1.05, r * 0.28);
      ctx.closePath();
      ctx.fillStyle = "#ffd83d";
      ctx.fill();
      ctx.strokeStyle = "rgba(180,130,0,0.35)";
      ctx.lineWidth = Math.max(1, r * 0.04);
      ctx.stroke();
      circle(ctx, -r * 1.02, r * 0.3, r * 0.09, "#7a5a1e");
      circle(ctx, r * 1.02, r * 0.3, r * 0.09, "#7a5a1e");
      ctx.restore();
    },
  },
  {
    name: "strawberry", radius: 0.88, flesh: "#ffd7dd", juice: "#ff2d55", score: 10,
    draw(ctx, r) {
      ctx.beginPath();
      ctx.moveTo(0, r);
      ctx.bezierCurveTo(-r * 0.95, r * 0.35, -r * 0.95, -r * 0.72, 0, -r * 0.72);
      ctx.bezierCurveTo(r * 0.95, -r * 0.72, r * 0.95, r * 0.35, 0, r);
      ctx.fillStyle = "#ff2d55";
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#ffe08a";
      for (const [dx, dy] of scatter(16, 311)) {
        ctx.beginPath();
        ctx.ellipse(dx * r * 0.7, dy * r * 0.8 + r * 0.05, r * 0.055, r * 0.085, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      // green calyx
      ctx.save();
      ctx.translate(0, -r * 0.68);
      for (let i = 0; i < 5; i++) leaf(ctx, r, (i / 5) * TAU - Math.PI / 2 - 0.3, 0.5, 0.22);
      ctx.restore();
    },
  },
  {
    name: "pineapple", radius: 1.25, flesh: "#ffe066", juice: "#ffc300", score: 10,
    draw(ctx, r) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, r * 0.12, r * 0.72, r * 0.95, 0, 0, TAU);
      ctx.fillStyle = "#d9942b";
      ctx.fill();
      ctx.clip();
      // crosshatch scales
      ctx.strokeStyle = "rgba(110,65,10,0.45)";
      ctx.lineWidth = Math.max(1, r * 0.035);
      for (let i = -5; i <= 5; i++) {
        ctx.beginPath(); ctx.moveTo(-r, i * r * 0.28 - r * 0.5); ctx.lineTo(r, i * r * 0.28 + r * 0.3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-r, i * r * 0.28 + r * 0.3); ctx.lineTo(r, i * r * 0.28 - r * 0.5); ctx.stroke();
      }
      ctx.restore();
      // spiky crown
      ctx.fillStyle = "#3f9d3a";
      for (let i = -2; i <= 2; i++) {
        ctx.save();
        ctx.translate(i * r * 0.16, -r * 0.82);
        ctx.rotate(i * 0.3);
        ctx.beginPath();
        ctx.moveTo(-r * 0.12, 0);
        ctx.lineTo(0, -r * 0.62);
        ctx.lineTo(r * 0.12, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    },
  },
  {
    name: "kiwi", radius: 0.9, flesh: "#b9e07a", juice: "#8ec63f", score: 10,
    draw(ctx, r) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.86, 0, 0, TAU);
      ctx.fillStyle = "#8a5a2b";
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = "rgba(60,35,10,0.35)";
      for (const [dx, dy] of scatter(40, 991)) circle(ctx, dx * r, dy * r, r * 0.035, "rgba(60,35,10,0.35)");
      ctx.restore();
      sheen(ctx, r * 0.9, 0.16);
    },
  },
];

// The bomb is not a fruit and never gets a "half" - it explodes instead.
export const BOMB = {
  name: "bomb", radius: 1.0, flesh: "#111", juice: "#ff7a1a", score: 0,
  draw(ctx, r) {
    circle(ctx, 0, 0, r, "#15151c");
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.03, 0, 0, r);
    g.addColorStop(0, "rgba(255,255,255,0.5)");
    g.addColorStop(0.4, "rgba(255,255,255,0.05)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    // fuse
    ctx.strokeStyle = "#8a6a3a";
    ctx.lineWidth = Math.max(2, r * 0.13);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(r * 0.3, -r * 0.85);
    ctx.quadraticCurveTo(r * 0.85, -r * 1.25, r * 0.72, -r * 1.5);
    ctx.stroke();
    // spark - the one thing on a bomb that should catch the eye
    const t = performance.now() / 90;
    const s = r * (0.19 + 0.05 * Math.sin(t));
    circle(ctx, r * 0.72, -r * 1.5, s, "#ffdc6a");
    circle(ctx, r * 0.72, -r * 1.5, s * 0.55, "#fff");
    ctx.fillStyle = "rgba(255,140,20,0.55)";
    ctx.beginPath(); ctx.arc(r * 0.72, -r * 1.5, s * 1.9, 0, TAU); ctx.fill();
  },
};

export const randomFruit = () => FRUITS[(Math.random() * FRUITS.length) | 0];


// Draw a whole fruit at its current tumble angle.
export function drawFruit(ctx, kind, r, rot) {
  ctx.save();
  ctx.rotate(rot);
  kind.draw(ctx, r);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Halves.
//
// Baked ONCE per piece, the instant a fruit is cut, onto a small offscreen
// canvas — after that the tumbling piece costs one drawImage per frame.
//
// The trick is two composite passes instead of a clip:
//   destination-in  keeps only the pixels on one side of the slash line
//   source-atop     paints the flesh slab ONLY where fruit pixels survived
// so the exposed cut face follows the real silhouette. That matters for the
// shapes a plain ellipse would overshoot — the banana crescent, the strawberry,
// the pineapple crown.
//
// `rot` is the fruit's tumble at the moment of the cut and gets baked in, so
// `cutAngle` is a plain world-space angle and the piece starts life unrotated.
export function makeHalf(kind, r, rot, cutAngle, side, dpr = 1) {
  const half = Math.ceil(r * 2.1);        // room for stalks, crowns, leaves
  const size = half * 2;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(size * dpr));
  c.height = Math.max(1, Math.ceil(size * dpr));
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.translate(half, half);

  g.save();
  g.rotate(rot);
  kind.draw(g, r);
  g.restore();

  // keep one side of the cut
  g.save();
  g.globalCompositeOperation = "destination-in";
  g.rotate(cutAngle);
  g.fillStyle = "#000";
  g.fillRect(-size, side > 0 ? 0 : -size, size * 2, size);
  g.restore();

  // The exposed inside, painted only over surviving fruit pixels. It needs real
  // width: a hairline reads as an outlined shape, while a broad band reads as a
  // piece of fruit you are looking into - which is the whole point of the cut.
  const t = Math.max(2, r * 0.34);
  g.save();
  g.globalCompositeOperation = "source-atop";
  g.rotate(cutAngle);
  g.fillStyle = kind.flesh;
  g.fillRect(-size, side > 0 ? 0 : -t, size * 2, t);
  // a soft shadow where the face turns away, so the band has depth
  const shade = g.createLinearGradient(0, side > 0 ? 0 : -t, 0, side > 0 ? t : 0);
  shade.addColorStop(side > 0 ? 0 : 1, "rgba(0,0,0,0)");
  shade.addColorStop(side > 0 ? 1 : 0, "rgba(0,0,0,0.28)");
  g.fillStyle = shade;
  g.fillRect(-size, side > 0 ? 0 : -t, size * 2, t);
  // and a bright lip right on the cut line
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.fillRect(-size, side > 0 ? 0 : -t * 0.1, size * 2, t * 0.1);
  g.restore();

  return { canvas: c, half, size };
}

// Blit a baked half at its current position and tumble.
export function drawBakedHalf(ctx, baked, x, y, rot, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.drawImage(baked.canvas, -baked.half, -baked.half, baked.size, baked.size);
  ctx.restore();
}
