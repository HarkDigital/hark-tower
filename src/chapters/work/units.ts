import * as THREE from 'three'
import { MAT, T, TOWER_W, iBeamGeometry, mergeAll } from '../../kit/steel'

/*
 * Steel (work) — the 3D pieces: unitised curtain-wall units that carry a
 * client's site on their vision glass, the crane's lifting rig, the A-frame
 * stillage they wait in on the ground, and the cyan slot marks drawn on the
 * facade where each one is set.
 *
 * Units are metres. A unit is one bay wide (6 m, column line to column line)
 * and one storey tall (4 m); its vision glass is 5.6 x 3.5 m — the 1.6:1 of
 * the 1280 x 800 screenshots, so nothing is cropped.
 */

/** unit outer size, vision glass size, frame depth */
export const PW = 6
export const PH = 4
export const GW = 5.6
export const GH = 3.5
export const PD = 0.3
/** the facade: the tower's glass line is HALF + 0.45; units stand just proud of it */
export const FACE_Z = TOWER_W / 2 + 0.45
export const UNIT_Z = FACE_Z + PD / 2 + 0.14
/** hook → spreader bar (V slings) and spreader → unit top (vertical slings) */
export const V_DROP = 2.2
export const S_DROP = 1.2
/** hook (pivot) to unit centre */
export const HANG = V_DROP + S_DROP + PH / 2
const LUG_X = 2.2

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

/** Frame, back pan, pressure caps, anchor brackets and lifting lugs — one merged geometry. */
export function frameGeometry(mobile: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const jw = (PW - GW) / 2
  const hh = (PH - GH) / 2
  // jambs, head, sill
  parts.push(box(jw, PH, PD, -PW / 2 + jw / 2, 0, 0), box(jw, PH, PD, PW / 2 - jw / 2, 0, 0))
  parts.push(box(PW - 2 * jw, hh, PD, 0, PH / 2 - hh / 2, 0), box(PW - 2 * jw, hh, PD, 0, -PH / 2 + hh / 2, 0))
  // the back pan (so the unit is opaque from behind, e.g. on the stillage)
  parts.push(box(GW, GH, 0.05, 0, 0, -PD / 2 + 0.04))
  // pressure caps: proud strips on the frame face — they give the unit its depth
  const cz = PD / 2 + 0.03
  parts.push(box(0.1, PH, 0.06, -PW / 2 + jw / 2, 0, cz), box(0.1, PH, 0.06, PW / 2 - jw / 2, 0, cz))
  parts.push(box(PW, 0.1, 0.06, 0, PH / 2 - hh / 2, cz), box(PW, 0.1, 0.06, 0, -PH / 2 + hh / 2, cz))
  if (!mobile) {
    // stack joint: a thin horizontal gasket line at the head, like a real unitised system
    parts.push(box(PW, 0.035, 0.02, 0, PH / 2 - 0.02, cz + 0.035))
  }
  // anchor brackets at the head (they hook onto the slab edge) and at the sill
  for (const sx of [-1, 1]) {
    parts.push(box(0.46, 0.16, 0.42, sx * (PW / 2 - 0.55), PH / 2 - 0.1, -PD / 2 - 0.2))
    parts.push(box(0.36, 0.12, 0.3, sx * (PW / 2 - 0.55), -PH / 2 + 0.08, -PD / 2 - 0.14))
    // lifting lugs on the head
    parts.push(box(0.1, 0.26, 0.1, sx * LUG_X, PH / 2 + 0.13, 0))
    parts.push(box(0.26, 0.08, 0.1, sx * LUG_X, PH / 2 + 0.26, 0))
  }
  return mergeAll(parts)
}

export interface ShotUniforms {
  uSheen: { value: number }
  uSky: { value: THREE.Color }
  uGround: { value: THREE.Color }
  uGlint: { value: number }
}

/**
 * The vision glass: the screenshot seen through a pane of tinted glass. A
 * plain MeshBasicMaterial (tone-mapped, colour 0.9 so it never blooms) that
 * reads as glass rather than a screen:
 *  - the site sits a little behind the glass, cool-tinted and shaded in from
 *    the frame it is set into;
 *  - the pane reflects the sky above the horizon and the ground below it,
 *    along the real reflected view ray (so the reflection slides as the
 *    camera moves), weak face-on and strong at grazing angles (Schlick);
 *  - the reflected skyline breaks the horizon into building silhouettes;
 *  - two soft diagonal streaks of sky light; uGlint slides them across as the
 *    unit turns on the cable or is set.
 * Kept faint face-on so the client's site stays legible.
 */
