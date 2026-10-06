// Generated sound (WebAudio only, no audio files). Off until the first click (browser autoplay
// rules) and only when the sound setting is on. Keyboard clacks while Ghost types, a soft synth
// ambience, a ding on success, a buzzer on errors, a call when a program asks for input, a purr
// for the cat, thunder for lightning.

import type { ServerEvent } from '@shared/events';
import { HACKER_ID } from '@shared/agents';
import { worldStore } from '../net/store';
import { getSettings, subscribeSettings } from '../settings';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambience: { stop: () => void } | null = null;
  private noise: AudioBuffer | null = null;
  private unlocked = false;
  private nextClack = 0;
  private timer: number | undefined;

  init(): void {
    const unlock = () => {
      this.unlocked = true;
      this.apply();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    subscribeSettings(() => this.apply());
    worldStore.onEvent((e) => this.onEvent(e));
    this.timer = window.setInterval(() => this.typingLoop(), 40);
  }

  private get enabled(): boolean {
    return this.unlocked && getSettings().sound;
  }

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private apply(): void {
    if (this.enabled) {
      const ctx = this.ensure();
      if (ctx && !this.ambience) this.ambience = this.startAmbience(ctx);
    } else {
      this.ambience?.stop();
      this.ambience = null;
      if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
    }
  }

  private startAmbience(ctx: AudioContext): { stop: () => void } {
    const out = ctx.createGain();
    out.gain.value = 0.035;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.connect(out);
    out.connect(this.master!);
    const oscs = [55, 82.4, 110.3].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 1 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      o.detune.value = i * 4;
      o.connect(filter);
      o.start();
      return o;
    });
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    return {
      stop: () => {
        for (const o of [...oscs, lfo]) o.stop();
        out.disconnect();
      },
    };
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, vol: number, freq: number, q = 1, delay = 0, amHz = 0): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    if (amHz > 0) {
      const am = ctx.createGain();
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = amHz;
      depth.gain.value = 0.5;
      am.gain.value = 0.5;
      lfo.connect(depth);
      depth.connect(am.gain);
      g.connect(am);
      am.connect(this.master);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    } else g.connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  clack(): void {
    this.noiseBurst(0.035 + Math.random() * 0.02, 0.12, 2400 + Math.random() * 1800, 2.5);
  }

  ding(): void {
    this.tone(988, 0.18, 'square', 0.08);
    this.tone(1319, 0.32, 'square', 0.08, 0.12);
  }

  buzzer(): void {
    this.tone(110, 0.35, 'square', 0.1);
    this.tone(104, 0.35, 'sawtooth', 0.06, 0.02);
  }

  purr(): void {
    this.noiseBurst(1.3, 0.25, 180, 0.8, 0, 26);
  }

  blip(): void {
    this.tone(660, 0.06, 'square', 0.05);
  }

  /** The program asks for input: a rising two note call. */
  ask(): void {
    this.tone(523, 0.09, 'square', 0.07);
    this.tone(784, 0.16, 'square', 0.07, 0.1);
  }

  thunder(): void {
    this.noiseBurst(1.6, 0.18, 90, 0.6, 0.1);
  }

  private typingLoop(): void {
    if (!this.enabled) return;
    const ghost = worldStore.state.agents[HACKER_ID];
    // Keyboard clacks only while Ghost actually works at the PC (its screen is on: green, or red
    // after a runner error). He never types anywhere else, and the PC is dark when he is away.
    if (!ghost || ghost.anim !== 'typing' || ghost.move || worldStore.clock.isPaused) return;
    if (worldStore.state.world.deskScreen === 'off') return;
    const now = performance.now();
    if (now < this.nextClack) return;
    this.clack();
    const speed = worldStore.clock.speedMultiplier || 1;
    this.nextClack = now + (70 + Math.random() * 110) / speed;
  }

  private onEvent(e: ServerEvent): void {
    if (!this.enabled) return;
    switch (e.type) {
      case 'RESULT':
        if (e.payload.ok) this.ding();
        else this.buzzer();
        break;
      case 'FX':
        if (e.payload.type === 'siren') this.buzzer();
        else if (e.payload.type === 'coin_xp') this.blip();
        break;
      case 'AMBIENT':
        if (e.payload.type === 'lightning') this.thunder();
        break;
      case 'INPUT_REQUEST':
        this.ask();
        break;
    }
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }
}

export const sound = new SoundEngine();
