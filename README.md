# Slice Party

**Play online: https://emirhan777.github.io/SliceParty/**

Every browser tab opens its own room. Use **New room** to start a fresh one. No player account is needed. In the iPhone app, choose **Create a room**, create a room link, and share or copy it to a computer or TV. Confirm **Open game on this screen** there, then return to the app: your sword connects automatically. Pending links expire after ten minutes and work on one screen.

Put a screen up, scan the QR with your phone, and the phone becomes a sword.
Tilt it and a glowing blade sweeps across the screen, cutting fruit in half along
the exact line you swung.

No app to install, no account, no name to type. Scan and swing.

An optional native iPhone controller is now in [`mobile/`](mobile/README.md).
It uses the same motion tracker, scans the game QR, and shows your score/lives.
Run `npm run ios:tunnel` to preview it in Expo Go; standalone iOS build instructions
are in the mobile README.

```
 📱 play.html (phone, tilt) ──blade coords──▶ 🔥 Firebase RTDB ◀──listen── 🖥️ index.html (big screen)
```

---

## Local development

Motion sensors only work over **https**, so a plain `http://192.168.…` address
will not do — iOS silently sends no motion data at all. Two terminals:

```bash
# terminal 1 — serve the game
npm start

# terminal 2 — put it on a public https address
npm run tunnel
```

The second command prints a URL like `https://something-random.trycloudflare.com`.
**Open that URL on your computer** (not localhost) — the QR code is built from
whatever address the page is served from, so it has to be the https one.

Then scan the QR with your iPhone camera, tap **PLAY**, allow motion access when
iOS asks, hold the phone tilted back so you can see its screen, and swing.

The first `npm run tunnel` downloads the cloudflared binary, which takes a few
seconds. No account, no signup. Leave both terminals running while you play.

> `npm run tunnel` forces cloudflared's **HTTP/2** transport (TCP 7844) rather
> than its default QUIC (UDP 7844), because plenty of university and corporate
> networks drop outbound UDP on odd ports. The symptom if you ever hit it the
> other way round is an endless loop of
> `Failed to dial a quic connection ... no recent network activity`.
> `npm run tunnel:quic` gives you the faster default if your network allows it.

### No phone? No tunnel?

```bash
npm start
```

Then open **http://localhost:3000/?mouse=1** — the big screen gets its own mouse
sword and the whole game is playable and tunable without a phone.

And if you open the plain LAN address (`http://192.168.x.x:3000`) on a phone, it
still works — it just falls back to dragging a finger instead of tilting.

---

## The rules

Three lives. Fruit that drops off the bottom uncut costs one. Slicing a **bomb**
ends the run on the spot. Fruit cut within a few hundred milliseconds of each
other scores a combo bonus. Your best score is remembered on the big screen.
When it's over, **slash the circle** to play again.

`Space` on the big screen also starts and restarts.

---

## Layout

| Path | What it is |
|------|-----------|
| `index.html` | The big screen. Opens a room, shows the QR, runs the game. |
| `play.html` | The phone. Opened by the QR with `?room=CODE`. |
| `firebase-config.js` | Firebase keys — the only file to edit to move to your own project. |
| `ninja/net.js` | The transport seam. The only file that imports Firebase. |
| `ninja/tilt.js` | Phone orientation → a point on the screen. |
| `ninja/motion.js` | Orientation permission, touch fallback, and recovery. |
| `ninja/blade.js` | Prediction, smoothing, and the trail that does the cutting. |
| `ninja/fruits.js` | Procedural fruit, and halves clipped along the real slash line. |
| `ninja/engine.js` | Game loop: spawning, physics, slicing, scoring, state. |
| `tools/dev-server.mjs` | `npm start`. Dependency-free static server. |
| `tools/net-test.mjs` | `npm run test:net`. Round-trips the relay and checks the security rules. |
| `tools/tilt-test.mjs` | `npm run test:tilt`. Measures blade stability against a smooth swing. |
| `tools/motion-test.mjs` | `npm run test:motion`. Checks mapping, sensor startup, recovery, and screen easing. |

No build step. No bundler. Every file is loaded directly by the browser.

