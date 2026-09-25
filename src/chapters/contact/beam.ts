import * as THREE from 'three'
import { rng } from '../../core/math'
import { MAT, mergeAll } from '../../kit/steel'

/*
 * THE LAST BEAM — the topping-out tradition, built to the tower's scale.
 *
 * A W36 girder (0.9 m deep, 6 m long: exactly one bay) painted white and
 * covered in the crew's signatures (procedural ink scribbles — no names), a
 * hand-lettered SAY HELLO. and the address, a small evergreen zip-tied to the
 * top flange, and a flag on a clamp pole. It hangs from the crane hook on a
 * two-leg sling bridle, with two tag lines trailing from its ends.
 *
 *   load            origin = the beam's centre (index.ts places + swings it)
 *   HANG            metres from the beam's centre up to the crane's hook point
 *   setSlings(on)   the bridle (hidden once it's unhooked)
 *   setTags(k)      tag lines 0..1 (pulled up as the beam lands)
 *   update(t, amt)  flag + tag-line idle motion (amt 0 = still)
 */

export const BEAM_L = 6
export const BEAM_D = 0.9
const BEAM_W = 0.3
const TF = 0.05
const TW = 0.032
const WEB_H = BEAM_D - 2 * TF
/** hook point above the beam's centre (bridle + hook bowl) */
export const HANG = 3.5

const INK = ['#141414', '#141414', '#161a24', '#1d2b5c', '#1d2b5c', '#8f2218', '#1c5f35', '#253f8f', '#3a3a3a']

/**
 * One ink "signature": a run of cursive letter strokes (loops, humps, a
 * descender, a big capital), slanted and smoothed through midpoints so it
 * reads as a real autograph from a few metres away. Never a real name.
 */
type Pt = [number, number]
const LETTERS: ((x: number, r: () => number) => Pt[])[] = [
  // e — a small loop
  (x, r) => { const h = 0.45 + r() * 0.2; return [[x + 0.15, h * 0.4], [x + 0.35, h], [x + 0.18, h * 0.95], [x + 0.2, h * 0.3], [x + 0.55, 0]] },
  // l — a tall loop (ascender)
  (x, r) => { const h = 1.3 + r() * 0.5; return [[x + 0.25, h * 0.5], [x + 0.45, h], [x + 0.25, h * 0.92], [x + 0.28, h * 0.2], [x + 0.6, 0]] },
  // n — two humps
  x => [[x + 0.1, 0.5], [x + 0.25, 0.55], [x + 0.35, 0], [x + 0.5, 0.52], [x + 0.65, 0.5], [x + 0.75, 0]],
  // u — two cups
  x => [[x + 0.08, 0.5], [x + 0.2, 0.02], [x + 0.36, 0.5], [x + 0.46, 0.02], [x + 0.62, 0.45], [x + 0.7, 0.05]],
  // g — a descender loop
  (x, r) => { const d = 0.8 + r() * 0.4; return [[x + 0.2, 0.45], [x + 0.05, 0.2], [x + 0.3, 0.05], [x + 0.4, 0.48], [x + 0.36, -d], [x + 0.1, -d * 0.7], [x + 0.55, 0.05]] },
  // o — a round with its tie
  x => [[x + 0.2, 0.48], [x + 0.02, 0.22], [x + 0.25, 0], [x + 0.42, 0.3], [x + 0.25, 0.48], [x + 0.55, 0.42], [x + 0.7, 0.3]],
  // r / s — a short wave
  x => [[x + 0.1, 0.45], [x + 0.25, 0.5], [x + 0.3, 0.2], [x + 0.5, 0]],
]