export function shotMaterial(map: THREE.Texture): { mat: THREE.MeshBasicMaterial; u: ShotUniforms } {
  const mat = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(0.9, 0.9, 0.9), toneMapped: true })
  const u: ShotUniforms = {
    uSheen: { value: 1 },
    uSky: { value: new THREE.Color('#9fbad6') },
    uGround: { value: new THREE.Color('#5d554c') },
    uGlint: { value: -1 },
  }
  mat.onBeforeCompile = sh => {
    sh.uniforms.uSheen = u.uSheen
    sh.uniforms.uSky = u.uSky
    sh.uniforms.uGround = u.uGround
    sh.uniforms.uGlint = u.uGlint
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vReflW;\nvarying float vCosV;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 gW = modelMatrix * vec4(transformed, 1.0);
        vec3 gN = normalize(mat3(modelMatrix) * normal);
        vec3 gI = normalize(gW.xyz - cameraPosition);
        vReflW = reflect(gI, gN);
        vCosV = clamp(abs(dot(gN, gI)), 0.0, 1.0);`,
      )
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uSheen;\nuniform vec3 uSky;\nuniform vec3 uGround;\nuniform float uGlint;\nvarying vec3 vReflW;\nvarying float vCosV;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          vec2 gUv = vMapUv;
        #else
          vec2 gUv = vec2(0.5);
        #endif
        // behind the glass: a cool tint, shaded in from the deep frame
        vec2 gE = min(gUv, 1.0 - gUv);
        float gIn = smoothstep(0.0, 0.028, gE.x) * smoothstep(0.0, 0.04, gE.y);
        diffuseColor.rgb *= vec3(0.88, 0.93, 0.96) * mix(0.55, 1.0, gIn);
        // on the glass: the reflected sky / skyline / ground along the reflected ray
        vec3 gR = normalize(vReflW);
        vec3 gHz = mix(uSky, vec3(1.0, 0.96, 0.9), 0.45);
        vec3 gRef = mix(gHz, uSky * 0.8, smoothstep(0.0, 0.55, gR.y));
        float gAz = atan(gR.x, gR.z + 1e-4);
        float gCell = floor(gAz * 14.0);
        float gTop = 0.02 + 0.13 * fract(sin(gCell * 91.7 + 3.1) * 43758.5);
        float gBld = 1.0 - smoothstep(gTop - 0.006, gTop, gR.y);
        gRef = mix(gRef, mix(uGround, gHz, 0.35), gBld * 0.75);
        gRef = mix(gRef, uGround * 0.85, 1.0 - smoothstep(-0.3, -0.02, gR.y));
        float gF = 0.05 + 0.95 * pow(1.0 - vCosV, 5.0);
        float gK = uSheen * clamp(0.11 + 0.9 * gF, 0.0, 0.72);
        float gx = gUv.x * 0.8 + gUv.y * 0.45 - uGlint;
        float gx2 = gx + 0.3;
        float gStreak = exp(-gx * gx * 60.0) + 0.5 * exp(-gx2 * gx2 * 300.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, gRef, gK) + gHz * gStreak * 0.13 * uSheen;`,
      )
  }
  mat.customProgramCacheKey = () => 'tower-work-glass'
  return { mat, u }
}

/**
 * Unit frames: clear-anodised aluminium (a unitised system's extrusions),
 * a shade lighter than the tower's graphite mullions so a freshly set unit
 * reads as a framed pane of glass, not a black-bezelled screen. Same program
 * as MAT.mullion (a plain MeshStandardMaterial), so it adds no compile.
 */
let frameMat: THREE.MeshStandardMaterial | null = null
export function unitFrameMaterial(): THREE.MeshStandardMaterial {
  frameMat ??= new THREE.MeshStandardMaterial({ color: '#737d86', metalness: 0.85, roughness: 0.3 })
  return frameMat
}

export interface Unit {
  root: THREE.Group
  shot: THREE.Mesh
  shotMat: THREE.MeshBasicMaterial
  u: ShotUniforms
}

