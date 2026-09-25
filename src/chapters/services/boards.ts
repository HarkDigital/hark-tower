import * as THREE from 'three'
import { SERVICES } from '../../content'
import { T } from '../../kit/steel'
import { DIAMOND, GLYPHS, strokeLength, type Stroke } from './icons'
import { COUNT, levelOf, slabOf } from './timeline'

/*
 * THE LANDING BOARDS — one per service floor, hung on the face of the slab
 * next to the hoist landing: a painted level plate ("LEVEL / 19", hazard-yellow on
 * graphite) beside a drawing sheet (blueprint paper, grid, title block, the
 * service's glyph). As the car arrives the glyph is DRAFTED stroke by stroke;
 * once the floor is fitted out the board SWEEPS into a lit sign: graphite,
 * the glyph in Hark signal green, the number in white.
 *
 * One atlas (a DataTexture with four channels), one merged geometry, one
 * shader; per-board draw/lit arrive as uniform arrays.
 *   R  glyph ink (crisp)       G  pen progress along the glyph (0..1)
 *   B  sheet linework / text   A  painted number plate
 *
 * Also here: the small painted level headers over every landing gate ("L19").
 */

type Ctx = CanvasRenderingContext2D

const DISPLAY = "'Big Shoulders Display Variable', 'Archivo Variable', 'Arial Narrow', sans-serif"
const MONO = "'IBM Plex Mono', ui-monospace, monospace"

/**
 * Make sure the canvas fonts are loaded before drawing (never block for long).
 * Resolves true when they are; false = draw now with fallbacks and redraw
 * once `whenFonts` settles.
 */
let fontsPending: Promise<unknown> = Promise.resolve()
export async function loadFonts(): Promise<boolean> {
  const f = document.fonts
  if (!f?.load) return true
  let done = false
  fontsPending = Promise.all([f.load(`800 120px ${DISPLAY}`), f.load(`500 14px ${MONO}`)])
    .catch(() => {})
    .then(() => (done = true))
  await Promise.race([fontsPending, new Promise(r => setTimeout(r, 1500))])
  return done
}
export const whenFonts = () => fontsPending

/** Board size on the building (m) and where it hangs. */
// hung on the outside of the facade (in front of the curtain wall once it arrives)
export const BOARD = { w: 6.2, h: 3.1, x: 15.6, z: 5.55, y: 0.4 }
/** the plate / sheet split (u) */
const SPLIT = 0.345

const COLS = 2
const ROWS = Math.ceil(COUNT / COLS)
const DW = 512
const DH = 256

function drawGlyph(g: Ctx, strokes: Stroke[], mode: 'ink' | 'pen', width: number) {
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.lineWidth = width
  if (mode === 'ink') {
    g.strokeStyle = '#fff'
    for (const s of strokes) {
      g.beginPath()
      g.moveTo(s[0][0], s[0][1])
      for (let i = 1; i < s.length; i++) g.lineTo(s[i][0], s[i][1])
      g.stroke()
    }
    return
  }
  // the pen: every short piece carries how far along the drawing it is
  const L = strokeLength(strokes)
  let run = 0
  for (const s of strokes) {
    for (let i = 1; i < s.length; i++) {
      const [ax, ay] = s[i - 1]
      const [bx, by] = s[i]
      const len = Math.hypot(bx - ax, by - ay)
      const n = Math.max(1, Math.ceil(len / 2))
      for (let j = 0; j < n; j++) {
        const t0 = j / n
        const t1 = (j + 1) / n
        run += len / n
        const v = Math.round((0.015 + 0.965 * (run / L)) * 255)
        g.strokeStyle = `rgb(${v},${v},${v})`
        g.beginPath()
        g.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0)
        g.lineTo(ax + (bx - ax) * t1, ay + (by - ay) * t1)
        g.stroke()
      }
    }
  }
}

function hazard(g: Ctx, x: number, y: number, w: number, h: number, step = 10) {
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.fillStyle = '#fff'
  for (let i = -h; i < w + h; i += step * 2) {
    g.beginPath()
    g.moveTo(x + i, y + h)
    g.lineTo(x + i + step, y + h)
    g.lineTo(x + i + step + h, y)
    g.lineTo(x + i + h, y)
    g.closePath()
    g.fill()
  }
  g.restore()
}

