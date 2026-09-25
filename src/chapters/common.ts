import * as THREE from 'three'
import { logoGeometry } from '../logo/logo'
import { clamp, lerp } from '../core/math'
import type { CameraPose, ChapterContext, Frame } from '../core/types'
import { FLOOR_H, FLOORS, MAT, TOWER_W } from '../kit/steel'

/*
 * Shared helpers for Hark Tower chapters.
 *
 * THE BAND: every chapter owns a band of the tower's construction and a slice
 * of the day. As `local` runs 0..1 the tower is erected from floors[0] to
 * floors[1] and the time of day moves from time[0] to time[1]. Chapters call
 * applySite(ctx, id, local) every frame (then override anything they need),
 * and frame their camera around frontierY(id, local) — the height of the
 * steel being erected right now. The tower is the through-line: scrolling
 * the whole site rides it from groundbreaking to topping out.
 *
 *   hero      Groundbreaking  floors  0 →  3   dawn
 *   work      Steel           floors  3 → 18   early morning
 *   services  Floors          floors 18 → 34   morning → midday
 *   voices    Tenants         floors 34 → 44   afternoon
 *   shield    Wind Load       floors 44 → 50   late afternoon
 *   process   Blueprint       floors 50 → 57   golden hour
 *   contact   Topping Out     floors 57 → 60   dusk → night (crown lights)
 */

export const BANDS: Record<string, { floors: [number, number]; time: [number, number] }> = {
  hero: { floors: [0, 3], time: [0.0, 0.06] },
  work: { floors: [3, 18], time: [0.08, 0.2] },
  services: { floors: [18, 34], time: [0.22, 0.34] },
  voices: { floors: [34, 44], time: [0.36, 0.46] },
  shield: { floors: [44, 50], time: [0.47, 0.54] },
  process: { floors: [50, 57], time: [0.55, 0.64] },
  contact: { floors: [57, 60], time: [0.7, 0.9] },
}

/** Floors erected at `local` within chapter `id`'s band. */
export function builtAt(id: string, local: number): number {
  const b = BANDS[id]
  return lerp(b.floors[0], b.floors[1], clamp(local))
}

/** Height (m) of the steel frontier at `local` within `id`'s band. */
export function frontierY(id: string, local: number): number {
  return builtAt(id, local) * FLOOR_H
}

/**
 * Set the site for this frame: floors built, curtain wall 6 floors behind,
 * interiors 12 behind, time of day, and the shadow focus at the frontier.
 * Call first in update(); override params afterwards as the chapter needs.
 */
export function applySite(ctx: ChapterContext, id: string, local: number) {
  const b = BANDS[id]
  const built = builtAt(id, local)
  const p = ctx.world.params
  p.built = built
  p.glazed = Math.max(0, built - 6)
  p.fitted = Math.max(0, built - 12)
  p.time = lerp(b.time[0], b.time[1], clamp(local))
  p.ghost = 1
  p.focus.set(0, built * FLOOR_H, 0)
}

/**
 * Frame the frontier from outside the tower: `angle` around it (radians, 0 =
 * the +z main face), `dist` from the tower centre, `above` metres above the
 * frontier, looking at a point `look` metres above it. Landscape screens push
 * the tower right of centre (copy lives on the left); portrait pulls back and
 * keeps it in the upper half (copy lives at the bottom).
 */
export function frontierCamera(
  out: CameraPose,
  frame: Frame,
  y: number,
  o: { angle?: number; dist?: number; above?: number; look?: number; fov?: number; side?: number } = {},
) {
  const portrait = frame.height > frame.width
  const angle = o.angle ?? 0.55
  const dist = (o.dist ?? 72) * (portrait ? 1.45 : 1)
  const above = o.above ?? 10
  const look = o.look ?? 2
  const side = portrait ? 0 : (o.side ?? 1) * 14
  // offset the look point sideways (screen-left) so the tower sits right of centre
  const right = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle))
  out.position.set(Math.sin(angle) * dist, y + above, Math.cos(angle) * dist)
  out.target.set(0, y + look - (portrait ? 8 : 0), 0).addScaledVector(right, -side)
  out.fov = o.fov ?? 42
  out.parallax = 0.8
}

/** The Hark mark as a small lit steel sign — a stand-in object for placeholders. */
export function placeholderMark(): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(logoGeometry({ depth: 0.22 }), MAT.signal(2.2))
  g.add(body)
  return g
}

/** No floor needed: the world has the city ground. Kept for placeholder imports. */
export function placeholderFloor(): THREE.Group {
  return new THREE.Group()
}

/**
 * Step through `count` items between local `a` and `b`.
 * Returns the current index, the progress inside its slot (0..1), and the
 * local value at the centre of each slot (use those for chapter.anchors).
 */
export function beat(local: number, count: number, a: number, b: number) {
  const span = (b - a) / count
  const idx = Math.min(count - 1, Math.max(0, Math.floor((local - a) / span)))
  const phase = clamp((local - a - idx * span) / span)
  const active = local >= a && local <= b
  return { idx, phase, active, centers: Array.from({ length: count }, (_, i) => a + span * (i + 0.55)) }
}

/** Legacy helper from the starter (placeholders): frame a subject at the origin. */
export function framedCamera(out: CameraPose, frame: Frame, amount = 1, dist = 7.5) {
  const portrait = frame.height > frame.width
  if (portrait) {
    out.position.set(0, 0.3, dist * 1.45)
    out.target.set(0, -0.35 * amount, 0)
  } else {
    out.position.set(-2.1 * amount, 0.5, dist)
    out.target.set(-1.5 * amount, 0, 0)
  }
  out.fov = 40
  out.parallax = 0.3
}

export { FLOOR_H, FLOORS, TOWER_W }
