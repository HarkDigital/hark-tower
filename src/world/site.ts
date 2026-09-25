import * as THREE from 'three'
import { MAT, T, TC, TOWER_W, iBeamGeometry, mergeAll, personGeometry, tint } from '../kit/steel'
import { logoOutlines } from '../logo/logo'
import { BRAND, MICROCOPY } from '../content'
import { inPlaza } from './city'

/*
 * THE GROUND SITE — what the hero's dawn camera (and every look down) finds
 * at the foot of the tower:
 *
 *  - a 2.6 m plywood hoarding round the site (|x|,|z| = 60 m) printed with the
 *    developer graphic (HARK DIGITAL DESIGN · NOW BUILDING · the tagline, the
 *    mark in signal green, a hazard band), a gate on the main (+z) side
 *  - the foundation apron the steel stands on, batter boards + string lines
 *    and flagged survey stakes on the building lines
 *  - the site office (stacked portacabins + stair), storage containers, the
 *    steel laydown yard (beam bundles, deck packs), a mixer truck at the gate,
 *    a delivery flatbed, and a ground crew for scale
 *  - rebar bundles on dunnage, a spoil heap and a gravel pile, welfare units
 *  - outside: street trees (thin trunks and limbs under a sparse leaf canopy,
 *    not lollipops), the square's trees, parked sedans and SUVs with real
 *    profiles, street-light heads that glow at night (lights 0..1)
 *
 * Static and merged by material (a handful of draw calls; frustum-culled).
 * `onSite` (inside the hoarding, and the hoarding) hides when a chapter sets
 * world.params.site = 0 to stage its own ground site; `street` always shows.
 */

const F = 60
const HOARD_H = 2.6
const TILE_M = 26
const GATE: [number, number] = [16, 28]

function hoardingTexture() {
  const W = 2048
  const H = Math.round((W * HOARD_H) / TILE_M)
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const mark = logoOutlines(undefined, 120)
  const draw = () => {
    g.fillStyle = '#1c2127'
    g.fillRect(0, 0, W, H)
    // hazard band along the foot + a thin yellow top rail
    const band = Math.round(H * 0.11)
    g.save()
    g.beginPath()
    g.rect(0, H - band, W, band)
    g.clip()
    g.fillStyle = T.craneYellow
    g.fillRect(0, H - band, W, band)
    g.fillStyle = '#15181b'
    for (let x = -band * 2; x < W + band * 2; x += band * 2) {
      g.beginPath()
      g.moveTo(x, H)
      g.lineTo(x + band, H - band)
      g.lineTo(x + band * 2, H - band)
      g.lineTo(x + band, H)
      g.closePath()
      g.fill()
    }
    g.restore()
    g.fillStyle = T.craneYellow
    g.fillRect(0, 0, W, 4)
    const mid = (H - band) / 2 + 2
    // the mark
    const mh = H * 0.5
    const mx = 70
    g.save()
    g.translate(mx + mh * 0.5, mid)
    g.scale(mh, -mh)
    g.beginPath()
    for (const line of mark) {
      line.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.closePath()
    }
    g.fillStyle = T.signal
    g.fill('evenodd')
    g.restore()
    // HARK DIGITAL DESIGN
    g.textBaseline = 'middle'
    g.fillStyle = '#f4f1ea'
    g.font = `800 ${Math.round(H * 0.42)}px 'Big Shoulders Display Variable', 'Archivo Variable', sans-serif`
    let x = mx + mh + 34
    const name = MICROCOPY.signalEyebrow.toUpperCase()
    g.fillText(name, x, mid)
    x += g.measureText(name).width + 46
    // NOW BUILDING chip
    g.font = `600 ${Math.round(H * 0.15)}px 'IBM Plex Mono', ui-monospace, monospace`
    const chip = 'NOW BUILDING'
    const cw = g.measureText(chip).width + 36
    const ch = H * 0.26
    g.fillStyle = T.craneYellow
    g.fillRect(x, mid - ch / 2, cw, ch)
    g.fillStyle = '#15181b'
    g.fillText(chip, x + 18, mid + 2)
    x += cw + 46
    // the tagline, LISTEN. in signal green
    g.font = `800 ${Math.round(H * 0.3)}px 'Big Shoulders Display Variable', 'Archivo Variable', sans-serif`
    const tag = BRAND.tagline.toUpperCase()
    const cut = tag.lastIndexOf(' ') + 1
    g.fillStyle = '#f4f1ea'
    g.fillText(tag.slice(0, cut), x, mid)
    x += g.measureText(tag.slice(0, cut)).width
    g.fillStyle = T.signal
    g.fillText(tag.slice(cut), x, mid)
    x += g.measureText(tag.slice(cut)).width + 46
    // locale, small mono
    g.font = `500 ${Math.round(H * 0.11)}px 'IBM Plex Mono', ui-monospace, monospace`
    g.fillStyle = '#8b949c'
    g.fillText(BRAND.locale.toUpperCase(), x, mid)
  }
  draw()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.anisotropy = 8
  document.fonts?.ready.then(() => {
    draw()
    tex.needsUpdate = true
  })
  return tex
}