/** Build the four channel layers for every board into one RGBA DataTexture. */
function buildAtlas(scale: number) {
  const CW = Math.round(DW * scale)
  const CH = Math.round(DH * scale)
  const AW = CW * COLS
  const AH = CH * ROWS
  const layers = [0, 1, 2, 3].map(() => {
    const c = document.createElement('canvas')
    c.width = AW
    c.height = AH
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.fillStyle = '#000'
    g.fillRect(0, 0, AW, AH)
    return g
  })
  const [ink, pen, deco, num] = layers
  for (let k = 0; k < COUNT; k++) {
    const svc = SERVICES[k]
    const level = levelOf(slabOf(k))
    const ox = (k % COLS) * CW
    const oy = Math.floor(k / COLS) * CH
    for (const g of layers) {
      g.save()
      g.translate(ox, oy)
      g.scale(scale, scale)
    }

    // ---- the sheet (B): grid, borders, title, title block, a dimension line
    deco.fillStyle = '#fff'
    deco.strokeStyle = 'rgb(80,80,80)'
    deco.lineWidth = 1
    deco.beginPath()
    for (let x = 200; x < 500; x += 16) {
      deco.moveTo(x + 0.5, 13)
      deco.lineTo(x + 0.5, 243)
    }
    for (let y = 20; y < 244; y += 16) {
      deco.moveTo(193, y + 0.5)
      deco.lineTo(499, y + 0.5)
    }
    deco.stroke()
    deco.strokeStyle = '#fff'
    deco.lineWidth = 2.5
    deco.strokeRect(186, 6, 320, 244)
    deco.lineWidth = 1.2
    deco.strokeRect(192, 12, 308, 232)
    deco.font = `500 13px ${MONO}`
    deco.textBaseline = 'alphabetic'
    const title = `${svc.num} — ${svc.title.toUpperCase()}`
    deco.fillText(title, 202, 33, 290)
    // title block
    deco.fillStyle = '#000'
    deco.fillRect(376, 196, 118, 42)
    deco.fillStyle = '#fff'
    deco.lineWidth = 1.2
    deco.strokeRect(376.5, 196.5, 118, 42)
    deco.beginPath()
    deco.moveTo(436.5, 196)
    deco.lineTo(436.5, 238)
    deco.moveTo(376, 217.5)
    deco.lineTo(494, 217.5)
    deco.stroke()
    deco.font = `500 12px ${MONO}`
    deco.fillText(`A-${200 + level}`, 382, 212)
    deco.fillText(`L${level}`, 442, 212)
    deco.font = `500 10px ${MONO}`
    deco.fillText('FIT-OUT', 382, 232)
    deco.fillText(`${svc.num}/${String(COUNT).padStart(2, '0')}`, 442, 232)
    // dimension line under the glyph
    deco.beginPath()
    deco.moveTo(204, 226.5)
    deco.lineTo(360, 226.5)
    for (const x of [204.5, 359.5]) {
      deco.moveTo(x, 220)
      deco.lineTo(x, 233)
    }
    deco.stroke()
    deco.fillStyle = '#000'
    deco.fillRect(266, 219, 32, 14)
    deco.fillStyle = '#fff'
    deco.font = `500 10px ${MONO}`
    deco.fillText('6000', 270, 230)

    // ---- the glyph (R ink, G pen)
    const strokes = GLYPHS[svc.slug] ?? DIAMOND
    for (const [g, mode, w] of [
      [ink, 'ink', 6.5],
      [pen, 'pen', 11],
    ] as const) {
      g.save()
      g.translate(285, 124)
      g.scale(1.7, 1.7)
      drawGlyph(g, strokes, mode, w / 1.7)
      g.restore()
    }

    // ---- the painted plate (A): LEVEL / 19, hazard band
    num.fillStyle = '#fff'
    num.font = `500 17px ${MONO}`
    num.textBaseline = 'alphabetic'
    num.fillText('LEVEL', 16, 32)
    num.fillRect(16, 42, 142, 2)
    num.font = `800 186px ${DISPLAY}`
    num.textAlign = 'center'
    num.fillText(String(level), 87, 214, 150)
    num.textAlign = 'left'
    hazard(num, 0, 232, 174, 18, 9)

    for (const g of layers) g.restore()
  }

  // compose the four layers into RGBA, flipping rows so v = 1 is the canvas top
  const px = layers.map(g => g.getImageData(0, 0, AW, AH).data)
  const data = new Uint8Array(AW * AH * 4)
  for (let y = 0; y < AH; y++) {
    const src = y * AW * 4
    const dst = (AH - 1 - y) * AW * 4
    for (let x = 0; x < AW; x++) {
      const i = src + x * 4
      const o = dst + x * 4
      data[o] = px[0][i]
      data[o + 1] = px[1][i]
      data[o + 2] = px[2][i]
      data[o + 3] = px[3][i]
    }
  }
  return { data, AW, AH, CW, CH }
}

