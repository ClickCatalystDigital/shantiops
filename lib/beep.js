// lib/beep.js — a two-note chime with no audio file and no dependency. The repo has zero audio
// usage and public/ has no binaries; a committed .mp3 for 200ms of sine wave isn't worth it.
//
// Autoplay: browsers start an AudioContext 'suspended' until the page has seen a user gesture.
// components/NotificationBell.jsx pre-warms the context on the first pointerdown anywhere, so by
// the time a real notification arrives it's usually running. If one somehow fires before any
// interaction, state is still 'suspended' and beep() returns silently — the badge is the
// notification, the chime is a bonus.
let ctx;

export function warmAudio() {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume?.().catch(() => {});
  } catch {
    // no WebAudio — badge-only, silently
  }
}

export function beep() {
  try {
    warmAudio();
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    [880, 1320].forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const at = t0 + i * 0.09;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.012);  // 6% gain — subtle, not an alarm
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16); // exponential ramp: no click on stop
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.18);
    });
  } catch {
    // the badge is the notification
  }
}
