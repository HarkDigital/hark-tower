import * as THREE from 'three'
import { logoOutlines, logoShapes } from '../../logo/logo'
import { FLOORS, FLOOR_H, TOWER_W } from '../../kit/steel'
import { CROWN_H, CROWN_Y, TOWER_H } from '../../world/tower'
import { PenLines } from './pen'

/*
 * THE VISION — the whole tower drafted in the dawn sky before a single beam
 * exists. The same envelope as the world's blueprint ghost (floor outlines,
 * perimeter grid lines, bracing every five floors, the Hark crown outline),
 * but drawn with a pen: the verticals shoot up, each floor snaps around as the
 * pen passes it, the crown is traced last. Once drawn it hands over to the
 * world's ghost (same geometry) and fades out.
 *
 * Draw clock (uDraw): 0 → 1. The pen reaches the roof at PEN_TOP.
 */

const HALF = TOWER_W / 2
const BAYS = 5
const BAY = TOWER_W / BAYS
/** matches the world's crown outline (src/world/tower.ts buildCrown: sign z 0.2, ghost +0.05) */
const CROWN_C = new THREE.Vector3(0, CROWN_Y + CROWN_H / 2, 0.25)
export const PEN_TOP = 0.8

export function buildVision() {
  const pen = new PenLines()
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const at = (y: number) => (y / TOWER_H) * PEN_TOP

  // verticals: every perimeter grid line, one stroke from the ground to the roof
  for (let i = 0; i <= BAYS; i++) {
    for (const j of [0, BAYS]) {
      pen.seg(v(-HALF + i * BAY, 0, -HALF + j * BAY), v(-HALF + i * BAY, TOWER_H, -HALF + j * BAY), 0, PEN_TOP)
      if (i !== 0 && i !== BAYS) pen.seg(v(-HALF + j * BAY, 0, -HALF + i * BAY), v(-HALF + j * BAY, TOWER_H, -HALF + i * BAY), 0, PEN_TOP)
    }
  }
  // floor outlines: each one drawn round as the pen passes (front face first)
  const lap = 0.0042
  for (let f = 0; f <= FLOORS; f++) {
    const y = f * FLOOR_H
    const s = Math.max(0, at(y) - 0.006)
    pen.seg(v(-HALF, y, HALF), v(HALF, y, HALF), s, lap)
    pen.seg(v(HALF, y, HALF), v(HALF, y, -HALF), s + lap, lap)
    pen.seg(v(HALF, y, -HALF), v(-HALF, y, -HALF), s + 2 * lap, lap)
    pen.seg(v(-HALF, y, -HALF), v(-HALF, y, HALF), s + 3 * lap, lap)
  }
  // bracing every five floors, drawn with the rise
  for (let f = 0; f < FLOORS; f += 5) {
    const y0 = f * FLOOR_H
    const y1 = Math.min(TOWER_H, (f + 5) * FLOOR_H)
    const s = at(y0)
    const d = at(y1) - at(y0)
    pen.seg(v(-HALF, y0, HALF), v(HALF, y1, HALF), s, d)
    pen.seg(v(HALF, y0, -HALF), v(-HALF, y1, -HALF), s, d)
    pen.seg(v(HALF, y0, HALF), v(HALF, y1, -HALF), s, d)
    pen.seg(v(-HALF, y0, -HALF), v(-HALF, y1, HALF), s, d)
  }
  // the crown's sign frame posts, as the world's ghost draws them
  for (const x of [-9, 9]) pen.seg(v(x, TOWER_H, 0), v(x, CROWN_Y + CROWN_H, 0), PEN_TOP, 0.1)
  const ghost = pen.build({ opacity: 0.42, head: 2.6 })

  // the crown: every contour of the Hark mark traced at once, last
  const crownPen = new PenLines()
  for (const line of logoOutlines(logoShapes(), 120)) {
    const pts = line.map(p => new THREE.Vector3(CROWN_C.x + p.x * CROWN_H, CROWN_C.y + p.y * CROWN_H, CROWN_C.z))
    crownPen.poly(pts, PEN_TOP + 0.02, 0.16)
  }
  const crown = crownPen.build({ opacity: 0.8, head: 2.2 })

  // drafting furniture: a height dimension up the left edge with a tick every ten
  // floors, extension lines, and the base width across the front
  const dim = new PenLines()
  const dx = -HALF - 7
  const dz = HALF
  dim.seg(v(dx, 0, dz), v(dx, TOWER_H, dz), 0.02, PEN_TOP)
  for (let f = 0; f <= FLOORS; f += 10) {
    const y = f * FLOOR_H
    const s = 0.02 + at(y)
    // architectural slash tick + an extension line back to the envelope
    dim.seg(v(dx - 0.9, y - 0.9, dz), v(dx + 0.9, y + 0.9, dz), s, 0.01)
    dim.seg(v(dx - 1.2, y, dz), v(-HALF - 0.8, y, dz), s, 0.02)
  }
  const bz = HALF + 7
  dim.seg(v(-HALF, 0.06, bz), v(HALF, 0.06, bz), 0.0, 0.12)
  for (let i = 0; i <= BAYS; i++) {
    const x = -HALF + i * BAY
    dim.seg(v(x - 0.7, 0.06, bz + 0.7), v(x + 0.7, 0.06, bz - 0.7), 0.02 * i, 0.01)
    dim.seg(v(x, 0.06, bz + 1.2), v(x, 0.06, HALF + 0.8), 0.02 * i, 0.03)
  }
  const dims = dim.build({ opacity: 0.55, head: 1.6 })

  const group = new THREE.Group()
  group.name = 'hero-vision'
  group.add(ghost, crown, dims)
  return { group, ghost, crown, dims }
}
