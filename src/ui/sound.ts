import type { Frame } from '../core/types'
import type { EngineState } from '../core/Engine'

/*
 * Hark Tower sound: THE CITY AT ALTITUDE (WebAudio, no files).
 *
 *   wind      a soft bed of filtered pink noise that breathes in slow gusts.
 *             It climbs with the steel: at groundbreaking it is a low, round
 *             hush between buildings; by the top floors it is higher and
 *             airier, with a faint whistle where the wind splits on the
 *             frame (a narrow band that wanders like air over an edge).
 *   city      a low, distant hum (brown noise, low-passed, plus a quiet
 *             open fifth under it) that falls away as the tower rises.
 *   steel     now and then a struck-steel note far off, like a beam ringing
 *             two blocks away: inharmonic partials, each a slightly detuned
 *             pair so it shimmers, a soft strike, darkened by distance and
 *             sent into a slap echo off the city and a long dark tail. D
 *             major pentatonic; the register lifts as the tower does.
 *   crown     when the Hark crown lights at topping out, a slow rising
 *             three-note steel chord (once, re-armed when it goes dark).
 *   cut()     a crane slew: a filtered-noise swell that sweeps up and
 *             settles, and a low steel chime as the load lands.
 *   blip()    a small steel tick (nav, buttons), pitched up the scale.
 *   tone()    a pure sine a chapter may ask for (also 'hark:tone' events).
 *   meter()   four band levels for the chrome's sound meter.
 *
 * Off by default. Sound only ever starts from a user gesture: the toggle's
 * own click / tap / Enter / Space. A remembered "on" (localStorage) waits for
 * the first real activation (a click or tap, or Enter / Space on a control;
 * never Tab, Shift, arrows or scrolling). Faded out and suspended while the
 * tab is hidden. On iOS the session is switched to "playback" so the silent
 * switch doesn't swallow it. Everything sits low: the master is well under
 * full scale, a high-pass keeps laptop speakers clean and a gentle
 * compressor glues it.
 */

export const STORE_KEY = 'hark-tower:sound'

/** The remembered choice: true (on), false (off), or null when never set. */
export function storedAudio(): boolean | null {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

/** What the world looks like right now (fed by the chrome). */
export interface SoundSource {
  /** 0 at the ground … 1 at the top of the steel */
  alt: number
  /** time of day, 0 dawn … 1 night */
  time: number
  /** 0..1 the Hark crown sign */
  crown: number
}

const ACTIVATE_KEYS = new Set(['Enter', ' ', 'Spacebar'])
const CONTROL = 'a[href], button, [role="button"], [role="switch"], summary, input, select, textarea'
const MASTER_LEVEL = 1
const TONE_MAX = 0.05
/** struck steel: inharmonic modes, their levels and relative decays */
const PARTIALS = [1, 1.588, 2.414, 3.312, 4.47]
const PARTIAL_GAIN = [1, 0.5, 0.34, 0.2, 0.11]
const PARTIAL_DECAY = [1, 0.66, 0.46, 0.32, 0.22]
/** D major pentatonic */
const SCALE = [0, 2, 4, 7, 9]
const ROOT = 50 // D3

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const degToMidi = (d: number) => ROOT + SCALE[((d % 5) + 5) % 5] + 12 * Math.floor(d / 5)

function setAudioSession(type: 'playback' | 'auto') {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    if (nav.audioSession) nav.audioSession.type = type
  } catch {
    /* not supported */
  }
}

export class Sound {
  enabled = false
  onChange: ((enabled: boolean) => void)[] = []

  private ctx: AudioContext | null = null
  private master!: GainNode
  private dry!: GainNode
  private echo!: GainNode
  private wet!: GainNode
  private analyser!: AnalyserNode
  private bins = new Uint8Array(128)
  private pink!: AudioBuffer
  private white!: AudioBuffer
  // wind
  private windBus!: GainNode
  private gust!: GainNode
  private windBody!: BiquadFilterNode
  private whistle!: BiquadFilterNode
  private whistleGain!: GainNode
  // city
  private cityGain!: GainNode
  // requested pure tone
  private toneOsc!: OscillatorNode
  private toneGain!: GainNode
  private toneHz = 440
  private toneLevel = 0

  // what the world is doing
  private source: (() => SoundSource) | null = null
  private alt = 0
  private time = 0
  private crownRung = false
  private lastParamAt = 0
  private nextGust = 0