/** A quad from a→b (ground line), height h, facing `out`; uv.x in tiles. */
function wallQuad(a: THREE.Vector2, b: THREE.Vector2, h: number, flip: boolean, u0: number) {
  const len = a.distanceTo(b)
  const g = new THREE.BufferGeometry()
  const p = flip
    ? [b.x, 0, b.y, a.x, 0, a.y, a.x, h, a.y, b.x, 0, b.y, a.x, h, a.y, b.x, h, b.y]
    : [a.x, 0, a.y, b.x, 0, b.y, b.x, h, b.y, a.x, 0, a.y, b.x, h, b.y, a.x, h, a.y]
  const u1 = u0 + len / TILE_M
  const uv = flip ? [u1, 0, u0, 0, u0, 1, u1, 0, u0, 1, u1, 1] : [u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1]
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.computeVertexNormals()
  return g
}

/** A leaf-cluster texture for the tree canopies (alpha-tested cards), plus an opaque white patch in the top-left corner for the bark. */
function leafTexture() {
  const S = 256
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  let seed = 23
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  // bark patch (uv ≈ 0.03, 0.97)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 16, 16)
  // a loose cluster: small leaves, denser toward the middle, gaps between
  for (let i = 0; i < 520; i++) {
    const a = rnd() * Math.PI * 2
    const r = Math.sqrt(rnd()) * 104
    const x = 128 + Math.cos(a) * r
    const y = 128 + Math.sin(a) * r * 0.92
    if (rnd() < (r / 104) * 0.45) continue
    const hue = 78 + rnd() * 34
    const sat = 22 + rnd() * 22
    const lit = 20 + rnd() * 24 + (1 - r / 104) * -4
    g.fillStyle = `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${lit.toFixed(0)}%)`
    g.beginPath()
    g.ellipse(x, y, 3.5 + rnd() * 4.5, 2.2 + rnd() * 2.6, rnd() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/**
 * A street tree at real scale: a thin trunk forking into a few limbs, under a
 * sparse canopy of leaf cards (both faces, normals bent round the canopy so it
 * shades as a volume). Vertex colours: white leaves (the texture carries the
 * greens), grey-brown bark (on the texture's white patch).
 */
function treeGeometry(seed: number, o: { height: number; spread: number; cards: number }) {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const parts: THREE.BufferGeometry[] = []
  const bark = '#5d554b'
  const barkUv = (g: THREE.BufferGeometry) => {
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.03, 0.97)
    return g
  }
  const H = o.height
  const fork = H * 0.42
  parts.push(tint(barkUv(new THREE.CylinderGeometry(0.075, 0.13, fork + 0.4, 6).translate(0, (fork + 0.4) / 2, 0)), bark))
  const up = new THREE.Vector3(0, 1, 0)
  const limbs = 3 + Math.floor(rnd() * 2)
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rnd() * 0.8
    const tilt = 0.35 + rnd() * 0.3
    const len = H * (0.34 + rnd() * 0.12)
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a))
    const g = new THREE.CylinderGeometry(0.022, 0.06, len, 5).translate(0, len / 2, 0)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir))
    parts.push(tint(barkUv(g.translate(0, fork, 0)), bark))
  }
  // the canopy: cards scattered through an ellipsoid, more toward its shell
  const cy = H * 0.66
  const R = new THREE.Vector3(o.spread, H * 0.27, o.spread)
  const centre = new THREE.Vector3(0, cy, 0)
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  for (let i = 0; i < o.cards; i++) {
    const u = rnd() * 2 - 1
    const ph = rnd() * Math.PI * 2
    const rr = 0.45 + 0.55 * Math.sqrt(rnd())
    const sq = Math.sqrt(1 - u * u)
    const p = new THREE.Vector3(sq * Math.cos(ph) * R.x * rr, u * R.y * rr, sq * Math.sin(ph) * R.z * rr).add(centre)
    const size = 1.2 + rnd() * 0.9
    const card = new THREE.PlaneGeometry(size, size * 0.9)
    const uv = card.attributes.uv as THREE.BufferAttribute
    for (let k = 0; k < uv.count; k++) uv.setXY(k, 0.08 + uv.getX(k) * 0.84, 0.08 + uv.getY(k) * 0.84)
    const back = card.clone().rotateY(Math.PI)
    const both = mergeAll([card, back])
    // (a third lie nearly flat, so the canopy also reads from above)
    e.set(rnd() < 0.34 ? Math.PI / 2 + (rnd() - 0.5) * 0.7 : (rnd() - 0.5) * 1.3, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.6)
    both.applyQuaternion(q.setFromEuler(e))
    both.translate(p.x, p.y, p.z)
    // normals bent outward from the canopy centre (+ a little sky): soft, volumetric shading
    const pos = both.attributes.position as THREE.BufferAttribute
    const nor = both.attributes.normal as THREE.BufferAttribute
    const n = new THREE.Vector3()
    for (let k = 0; k < pos.count; k++) {
      n.set((pos.getX(k) - centre.x) / R.x, (pos.getY(k) - centre.y) / R.y, (pos.getZ(k) - centre.z) / R.z).normalize()
      n.y += 0.35
      n.normalize()
      nor.setXYZ(k, n.x, n.y, n.z)
    }
    parts.push(tint(both, '#ffffff'))
  }
  return mergeAll(parts)
}

