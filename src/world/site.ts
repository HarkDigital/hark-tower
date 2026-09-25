import * as THREE from 'three'
import { MAT, T, TOWER_W, iBeamGeometry, mergeAll, personGeometry, tint } from '../kit/steel'
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
 *  - outside: street trees, the square's trees, parked cars, street-light
 *    heads that glow at night (lights 0..1)
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
      const parts = [
        tint(new THREE.BoxGeometry(2.5, 0.5, mixer ? 8.5 : 13).translate(0, 1.0, 0), '#23272d'),
        tint(new THREE.BoxGeometry(2.5, 2.3, 2.2).translate(0, 2.2, (mixer ? 8.5 : 13) / 2 - 1.2), mixer ? '#f4f1ea' : '#b4502a'),
        tint(new THREE.BoxGeometry(2.52, 0.9, 0.6).translate(0, 2.6, (mixer ? 8.5 : 13) / 2 - 0.2), '#28323b'),
      ]
      for (const zz of mixer ? [-2.8, -1.4, 2.6] : [-5.2, -4, -2.8, 4.8])
        for (const xx of [-1.1, 1.1]) parts.push(tint(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12).rotateZ(Math.PI / 2).translate(xx, 0.5, zz), '#15181b'))
      if (mixer) {
        const drum = new THREE.CylinderGeometry(0.9, 1.25, 4.8, 16)
        drum.rotateX(Math.PI / 2 - 0.22)
        parts.push(tint(drum.translate(0, 2.55, -1.2), '#e2dfd6'))
        parts.push(tint(new THREE.CylinderGeometry(1.26, 1.26, 0.25, 16).rotateX(Math.PI / 2 - 0.22).translate(0, 2.4, -0.4), T.safety))
      }
      const g = mergeAll(parts)
      g.rotateY(rot)
      g.translate(x, 0, z)
      props.push(g)
    }
    truck(22, 44, 0, true)
    truck(-8, 22, Math.PI / 2, false)
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

    // ---- ground crew ------------------------------------------------------------
    const crew: [number, number, number][] = [
      [19, 18, 0.4],
      [23.5, 17.2, -2.2],
      [-19, 21, 1.2],
      [36, -26, 2.8],
      [21, 40, -0.4],
      [-42.3, 37.8, 3.1],
      [8, 19.5, 0.2],
    ]
    const people = new THREE.InstancedMesh(personGeometry(), MAT.person(), mobile ? 4 : crew.length)
    for (let i = 0; i < people.count; i++) {
      const [x, z, r] = crew[i]
      people.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, 0.12, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r), new THREE.Vector3(1, 1, 1)))
    }
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
      put(t, 65.5, 0.9 + rnd() * 0.3)
      put(t, -65.5, 0.9 + rnd() * 0.3)
      put(65.5, t, 0.9 + rnd() * 0.3)
      put(-65.5, t, 0.9 + rnd() * 0.3)
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
      put(x, z, 1 + rnd() * 0.5)
      i++
    }
    // street trees: a trunk and a loose canopy of low-poly clumps (London planes, muted)
    const trunk = tint(new THREE.CylinderGeometry(0.13, 0.2, 3.4, 5).translate(0, 1.7, 0), '#4a3f33')
    const clumps: THREE.BufferGeometry[] = [trunk]
    for (const [x, y, z, r, c] of [
      [0, 4.9, 0, 1.9, '#465532'],
      [1.2, 5.6, 0.5, 1.4, '#51603a'],
      [-1.1, 5.4, -0.4, 1.5, '#3f4c2d'],
      [0.2, 6.4, -0.9, 1.2, '#56663e'],
      [-0.4, 5.9, 1.1, 1.1, '#4a5934'],
    ] as const)
      clumps.push(tint(new THREE.IcosahedronGeometry(r, 0).scale(1, 0.8, 1).translate(x, y, z), c))
    const treeGeo = mergeAll(clumps)
    const treeMesh = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true }), trees.length)
    const tc = new THREE.Color()
    trees.forEach((m, i) => {
      treeMesh.setMatrixAt(i, m)
      treeMesh.setColorAt(i, tc.setHSL(0.16 + rnd() * 0.06, 0.2 + rnd() * 0.15, 0.55 + rnd() * 0.12).multiplyScalar(1.5))
    })
    treeMesh.castShadow = shadow
    this.street.add(treeMesh)

    // parked cars along the kerbs of the ring streets (72 ± 3.6)
    // cars: painted body (instance colour), dark glasshouse, wheels in the arches
    const car = mergeAll([
      tint(new THREE.BoxGeometry(1.78, 0.62, 4.4).translate(0, 0.62, 0), '#ffffff'),
      tint(new THREE.BoxGeometry(1.7, 0.1, 4.3).translate(0, 0.98, 0), '#ffffff'),
      tint(new THREE.BoxGeometry(1.5, 0.52, 2.3).translate(0, 1.28, -0.25), '#161b21'),
      tint(new THREE.BoxGeometry(1.4, 0.06, 2.0).translate(0, 1.56, -0.25), '#ffffff'),
      ...[-1.35, 1.35].flatMap(z => [-0.8, 0.8].map(x => tint(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 10).rotateZ(Math.PI / 2).translate(x, 0.32, z), '#0e1114'))),
    ])
    const carM: THREE.Matrix4[] = []
    const carC: THREE.Color[] = []
    const paints = ['#c9c9c6', '#1c1f24', '#6f787f', '#34404f', '#6a2620', '#a8a296', '#26302a', '#1f2a3a']
    for (let t = -84; t <= 84; t += 6.2) {
      for (const [x, z, rot] of [
        [t, 75.8, Math.PI / 2],
        [t, -68.2, Math.PI / 2],
        [75.8, t, 0],
        [-68.2, t, 0],
      ] as const) {
        if (rnd() < 0.45) continue
        if (Math.abs(t) > 64 && Math.abs(t) < 80) continue // intersections
        carM.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + (rnd() < 0.5 ? 0 : Math.PI)), new THREE.Vector3(1, 1, 1)))
        carC.push(new THREE.Color(paints[Math.floor(rnd() * paints.length)]))
      }
    }
    const cars = new THREE.InstancedMesh(car, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.35, roughness: 0.45 }), carM.length)
    carM.forEach((m, i) => {
      cars.setMatrixAt(i, m)
      cars.setColorAt(i, carC[i])
    })
    this.street.add(cars)

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
    const poles = new THREE.InstancedMesh(pole, MAT.steel(), poleM.length)
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(T.sodium), toneMapped: false })
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.14, 0.9).translate(0, 7.3, 1.6), this.lampMat, poleM.length)
    poleM.forEach((m, i) => {
      poles.setMatrixAt(i, m)
      heads.setMatrixAt(i, m)
    })
    this.street.add(poles, heads)
    for (const m of [treeMesh, cars, poles, heads, people]) m.computeBoundingSphere()
  }

  /** lights 0 day … 1 night */
  update(lights: number) {
    this.lampMat.color.set(T.sodium).multiplyScalar(0.15 + 2.8 * THREE.MathUtils.smoothstep(lights, 0.15, 0.6))
  }
}
