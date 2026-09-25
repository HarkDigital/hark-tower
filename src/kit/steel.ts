import * as THREE from 'three'

/*
 * Hark Tower kit — steel, glass and site materials + shared builders, so every
 * chapter speaks the same construction language as the tower in the world.
 *
 *   T                         palette by name (hex strings)
 *   TC                        the same palette pre-parsed as THREE.Color (linear);
 *                             treat as constants: out.copy(TC.signal).multiplyScalar(k)
 *                             instead of color.set(T.signal) every frame
 *   MAT                       cached materials: steel (galvanised graphite),
 *                             primer (red-oxide beams), concrete, curtain
 *                             glass (mirror-tinted, reflects the sky), mullion,
 *                             craneYellow, safety (orange), rubber, signal
 *                             (emissive Hark green). Every one takes
 *                             { instanced: true } for use on an InstancedMesh:
 *                             a separately cached twin, so one material is never
 *                             drawn by both plain and instanced meshes (three
 *                             re-resolves the program on every flip)
 *   instancedDepth()          one shared depth material for castShadow
 *                             InstancedMeshes (mesh.customDepthMaterial)
 *   iBeamGeometry(len, o)     an I-beam (wide-flange) along +x, centred
 *   hssGeometry(len, size)    a square hollow section (columns, braces)
 *   latticeGeometry(o)        a crane-style lattice box truss (merged)
 *   blueprint(geometry, o)    cyan architectural linework for any geometry
 *                             (EdgesGeometry), with a 0..1 `draw` reveal
 *   Sparks                    welding/grinding sparks (Points, additive):
 *                             sparks.emit(worldPos, count); sparks.update(dt)
 *   dimension(a, b, label)    a blueprint dimension line with end ticks + label
 *   etchLabel(text, o)        stencil / painted text on a plane (canvas)
 *   mergeAll(geos)            merge (position/normal; + color/uv when all have them)
 *   tint(geo, color)          give a geometry a flat vertex colour (for mergeAll)
 *   personGeometry(o)         a worker at real scale (tapered limbs, work
 *                             clothes, hi-vis vest with reflective tape, hard
 *                             hat), vertex-coloured; varied skin tones, vests,
 *                             hats, builds and poses from `seed` (successive
 *                             calls vary on their own); pair with MAT.person()
 *   HIVIS, SKIN, HATS         the palettes it draws from
 *
 * Units are metres. One floor is FLOOR_H = 4 m; the tower is 30 x 30 m.
 */

export const T = {
  ink: '#0e1114',
  graphite: '#1c2127',
  steel: '#4a525b',
  steelLight: '#8b949c',
  primer: '#9c3b22',
  concrete: '#b8b3a9',
  concreteDark: '#7e7a72',
  glass: '#7ea3b6',
  craneYellow: '#f2b705',
  safety: '#ff6a1a',
  signal: '#00ff85',
  blueprint: '#0d3566',
  line: '#8fd6ff',
  paper: '#f1ede4',
  sodium: '#ffb458',
} as const

export const FLOOR_H = 4
export const FLOORS = 60
export const TOWER_W = 30

/** Pre-parsed palette (linear THREE.Color). Constants: copy them, never mutate. */
export const TC = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, new THREE.Color(v)])) as { readonly [K in keyof typeof T]: THREE.Color }

/** How a cached material is drawn: `instanced` returns its InstancedMesh twin. */
export interface MatUse {
  instanced?: boolean
}

const cache = new Map<string, THREE.Material>()
function once<M extends THREE.Material>(key: string, make: () => M, use?: MatUse): M {
  const k = use?.instanced ? `${key}|instanced` : key
  let m = cache.get(k) as M | undefined
  if (!m) {
    m = make()
    m.name = k
    cache.set(k, m)
  }
  return m
}

