import * as THREE from 'three'

/*
 * Camera shots for the hero, as keyframes over local progress. Each shot is
 * cylindrical around the tower (so moves between keys ORBIT instead of
 * cutting across the site):
 *
 *   th    angle around the tower (radians, 0 = the +z street face, + = right)
 *   d     horizontal distance of the camera from the tower axis (m)
 *   h     camera height (m)
 *   ty    height of the look-at point (m)
 *   tin   look-at point pulled from the axis toward the camera (m)
 *   side  look-at point shifted screen-left (m) → subject sits right of centre
 *   fov   vertical field of view (deg)
 *
 * Channels are interpolated with a monotone cubic (no overshoot: a heavy
 * camera never dips through the ground or swings past its mark).
 */

export interface Shot {
  th: number
  d: number
  h: number
  ty: number
  tin: number
  side: number
  fov: number
}
export type Key = [number, Shot]

const CH: (keyof Shot)[] = ['th', 'd', 'h', 'ty', 'tin', 'side', 'fov']

/** Fritsch–Carlson monotone cubic through (xs, ys), evaluated at x. */
function monotone(xs: number[], ys: number[], x: number) {
  const n = xs.length
  if (x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]
  let i = 0
  while (i < n - 2 && x > xs[i + 1]) i++
  const d: number[] = []
  const m: number[] = []
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]))
  m.push(d[0])
  for (let k = 1; k < n - 1; k++) m.push(d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2)
  m.push(d[n - 2])
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0
      m[k + 1] = 0
      continue
    }
    const a = m[k] / d[k]
    const b = m[k + 1] / d[k]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[k] = t * a * d[k]
      m[k + 1] = t * b * d[k]
    }
  }
  const h = xs[i + 1] - xs[i]
  const t = (x - xs[i]) / h
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
}

export function sample(keys: Key[], local: number, out: Shot): Shot {
  const xs = keys.map(k => k[0])
  for (const c of CH) out[c] = monotone(xs, keys.map(k => k[1][c]), local)
  return out
}

const right = new THREE.Vector3()

/** Shot → camera position + look-at target. */
export function place(s: Shot, pos: THREE.Vector3, tgt: THREE.Vector3) {
  const sx = Math.sin(s.th)
  const cz = Math.cos(s.th)
  pos.set(sx * s.d, s.h, cz * s.d)
  right.set(cz, 0, -sx)
  tgt.set(sx * s.tin, s.ty, cz * s.tin).addScaledVector(right, -s.side)
}

const S = (th: number, d: number, h: number, ty: number, tin: number, side: number, fov: number): Shot => ({ th, d, h, ty, tin, side, fov })

/*
 * Story (landscape — copy on the left, subject right of centre):
 *   0.00  VISION   on the pavement between the street trees, 3.5 m from the
 *                  hoarding, looking up the drawn tower (the reveal tilts up
 *                  from the project board)
 *   0.15  up over the hoarding: the plan drawn on the earth, the crane hooked
 *                  onto the first steel on the flatbed (A-001)
 *   0.28  orbiting left and down over the pedestals + base plates (S-101)
 *   0.48  low by grid line A, where the first columns land and are bolted (S-201)
 *   0.64  pulling up and back out over the square…
 *   0.74–0.92  PAYOFF  the whole vision, crown to first steel, from the square
 *   1.00  rising into the cut
 */
export const LAND: Key[] = [
  [0.0, S(-0.185, 65.3, 1.7, 118, 0, 20, 66)],
  [0.07, S(-0.18, 64.9, 2.2, 108, 0, 19, 64)],
  [0.15, S(-0.12, 56, 22, 0, 10, 11, 48)],
  [0.27, S(-0.3, 50, 15, 0.5, 9, 9, 46)],
  [0.37, S(-0.64, 44, 8, 1, 8, 7, 44)],
  [0.48, S(-0.78, 36, 3.2, 5.5, 8, 6, 48)],
  [0.56, S(-0.7, 40, 3.8, 8, 6, 6, 50)],
  [0.64, S(0.0, 92, 17, 60, 0, 6, 66)],
  [0.74, S(0.6, 150, 30, 93, 0, 4, 76)],
  [0.92, S(0.56, 152, 32, 95, 0, 4, 76)],
  [1.0, S(0.54, 146, 56, 122, 0, 4, 72)],
]

/*
 * Portrait: the tower and the story in the upper part, the copy plate below.
 * The vision starts across the pavement (behind the tree line, between two
 * trees) so the narrow frame still takes in the whole project board.
 */
export const PORT: Key[] = [
  [0.0, S(-0.174, 69.5, 1.7, 118, 0, 0, 80)],
  [0.07, S(-0.17, 69, 2.2, 110, 0, 0, 80)],
  [0.15, S(-0.12, 62, 32, -8, 7, 0, 62)],
  [0.27, S(-0.3, 58, 25, -6, 7, 0, 62)],
  [0.37, S(-0.64, 54, 15, -3, 8, 0, 62)],
  [0.48, S(-0.78, 46, 6, 1, 8, 0, 64)],
  [0.56, S(-0.7, 52, 6, 3, 6, 0, 66)],
  [0.64, S(0.0, 100, 10, 90, 0, 0, 80)],
  [0.74, S(0.6, 96, 3, 118, 0, 0, 86)],
  [0.92, S(0.57, 98, 3, 120, 0, 0, 86)],
  [1.0, S(0.54, 94, 30, 150, 0, 0, 82)],
]