export function buildUnit(frameGeo: THREE.BufferGeometry, map: THREE.Texture, mobile: boolean): Unit {
  const root = new THREE.Group()
  const frame = new THREE.Mesh(frameGeo, unitFrameMaterial())
  frame.castShadow = !mobile
  frame.receiveShadow = !mobile
  root.add(frame)
  const { mat, u } = shotMaterial(map)
  const shot = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH), mat)
  // the glass sits a little back from the frame face (real units have depth)
  shot.position.z = PD / 2 - 0.05
  shot.castShadow = !mobile
  root.add(shot)
  return { root, shot, shotMat: mat, u }
}

/**
 * A designed stand-in for a client's screenshot, for browsers that cannot
 * decode the WebP (Safari 14–15 on macOS 10.15): a dark display panel with
 * the unit tag, the industry, the client's name set large, a signal-green
 * rule and the address — legible through the glass. 1.6:1 like the
 * screenshots, so it fills the vision glass exactly.
 */
export async function paneFallbackTexture(o: { name: string; industry: string; host: string; tag: string; preview: boolean }): Promise<THREE.Texture> {
  const DISPLAY = '"Big Shoulders Display Variable", "Archivo Variable", "Arial Narrow", sans-serif'
  const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace'
  try {
    await Promise.all([document.fonts?.load(`700 120px ${DISPLAY}`), document.fonts?.load(`500 24px ${MONO}`)])
  } catch {
    /* draw with the fallbacks */
  }
  const W = 960
  const H = 600
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')!
  // panel: a deep blue-graphite field with a faint drawing grid
  const bg = x.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#1a2632')
  bg.addColorStop(1, '#0b1117')
  x.fillStyle = bg
  x.fillRect(0, 0, W, H)
  x.lineWidth = 1
  for (let gx = 0; gx <= W; gx += 40) {
    x.strokeStyle = gx % 200 === 0 ? 'rgba(126, 192, 255, 0.1)' : 'rgba(126, 192, 255, 0.045)'
    x.beginPath()
    x.moveTo(gx + 0.5, 0)
    x.lineTo(gx + 0.5, H)
    x.stroke()
  }
  for (let gy = 0; gy <= H; gy += 40) {
    x.strokeStyle = gy % 200 === 0 ? 'rgba(126, 192, 255, 0.1)' : 'rgba(126, 192, 255, 0.045)'
    x.beginPath()
    x.moveTo(0, gy + 0.5)
    x.lineTo(W, gy + 0.5)
    x.stroke()
  }
  // letter-spaced mono (canvas letterSpacing is too new for the browsers this is for)
  const measure = (s: string, track: number) => {
    let w = -track
    for (const ch of s) w += x.measureText(ch).width + track
    return w
  }
  const spaced = (s: string, px: number, py: number, track: number, align: 'left' | 'right' = 'left') => {
    const w = measure(s, track)
    let cx = align === 'right' ? px - w : px
    for (const ch of s) {
      x.fillText(ch, cx, py)
      cx += x.measureText(ch).width + track
    }
    return w
  }
  const L = 72
  x.textBaseline = 'alphabetic'
  // head: the unit tag on a yellow chip, the status at the right
  x.font = `500 22px ${MONO}`
  const tagW = measure(o.tag.toUpperCase(), 3)
  x.fillStyle = '#f2b705'
  x.fillRect(L, 64, tagW + 24, 38)
  x.fillStyle = '#0e1114'
  spaced(o.tag.toUpperCase(), L + 12, 91, 3)
  if (o.preview) {
    x.font = `500 20px ${MONO}`
    x.strokeStyle = '#00ff85'
    x.lineWidth = 2
    const pw = measure('PREVIEW', 3)
    x.strokeRect(W - L - pw - 24, 65, pw + 24, 36)
    x.fillStyle = '#00ff85'
    spaced('PREVIEW', W - L - 12, 90, 3, 'right')
  }
  // the name set as large as fits (two lines at most), the industry above it
  const name = o.name.toUpperCase()
  const maxW = W - 2 * L
  let size = 132
  let lines = [name]
  const fits = (ls: string[]) => ls.every(l => x.measureText(l).width <= maxW)
  for (; size >= 64; size -= 4) {
    x.font = `700 ${size}px ${DISPLAY}`
    if (fits([name])) {
      lines = [name]
      break
    }
    // the most even two-line break that fits
    const words = name.split(' ')
    const uneven = (p: string[]) => Math.abs(x.measureText(p[0]).width - x.measureText(p[1]).width)
    let best: string[] | null = null
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
      if (fits(pair) && (!best || uneven(pair) < uneven(best))) best = pair
    }
    if (best && size <= 116) {
      lines = best
      break
    }
  }
  const lh = size * 0.9
  // centre the block (industry, name, rule, address) in the space under the head
  const block = 24 + 24 + size * 0.78 + (lines.length - 1) * lh + 34 + 6 + 52
  const top = Math.max(128, 128 + (H - 40 - 128 - block) / 2)
  x.font = `500 24px ${MONO}`
  x.fillStyle = '#9fb3c4'
  spaced(o.industry.toUpperCase(), L, top + 24, 4)
  x.font = `700 ${size}px ${DISPLAY}`
  x.fillStyle = '#f4f1ea'
  let base = top + 48 + size * 0.78
  lines.forEach((l, i) => {
    if (i) base += lh
    x.fillText(l, L - 2, base)
  })
  // a signal-green rule, then the address
  const ry = base + 34
  x.fillStyle = '#00ff85'
  x.fillRect(L, ry, 120, 6)
  x.font = `500 24px ${MONO}`
  x.fillStyle = '#c9d3db'
  spaced(o.host, L, ry + 58, 2)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/**
 * The lifting rig that hangs from the crane hook: two slings in a V to a
 * yellow spreader bar, then two vertical slings down to the unit's lugs.
 * Origin = the hook's eye; the unit centre hangs HANG below it.
 */