  private ringTimer = 0
  private nextRing = 0
  private lastDegree = -1
  private lastCut = 0
  private lastBlip = 0
  private lastCrown = -99
  private suspendTimer = 0
  private hidden = typeof document !== 'undefined' && document.hidden
  /** a remembered "on" preference waiting for the first user gesture */
  private armed = false
  private gestureBound = false

  constructor() {
    this.armed = storedAudio() === true
    if (this.armed) this.waitForGesture()
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden
      this.applyRunning()
    })
    window.addEventListener('hark:tone', e => {
      const d = (e as CustomEvent<{ hz?: number; level?: number }>).detail
      if (d && typeof d.hz === 'number') this.tone(d.hz, d.level ?? 0)
    })
  }

  /** was sound on last visit? (it still needs a gesture to start) */
  get remembered() {
    return storedAudio() === true
  }

  /** Where the tower and the day are (the chrome wires this to the world). */
  bind(source: () => SoundSource) {
    this.source = source
  }

  /** Flip sound on/off. Call from a user gesture (click / key). */
  toggle() {
    this.armed = false
    this.setEnabled(!this.enabled)
    this.persist(this.enabled)
  }

  /** Follow the build: altitude opens the wind and thins the city; the crown rings. */
  update(_frame: Frame, _state: EngineState) {
    const src = this.source?.()
    if (src) {
      this.alt = clamp01(Number.isFinite(src.alt) ? src.alt : 0)
      this.time = clamp01(Number.isFinite(src.time) ? src.time : 0)
    }
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    // topping out: the crown lights -> one slow steel chord (re-armed once it goes dark)
    if (src) {
      if (!this.crownRung && src.crown > 0.55 && now - this.lastCrown > 8) {
        this.crownRung = true
        this.lastCrown = now
        this.crownChord(ctx, now + 0.1)
      } else if (this.crownRung && src.crown < 0.15) this.crownRung = false
    }
    if (now - this.lastParamAt < 0.12) return
    this.lastParamAt = now
    this.applyWind(ctx, now, 0.9)
    // gusts: every few seconds the wind leans in, then lets go
    if (now >= this.nextGust) {
      this.nextGust = now + 3.5 + Math.random() * 5.5
      const lean = 0.7 + Math.random() * 0.55
      this.gust.gain.setTargetAtTime(lean, now, 1.1 + Math.random() * 0.8)
    }
  }

  /** A crane slew: a filtered swell that sweeps up and settles, then a low steel chime. */
  cut(_from: number, to: number) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastCut < 0.7) return
    this.lastCut = now
    const src = ctx.createBufferSource()
    src.buffer = this.pink
    src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.6
    bp.frequency.setValueAtTime(170, now)
    bp.frequency.exponentialRampToValueAtTime(640, now + 0.85)
    bp.frequency.exponentialRampToValueAtTime(360, now + 1.8)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.09, now + 0.55)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.9)
    src.connect(bp).connect(g)
    g.connect(this.dry)
    const send = ctx.createGain()
    send.gain.value = 0.8
    g.connect(send).connect(this.wet)
    src.start(now, Math.random() * 3)
    src.stop(now + 2)
    // the load lands: a low steel note in the key, a fifth under it for weight
    const deg = Math.max(0, Math.min(6, Math.round(to)))
    this.ring(ctx, now + 0.62, degToMidi(deg), 0.62, 5.2, 0, 0.45)
    this.ring(ctx, now + 0.66, degToMidi(deg) - 5, 0.3, 4.4, 0.15, 0)
  }

  /** A small steel tick (nav, buttons). `pitch` steps up the pentatonic scale. No-op while off. */
  blip(pitch = 0) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastBlip < 0.06) return
    this.lastBlip = now
    const p = Math.max(0, Math.round(pitch))
    const f0 = mtof(degToMidi(p) + 36)
    const out = ctx.createGain()
    out.gain.value = 0.045
    out.connect(this.dry)
    const send = ctx.createGain()
    send.gain.value = 0.35
    out.connect(send).connect(this.wet)
    ;[1, 1.588, 2.414].forEach((r, i) => {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = Math.min(12000, f0 * r)
      const g = ctx.createGain()
      const d = [0.14, 0.09, 0.06][i]
      g.gain.setValueAtTime(0, now)
      g.gain.linearRampToValueAtTime([1, 0.45, 0.25][i], now + 0.002)
      g.gain.exponentialRampToValueAtTime(0.0001, now + d)
      o.connect(g).connect(out)
      o.start(now)
      o.stop(now + d + 0.02)
    })
    this.strike(ctx, now, Math.min(7000, f0 * 3), 0.25, out)
    window.setTimeout(() => out.disconnect(), 600)
  }

  /** A pure sine a chapter may ask for: level 0..1 (0 releases it). */
  tone(hz: number, level: number) {
    if (Number.isFinite(hz) && hz > 20 && hz < 12000) this.toneHz = hz
    this.toneLevel = clamp01(Number.isFinite(level) ? level : 0)
    this.applyTone()
  }

  /** Four band levels 0..1 (low → high) for a level meter; false while silent. */
  meter(out: number[]): boolean {
    const ctx = this.live()
    if (!ctx || !this.analyser) return false
    this.analyser.getByteFrequencyData(this.bins)
    const b = this.bins
    const band = (a: number, z: number) => {
      let m = 0
      for (let i = a; i <= z; i++) m = Math.max(m, b[i])
      return m / 255
    }
    out[0] = band(0, 2)
    out[1] = band(3, 6)
    out[2] = band(7, 16)
    out[3] = band(17, 48)
    return true
  }

  /* ------------------------------------------------------------ internals */

  private live() {
    const ctx = this.ctx
    if (!ctx || !this.enabled || this.hidden || ctx.state !== 'running') return null
    return ctx
  }

  private persist(on: boolean) {
    try {
      localStorage.setItem(STORE_KEY, on ? '1' : '0')
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }

  private setEnabled(on: boolean) {
    if (on === this.enabled) return
    this.enabled = on
    setAudioSession(on ? 'playback' : 'auto')
    if (on) {
      try {
        this.ensureGraph()
      } catch (err) {
        console.warn('[hark] audio unavailable', err)
      }
    }
    this.applyRunning(true)
    for (const fn of this.onChange) fn(on)
  }

  /** Resume + fade in, or fade out + suspend, based on enabled/hidden. */
  private applyRunning(greet = false) {
    const ctx = this.ctx
    if (!ctx) return
    window.clearTimeout(this.suspendTimer)
    window.clearInterval(this.ringTimer)
    const now = ctx.currentTime
    if (this.enabled && !this.hidden) {
      ctx
        .resume()
        .then(() => {
          if (!this.enabled || this.hidden) return
          if (ctx.state !== 'running') return this.waitForGesture()
          const t = ctx.currentTime
          this.applyWind(ctx, t, 0.05)
          this.master.gain.cancelScheduledValues(t)
          this.master.gain.setValueAtTime(this.master.gain.value, t)
          this.master.gain.setTargetAtTime(MASTER_LEVEL, t, 0.7)
          this.applyTone()
          if (greet) {
            // "on": two steel notes, a fifth apart, like a beam answered across the street
            this.ring(ctx, t + 0.08, degToMidi(5), 0.55, 4.2, -0.3, 0.8)
            this.ring(ctx, t + 0.42, degToMidi(8), 0.4, 4.6, 0.35, 0.6)
            this.nextRing = t + 6
          } else this.nextRing = t + 2.5
          this.nextGust = t + 2
          this.ringTimer = window.setInterval(this.tickRings, 250)
        })
        .catch(() => this.waitForGesture())
    } else {
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(this.master.gain.value, now)
      this.master.gain.setTargetAtTime(0, now, this.hidden ? 0.05 : 0.2)
      this.suspendTimer = window.setTimeout(
        () => {
          if (!this.enabled || this.hidden) ctx.suspend().catch(() => {})
        },
        this.hidden ? 300 : 1100,
      )
    }
  }

  /** Start audio on the first real gesture (remembered preference / blocked resume). */
  private waitForGesture() {
    if (this.gestureBound) return
    this.gestureBound = true
    let sx = 0
    let sy = 0
    const events = ['click', 'keydown', 'touchstart', 'touchend'] as const
    const handler = (e: Event) => {
      if (e.type === 'touchstart') {
        const t = (e as TouchEvent).touches[0]
        if (t) {
          sx = t.clientX
          sy = t.clientY
        }
        return
      }
      if (e.type === 'touchend') {
        // a tap, not a scroll or a swipe
        const t = (e as TouchEvent).changedTouches[0]
        if (!t || Math.hypot(t.clientX - sx, t.clientY - sy) > 12) return
      }
      // keyboard: only Enter / Space aimed at a control counts as "play"; Tab,
      // Shift+Tab, arrows, PageDown and Space-to-scroll are just moving around
      if (e instanceof KeyboardEvent) {
        if (!ACTIVATE_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
        if (!(e.target as Element | null)?.closest?.(CONTROL)) return
      }
      for (const ev of events) window.removeEventListener(ev, handler, true)
      this.gestureBound = false
      const onToggle = (e.target as Element | null)?.closest?.('[data-sound-toggle]')
      if (this.armed) {
        this.armed = false
        // the toggle's own click decides for itself
        if (!onToggle) this.setEnabled(true)
      } else if (this.enabled) this.applyRunning()
    }
    for (const ev of events) window.addEventListener(ev, handler, { capture: true, passive: true })
  }

  private ensureGraph() {
    if (this.ctx) return
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC({ latencyHint: 'playback' })
    this.ctx = ctx
    const now = ctx.currentTime

    // master -> high-pass -> gentle glue compression -> out (+ a meter tap)
    this.master = ctx.createGain()
    this.master.gain.value = 0
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 45
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -22
    comp.knee.value = 18
    comp.ratio.value = 3
    comp.attack.value = 0.012
    comp.release.value = 0.35
    this.master.connect(hp)
    hp.connect(comp)
    comp.connect(ctx.destination)
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.smoothingTimeConstant = 0.82
    this.analyser.minDecibels = -86
    this.analyser.maxDecibels = -28
    comp.connect(this.analyser)

    this.dry = ctx.createGain()
    this.dry.connect(this.master)

    // the city answers: a darkened slap echo off the facades across the street
    this.echo = ctx.createGain()
    this.echo.gain.value = 1
    const delay = ctx.createDelay(1.5)
    delay.delayTime.value = 0.34
    const fb = ctx.createGain()
    fb.gain.value = 0.3
    const dark = ctx.createBiquadFilter()
    dark.type = 'lowpass'
    dark.frequency.value = 1700
    this.echo.connect(delay)
    delay.connect(dark)
    dark.connect(fb).connect(delay)
    const echoOut = ctx.createGain()
    echoOut.gain.value = 0.42
    dark.connect(echoOut).connect(this.master)

    // a long, dark tail: the street canyon
    const verb = ctx.createConvolver()
    verb.buffer = canyonImpulse(ctx, 3.6)
    this.wet = ctx.createGain()
    this.wet.gain.value = 0.5
    this.wet.connect(verb)
    verb.connect(this.master)

    this.pink = pinkBuffer(ctx, 6)
    this.white = whiteBuffer(ctx, 1.5)

    // ---- wind: pink noise, a body band + a narrow whistle band, breathing in gusts
    this.windBus = ctx.createGain()
    this.windBus.gain.value = 0.06
    this.gust = ctx.createGain()
    this.gust.gain.value = 0.85
    this.windBus.connect(this.gust)
    this.gust.connect(this.dry)
    const windSend = ctx.createGain()
    windSend.gain.value = 0.35
    this.gust.connect(windSend).connect(this.wet)
    // slow breathing on top of the scheduled gusts
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.071
    const lfoDepth = ctx.createGain()
    lfoDepth.gain.value = 0.018
    lfo.connect(lfoDepth).connect(this.windBus.gain)
    lfo.start(now)

    const windSrc = ctx.createBufferSource()
    windSrc.buffer = this.pink
    windSrc.loop = true
    this.windBody = ctx.createBiquadFilter()
    this.windBody.type = 'bandpass'
    this.windBody.frequency.value = 340
    this.windBody.Q.value = 0.55
    windSrc.connect(this.windBody).connect(this.windBus)
    windSrc.start(now, Math.random() * 5)

    const whistleSrc = ctx.createBufferSource()
    whistleSrc.buffer = this.pink
    whistleSrc.loop = true
    this.whistle = ctx.createBiquadFilter()
    this.whistle.type = 'bandpass'
    this.whistle.frequency.value = 900
    this.whistle.Q.value = 11
    // the whistle wanders a little, like air over an edge
    const wander = ctx.createOscillator()
    wander.frequency.value = 0.13
    const wanderDepth = ctx.createGain()
    wanderDepth.gain.value = 55
    wander.connect(wanderDepth).connect(this.whistle.frequency)
    wander.start(now)
    this.whistleGain = ctx.createGain()
    this.whistleGain.gain.value = 0
    whistleSrc.connect(this.whistle).connect(this.whistleGain).connect(this.windBus)
    whistleSrc.start(now, Math.random() * 5)

    // ---- the city below: a low rumble and a quiet open fifth, falling away with height
    this.cityGain = ctx.createGain()
    this.cityGain.gain.value = 0.1
    this.cityGain.connect(this.dry)
    const rumbleSrc = ctx.createBufferSource()
    rumbleSrc.buffer = brownBuffer(ctx, 5)
    rumbleSrc.loop = true
    const rumbleLp = ctx.createBiquadFilter()
    rumbleLp.type = 'lowpass'
    rumbleLp.frequency.value = 240
    rumbleLp.Q.value = 0.3
    const rumbleG = ctx.createGain()
    rumbleG.gain.value = 0.9
    rumbleSrc.connect(rumbleLp).connect(rumbleG).connect(this.cityGain)
    rumbleSrc.start(now, Math.random() * 4)
    const humLp = ctx.createBiquadFilter()
    humLp.type = 'lowpass'
    humLp.frequency.value = 420
    const humG = ctx.createGain()
    humG.gain.value = 0.035
    humLp.connect(humG).connect(this.cityGain)
    for (const [hz, det] of [
      [mtof(38), -3],
      [mtof(45), 4],
    ]) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = hz
      o.detune.value = det
      o.connect(humLp)
      o.start(now)
    }

    // ---- requested pure tone
    this.toneOsc = ctx.createOscillator()
    this.toneOsc.type = 'sine'
    this.toneOsc.frequency.value = this.toneHz
    this.toneGain = ctx.createGain()
    this.toneGain.gain.value = 0
    this.toneOsc.connect(this.toneGain).connect(this.dry)
    this.toneOsc.start(now)
  }

  /** wind + city follow the altitude and the hour */
  private applyWind(ctx: AudioContext, now: number, tc: number) {
    if (!this.windBus) return
    const a = this.alt
    const night = clamp01((this.time - 0.72) / 0.25)
    // higher = brighter, airier body; a whistle only once there's height to catch
    this.windBody.frequency.setTargetAtTime(300 + a * 820, now, tc)
    this.windBody.Q.value = 0.55 + a * 0.35
    this.whistle.frequency.setTargetAtTime(760 + a * 980, now, tc)
    this.whistleGain.gain.setTargetAtTime(Math.pow(a, 1.4) * 0.34, now, tc)
    this.windBus.gain.setTargetAtTime((0.05 + a * 0.07) * (1 - night * 0.3), now, tc)
    // the city falls away beneath you (and hushes at night)
    this.cityGain.gain.setTargetAtTime(0.1 * (1 - a * 0.72) * (1 - night * 0.35), now, tc)
    void ctx
  }

  private tickRings = () => {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (now < this.nextRing) return
    const night = clamp01((this.time - 0.72) / 0.25)
    // sparse: a beam every 5–11 s (sparser at night)
    this.nextRing = now + (5 + Math.random() * 6) * (1 + night * 0.4)
    // a gentle walk around the scale; the register lifts with the tower
    const lo = Math.round(this.alt * 4)
    const n = 7
    let d = this.lastDegree < 0 ? lo + Math.floor(Math.random() * n) : this.lastDegree + Math.round((Math.random() - 0.5) * 4)
    d = Math.max(lo, Math.min(lo + n - 1, d))
    this.lastDegree = d
    const vel = 0.4 + Math.random() * 0.4
    const pan = (Math.random() - 0.5) * 1.1
    this.ring(ctx, now + 0.02, degToMidi(d), vel, 4.8, pan, 0.8)
    // sometimes a second beam answers from across the street
    if (Math.random() < 0.3) this.ring(ctx, now + 0.5 + Math.random() * 0.4, degToMidi(d + 2), vel * 0.55, 4, -pan * 0.7, 0.5)
  }

  /** topping out: a slow rising D major chord in steel, then the octave */
  private crownChord(ctx: AudioContext, t: number) {
    const notes = [degToMidi(5), degToMidi(7), degToMidi(8), degToMidi(10)]
    notes.forEach((m, i) => this.ring(ctx, t + i * 0.32, m, 0.55 - i * 0.06, 5.5, (i - 1.5) * 0.35, 0.6))
    this.nextRing = Math.max(this.nextRing, t + 7)
  }

  /**
   * One struck-steel note: inharmonic modes, each a detuned pair so it
   * shimmers like a real beam; a soft strike; darkened by distance; half dry,
   * half off the city (slap echo + canyon tail).
   */
  private ring(ctx: AudioContext, t: number, midi: number, vel: number, decay: number, pan = 0, strike = 1) {
    const f0 = mtof(midi)
    const out = ctx.createGain()
    out.gain.value = 0.03 * vel
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2600
    lp.Q.value = 0.4
    out.connect(lp)
    let dest: AudioNode = lp
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner()
      p.pan.value = Math.max(-1, Math.min(1, pan))
      lp.connect(p)
      dest = p
    }
    dest.connect(this.dry)
    const echoSend = ctx.createGain()
    echoSend.gain.value = 0.5
    dest.connect(echoSend).connect(this.echo)
    const verbSend = ctx.createGain()
    verbSend.gain.value = 0.85
    dest.connect(verbSend).connect(this.wet)
    // higher notes ring shorter
    const reg = Math.max(0.5, Math.min(1.25, 320 / f0))
    let end = t
    PARTIALS.forEach((r, i) => {
      const f = f0 * r
      if (f > 9000) return
      const d = Math.max(0.1, decay * PARTIAL_DECAY[i] * reg)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(PARTIAL_GAIN[i] * 0.5, t + 0.003)
      g.gain.exponentialRampToValueAtTime(0.0001, t + d)
      g.connect(out)
      for (const k of [-1, 1]) {
        const o = ctx.createOscillator()
        o.type = 'sine'
        // the pair beats ~0.4–1.5 Hz: the shimmer of a long steel member
        o.frequency.value = f * (1 + k * (0.0011 + i * 0.0004))
        o.connect(g)
        o.start(t)
        o.stop(t + d + 0.05)
      }
      end = Math.max(end, t + d + 0.05)
    })
    if (strike > 0) this.strike(ctx, t, Math.min(6500, f0 * 6.5), 0.16 * strike, out)
    // tidy up the little graph once it has rung out (plus the echo tail)
    window.setTimeout(() => out.disconnect(), (end - ctx.currentTime + 1.2) * 1000)
  }

  /** a short band-passed noise tick: the hammer on the steel */
  private strike(ctx: AudioContext, t: number, hz: number, level: number, dest: AudioNode) {
    const s = ctx.createBufferSource()
    s.buffer = this.white
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = hz
    bp.Q.value = 1.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.028)
    s.connect(bp).connect(g).connect(dest)
    s.start(t, Math.random() * 1.2, 0.05)
  }

  private applyTone() {
    const ctx = this.ctx
    if (!ctx || !this.toneOsc) return
    const now = ctx.currentTime
    this.toneOsc.frequency.setTargetAtTime(this.toneHz, now, 0.05)
    this.toneGain.gain.setTargetAtTime(this.enabled ? this.toneLevel * TONE_MAX : 0, now, 0.12)
  }
}

