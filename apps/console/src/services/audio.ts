import type { AlarmSeverity } from '@magnav/protocol';

/**
 * Minimal alarm sounder. WebAudio needs a user gesture; call unlock() from the
 * first interaction. High-priority alarms use a two-tone IEC-60601-1-8-inspired
 * pattern; medium uses a single short tone. No external assets.
 */

let ctx: AudioContext | null = null;
let muted = false;
let lastPlayed = 0;

export function initAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  try {
    ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  } catch {
    ctx = null;
  }
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem('magnav.muted', value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function isMuted(): boolean {
  if (muted) return true;
  try {
    return window.localStorage.getItem('magnav.muted') === '1';
  } catch {
    return false;
  }
}

function tone(freq: number, start: number, duration: number, gainValue: number, type: OscillatorType) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(gainValue, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export function playAlarm(severity: AlarmSeverity): void {
  if (isMuted() || !ctx) return;
  const now = ctx.currentTime;
  if (now - lastPlayed < 0.9) return;
  lastPlayed = now;
  if (severity === 'high') {
    tone(880, now, 0.16, 0.16, 'sine');
    tone(1175, now + 0.2, 0.16, 0.16, 'sine');
    tone(880, now + 0.4, 0.16, 0.12, 'sine');
  } else if (severity === 'medium') {
    tone(660, now, 0.14, 0.1, 'triangle');
    tone(660, now + 0.24, 0.14, 0.08, 'triangle');
  } else {
    tone(520, now, 0.1, 0.05, 'sine');
  }
}

export function playClick(): void {
  if (isMuted() || !ctx) return;
  tone(1200, ctx.currentTime, 0.03, 0.03, 'square');
}