export function buildRig(mobile: boolean): THREE.Group {
  const g = new THREE.Group()
  const slings: THREE.BufferGeometry[] = []
  const r = 0.045
  const seg = (a: THREE.Vector3, b: THREE.Vector3) => {
    const L = a.distanceTo(b)
    const c = new THREE.CylinderGeometry(r, r, L, 5, 1)
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
    const m = a.clone().add(b).multiplyScalar(0.5)
    c.translate(m.x, m.y, m.z)
    slings.push(c)
  }
  const top = new THREE.Vector3(0, -0.25, 0)
  for (const sx of [-1, 1]) {
    seg(top, new THREE.Vector3(sx * LUG_X, -V_DROP, 0))
    seg(new THREE.Vector3(sx * LUG_X, -V_DROP, 0), new THREE.Vector3(sx * LUG_X, -V_DROP - S_DROP + 0.02, 0))
  }
  const sl = new THREE.Mesh(mergeAll(slings), MAT.rubber())
  g.add(sl)
  const bar = new THREE.Mesh(iBeamGeometry(LUG_X * 2 + 0.6, { depth: 0.32, width: 0.2 }), MAT.craneYellow())
  bar.position.set(-LUG_X - 0.3, -V_DROP, 0)
  bar.castShadow = !mobile
  g.add(bar)
  return g
}

/**
 * An A-frame glass stillage (the rack units are delivered in): a skid of two
 * beams, three A-frames, a ridge and a toe ledge on the +z face where the
 * units lean back 8 degrees, outermost first.
 */
export const RACK_LEAN = (8 * Math.PI) / 180
export const RACK_STEP = 0.36
export function rackGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const L = 7.2
  // skid beams along x
  for (const z of [-1.3, 1.3]) {
    const b = iBeamGeometry(L, { depth: 0.3, width: 0.18 })
    b.translate(-L / 2, 0.15, z)
    parts.push(b)
  }
  // cross members
  for (const x of [-3.2, 0, 3.2]) parts.push(box(0.16, 0.16, 2.8, x, 0.32, 0))
  // A-frames: front leg leans back by RACK_LEAN, rear leg mirrors it
  const H = 4.1
  for (const x of [-3.2, 0, 3.2]) {
    for (const s of [1, -1]) {
      const leg = new THREE.BoxGeometry(0.14, H / Math.cos(RACK_LEAN), 0.14)
      leg.rotateX(-s * RACK_LEAN)
      leg.translate(x, 0.4 + H / 2, s * (0.62 - (H / 2) * Math.tan(RACK_LEAN)))
      parts.push(leg)
    }
  }
  // ridge + mid rail + toe ledge
  parts.push(box(L, 0.14, 0.14, 0, 0.4 + H, 0))
  parts.push(box(L, 0.1, 0.1, 0, 0.4 + H * 0.5, 0.62 - H * 0.5 * Math.tan(RACK_LEAN) + 0.04))
  parts.push(box(L, 0.14, 2.5, 0, 0.42, 1.85))
  // toe stop at the outer edge
  parts.push(box(L, 0.22, 0.12, 0, 0.56, 3.05))
  return mergeAll(parts)
}