export const MAT = {
  steel: (use?: MatUse) => once('steel', () => new THREE.MeshStandardMaterial({ color: T.steel, metalness: 0.75, roughness: 0.42 }), use),
  primer: (use?: MatUse) => once('primer', () => new THREE.MeshStandardMaterial({ color: T.primer, metalness: 0.35, roughness: 0.62 }), use),
  concrete: (use?: MatUse) => once('concrete', () => new THREE.MeshStandardMaterial({ color: T.concrete, metalness: 0, roughness: 0.92 }), use),
  concreteDark: (use?: MatUse) => once('concreteDark', () => new THREE.MeshStandardMaterial({ color: T.concreteDark, metalness: 0, roughness: 0.95 }), use),
  /** the curtain wall: tinted, near-mirror; it shows the sky (scene.environment) */
  glass: (use?: MatUse) =>
    once('glass', () => new THREE.MeshStandardMaterial({ color: T.glass, metalness: 0.92, roughness: 0.07, envMapIntensity: 1.2 }), use),
  mullion: (use?: MatUse) => once('mullion', () => new THREE.MeshStandardMaterial({ color: '#2a3036', metalness: 0.8, roughness: 0.35 }), use),
  craneYellow: (use?: MatUse) => once('craneYellow', () => new THREE.MeshStandardMaterial({ color: T.craneYellow, metalness: 0.3, roughness: 0.5 }), use),
  safety: (use?: MatUse) => once('safety', () => new THREE.MeshStandardMaterial({ color: T.safety, metalness: 0.1, roughness: 0.6 }), use),
  rubber: (use?: MatUse) => once('rubber', () => new THREE.MeshStandardMaterial({ color: '#15181b', metalness: 0, roughness: 0.85 }), use),
  /** vertex-coloured matte (personGeometry, site props built with tint()) */
  person: (use?: MatUse) => once('person', () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.8 }), use),
  /** emissive Hark green (crown, status lights); blooms */
  signal: (strength = 3, use?: MatUse) =>
    once(`signal:${strength}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(T.signal).multiplyScalar(strength), toneMapped: false }), use),
  /** warm interior light (fitted floors at dusk) */
  interior: (strength = 1.6, use?: MatUse) =>
    once(`interior:${strength}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(strength), toneMapped: false }), use),
}

let depthShared: THREE.MeshDepthMaterial | null = null
/**
 * One depth material for every castShadow InstancedMesh (set it as
 * mesh.customDepthMaterial). Without it the shadow pass shares its single
 * default depth material between plain and instanced casters and rebuilds the
 * program parameters on every flip. Only for InstancedMeshes, and only ones
 * whose material needs no vertex patch or alpha test.
 */
export function instancedDepth(): THREE.MeshDepthMaterial {
  if (!depthShared) {
    depthShared = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
    depthShared.name = 'depth|instanced'
  }
  return depthShared
}

/** Wide-flange I-beam along +x from 0..len (centred on y/z). depth = web height. */
export function iBeamGeometry(len: number, o: { depth?: number; width?: number; flange?: number; web?: number } = {}): THREE.BufferGeometry {
  const d = o.depth ?? 0.45
  const w = o.width ?? 0.22
  const tf = o.flange ?? 0.035
  const tw = o.web ?? 0.022
  const s = new THREE.Shape()
  s.moveTo(-w / 2, -d / 2)
  s.lineTo(w / 2, -d / 2)
  s.lineTo(w / 2, -d / 2 + tf)
  s.lineTo(tw / 2, -d / 2 + tf)
  s.lineTo(tw / 2, d / 2 - tf)
  s.lineTo(w / 2, d / 2 - tf)
  s.lineTo(w / 2, d / 2)
  s.lineTo(-w / 2, d / 2)
  s.lineTo(-w / 2, d / 2 - tf)
  s.lineTo(-tw / 2, d / 2 - tf)
  s.lineTo(-tw / 2, -d / 2 + tf)
  s.lineTo(-w / 2, -d / 2 + tf)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, steps: 1 })
  // extrude runs along +z: turn it to run along +x, profile in the y/z plane
  g.rotateY(Math.PI / 2)
  g.computeVertexNormals()
  return g
}

/** Square hollow section column/brace along +y from 0..len. */
export function hssGeometry(len: number, size = 0.5): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, len, size)
  g.translate(0, len / 2, 0)
  return g
}

/**
 * A lattice box truss (tower-crane mast / jib) along +y, `len` long, `size`
 * square: four chords + zig-zag diagonals on each face, merged into one geometry.
 */
