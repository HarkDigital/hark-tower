import { clamp, lerp, smoothstep } from '../../core/math'
import { SERVICES } from '../../content'
import { builtAt } from '../common'

/*
 * FLOORS — the scroll schedule, as pure functions of `local` (so any jump
 * poses exactly).
 *
 *   0 – 0.08     intro: the hoist is already climbing out of the cut,
 *                "Eleven ways to be heard."
 *   0.08 – 0.92  eleven stops. Slot k: the hoist travels up one floor
 *                (phase 0 → ARRIVE), docks at slab SLAB0 + k, the landing
 *                gate lifts, the floor's drawing is finished, the curtain
 *                wall goes in, the lights come on and the sign lights up
 *                (settled by phase 0.52; the anchor sits at 0.55).
 *   0.92 – 1     the car runs up to the top landing under the steel as the
 *                blueprint cut begins.
 *
 * Levels are named the US way: slab index 0 (the ground) is Level 1, so
 * slab 18 is "L19".
 */

export const COUNT = SERVICES.length
export const A = 0.08
export const B = 0.92
export const SPAN = (B - A) / COUNT
/** phase of a slot at which the car docks */
export const ARRIVE = 0.32
/** slab of the first service stop */
export const SLAB0 = 18
/** where the car is at local 0 (already moving) */
export const START_SLAB = 14
/** the top landing the car reaches at the end */
export const TOP_SLAB = 31
const TOP_AT = 0.985

export const slabOf = (k: number) => SLAB0 + k
export const levelOf = (slab: number) => Math.round(slab) + 1

/** smootherstep: zero velocity and acceleration at both ends (a hoist car) */
export const smoother = (t: number) => {
  const x = clamp(t)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

/** Phase of service k's slot at `local` (may run < 0 or > 1). */
export const phaseOf = (k: number, local: number) => (local - A - k * SPAN) / SPAN

/** The car's floor (fractional slab index; y = slab * FLOOR_H). */
export function hoistSlab(local: number): number {
  const l = clamp(local)
  const first = A + ARRIVE * SPAN
  if (l <= first) {
    // out of the cut at speed, decelerating into the first stop
    const t = l / first
    return lerp(START_SLAB, SLAB0, 1 - (1 - t) * (1 - t))
  }
  if (l >= B) return lerp(slabOf(COUNT - 1), TOP_SLAB, smoother((l - B) / (TOP_AT - B)))
  const k = Math.min(COUNT - 1, Math.floor((l - A) / SPAN))
  const p = (l - A - k * SPAN) / SPAN
  if (k === 0 || p >= ARRIVE) return slabOf(k)
  return lerp(slabOf(k - 1), slabOf(k), smoother(p / ARRIVE))
}

/** 0..1 how fast the car is moving right now (for vibration / the HUD). */
export function hoistSpeed(local: number): number {
  const e = 0.0015
  const v = Math.abs(hoistSlab(local + e) - hoistSlab(local - e)) / (2 * e)
  // peak of a one-floor smootherstep run is 1.875 floors per ARRIVE * SPAN
  return clamp(v / (1.875 / (ARRIVE * SPAN)))
}

/**
 * Steel erected: the band's linear rise plus a small lead through the middle
 * (so every stop's slab is poured before the car docks); exact at both ends,
 * so the cuts to Steel and Tenants match.
 */
export function builtFor(local: number): number {
  const bump = 1.2 * smoothstep(0, 0.1, local) * (1 - smoothstep(0.86, 1, local))
  return builtAt('services', local) + bump
}

/** A slab is poured (and its landing usable) once the steel is this far past it. */
export const slabReady = (slab: number, built: number) => slab <= built - 1.9

/** Per-stop states, all 0..1. */
export function stopState(k: number, local: number) {
  const p = phaseOf(k, local)
  return {
    p,
    /** the drawing on the sheet is drafted as the car approaches */
    draw: smoothstep(-0.04, 0.3, p),
    /** curtain-wall units go in */
    glass: clamp((p - 0.24) / 0.24),
    /** ceiling lights flicker on */
    lights: clamp((p - 0.32) / 0.18),
    /** the sign lights up (sweeps bottom → top) */
    lit: smoothstep(0.36, 0.52, p),
    /** the landing gate lifts while the car is docked */
    gate: smoothstep(ARRIVE - 0.02, ARRIVE + 0.1, p) * (1 - smoothstep(0.95, 1.02, p)),
  }
}

/** Which service card is showing (-1 = none). Switches mid-travel, before the car docks. */
export function cardIndex(local: number): number {
  if (local < A + 0.1 * SPAN || local > B + 0.02) return -1
  return clamp(Math.floor((local - A - 0.1 * SPAN) / SPAN), 0, COUNT - 1)
}