/* ----------------------------------------------------------------- buffers */

function whiteBuffer(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return buf
}

/** pink noise (Paul Kellet's economy filter): soft, wind-like */
function pinkBuffer(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    b0 = 0.99765 * b0 + w * 0.099046
    b1 = 0.963 * b1 + w * 0.2965164
    b2 = 0.57 * b2 + w * 1.0526913
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2
  }
  // crossfade the loop seam
  const fade = Math.floor(ctx.sampleRate * 0.05)
  for (let i = 0; i < fade; i++) {
    const k = i / fade
    d[i] = d[i] * k + d[len - fade + i] * (1 - k)
  }
  return buf
}

/** brown noise: the deep, distant city */
function brownBuffer(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
    d[i] = last * 3.2
  }
  const fade = Math.floor(ctx.sampleRate * 0.08)
  for (let i = 0; i < fade; i++) {
    const k = i / fade
    d[i] = d[i] * k + d[len - fade + i] * (1 - k)
  }
  return buf
}

/** A dark stereo tail between tall buildings: decaying noise through a one-pole low-pass. */
function canyonImpulse(ctx: AudioContext, seconds: number) {
  const rate = ctx.sampleRate
  const len = Math.floor(rate * seconds)
  const buf = ctx.createBuffer(2, len, rate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      // the tail darkens as it decays
      const k = 0.42 - 0.34 * t
      lp += (Math.random() * 2 - 1 - lp) * k
      const pre = i < rate * 0.02 ? i / (rate * 0.02) : 1
      const tt = 1 - t
      d[i] = lp * pre * tt * tt * tt
    }
  }
  return buf
}
