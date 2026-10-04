// Browser sensor lifecycle, independent of the controller UI and transport.
export function createPhoneMotion({ tracker, onSample, onMode, env = globalThis }) {
  let active = false, lastSample = -Infinity, waitingSince = 0, timer = null;
  const now = () => env.performance.now();
  const send = sample => {
    if (!active || !sample) return;
    lastSample = now();
    onMode("motion", "Sword motion live");
    onSample(sample);
  };
  const orient = e => {
    if (active && Number.isFinite(e.alpha) && Number.isFinite(e.beta)) {
      send(tracker.push(e.alpha, e.beta));
    }
  };
  function stop() {
    active = false;
    env.removeEventListener("deviceorientation", orient);
    if (timer !== null) env.clearInterval(timer);
    timer = null;
  }
  return {
    async start() {
      stop();
      if (!env.isSecureContext) {
        onMode("touch", "Open the HTTPS game link to enable motion");
        return;
      }
      // Same sensor as HarryPotterSpells; request during the PLAY gesture.
      const request = Type => {
        try {
          return Type && typeof Type.requestPermission === "function"
            ? Promise.resolve(Type.requestPermission())
            : Promise.resolve(Type ? "granted" : "unavailable");
        } catch (e) { return Promise.reject(e); }
      };
      const [result] = await Promise.allSettled([request(env.DeviceOrientationEvent)]);
      if (result.status !== "fulfilled" || result.value !== "granted") {
        onMode("touch", "Motion access unavailable — tap Enable motion to retry");
        return;
      }
      tracker.reset(); tracker.center();
      active = true; lastSample = -Infinity; waitingSince = now();
      onMode("waiting", "Point at the screen with your phone tilted back. Waiting for motion…");
      env.addEventListener("deviceorientation", orient);
      timer = env.setInterval(() => {
        if (now() - Math.max(waitingSince, lastSample) > 5000) {
          // Keep listeners: sensors may arrive late after permission or resume.
          onMode("touch", "No motion data — tap Enable motion or drag to swing");
        }
      }, 500);
    },
    stop,
  };
}