export function latticeGeometry(o: { len: number; size: number; chord?: number; bay?: number; triangular?: boolean }): THREE.BufferGeometry {
  const { len, size } = o
  const chord = o.chord ?? size * 0.07
  const bay = o.bay ?? size
  const parts: THREE.BufferGeometry[] = []
  const h = size / 2
  const corners: [number, number][] = o.triangular
    ? [
        [-h, -h * 0.58],
        [h, -h * 0.58],
        [0, h * 0.58],
      ]
    : [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ]
  for (const [x, z] of corners) {
    const c = new THREE.BoxGeometry(chord, len, chord)
    c.translate(x, len / 2, z)
    parts.push(c)
  }
  const n = Math.max(1, Math.round(len / bay))
  const step = len / n
  const dia = chord * 0.6
  for (let f = 0; f < corners.length; f++) {
    const [ax, az] = corners[f]
    const [bx, bz] = corners[(f + 1) % corners.length]
    for (let i = 0; i < n; i++) {
      const y0 = i * step
      const flip = i % 2 === 0
      const p0 = new THREE.Vector3(flip ? ax : bx, y0, flip ? az : bz)
      const p1 = new THREE.Vector3(flip ? bx : ax, y0 + step, flip ? bz : az)
      const L = p0.distanceTo(p1)
      const d = new THREE.BoxGeometry(dia, L, dia)
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize())
      d.applyQuaternion(q)
      const mid = p0.clone().add(p1).multiplyScalar(0.5)
      d.translate(mid.x, mid.y, mid.z)
      parts.push(d)
      // horizontal strut
      const hL = Math.hypot(bx - ax, bz - az)
      const hs = new THREE.BoxGeometry(dia, dia, hL)
      hs.lookAt(new THREE.Vector3(bx - ax, 0, bz - az))
      hs.translate((ax + bx) / 2, y0, (az + bz) / 2)
      parts.push(hs)
    }
  }
  return mergeAll(parts)
}

/**
 * Merge geometries into one non-indexed geometry: position + normal always;
 * `color` and `uv` too when every part has them (e.g. personGeometry()).
 */
export function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0
  const prepped = parts.map(p => {
    const g = p.index ? p.toNonIndexed() : p
    count += g.attributes.position.count
    return g
  })
  const withColor = prepped.length > 0 && prepped.every(g => !!g.attributes.color && g.attributes.color.itemSize === 3)
  const withUv = prepped.length > 0 && prepped.every(g => !!g.attributes.uv)
  const pos = new Float32Array(count * 3)
  const nor = new Float32Array(count * 3)
  const col = withColor ? new Float32Array(count * 3) : null
  const uv = withUv ? new Float32Array(count * 2) : null
  let o = 0
  for (const g of prepped) {
    if (!g.attributes.normal) g.computeVertexNormals()
    pos.set(g.attributes.position.array as Float32Array, o * 3)
    nor.set(g.attributes.normal.array as Float32Array, o * 3)
    if (col) col.set(g.attributes.color.array as Float32Array, o * 3)
    if (uv) uv.set(g.attributes.uv.array as Float32Array, o * 2)
    o += g.attributes.position.count
    g.dispose()
  }
  for (const p of parts) p.dispose()
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3))
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  out.computeBoundingSphere()
  return out
}

/** Paint a whole geometry one colour (a `color` attribute, for vertexColors materials + mergeAll). */
export function tint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color)
  const n = g.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r
    a[i * 3 + 1] = c.g
    a[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}

/** Hi-vis vest colours: fluorescent orange, fluorescent yellow, lime. */
export const HIVIS = ['#ff6a1a', '#f2e21e', '#b8e62c'] as const
/** A range of real skin tones, light to deep. */
export const SKIN = ['#f1c9a5', '#e0ac85', '#c68863', '#a86e4b', '#8a5536', '#6b3f28', '#4e2c1c'] as const
/** Hard hats: white (most), yellow, orange, blue (supervisors, visitors, engineers). */
export const HATS = ['#f4f1ea', '#f4f1ea', '#f2c200', '#f4f1ea', '#ff7a1a', '#2f6fd1'] as const
const SHIRTS = ['#2b3544', '#3a3f45', '#34465e', '#40463a', '#56524a', '#2a2c30'] as const
const TROUSERS = ['#23272d', '#2e3a4f', '#3a3630', '#4a4436', '#262a31'] as const

let personSerial = 0

