import * as THREE from 'three'

/*
 * Hark Tower kit — steel, glass and site materials + shared builders, so every
 * chapter speaks the same construction language as the tower in the world.
 *
 *   T                         palette by name (hex strings)
 *   MAT                       cached materials: steel (galvanised graphite),
 *                             primer (red-oxide beams), concrete, curtain
 *                             glass (mirror-tinted, reflects the sky), mullion,
 *                             craneYellow, safety (orange), rubber, signal
 *                             (emissive Hark green)
 *   iBeamGeometry(len, o)     an I-beam (wide-flange) along +x, centred
 *   hssGeometry(len, size)    a square hollow section (columns, braces)
 *   latticeGeometry(o)        a crane-style lattice box truss (merged)
 *   blueprint(geometry, o)    cyan architectural linework for any geometry
 *                             (EdgesGeometry), with a 0..1 `draw` reveal
 *   Sparks                    welding/grinding sparks (Points, additive):
 *                             sparks.emit(worldPos, count); sparks.update(dt)
 *   dimension(a, b, label)    a blueprint dimension line with end ticks + label
 *   etchLabel(text, o)        stencil / painted text on a plane (canvas)
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

const cache = new Map<string, THREE.Material>()
function once<M extends THREE.Material>(key: string, make: () => M): M {
  let m = cache.get(key) as M | undefined
  if (!m) {
    m = make()
    cache.set(key, m)
  }
  return m
}

export const MAT = {
  steel: () => once('steel', () => new THREE.MeshStandardMaterial({ color: T.steel, metalness: 0.75, roughness: 0.42 })),
  primer: () => once('primer', () => new THREE.MeshStandardMaterial({ color: T.primer, metalness: 0.35, roughness: 0.62 })),
  concrete: () => once('concrete', () => new THREE.MeshStandardMaterial({ color: T.concrete, metalness: 0, roughness: 0.92 })),
  concreteDark: () => once('concreteDark', () => new THREE.MeshStandardMaterial({ color: T.concreteDark, metalness: 0, roughness: 0.95 })),
  /** the curtain wall: tinted, near-mirror; it shows the sky (scene.environment) */
  glass: () =>
    once('glass', () => new THREE.MeshStandardMaterial({ color: T.glass, metalness: 0.92, roughness: 0.07, envMapIntensity: 1.2 })),
  mullion: () => once('mullion', () => new THREE.MeshStandardMaterial({ color: '#2a3036', metalness: 0.8, roughness: 0.35 })),
  craneYellow: () => once('craneYellow', () => new THREE.MeshStandardMaterial({ color: T.craneYellow, metalness: 0.3, roughness: 0.5 })),
  safety: () => once('safety', () => new THREE.MeshStandardMaterial({ color: T.safety, metalness: 0.1, roughness: 0.6 })),
  rubber: () => once('rubber', () => new THREE.MeshStandardMaterial({ color: '#15181b', metalness: 0, roughness: 0.85 })),
  /** emissive Hark green (crown, status lights); blooms */
  signal: (strength = 3) =>
    once(`signal:${strength}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(T.signal).multiplyScalar(strength), toneMapped: false })),
  /** warm interior light (fitted floors at dusk) */
  interior: (strength = 1.6) =>
    once(`interior:${strength}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0').multiplyScalar(strength), toneMapped: false })),
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

/** Merge non-indexed-compatible geometries (position/normal only). */
export function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0
  const prepped = parts.map(p => {
    const g = p.index ? p.toNonIndexed() : p
    count += g.attributes.position.count
    return g
  })
  const pos = new Float32Array(count * 3)
  const nor = new Float32Array(count * 3)
  let o = 0
  for (const g of prepped) {
    if (!g.attributes.normal) g.computeVertexNormals()
    pos.set(g.attributes.position.array as Float32Array, o * 3)
    nor.set(g.attributes.normal.array as Float32Array, o * 3)
    o += g.attributes.position.count
    g.dispose()
  }
  for (const p of parts) p.dispose()
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  out.computeBoundingSphere()
  return out
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
  constructor(private max = 400, size = 0.12) {
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
      uniforms: { uSize: { value: size * 300 } },
      vertexShader: /* glsl */ `
        attribute float life; uniform float uSize; varying float vLife;
        void main() {
          vLife = life;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize * clamp(life, 0.0, 1.0) / max(-mv.z, 0.5);
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