const VERT = /* glsl */ `
  attribute vec2 aLocal;
  attribute float aIdx;
  uniform float uDraw[${COUNT}];
  uniform float uLit[${COUNT}];
  varying vec2 vUv;
  varying vec2 vLocal;
  varying float vDraw;
  varying float vLit;
  void main() {
    int i = int(aIdx + 0.5);
    vDraw = uDraw[i];
    vLit = uLit[i];
    vUv = uv;
    vLocal = aLocal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uPaper, uLine, uPlate, uPaint, uSignal, uWhite;
  uniform float uShade;
  varying vec2 vUv;
  varying vec2 vLocal;
  varying float vDraw;
  varying float vLit;
  void main() {
    vec4 t = texture2D(uMap, vUv);
    float plate = 1.0 - step(${SPLIT.toFixed(3)}, vLocal.x);
    // drafted: the glyph appears where the pen has passed; the pen tip glows
    float drawn = t.r * (1.0 - smoothstep(vDraw - 0.012, vDraw, t.g));
    float live = step(0.001, vDraw) * (1.0 - step(0.999, vDraw));
    float tip = t.r * (1.0 - smoothstep(0.0, 0.035, abs(t.g - vDraw))) * live;
    vec3 sheet = uPaper + uLine * (t.b * 0.5 + drawn * 1.05) + uWhite * tip * 2.2;
    vec3 painted = uPlate + uPaint * t.a;
    vec3 pre = mix(sheet, painted, plate) * uShade;
    // lit: a graphite sign, the glyph in signal green, the number in white
    float ink = smoothstep(0.55, 0.9, t.b);
    vec3 litSheet = uPlate * 1.3 + uSignal * t.r * 1.9 + uWhite * 0.42 * ink;
    vec3 litPlate = uPlate * 1.3 + uWhite * 1.1 * t.a;
    vec3 lit = mix(litSheet, litPlate, plate);
    // the lit state sweeps up the board, a green scan line at its front
    float front = vLit * 1.1 - 0.05;
    float w = 1.0 - smoothstep(front - 0.015, front + 0.015, vLocal.y);
    vec3 col = mix(pre, lit, w);
    float sweeping = step(0.001, vLit) * (1.0 - step(0.999, vLit));
    col += uSignal * exp(-abs(vLocal.y - front) * 90.0) * sweeping * 1.6;
    gl_FragColor = vec4(col, 1.0);
  }
`

export interface Boards {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  /** show the first n boards (slab order) */
  setVisible(n: number): void
  /** per board 0..1 */
  set(k: number, draw: number, lit: number): void
  /** redraw the atlas (after late web fonts) */
  refresh(): void
  dispose(): void
}

export function createBoards(renderer: THREE.WebGLRenderer, mobile: boolean, yOf: (slab: number) => number): Boards {
  const scale = mobile ? 0.75 : 1
  const { data, AW, AH, CW, CH } = buildAtlas(scale)
  const tex = new THREE.DataTexture(data, AW, AH, THREE.RGBAFormat)
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true

  const pos: number[] = []
  const uv: number[] = []
  const loc: number[] = []
  const idx: number[] = []
  const { w, h, x, z } = BOARD
  for (let k = 0; k < COUNT; k++) {
    const y0 = yOf(slabOf(k)) + BOARD.y
    const col = k % COLS
    const row = Math.floor(k / COLS)
    const u0 = (col * CW + 1) / AW
    const u1 = ((col + 1) * CW - 1) / AW
    const vTop = 1 - (row * CH + 1) / AH
    const vBot = 1 - ((row + 1) * CH - 1) / AH
    // facing +x: the viewer's left is +z, so u = 0 sits at the +z end
    const corners = [
      { p: [x, y0, z + w / 2], u: u0, v: vBot, l: [0, 0] },
      { p: [x, y0, z - w / 2], u: u1, v: vBot, l: [1, 0] },
      { p: [x, y0 + h, z - w / 2], u: u1, v: vTop, l: [1, 1] },
      { p: [x, y0 + h, z + w / 2], u: u0, v: vTop, l: [0, 1] },
    ]
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const c = corners[i]
      pos.push(c.p[0], c.p[1], c.p[2])
      uv.push(c.u, c.v)
      loc.push(c.l[0], c.l[1])
      idx.push(k)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 2))
  geo.setAttribute('aIdx', new THREE.Float32BufferAttribute(idx, 1))
  geo.computeBoundingSphere()

  const col = (hex: string, s = 1) => new THREE.Color(hex).multiplyScalar(s)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uDraw: { value: new Array(COUNT).fill(0) },
      uLit: { value: new Array(COUNT).fill(0) },
      uPaper: { value: col(T.blueprint, 1.25) },
      uLine: { value: col(T.line, 0.95) },
      uPlate: { value: col(T.graphite, 1) },
      uPaint: { value: col(T.craneYellow, 0.62) },
      uSignal: { value: col(T.signal, 1) },
      uWhite: { value: col('#f4f1ea', 1) },
      uShade: { value: 1 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  const draws = material.uniforms.uDraw.value as number[]
  const lits = material.uniforms.uLit.value as number[]
  return {
    mesh,
    material,
    setVisible(n) {
      geo.setDrawRange(0, Math.max(0, Math.min(COUNT, n)) * 6)
    },
    set(k, draw, lit) {
      draws[k] = draw
      lits[k] = lit
    },
    refresh() {
      data.set(buildAtlas(scale).data)
      tex.needsUpdate = true
    },
    dispose() {
      geo.dispose()
      material.dispose()
      tex.dispose()
    },
  }
}