/**
 * A vehicle body part from its side profile: points (u along the length,
 * v height) extruded across `width` (centred on x) with bevelled edges; the
 * profile's +u ends up toward -z. Vertex-tinted.
 */
function extrudeSide(pts: [number, number][], width: number, color: string, bevel = 0.05) {
  const sh = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)))
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 })
  g.rotateY(Math.PI / 2)
  g.translate(-(width - 2 * bevel) / 2, 0, 0)
  return tint(g, color)
}

/**
 * A site truck, front toward +z: chassis rails, a profiled cab (raked
 * windscreen, side glass, grille, bumper, lamps, mirrors), fuel tank, front
 * wheels under fenders and a rear tandem; a flatbed with a headboard, or a
 * mixer drum with its water tank and chute.
 */
function truckGeometry(mixer: boolean, paint: string) {
  const L = mixer ? 8.5 : 13
  const zf = L / 2
  const parts: THREE.BufferGeometry[] = []
  const dark = '#23272d'
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: string) => parts.push(tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c))
  // chassis
  box(1.1, 0.34, L - 0.3, 0, 0.85, -0.1, dark)
  // cab: side profile, flipped so its front faces +z
  const cab = mergeAll([
    extrudeSide([[0, 1.0], [2.35, 1.0], [2.38, 1.85], [2.1, 2.85], [0.05, 2.95], [0, 2.9]], 2.45, paint),
    extrudeSide([[1.0, 1.95], [2.36, 1.95], [2.12, 2.74], [1.0, 2.76]], 2.5, '#1b2229', 0.02),
  ])
  cab.rotateY(Math.PI)
  cab.translate(0, 0, zf - 2.38)
  parts.push(cab)
  box(2.5, 0.32, 0.22, 0, 0.82, zf + 0.04, '#3a4046')
  box(1.5, 0.75, 0.04, 0, 1.45, zf + 0.02, '#15181b')
  for (const x of [-0.95, 0.95]) {
    box(0.34, 0.16, 0.05, x, 1.12, zf + 0.03, '#e8e6df')
    box(0.08, 0.34, 0.2, x * 1.42, 2.25, zf - 0.35, '#15181b')
    box(0.55, 0.08, 1.3, x * 1.1, 1.12, zf - 1.3, '#15181b')
  }
  parts.push(tint(new THREE.CylinderGeometry(0.3, 0.3, 1.1, 10).rotateX(Math.PI / 2).translate(1.0, 0.8, zf - 3.1), '#8b949c'))
  // wheels: steer axle under the cab, a rear tandem (wide: reads as duals)
  const rear = mixer ? [-2.8, -1.4] : [-zf + 1.6, -zf + 2.95]
  for (const zz of [zf - 1.3, ...rear])
    for (const xx of [-1.0, 1.0])
      parts.push(tint(new THREE.CylinderGeometry(0.52, 0.52, zz > 0 ? 0.32 : 0.5, 14).rotateZ(Math.PI / 2).translate(xx, 0.52, zz), '#15181b'))
  if (mixer) {
    const drum = new THREE.CylinderGeometry(0.9, 1.25, 4.8, 18)
    drum.rotateX(Math.PI / 2 - 0.22)
    parts.push(tint(drum.translate(0, 2.55, -1.2), '#e2dfd6'))
    parts.push(tint(new THREE.CylinderGeometry(1.26, 1.26, 0.25, 18).rotateX(Math.PI / 2 - 0.22).translate(0, 2.4, -0.4), T.safety))
    parts.push(tint(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12).rotateZ(Math.PI / 2).translate(0, 2.1, zf - 2.9), '#c9ccce'))
    box(0.5, 0.08, 1.4, 0, 1.6, -zf - 0.3, '#8b949c')
  } else {
    // deck (top at 1.25 m), stake rails, the headboard behind the cab
    const deckLen = L - 2.8
    box(2.5, 0.16, deckLen, 0, 1.17, -zf + deckLen / 2, '#5b4a3a')
    for (const x of [-1.24, 1.24]) box(0.06, 0.2, deckLen, x, 1.2, -zf + deckLen / 2, dark)
    box(2.44, 1.3, 0.08, 0, 1.9, zf - 2.62, '#6f787f')
    for (const x of [-0.9, -0.3, 0.3, 0.9]) box(0.08, 1.3, 0.1, x, 1.9, zf - 2.58, dark)
  }
  return mergeAll(parts)
}