function signature(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: () => number) {
  const pts: Pt[] = []
  // the capital: a big looping stroke that starts below the baseline
  const capH = 1.9 + r() * 0.8
  pts.push([0, -0.2], [0.05, capH * 0.6], [0.35, capH], [0.55, capH * 0.7], [0.2, 0.2], [0.05, 0.15], [0.6, 0.35])
  let cx = 0.62
  const n = 4 + Math.floor(r() * 5)
  for (let i = 0; i < n; i++) {
    const L = LETTERS[Math.floor(r() * LETTERS.length)]
    const lp = L(cx, r)
    pts.push(...lp)
    cx = lp[lp.length - 1][0] + 0.02
    // a second name, sometimes: a lift and a new capital
    if (i === Math.floor(n / 2) && r() < 0.4) {
      cx += 0.35
      pts.push([cx, 1.4 + r() * 0.5], [cx + 0.15, 0], [cx + 0.35, 0.4])
      cx += 0.4
    }
  }
  // the underline flourish
  const fl = r()
  if (fl < 0.5) pts.push([cx + 0.3, 0.2], [cx * 0.6, -0.55], [-0.1, -0.35])
  else if (fl < 0.75) pts.push([cx + 0.5, 0.8])
  const sx = w / (cx + 0.5)
  const sy = h * 0.42
  const slant = 0.28 + r() * 0.2
  g.save()
  g.translate(x, y)
  g.rotate((r() - 0.5) * 0.16)
  g.beginPath()
  const P = pts.map(([px, py]) => [(px + py * slant) * sx, -py * sy] as Pt)
  g.moveTo(P[0][0], P[0][1])
  for (let i = 1; i < P.length - 1; i++) {
    const mx = (P[i][0] + P[i + 1][0]) / 2
    const my = (P[i][1] + P[i + 1][1]) / 2
    g.quadraticCurveTo(P[i][0], P[i][1], mx, my)
  }
  g.lineTo(P[P.length - 1][0], P[P.length - 1][1])
  g.stroke()
  // an i-dot, sometimes
  if (r() < 0.45) {
    g.beginPath()
    g.arc(w * (0.3 + r() * 0.5), -h * (0.55 + r() * 0.2), g.lineWidth * 0.75, 0, Math.PI * 2)
    g.fill()
  }
  g.restore()
}

