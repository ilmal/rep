import { getState } from '../store/core';

let ctx: AudioContext | null = null;

/** Beep + haptic when a rest ends (respects Settings → sound & haptics). Safe to call anywhere; never throws. */
export function restOverAlert() {
  if (!getState().settings.sound) return;
  try { navigator.vibrate?.([120, 60, 120]); } catch { /* unsupported */ }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    for (const [i, f] of [880, 1175].entries()) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + i * 0.16); g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.14);
      o.connect(g).connect(ctx.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.15);
    }
  } catch { /* audio blocked until a user gesture: haptics still fired */ }
}