/**
 * A parked car with a real side profile (bevelled, extruded): painted body
 * (white: the instance colour paints it), a dark glasshouse set in from the
 * body sides, painted roof, wheels, lamps. `suv` = taller, boxier.
 */
function carGeometry(suv: boolean) {
  const ext = extrudeSide
  const parts: THREE.BufferGeometry[] = []
  const paint = '#ffffff'
  const glass = '#1b2229'
  if (!suv) {
    parts.push(ext([[-2.15, 0.36], [2.08, 0.36], [2.17, 0.5], [2.15, 0.7], [1.9, 0.8], [0.98, 0.9], [-1.4, 0.94], [-2.06, 0.91], [-2.17, 0.78], [-2.19, 0.5]], 1.76, paint))
    parts.push(ext([[-1.36, 0.9], [0.98, 0.86], [0.28, 1.34], [-0.9, 1.36], [-1.32, 1.02]], 1.5, glass, 0.03))
    parts.push(ext([[0.34, 1.3], [-0.92, 1.32], [-0.9, 1.4], [0.3, 1.39]], 1.46, paint, 0.03))
  } else {
    parts.push(ext([[-2.25, 0.42], [2.15, 0.42], [2.27, 0.6], [2.25, 0.9], [2.05, 1.02], [1.12, 1.1], [-2.15, 1.12], [-2.27, 1.0], [-2.29, 0.6]], 1.84, paint))
    parts.push(ext([[-2.16, 1.08], [1.12, 1.06], [0.46, 1.64], [-2.0, 1.66], [-2.2, 1.28]], 1.6, glass, 0.03))
    parts.push(ext([[0.52, 1.58], [-2.02, 1.6], [-2.0, 1.72], [0.46, 1.71]], 1.58, paint, 0.03))
  }
  const wr = suv ? 0.37 : 0.32
  const wz = suv ? 1.42 : 1.33
  const wx = suv ? 0.8 : 0.76
  for (const z of [-wz, wz])
    for (const x of [-wx, wx]) parts.push(tint(new THREE.CylinderGeometry(wr, wr, 0.24, 12).rotateZ(Math.PI / 2).translate(x, wr, z), '#0e1114'))
  const front = suv ? 2.3 : 2.2
  for (const x of [-0.62, 0.62]) {
    parts.push(tint(new THREE.BoxGeometry(0.34, 0.1, 0.04).translate(x, suv ? 0.88 : 0.66, -front), '#e8e6df'))
    parts.push(tint(new THREE.BoxGeometry(0.3, 0.1, 0.04).translate(x, suv ? 0.92 : 0.8, front), '#6a1612'))
  }
  return mergeAll(parts)
}

export class Site {
  root = new THREE.Group()
  /** everything inside the hoarding (+ the hoarding): hidden when a chapter brings its own (world.params.site = 0) */
  onSite = new THREE.Group()
  /** streets outside: trees, parked cars, street lights */
  street = new THREE.Group()
  private lampMat: THREE.MeshBasicMaterial