/** Where unit `slot` (0 = outermost) leans on a stillage whose origin is at `origin`. */
export function rackPose(slot: number, origin: THREE.Vector3, outPos: THREE.Vector3, outQuat: THREE.Quaternion) {
  // the unit's back pan rests against the front legs, stacked outward
  const lean = RACK_LEAN
  const back = 0.62 + PD / 2 + 0.06 + (5 - slot) * RACK_STEP
  const baseY = 0.5
  outPos.set(origin.x, origin.y + baseY + (PH / 2) * Math.cos(lean), origin.z + back - (PH / 2) * Math.sin(lean))
  outQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -lean)
}

/**
 * The slot on the facade drawn as a blueprint opening: a rectangle with the
 * glazing X, plus two dimension lines (width above, height at the side).
 * uDraw reveals it from the bottom up, uOpacity fades it.
 */
export function slotMark(): { lines: THREE.LineSegments; u: { uDraw: { value: number }; uOpacity: { value: number } } } {
  const p: number[] = []
  const s = (ax: number, ay: number, bx: number, by: number) => p.push(ax, ay, 0, bx, by, 0)
  const w = PW / 2
  const h = PH / 2
  // the opening
  s(-w, -h, w, -h)
  s(w, -h, w, h)
  s(w, h, -w, h)
  s(-w, h, -w, -h)
  // the glazing X (drafting convention for a glazed opening), inset
  s(-w + 0.4, -h + 0.4, w - 0.4, h - 0.4)
  s(-w + 0.4, h - 0.4, w - 0.4, -h + 0.4)
  // width dimension, 0.7 m above
  const dy = h + 0.7
  s(-w, dy, w, dy)
  s(-w, dy - 0.25, -w, dy + 0.25)
  s(w, dy - 0.25, w, dy + 0.25)
  s(-w - 0.15, dy - 0.15, -w + 0.15, dy + 0.15)
  s(w - 0.15, dy - 0.15, w + 0.15, dy + 0.15)
  // extension lines
  s(-w, h + 0.12, -w, dy + 0.12)
  s(w, h + 0.12, w, dy + 0.12)
  // height dimension, 0.7 m to the side
  const dx = w + 0.7
  s(dx, -h, dx, h)
  s(dx - 0.25, -h, dx + 0.25, -h)
  s(dx - 0.25, h, dx + 0.25, h)
  s(dx - 0.15, -h - 0.15, dx + 0.15, -h + 0.15)
  s(dx - 0.15, h - 0.15, dx + 0.15, h + 0.15)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  const u = { uDraw: { value: 0 }, uOpacity: { value: 0 } }
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
    uniforms: { uColor: { value: new THREE.Color(T.line) }, ...u },
    vertexShader: /* glsl */ `
      varying float vY;
      void main() { vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uDraw, uOpacity; varying float vY;
      void main() {
        float h = (vY + ${(h + 0.1).toFixed(2)}) / ${(PH + 1.2).toFixed(2)};
        float a = (1.0 - smoothstep(uDraw - 0.04, uDraw, h)) * uOpacity;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(uColor * a * 1.4, 1.0);
      }
    `,
  })
  const lines = new THREE.LineSegments(g, mat)
  lines.frustumCulled = false
  return { lines, u }
}

/** Four small hot bolts at a unit's anchor brackets — they glow briefly after the bolt-up. */
export function boltGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (const [x, y] of [
    [-(PW / 2 - 0.55), PH / 2 - 0.1],
    [PW / 2 - 0.55, PH / 2 - 0.1],
    [-(PW / 2 - 0.55), -PH / 2 + 0.08],
    [PW / 2 - 0.55, -PH / 2 + 0.08],
  ]) {
    const s = new THREE.SphereGeometry(0.07, 10, 6)
    s.translate(x, y, PD / 2 + 0.07)
    parts.push(s)
  }
  return mergeAll(parts)
}

/** Bolt-up points (unit-local) for the spark bursts. */
export const BOLT_POINTS: [number, number][] = [
  [-(PW / 2 - 0.55), PH / 2 - 0.1],
  [PW / 2 - 0.55, PH / 2 - 0.1],
  [-(PW / 2 - 0.55), -PH / 2 + 0.08],
  [PW / 2 - 0.55, -PH / 2 + 0.08],
]
