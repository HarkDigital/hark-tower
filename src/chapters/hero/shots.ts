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

/**
 * Fritsch–Carlson monotone cubic tangents for (xs, ys), computed once per key
 * set (sampling runs every frame and must not allocate).
 */
function tangents(xs: number[], ys: number[]) {
  const n = xs.length
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
  return m
}

type Curve = { xs: number[]; ys: number[][]; ms: number[][] }
const curves = new WeakMap<Key[], Curve>()

function curveOf(keys: Key[]): Curve {
  let c = curves.get(keys)
  if (!c) {
    const xs = keys.map(k => k[0])
    const ys = CH.map(ch => keys.map(k => k[1][ch]))
    c = { xs, ys, ms: ys.map(y => tangents(xs, y)) }
    curves.set(keys, c)
  }
  return c
}

export function sample(keys: Key[], local: number, out: Shot): Shot {
  const { xs, ys, ms } = curveOf(keys)
  const n = xs.length
  let i = 0
  while (i < n - 2 && local > xs[i + 1]) i++
  const x = Math.min(Math.max(local, xs[0]), xs[n - 1])
  const h = xs[i + 1] - xs[i]
  const t = (x - xs[i]) / h
  const t2 = t * t
  const t3 = t2 * t
  const h00 = 2 * t3 - 3 * t2 + 1
  const h10 = (t3 - 2 * t2 + t) * h
  const h01 = -2 * t3 + 3 * t2
  const h11 = (t3 - t2) * h
  for (let c = 0; c < CH.length; c++) {
    const y = ys[c]
    const m = ms[c]
    out[CH[c]] = h00 * y[i] + h10 * m[i] + h01 * y[i + 1] + h11 * m[i + 1]
  }
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
 *   0.00  VISION   across the square, at street level 150 m out: the whole
 *                  tower, crown to street, over the site (the reveal tilts up
 *                  from the site with the pen; the rest frame is the finished
 *                  glass tower standing over the crane and the empty lot).
 *                  Side offset: index.ts places it beside the opening copy.
 *   0.105 climbing over the square's trees toward the site…
 *   0.15  up over the hoarding: the plan drawn on the earth, the crane hooked
 *                  onto the first steel on the flatbed (A-001)
 *   0.28  orbiting left and down over the pedestals + base plates (S-101)
 *   0.48  low by grid line A, where the first columns land and are bolted (S-201)
 *   0.64  pulling up and back out over the square…
 *   0.74–0.92  PAYOFF  the whole vision, crown to first steel, from the square
 *   1.00  rising into the cut
 */
export const LAND: Key[] = [
  [0.0, S(0.2, 156, 2.2, 90, 0, 0, 72)],
  [0.06, S(0.193, 153, 2.6, 88, 0, 0, 71.5)],
  [0.105, S(0.04, 104, 26, 24, 6, 12, 56)],
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
 * The vision is the same view across the square as landscape (a taller lens:
 * the opening line sits over the sky beside it, the plate below its foot);
 * the payoff looks from over the square, like landscape's, clear of the
 * street trees (the first steel sits low, behind the restated tagline).
 */
export const PORT: Key[] = [
  [0.0, S(0.2, 156, 2, 54, 0, 0, 94)],
  [0.06, S(0.193, 153, 2.4, 53, 0, 0, 93)],
  [0.105, S(0.04, 108, 30, 14, 5, 0, 68)],
  [0.15, S(-0.12, 62, 32, -8, 7, 0, 62)],
  [0.27, S(-0.3, 58, 25, -6, 7, 0, 62)],
  [0.37, S(-0.64, 54, 15, -3, 8, 0, 62)],
  [0.48, S(-0.78, 46, 6, 1, 8, 0, 64)],
  [0.56, S(-0.7, 52, 6, 3, 6, 0, 66)],
  [0.6, S(-0.26, 84, 19, 36, 3, 0, 72)],
  [0.64, S(0.2, 116, 14, 72, 0, 0, 82)],
  [0.74, S(0.58, 152, 24, 80, 0, 0, 88)],
  [0.92, S(0.55, 154, 26, 82, 0, 0, 88)],
  [1.0, S(0.52, 146, 52, 118, 0, 0, 82)],
]