/**
 * A construction worker at real scale (1.62–1.9 m), standing on y = 0 facing
 * +z: tapered legs and forearms, boots, a work shirt under a hi-vis vest with
 * two bands of silver reflective tape, a hard hat with a peak. Vertex-coloured
 * (use with MAT.person()); merge several into one mesh for a crew, or instance
 * one.
 *
 *   seed   picks skin tone, clothes, hat, build and small pose offsets
 *          (omitted: each call takes the next seed, so a crew varies by itself)
 *   vest / hat / skin   override the palette picks
 *   pose   'stand' | 'walk' | 'work' (arms forward, handling something) |
 *          'reach' (one arm up, signalling / guiding a load)
 */
export function personGeometry(
  o: {
    vest?: THREE.ColorRepresentation
    hat?: THREE.ColorRepresentation
    skin?: THREE.ColorRepresentation
    pose?: 'stand' | 'walk' | 'work' | 'reach'
    seed?: number
  } = {},
): THREE.BufferGeometry {
  let s = (o.seed ?? personSerial++) * 7919 + 17
  const rnd = () => {
    s = (s * 16807 + 11) % 2147483647
    return s / 2147483647
  }
  const pick = <V>(a: readonly V[]) => a[Math.floor(rnd() * a.length) % a.length]
  const skin = o.skin ?? pick(SKIN)
  const vest = o.vest ?? pick(HIVIS)
  const hat = o.hat ?? pick(HATS)
  const shirt = pick(SHIRTS)
  const trousers = pick(TROUSERS)
  const tape = '#c9cdd0'
  const boot = '#1f1a16'
  const pose = o.pose ?? 'stand'
  const lean = (rnd() - 0.5) * 0.08
  const parts: THREE.BufferGeometry[] = []
  const X = new THREE.Vector3(1, 0, 0)
  const Z = new THREE.Vector3(0, 0, 1)
  /** a limb hanging from `at` (its top), swung forward by `fwd` and out by `out` (radians) */
  const limb = (g: THREE.BufferGeometry, at: THREE.Vector3, fwd: number, out: number) => {
    g.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(Z, out))
    g.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(X, -fwd))
    return g.translate(at.x, at.y, at.z)
  }
  /** a tapered round section hanging down from its top: radii top/bottom, length */
  const taper = (rt: number, rb: number, len: number, seg = 7) => new THREE.CylinderGeometry(rt, rb, len, seg, 1).translate(0, -len / 2, 0)
  const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 2, 7).translate(0, -len / 2, 0)

  // legs: thigh → shin in one tapered trouser leg, a boot at the foot
  const legSwing = pose === 'walk' ? 0.32 : pose === 'work' ? 0.08 : 0.03
  for (const side of [-1, 1]) {
    const hip = new THREE.Vector3(side * 0.095, 0.93, 0)
    const sw = side * legSwing * (pose === 'work' ? -1 : 1)
    parts.push(tint(limb(taper(0.082, 0.056, 0.84), hip, sw, side * 0.035), trousers))
    const footZ = Math.sin(sw) * 0.84
    parts.push(tint(new THREE.BoxGeometry(0.12, 0.1, 0.27).translate(side * 0.11, 0.05, footZ + 0.04), boot))
  }
  // pelvis
  parts.push(tint(new THREE.CylinderGeometry(0.165, 0.15, 0.2, 9).scale(1, 1, 0.66).translate(0, 0.93, 0), trousers))
  // torso (shirt), the vest over it, the reflective tape round the vest
  parts.push(tint(new THREE.CylinderGeometry(0.2, 0.158, 0.56, 10).scale(1, 1, 0.6).translate(0, 1.2, 0), shirt))
  parts.push(tint(new THREE.CylinderGeometry(0.212, 0.172, 0.44, 10, 1, true).scale(1, 1, 0.64).translate(0, 1.18, 0), vest))
  for (const y of [1.08, 1.27]) {
    const r = 0.172 + ((y - 0.96) / 0.44) * 0.04 + 0.006
    parts.push(tint(new THREE.CylinderGeometry(r + 0.002, r, 0.035, 10, 1, true).scale(1, 1, 0.65).translate(0, y, 0), tape))
  }
  // shoulders + arms (sleeves), hands
  const armFwd: [number, number] =
    pose === 'work' ? [0.95 + rnd() * 0.3, 0.8 + rnd() * 0.3] : pose === 'walk' ? [-0.3, 0.3] : pose === 'reach' ? [0.2, 2.7] : [0.06 + rnd() * 0.1, -0.04 + rnd() * 0.1]
  ;[-1, 1].forEach((side, i) => {
    const sh = new THREE.Vector3(side * 0.225, 1.45, 0)
    parts.push(tint(new THREE.SphereGeometry(0.07, 7, 5).translate(sh.x, sh.y - 0.01, 0), shirt))
    const out = side * (pose === 'reach' && i === 1 ? 0.25 : 0.1)
    parts.push(tint(limb(capsule(0.052, 0.56), sh, armFwd[i], out), shirt))
    const hand = new THREE.Vector3(0, -0.6, 0).applyAxisAngle(Z, out).applyAxisAngle(X, -armFwd[i]).add(sh)
    parts.push(tint(new THREE.SphereGeometry(0.045, 6, 4).translate(hand.x, hand.y, hand.z), skin))
  })
  // neck, head, hard hat (dome + peak)
  parts.push(tint(new THREE.CylinderGeometry(0.052, 0.058, 0.1, 7).translate(0, 1.52, 0.005), skin))
  parts.push(tint(new THREE.SphereGeometry(0.1, 10, 8).scale(0.9, 1.1, 0.98).translate(0, 1.64, 0.01), skin))
  parts.push(tint(new THREE.SphereGeometry(0.125, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.82, 1.08).translate(0, 1.68, 0.005), hat))
  parts.push(tint(new THREE.CylinderGeometry(0.14, 0.145, 0.018, 12).scale(1, 1, 1.12).translate(0, 1.685, 0.025), hat))
  parts.push(tint(new THREE.BoxGeometry(0.16, 0.014, 0.08).translate(0, 1.684, 0.16), hat))
  const g = mergeAll(parts)
  // build: height 0.9–1.06 of 1.8 m, a little broader or slimmer; a slight lean
  const h = 0.92 + rnd() * 0.14
  const w = 0.94 + rnd() * 0.14
  g.scale(w, h, w)
  if (pose === 'work') {
    // bent into the job: everything above the hips leans forward
    const pos = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      if (y > 0.9 * h) pos.setZ(i, pos.getZ(i) + (y - 0.9 * h) * 0.32)
    }
    // (normals left as they were: a small shear, and recomputing on a
    // non-indexed merge would facet every round part)
  }
  g.rotateZ(lean)
  return g
}