  constructor(mobile: boolean) {
    this.root.name = 'site'
    this.root.add(this.onSite, this.street)
    const shadow = !mobile
    const V = (x: number, z: number) => new THREE.Vector2(x, z)

    // ---- hoarding -------------------------------------------------------------
    // runs counter-clockwise seen from above; outer faces printed, inner plywood
    const runs: [THREE.Vector2, THREE.Vector2][] = [
      [V(-F, F), V(GATE[0], F)],
      [V(GATE[1], F), V(F, F)],
      [V(F, F), V(F, -F)],
      [V(F, -F), V(-F, -F)],
      [V(-F, -F), V(-F, F)],
    ]
    const outer: THREE.BufferGeometry[] = []
    const inner: THREE.BufferGeometry[] = []
    let u = 0
    for (const [a, b] of runs) {
      // outward normal must point away from the site: winding chosen so it does
      outer.push(wallQuad(a, b, HOARD_H, false, u))
      inner.push(wallQuad(a, b, HOARD_H, true, 0))
      u += a.distanceTo(b) / TILE_M
    }
    // gate posts + the two gate leaves (chain-link, drawn as a frame), open inward
    const gateParts: THREE.BufferGeometry[] = []
    for (const x of GATE) gateParts.push(new THREE.BoxGeometry(0.3, 3.2, 0.3).translate(x, 1.6, F))
    for (const [x, dir] of [
      [GATE[0], 1],
      [GATE[1], -1],
    ] as const) {
      const leaf = new THREE.BoxGeometry(5.6, 0.1, 0.08).translate(2.8, 0, 0)
      const leafTop = leaf.clone().translate(0, 2.2, 0)
      const g = mergeAll([leaf.translate(0, 0.2, 0), leafTop, new THREE.BoxGeometry(0.08, 2.1, 0.08).translate(5.55, 1.25, 0)])
      g.rotateY(dir > 0 ? 1.2 : Math.PI - 1.2)
      g.translate(x, 0, F - 0.1)
      gateParts.push(g)
    }
    const hoardMat = new THREE.MeshStandardMaterial({ map: hoardingTexture(), roughness: 0.7, metalness: 0 })
    const hoard = new THREE.Mesh(mergeAll(outer), hoardMat)
    const ply = new THREE.Mesh(mergeAll(inner), new THREE.MeshStandardMaterial({ color: '#7d705d', roughness: 0.9 }))
    hoard.receiveShadow = ply.receiveShadow = shadow
    hoard.castShadow = shadow
    this.onSite.add(hoard, ply, new THREE.Mesh(mergeAll(gateParts), MAT.steel()))

    // ---- foundation apron + batter boards, string lines, survey stakes -------
    const apron = new THREE.Mesh(new THREE.BoxGeometry(TOWER_W + 6, 0.12, TOWER_W + 6).translate(0, 0.06, 0), MAT.concrete())
    apron.receiveShadow = shadow
    this.onSite.add(apron)
    const timber: THREE.BufferGeometry[] = []
    const lines: number[] = []
    const E = TOWER_W / 2
    const O = E + 5
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        // L-shaped batter boards off each corner
        const cx = sx * O
        const cz = sz * O
        for (const [px, pz] of [
          [cx, cz],
          [cx - sx * 3, cz],
          [cx, cz - sz * 3],
        ])
          timber.push(new THREE.BoxGeometry(0.1, 1.2, 0.1).translate(px, 0.6, pz))
        timber.push(new THREE.BoxGeometry(3.1, 0.18, 0.05).translate(cx - sx * 1.5, 1.0, cz))
        timber.push(new THREE.BoxGeometry(0.05, 0.18, 3.1).translate(cx, 1.0, cz - sz * 1.5))
        // strings along the building lines (x = ±E and z = ±E), tied off at the boards
        lines.push(sx * E, 1.05, cz, sx * E, 1.05, -cz)
        lines.push(cx, 1.05, sz * E, -cx, 1.05, sz * E)
      }
    const flags: THREE.BufferGeometry[] = []
    let seed = 5
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2
      const r = 30 + rnd() * 22
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      timber.push(new THREE.BoxGeometry(0.05, 0.9, 0.05).translate(x, 0.45, z))
      flags.push(new THREE.BoxGeometry(0.02, 0.12, 0.22).translate(x, 0.82, z + 0.12))
    }
    const stakes = new THREE.Mesh(mergeAll(timber), new THREE.MeshStandardMaterial({ color: '#b39263', roughness: 0.85 }))
    stakes.castShadow = shadow
    this.onSite.add(stakes)
    this.onSite.add(new THREE.Mesh(mergeAll(flags), new THREE.MeshStandardMaterial({ color: '#ff3d8b', roughness: 0.6 })))
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
    this.onSite.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: '#f4f1ea', transparent: true, opacity: 0.8 })))

    // ---- site office, containers, vehicles (vertex-coloured, one material) ---
    const props: THREE.BufferGeometry[] = []
    const cabin = (x: number, y: number, z: number, rotY: number) => {
      const parts = [
        tint(new THREE.BoxGeometry(3.0, 2.9, 9.7).translate(0, 1.45, 0), '#dcd9d0'),
        tint(new THREE.BoxGeometry(3.06, 0.9, 7.6).translate(0, 1.75, 0), '#28323b'),
        tint(new THREE.BoxGeometry(3.1, 0.14, 9.8).translate(0, 2.93, 0), '#3a4148'),
        tint(new THREE.BoxGeometry(3.1, 0.12, 9.8).translate(0, 0.06, 0), '#3a4148'),
      ]
      const g = mergeAll(parts)
      g.rotateY(rotY)
      g.translate(x, y, z)
      props.push(g)
    }
    cabin(-48, 0, 34, 0)
    cabin(-44.6, 0, 34, 0)
    cabin(-46.3, 2.95, 34, 0)
    // stair to the top cabin
    const stair = new THREE.BoxGeometry(1.1, 0.12, 5.2)
    stair.rotateX(-0.6)
    props.push(tint(stair.translate(-42.3, 1.5, 41.3), '#3a4148'))
    props.push(tint(new THREE.BoxGeometry(1.1, 0.1, 1.4).translate(-42.3, 2.95, 38.4), '#3a4148'))
    // storage containers
    const box = (x: number, z: number, rot: number, color: string, y = 0) => {
      const g = mergeAll([tint(new THREE.BoxGeometry(2.44, 2.6, 6.06).translate(0, 1.3, 0), color), tint(new THREE.BoxGeometry(2.5, 0.08, 6.1).translate(0, 2.62, 0), '#2a2f35')])
      g.rotateY(rot)
      g.translate(x, y, z)
      props.push(g)
    }
    box(-50, -26, 0, '#b4502a')
    box(-47, -26, 0, '#2f5f8f')
    box(-48.5, -18, Math.PI / 2, '#56707a')
    // a mixer truck inside the gate, a flatbed delivering steel on the haul road
    const truck = (x: number, z: number, rot: number, mixer: boolean) => {
      const g = truckGeometry(mixer, mixer ? '#f4f1ea' : '#b4502a')
      g.rotateY(rot)
      g.translate(x, 0, z)
      props.push(g)
    }
    truck(22, 44, 0, true)
    truck(-8, 22, Math.PI / 2, false)
    // rebar bundles on dunnage (rusted bar, three layers) by the cabins and the yard
    const rebar = (x: number, z: number, rot: number, len: number) => {
      const bars: THREE.BufferGeometry[] = []
      for (let l = 0; l < 3; l++)
        for (let k = 0; k < 11 - l; k++) bars.push(new THREE.CylinderGeometry(0.018, 0.018, len, 4).rotateZ(Math.PI / 2).translate(0, 0.24 + l * 0.034, (k - 5 + l * 0.5) * 0.037))
      const g = mergeAll([
        tint(mergeAll(bars), '#6a3b26'),
        ...[-len * 0.35, len * 0.35].map(dx => tint(new THREE.BoxGeometry(0.16, 0.16, 0.8).translate(dx, 0.08, 0), '#8a7456')),
        ...[-len * 0.2, len * 0.2].map(dx => tint(new THREE.BoxGeometry(0.03, 0.17, 0.46).translate(dx, 0.28, 0), '#caa23a')),
      ])
      g.rotateY(rot)
      g.translate(x, 0, z)
      props.push(g)
    }
    rebar(33, 30, 0.15, 12)
    rebar(33.4, 31.6, 0.12, 12)
    rebar(-27, 47, -0.05, 9)
    rebar(46, -46, 1.45, 12)
    // spoil heap (excavated earth) and a gravel pile: lumpy cones
    const heap = (x: number, z: number, r: number, h: number, color: string, seed: number) => {
      const g = new THREE.ConeGeometry(r, h, 16, 4)
      const pos = g.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i)
        const pz = pos.getZ(i)
        const py = pos.getY(i)
        const n = Math.sin(px * 1.3 + seed) * Math.cos(pz * 1.1 - seed) * 0.5 + Math.sin(px * 3.1 + pz * 2.3 + seed * 2) * 0.25
        const rim = 1 - Math.abs(py / h - 0.5) * 2
        pos.setXYZ(i, px * (1 + n * 0.12), py + n * h * 0.12 * rim, pz * (1 + n * 0.12))
      }
      g.computeVertexNormals()
      g.translate(x, h / 2 - 0.1, z)
      props.push(tint(g, color))
    }
    heap(-44, -46, 7.5, 3.4, '#6a5646', 1.7)
    heap(-36, -50, 4.5, 2.1, '#6f5b4a', 4.2)
    heap(47, 6, 3.4, 1.7, '#8a8781', 2.9)
    // welfare units by the cabins
    for (const [x, z] of [
      [-40.2, 27.2],
      [-38.8, 27.2],
    ] as const)
      props.push(mergeAll([tint(new THREE.BoxGeometry(1.15, 2.3, 1.15).translate(x, 1.15, z), '#2f5f8f'), tint(new THREE.BoxGeometry(1.2, 0.08, 1.2).translate(x, 2.34, z), '#dcd9d0')]))
    const propsMesh = new THREE.Mesh(mergeAll(props), MAT.person())
    propsMesh.castShadow = propsMesh.receiveShadow = shadow
    this.onSite.add(propsMesh)

    // ---- steel laydown yard: beam bundles on dunnage, deck packs --------------
    const steel: THREE.BufferGeometry[] = []
    const bundle = (x: number, z: number, len: number, rows: number, layers: number, rot: number, y = 0) => {
      const parts: THREE.BufferGeometry[] = []
      for (let l = 0; l < layers; l++)
        for (let k = 0; k < rows - (l % 2); k++) parts.push(iBeamGeometry(len, { depth: 0.46, width: 0.22 }).translate(-len / 2, 0.45 + l * 0.47, k * 0.27 + (l % 2) * 0.13))
      const g = mergeAll(parts)
      g.rotateY(rot)
      g.translate(x, y, z - (rows * 0.27) / 2)
      steel.push(g)
    }
    bundle(40, -30, 12, 5, 3, 0)
    bundle(40, -24, 12, 4, 2, 0)
    bundle(42, -40, 9, 5, 2, 0.08)
    bundle(-8.6, 22, 9.4, 5, 2, 0, 1.0)
    const yard = new THREE.Mesh(mergeAll(steel), MAT.primer())
    yard.castShadow = shadow
    this.onSite.add(yard)
    const packs: THREE.BufferGeometry[] = []
    for (let i = 0; i < 3; i++) packs.push(new THREE.BoxGeometry(6.2, 0.55, 1.0).translate(42, 0.4 + i * 0.6, -16 + (i % 2) * 0.1))
    for (let i = 0; i < 2; i++) packs.push(new THREE.BoxGeometry(6.2, 0.55, 1.0).translate(42, 0.4 + i * 0.6, -14.6))
    const deckPacks = new THREE.Mesh(mergeAll(packs), new THREE.MeshStandardMaterial({ color: '#9aa3aa', metalness: 0.7, roughness: 0.4 }))
    deckPacks.castShadow = shadow
    this.onSite.add(deckPacks)

    // ---- ground crew: one merged, varied mesh (skin, vests, hats, poses) ------
    const crew: [number, number, number, 'stand' | 'walk' | 'work' | 'reach'][] = [
      [19, 18, 0.4, 'work'],
      [23.5, 17.2, -2.2, 'stand'],
      [-19, 21, 1.2, 'walk'],
      [36, -26, 2.8, 'work'],
      [21, 40, -0.4, 'reach'],
      [-42.3, 37.8, 3.1, 'walk'],
      [8, 19.5, 0.2, 'stand'],
    ]
    const people = new THREE.Mesh(
      mergeAll(crew.slice(0, mobile ? 4 : crew.length).map(([x, z, r, pose], i) => personGeometry({ pose, seed: 101 + i * 3 }).rotateY(r).translate(x, 0.12, z))),
      MAT.person(),
    )
    people.castShadow = shadow
    this.onSite.add(people)

    // ---- outside: street trees, the square, parked cars, street lights ---------
    const trees: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const put = (x: number, z: number, s: number) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28)
      trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.9 + rnd() * 0.3), s)))
    }
    // sidewalk ring (x or z = ±66), skipping the gate
    for (let t = -54; t <= 54; t += 12) {
      put(t, 65.5, 0.85 + rnd() * 0.3)
      put(t, -65.5, 0.85 + rnd() * 0.3)
      put(65.5, t, 0.85 + rnd() * 0.3)
      put(-65.5, t, 0.85 + rnd() * 0.3)
    }
    // the square
    const nSquare = mobile ? 26 : 48
    for (let i = 0, tries = 0; i < nSquare && tries < 600; tries++) {
      const x = -40 + rnd() * 200
      const z = -40 + rnd() * 200
      const d = Math.hypot(x, z)
      if (!inPlaza(x, z) || d < 82) continue
      const toStreet = (v: number) => {
        const m = (((v - 24) % 48) + 48) % 48
        return Math.min(m, 48 - m)
      }
      if (Math.min(toStreet(x), toStreet(z)) < 8) continue // keep off streets + kerbs
      put(x, z, 0.85 + rnd() * 0.4)
      i++
    }
    // street trees (London planes: pale trunks, sparse canopies) + the square's
    // (broader); instance colour varies each tree a little
    const leaves = leafTexture()
    const treeMat = new THREE.MeshStandardMaterial({ map: leaves, vertexColors: true, alphaTest: 0.5, roughness: 0.92, metalness: 0 })
    const treeDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leaves, alphaTest: 0.5 })
    const nStreet = 40
    const variants = [
      { geo: treeGeometry(41, { height: 8.2, spread: 2.2, cards: mobile ? 18 : 28 }), from: 0, to: nStreet },
      { geo: treeGeometry(77, { height: 9.4, spread: 3.0, cards: mobile ? 22 : 36 }), from: nStreet, to: trees.length },
    ]
    const tc = new THREE.Color()
    const treeMeshes: THREE.InstancedMesh[] = []
    for (const v of variants) {
      const n = v.to - v.from
      if (n <= 0) continue
      const mesh = new THREE.InstancedMesh(v.geo, treeMat, n)
      for (let i = 0; i < n; i++) {
        mesh.setMatrixAt(i, trees[v.from + i])
        // near-neutral: a little warmer / cooler, lighter / darker per tree
        const w = rnd()
        mesh.setColorAt(i, tc.setRGB(0.95 + 0.2 * w, 1.0 + 0.08 * rnd(), 0.82 + 0.2 * (1 - w)).multiplyScalar(0.95 + rnd() * 0.3))
      }
      mesh.castShadow = shadow
      mesh.customDepthMaterial = treeDepth
      this.street.add(mesh)
      treeMeshes.push(mesh)
    }

    // parked cars along the kerbs of the ring streets (72 ± 3.6)
    // cars: sedans and SUVs with real profiles; painted by instance colour
    const carM: THREE.Matrix4[][] = [[], []]
    const carC: THREE.Color[][] = [[], []]
    const paints = ['#c9c9c6', '#1c1f24', '#6f787f', '#34404f', '#6a2620', '#a8a296', '#26302a', '#1f2a3a', '#e4e3df', '#3d4247']
    for (let t = -84; t <= 84; t += 6.2) {
      for (const [x, z, rot] of [
        [t, 75.8, Math.PI / 2],
        [t, -68.2, Math.PI / 2],
        [75.8, t, 0],
        [-68.2, t, 0],
      ] as const) {
        if (rnd() < 0.45) continue
        if (Math.abs(t) > 64 && Math.abs(t) < 80) continue // intersections
        const kind = rnd() < 0.38 ? 1 : 0
        carM[kind].push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + (rnd() < 0.5 ? 0 : Math.PI)), new THREE.Vector3(1, 1, 1)))
        carC[kind].push(new THREE.Color(paints[Math.floor(rnd() * paints.length)]))
      }
    }
    const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.38 })
    const carMeshes: THREE.InstancedMesh[] = []
    for (const kind of [0, 1]) {
      const cars = new THREE.InstancedMesh(carGeometry(kind === 1), carMat, carM[kind].length)
      carM[kind].forEach((m, i) => {
        cars.setMatrixAt(i, m)
        cars.setColorAt(i, carC[kind][i])
      })
      this.street.add(cars)
      carMeshes.push(cars)
    }

    // street-light poles + heads round the site
    const poleM: THREE.Matrix4[] = []
    for (let t = -54; t <= 54; t += 18)
      for (const [x, z, r] of [
        [t, 67.2, Math.PI],
        [t, -67.2, 0],
        [67.2, t, -Math.PI / 2],
        [-67.2, t, Math.PI / 2],
      ] as const)
        poleM.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r), new THREE.Vector3(1, 1, 1)))
    const pole = mergeAll([new THREE.CylinderGeometry(0.09, 0.12, 7.5, 6).translate(0, 3.75, 0), new THREE.BoxGeometry(0.08, 0.08, 1.8).translate(0, 7.4, 0.85)])
    const poles = new THREE.InstancedMesh(pole, MAT.steel({ instanced: true }), poleM.length)
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(T.sodium), toneMapped: false })
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.14, 0.9).translate(0, 7.3, 1.6), this.lampMat, poleM.length)
    poleM.forEach((m, i) => {
      poles.setMatrixAt(i, m)
      heads.setMatrixAt(i, m)
    })
    this.street.add(poles, heads)
    for (const m of [...treeMeshes, ...carMeshes, poles, heads]) m.computeBoundingSphere()
  }

  /** lights 0 day … 1 night */
  update(lights: number) {
    this.lampMat.color.copy(TC.sodium).multiplyScalar(0.15 + 2.8 * THREE.MathUtils.smoothstep(lights, 0.15, 0.6))
  }
}