---

## How the sword works

The controller uses the phone-to-screen movement mechanism from HarryPotterSpells:

The motion tracker is copied directly from `HarryPotterSpells/game/tilt.js`.
Point your phone toward the big screen, tilted back so you can see its screen,
then tap **PLAY** and allow motion. Tap **Center** while aiming at the middle.
Turn left/right or tip up/down to swing the sword, just like the wand controls.

**Phone mapping.** Heading (alpha) controls x, pitch (beta) controls y. The pose
at PLAY or Center is the middle. A 112-degree turn covers the width; a 60-degree
tip covers the height. These are the source project's fixed gains. There is no
sensitivity slider, rotation-matrix mapping, velocity estimation, or prediction.
Avoid holding the phone dead upright; use the tilted posture from that project.

**Transport and display.** Match HarryPotterSpells' cadence: send at most every
30ms, with a 0.005-screen movement threshold and periodic keepalives. The screen
uses the same 16ms easing toward the latest received point. It never extrapolates
beyond the measured phone position. If motion is unavailable, drag to swing or
tap **Enable motion** to retry. Late sensor data restores motion automatically.

The visible trail is a ring buffer of the last 200ms of *rendered* positions, and
its newest segment is exactly what the slicing test uses — so what you see is what
cuts. Fast flicks are walked in sub-steps so a swing can never tunnel past a fruit,
and there's a minimum speed below which a resting sword doesn't cut anything.

## Halves

There are no sprite assets. Each fruit is a `draw(ctx, r)` function, and a half is
made by running that same function through two composite passes:
`destination-in` against a half-plane along the slash keeps one side, then
`source-atop` paints the flesh only where fruit pixels survived. The cut face
therefore follows the real silhouette — the banana crescent, the strawberry, the
pineapple crown — at any angle. Each piece is baked once at the moment of the cut
and then just tumbles as an image.

---

## Data model

Everything lives under `rooms/{6-digit code}`:

```
game:          "ninja"
status:        "lobby" | "playing" | "over"
players/{pid}: { joinedAt, slot }      # slot 0|1 -> blade colour
input/{pid}:   { x, y, vx, vy, t }     # set() ~33Hz, overwritten, never grows
cmd/{pid}:     { type, at }            # "start" | "again" | "center"
hud:           { score, best, lives, combo, status }
```

The sword is a cursor, not a log: one node per player, overwritten forever, so an
hour-long session costs the same as a one-minute one.

The room deletes itself when the big screen closes (`onDisconnect`), and each
phone removes its own nodes when it disconnects.

> **The Firebase project is shared** with an older project (PenDraw) that also
> writes under `rooms/`. That's why this app never enumerates or garbage-collects
> that tree — it atomically reserves a randomly chosen code and leaves
> everything else alone. `firebase-rules.json` is the rule set both rely on; it
> only permits writes under `rooms/{6 digits}`. To move onto your own Firebase
> project, edit `firebase-config.js` and publish `firebase-rules.json` to it.

## Two players

The wire format is already per-player and the engine already renders one blade per
slot in a second colour. `MAX_SLOTS` in `ninja/net.js` is set to 2, so a second
phone scanning the same QR gets a pink sword.

## Deploy

The public game is hosted on GitHub Pages from the `gh-pages` branch of
[Emirhan777/SliceParty](https://github.com/Emirhan777/SliceParty). Run
`npm run build:site` to prepare the browser files in `dist/site`, then publish
that directory to the deployment branch. Native sources, environment files,
and build archives are excluded from the website.

GitHub Pages provides HTTPS without a running development computer. Firebase
provides live rooms using the existing database and rules. No paid hosting or
billing upgrade is required by this setup. Firebase's Spark plan is limited to
100 simultaneous connections, 1 GB stored, and 10 GB/month downloaded, shared
across all apps using that project. Pending app links expire after ten minutes;
normal app cancellation removes them, and screen-owned rooms delete on disconnect.
Abruptly terminated apps can leave small expired reservations, which cannot be claimed.

References: [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits),
[Firebase pricing](https://firebase.google.com/pricing).