/**
 * Cyan architectural linework for a geometry. `draw` (0..1) reveals it from
 * the bottom up (by world-space height inside the geometry's bounds).
 * Returns the LineSegments; set (lines.material as any).uniforms.uDraw.value.
 */
export function blueprint(geometry: THREE.BufferGeometry, o: { color?: THREE.ColorRepresentation; opacity?: number; threshold?: number } = {}): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(geometry, o.threshold ?? 20)
  edges.computeBoundingBox()
  const bb = edges.boundingBox!
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(o.color ?? T.line) },
      uOpacity: { value: o.opacity ?? 0.8 },
      uDraw: { value: 1 },
      uMinY: { value: bb.min.y },
      uMaxY: { value: bb.max.y },
    },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() { vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity, uDraw, uMinY, uMaxY; varying float vY;
      void main() {
        float h = (vY - uMinY) / max(uMaxY - uMinY, 1e-4);
        float a = 1.0 - smoothstep(uDraw - 0.02, uDraw, h);
        if (a <= 0.001) discard;
        gl_FragColor = vec4(uColor * uOpacity * a, 1.0);
      }
    `,
  })
  return new THREE.LineSegments(edges, mat)
}

/** Welding / grinding sparks: additive points with gravity and bounce-free fade. */
export class Sparks {
  points: THREE.Points
  private pos: Float32Array
  private vel: Float32Array
  private life: Float32Array
  private next = 0
  /** size = world size factor; minPx = smallest point in pixels (keeps far sparks visible) */
  constructor(private max = 400, size = 0.12, minPx = 0) {
    this.pos = new Float32Array(max * 3)
    this.vel = new Float32Array(max * 3)
    this.life = new Float32Array(max)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage))
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: { uSize: { value: size * 300 }, uMinPx: { value: minPx } },
      vertexShader: /* glsl */ `
        attribute float life; uniform float uSize, uMinPx; varying float vLife;
        void main() {
          vLife = life;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float lk = clamp(life, 0.0, 1.0);
          gl_PointSize = max(uSize * lk / max(-mv.z, 0.5), uMinPx * step(0.001, life) * (0.5 + 0.5 * lk));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        void main() {
          if (vLife <= 0.0) discard;
          vec2 c = gl_PointCoord - 0.5;
          float d = 1.0 - smoothstep(0.1, 0.5, length(c));
          vec3 col = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.95, 0.7), clamp(vLife, 0.0, 1.0));
          gl_FragColor = vec4(col * d * 4.0 * vLife, 1.0);
        }
      `,
    })
    this.points = new THREE.Points(g, m)
    this.points.frustumCulled = false
  }
  /** Burst `count` sparks from a local-space point (in the points' parent space). */
  emit(at: THREE.Vector3, count = 20, spread = 3.5) {
    for (let i = 0; i < count; i++) {
      const k = this.next
      this.next = (this.next + 1) % this.max
      this.pos[k * 3] = at.x
      this.pos[k * 3 + 1] = at.y
      this.pos[k * 3 + 2] = at.z
      const a = Math.random() * Math.PI * 2
      const up = Math.random() * 0.8
      const sp = spread * (0.4 + Math.random() * 0.8)
      this.vel[k * 3] = Math.cos(a) * sp
      this.vel[k * 3 + 1] = up * sp
      this.vel[k * 3 + 2] = Math.sin(a) * sp
      this.life[k] = 0.6 + Math.random() * 0.5
    }
  }
  update(dt: number) {
    let any = false
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) continue
      any = true
      this.life[k] -= dt * 1.4
      this.vel[k * 3 + 1] -= 9.8 * dt
      this.pos[k * 3] += this.vel[k * 3] * dt
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt
    }
    if (any) {
      this.points.geometry.attributes.position.needsUpdate = true
      this.points.geometry.attributes.life.needsUpdate = true
    }
  }
}

/** Stencilled / painted text on a plane (e.g. "LEVEL 24", beam signatures). */
export function etchLabel(
  text: string,
  o: {
    height?: number
    font?: string
    weight?: number
    color?: THREE.ColorRepresentation
    bg?: THREE.ColorRepresentation
    glow?: number
    pad?: number
  } = {},
): THREE.Mesh {
  const px = 128
  const font = `${o.weight ?? 800} ${px}px ${o.font ?? "'Big Shoulders Display Variable', 'Archivo Variable', sans-serif"}`
  const cv = document.createElement('canvas')
  const g = cv.getContext('2d')!
  g.font = font
  const pad = o.pad ?? 16
  const w = Math.ceil(g.measureText(text).width) + pad * 2
  const h = Math.ceil(px * 1.2) + pad
  cv.width = w
  cv.height = h
  const draw = () => {
    g.clearRect(0, 0, w, h)
    if (o.bg) {
      g.fillStyle = new THREE.Color(o.bg).getStyle()
      g.fillRect(0, 0, w, h)
    }
    g.font = font
    g.textBaseline = 'middle'
    g.fillStyle = '#ffffff'
    g.fillText(text, pad, h / 2 + 4)
  }
  draw()
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  document.fonts?.ready.then(() => {
    draw()
    tex.needsUpdate = true
  })
  const glow = o.glow ?? 1
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: new THREE.Color(o.color ?? '#ffffff').multiplyScalar(glow),
    transparent: !o.bg,
    depthWrite: !!o.bg,
    toneMapped: glow <= 1,
  })
  const height = o.height ?? 1
  return new THREE.Mesh(new THREE.PlaneGeometry((height * w) / h, height), mat)
}

/** A blueprint dimension line between a and b (world units) with end ticks. */
export function dimension(a: THREE.Vector3, b: THREE.Vector3, color: THREE.ColorRepresentation = T.line): THREE.LineSegments {
  const dir = b.clone().sub(a).normalize()
  const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize()
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0)
  const t = 0.6
  const pts = [
    a, b,
    a.clone().addScaledVector(side, -t), a.clone().addScaledVector(side, t),
    b.clone().addScaledVector(side, -t), b.clone().addScaledVector(side, t),
  ]
  const g = new THREE.BufferGeometry().setFromPoints(pts)
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false }))
}