/* ------------------------------------------------------------------------ */

/** Painted "L19" headers over every landing gate (slab 1..maxSlab). */
export function createHeaders(maxSlab: number, place: (slab: number) => { x: number; y: number; z: number }, mobile: boolean) {
  const n = maxSlab
  const cols = 4
  const rows = Math.ceil(n / cols)
  const s = mobile ? 0.75 : 1
  const CW = Math.round(256 * s)
  const CH = Math.round(80 * s)
  const cv = document.createElement('canvas')
  cv.width = CW * cols
  cv.height = CH * rows
  const g = cv.getContext('2d')!
  const draw = () => {
    g.clearRect(0, 0, cv.width, cv.height)
    for (let i = 0; i < n; i++) {
      const slab = i + 1
      g.save()
      g.translate((i % cols) * CW, Math.floor(i / cols) * CH)
      g.scale(s, s)
      g.fillStyle = '#22272d'
      g.fillRect(0, 0, 256, 80)
      g.fillStyle = T.craneYellow
      hazardColored(g, 0, 0, 26, 80)
      hazardColored(g, 230, 0, 26, 80)
      g.fillStyle = T.craneYellow
      g.font = `800 64px ${DISPLAY}`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(`L${levelOf(slab)}`, 128, 44, 180)
      g.restore()
    }
  }
  draw()
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const W = 2.7
  const H = 0.84
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  for (let i = 0; i < n; i++) {
    const slab = i + 1
    const c = place(slab)
    const u0 = ((i % cols) * CW + 1) / cv.width
    const u1 = ((i % cols + 1) * CW - 1) / cv.width
    // CanvasTexture flips Y: v = 1 is the canvas top
    const vTop = 1 - (Math.floor(i / cols) * CH + 1) / cv.height
    const vBot = 1 - ((Math.floor(i / cols) + 1) * CH - 1) / cv.height
    const corners = [
      [c.x, c.y - H / 2, c.z + W / 2, u0, vBot],
      [c.x, c.y - H / 2, c.z - W / 2, u1, vBot],
      [c.x, c.y + H / 2, c.z - W / 2, u1, vTop],
      [c.x, c.y + H / 2, c.z + W / 2, u0, vTop],
    ]
    for (const j of [0, 1, 2, 0, 2, 3]) {
      const q = corners[j]
      pos.push(q[0], q[1], q[2])
      nor.push(1, 0, 0)
      uv.push(q[3], q[4])
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.computeBoundingSphere()
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.05 })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  return {
    mesh,
    redraw() {
      draw()
      tex.needsUpdate = true
    },
    /** show slabs 1..count */
    setVisible(count: number) {
      geo.setDrawRange(0, Math.max(0, Math.min(n, count)) * 6)
    },
  }
}

function hazardColored(g: Ctx, x: number, y: number, w: number, h: number) {
  g.save()
  g.fillStyle = '#16191d'
  g.fillRect(x, y, w, h)
  g.fillStyle = T.craneYellow
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  for (let i = -w; i < h + w; i += 20) {
    g.beginPath()
    g.moveTo(x, y + i)
    g.lineTo(x + w, y + i - w)
    g.lineTo(x + w, y + i - w + 10)
    g.lineTo(x, y + i + 10)
    g.closePath()
    g.fill()
  }
  g.restore()
}