/** Paint one face of the web: primer-white paint, baked flange shade, bolt holes, marks. */
function paintFace(g: CanvasRenderingContext2D, W: number, H: number, oy: number, seed: number, front: boolean) {
  const r = rng(seed)
  g.save()
  g.translate(0, oy)
  g.beginPath()
  g.rect(0, 0, W, H)
  g.clip()
  // paint + roller streaks
  g.fillStyle = '#eeeae1'
  g.fillRect(0, 0, W, H)
  for (let i = 0; i < 140; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(120,110,95,0.035)' : 'rgba(255,255,255,0.05)'
    g.fillRect(r() * W, r() * H, 60 + r() * 360, 1 + r() * 3)
  }
  // the flanges shade the web near its top and bottom edges
  const sh = g.createLinearGradient(0, 0, 0, H)
  sh.addColorStop(0, 'rgba(40,36,30,0.26)')
  sh.addColorStop(0.12, 'rgba(40,36,30,0)')
  sh.addColorStop(0.86, 'rgba(40,36,30,0)')
  sh.addColorStop(1, 'rgba(40,36,30,0.2)')
  g.fillStyle = sh
  g.fillRect(0, 0, W, H)
  // connection bolt holes at both ends (shear tabs), 4 high
  for (const ex of [34, W - 34]) {
    for (let k = 0; k < 4; k++) {
      const by = H * (0.2 + k * 0.2)
      for (const dx of [-11, 11]) {
        g.fillStyle = '#35322d'
        g.beginPath()
        g.arc(ex + dx, by, 6.5, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = 'rgba(255,255,255,0.35)'
        g.beginPath()
        g.arc(ex + dx - 1.5, by - 1.5, 2.2, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
  // the crew's signatures, everywhere except the clear panel in the middle
  const clear0 = front ? W * 0.3 : W * 2
  const clear1 = front ? W * 0.7 : -1
  let placed = 0
  for (let tries = 0; placed < (front ? 46 : 56) && tries < 900; tries++) {
    const w = 110 + r() * 150
    const h = 26 + r() * 26
    const x = 64 + r() * (W - 128 - w)
    const y = h * 1.0 + r() * (H - h * 1.5)
    if (x + w > clear0 - 10 && x < clear1 + 10) continue
    g.strokeStyle = g.fillStyle = INK[Math.floor(r() * INK.length)]
    g.lineWidth = 1.8 + r() * 2.2
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.globalAlpha = 0.82 + r() * 0.18
    signature(g, x, y, w, h, r)
    placed++
  }
  g.globalAlpha = 1
  if (front) {
    // hand-lettered with a paint marker: SAY HELLO. + the address, and a signal-green underline
    const cx = W * 0.5
    g.save()
    g.translate(cx, H * 0.4)
    g.rotate(-0.022)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `850 ${Math.round(H * 0.5)}px 'Big Shoulders Display Variable', 'Archivo Variable', sans-serif`
    g.fillStyle = '#121212'
    // a marker never lays down one perfect stroke: a few passes, slightly off
    for (let k = 0; k < 4; k++) {
      g.globalAlpha = k === 0 ? 1 : 0.35
      g.fillText('SAY HELLO.', (r() - 0.5) * 2.2, (r() - 0.5) * 2.2)
    }
    g.globalAlpha = 1
    g.restore()
    g.save()
    g.translate(cx + 6, H * 0.82)
    g.rotate(-0.012)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `500 ${Math.round(H * 0.19)}px 'IBM Plex Mono', ui-monospace, monospace`
    g.fillStyle = '#1d2b5c'
    g.fillText('mike@hark.digital', 0, 0)
    g.restore()
    g.strokeStyle = '#00a857'
    g.lineWidth = 5
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(cx - W * 0.12, H * 0.67)
    g.bezierCurveTo(cx - W * 0.04, H * 0.64, cx + W * 0.06, H * 0.69, cx + W * 0.13, H * 0.64)
    g.stroke()
  } else {
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `700 ${Math.round(H * 0.3)}px 'Big Shoulders Display Variable', sans-serif`
    g.fillStyle = '#141414'
    g.globalAlpha = 0.9
    g.fillText('TOPPING OUT · LEVEL 60', W * 0.5, H * 0.5)
    g.globalAlpha = 1
  }
  g.restore()
}

function flagTexture() {
  const cv = document.createElement('canvas')
  cv.width = 380
  cv.height = 200
  const g = cv.getContext('2d')!
  const W = cv.width
  const H = cv.height
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? '#f4f1ea' : '#b22234'
    g.fillRect(0, (i * H) / 13, W, H / 13 + 1)
  }
  const cw = W * 0.4
  const ch = (H * 7) / 13
  g.fillStyle = '#3c3b6e'
  g.fillRect(0, 0, cw, ch)
  g.fillStyle = '#f4f1ea'
  for (let row = 0; row < 9; row++) {
    const n = row % 2 ? 5 : 6
    for (let k = 0; k < n; k++) {
      const x = ((k + (row % 2 ? 1 : 0.5)) / 6) * cw
      const y = ((row + 0.8) / 10.2) * ch
      g.beginPath()
      g.arc(x, y, 2.6, 0, Math.PI * 2)
      g.fill()
    }
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** A small fir: stacked, ragged tiers of needles (vertex-jittered cones). */
function firGeometry(r: () => number) {
  const parts: THREE.BufferGeometry[] = []
  const tiers = 6
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1)
    const rad = THREE.MathUtils.lerp(0.62, 0.14, k)
    const h = THREE.MathUtils.lerp(0.62, 0.42, k)
    const c = new THREE.ConeGeometry(rad, h, 16, 2, true)
    const p = c.attributes.position as THREE.BufferAttribute
    for (let v = 0; v < p.count; v++) {
      const y = p.getY(v)
      if (y > h / 2 - 1e-3) continue
      const j = 1 + (r() - 0.5) * 0.5
      p.setX(v, p.getX(v) * j)
      p.setZ(v, p.getZ(v) * j)
      p.setY(v, y - (y < -h / 2 + 1e-3 ? r() * 0.08 : 0))
    }
    c.computeVertexNormals()
    c.translate(0, 0.32 + k * 1.2 + h / 2, 0)
    parts.push(c)
  }
  const trunk = new THREE.CylinderGeometry(0.045, 0.06, 0.4, 7)
  trunk.translate(0, 0.2, 0)
  parts.push(trunk)
  return mergeAll(parts)
}

/** A cylinder spanning a → b (unit cylinder along +y, scaled/rotated per frame). */
function strut(radius: number, mat: THREE.Material) {
  const g = new THREE.CylinderGeometry(radius, radius, 1, 6, 1, true)
  g.translate(0, 0.5, 0)
  return new THREE.Mesh(g, mat)
}
const _up = new THREE.Vector3(0, 1, 0)
const _d = new THREE.Vector3()
function span(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  _d.subVectors(b, a)
  const len = _d.length()
  m.position.copy(a)
  m.quaternion.setFromUnitVectors(_up, _d.divideScalar(Math.max(len, 1e-5)))
  m.scale.set(1, len, 1)
}

export interface LastBeam {
  load: THREE.Group
  setSlings(on: boolean): void
  setTags(k: number): void
  update(time: number, amt: number): void
}

export function buildBeam(renderer: THREE.WebGLRenderer, mobile: boolean): LastBeam {
  const load = new THREE.Group()
  load.name = 'last-beam'
  const shadows = !mobile

  // ---- the girder: white paint, flanges + web + shear tabs
  const paint = new THREE.MeshStandardMaterial({ color: '#ebe7dd', roughness: 0.5, metalness: 0.12, emissive: '#fff6e8', emissiveIntensity: 0.03 })
  const parts: THREE.BufferGeometry[] = []
  for (const s of [1, -1]) {
    const f = new THREE.BoxGeometry(BEAM_L, TF, BEAM_W)
    f.translate(0, s * (BEAM_D / 2 - TF / 2), 0)
    parts.push(f)
    const tab = new THREE.BoxGeometry(0.014, WEB_H - 0.08, 0.2)
    tab.translate(s * (BEAM_L / 2 - 0.03), 0, 0)
    parts.push(tab)
  }
  parts.push(new THREE.BoxGeometry(BEAM_L, WEB_H, TW))
  const body = new THREE.Mesh(mergeAll(parts), paint)
  body.castShadow = shadows
  body.receiveShadow = shadows
  load.add(body)

  // ---- the painted web faces (one canvas: front strip over back strip)
  const CW = mobile ? 1536 : 2048
  const FH = Math.round((CW * WEB_H) / BEAM_L)
  const cv = document.createElement('canvas')
  cv.width = CW
  cv.height = FH * 2
  const g = cv.getContext('2d')!
  const draw = () => {
    paintFace(g, CW, FH, 0, 71, true)
    paintFace(g, CW, FH, FH, 113, false)
  }
  draw()
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  // repaint once the display faces are in (the canvas can't wait for CSS)
  const fonts = document.fonts
  if (fonts) {
    Promise.all([
      fonts.load(`850 64px 'Big Shoulders Display Variable'`),
      fonts.load(`700 64px 'Big Shoulders Display Variable'`),
      fonts.load(`500 32px 'IBM Plex Mono'`),
    ])
      .then(() => {
        draw()
        tex.needsUpdate = true
      })
      .catch(() => {})
  }
  const faceMat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.55,
    metalness: 0.1,
    emissive: '#ffffff',
    emissiveMap: tex,
    emissiveIntensity: 0.04,
  })
  const faceGeo = (v0: number, v1: number) => {
    const p = new THREE.PlaneGeometry(BEAM_L - 0.03, WEB_H - 0.004)
    const uv = p.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setY(i, THREE.MathUtils.lerp(v0, v1, uv.getY(i)))
    return p
  }
  // canvas y runs down; texture v runs up (flipY): front strip = v 0.5..1
  const front = new THREE.Mesh(faceGeo(0.5, 1), faceMat)
  front.position.z = TW / 2 + 0.002
  front.receiveShadow = shadows
  load.add(front)
  const back = new THREE.Mesh(faceGeo(0, 0.5), faceMat)
  back.rotation.y = Math.PI
  back.position.z = -TW / 2 - 0.002
  back.receiveShadow = shadows
  load.add(back)

  // ---- the tree: a small fir zip-tied to the top flange
  const r = rng(9)
  const fir = new THREE.Mesh(firGeometry(r), new THREE.MeshStandardMaterial({ color: '#2d5a36', roughness: 0.92, metalness: 0, flatShading: true }))
  fir.position.set(-2.2, BEAM_D / 2, 0)
  fir.rotation.y = 0.4
  fir.scale.setScalar(0.78)
  fir.castShadow = shadows
  load.add(fir)

  // ---- the flag on a clamp pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 2.5, 8), MAT.steel())
  pole.position.set(2.35, BEAM_D / 2 + 1.25, 0)
  load.add(pole)
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, BEAM_W + 0.04), MAT.rubber())
  clamp.position.set(2.35, BEAM_D / 2 + 0.06, 0)
  load.add(clamp)
  const flagU = { uTime: { value: 0 }, uAmt: { value: 1 } }
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.8, metalness: 0 })
  flagMat.onBeforeCompile = shader => {
    shader.uniforms.uTime = flagU.uTime
    shader.uniforms.uAmt = flagU.uAmt
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmt;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        // pinned at the pole (uv.x = 0), rippling toward the fly end
        float fu = uv.x;
        float wv = sin(fu * 7.0 - uTime * 5.2 + uv.y * 1.6) * 0.11 + sin(fu * 13.0 - uTime * 8.3) * 0.03;
        transformed.z += wv * fu * uAmt;
        transformed.y -= fu * fu * 0.06 * (1.2 - uAmt * 0.4);`,
      )
  }
  flagMat.customProgramCacheKey = () => 'tower-flag'
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.63, 16, 4), flagMat)
  flag.geometry.translate(0.6, 0, 0)
  flag.position.set(2.37, BEAM_D / 2 + 2.12, 0)
  flag.castShadow = shadows
  load.add(flag)

  // ---- the bridle: two slings from lifting lugs on the top flange to the hook bowl
  const slingMat = new THREE.MeshStandardMaterial({ color: '#1a1c1f', roughness: 0.7, metalness: 0.4 })
  const apex = new THREE.Vector3(0, HANG - 0.72, 0)
  const slings = new THREE.Group()
  for (const s of [-1, 1]) {
    const m = strut(0.028, slingMat)
    span(m, new THREE.Vector3(s * 1.7, BEAM_D / 2, 0), apex)
    slings.add(m)
    const lug = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 6, 12), MAT.steel())
    lug.position.set(s * 1.7, BEAM_D / 2 + 0.06, 0)
    slings.add(lug)
  }
  load.add(slings)

  // ---- tag lines: two ropes trailing from the ends (the crew steers the load with them)
  const tags = new THREE.Group()
  const rope = new THREE.MeshStandardMaterial({ color: '#c9a86a', roughness: 0.9, metalness: 0 })
  const tagLines: THREE.Group[] = []
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(s * (BEAM_L / 2 - 0.25), -BEAM_D / 2, 0)
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(s * 0.15, -2.2, 0.2),
      new THREE.Vector3(s * 0.4, -4.6, 0.5),
      new THREE.Vector3(s * 0.55, -7.2, 0.95),
    ])
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.016, 5), rope)
    pivot.add(tube)
    tags.add(pivot)
    tagLines.push(pivot)
  }
  load.add(tags)

  return {
    load,
    setSlings(on) {
      slings.visible = on
    },
    setTags(k) {
      tags.visible = k > 0.01
      for (const t of tagLines) t.scale.set(1, Math.max(0.01, k), 1)
    },
    update(time, amt) {
      flagU.uTime.value = time
      flagU.uAmt.value = amt
      tagLines.forEach((t, i) => {
        t.rotation.z = Math.sin(time * 0.9 + i * 1.7) * 0.05 * amt
        t.rotation.x = Math.sin(time * 0.7 + i) * 0.06 * amt
      })
    },
  }
}
