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
  uGlint: { value: number }
}

/**
 * The vision glass: the screenshot seen through a pane of glass. A plain
 * MeshBasicMaterial (tone-mapped, colour 0.9 so it never blooms) with a thin
 * sky reflection that grows at grazing angles and a glint band that runs
 * across the pane as the unit turns on the cable.
 */
export function shotMaterial(map: THREE.Texture): { mat: THREE.MeshBasicMaterial; u: ShotUniforms } {
  const mat = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(0.9, 0.9, 0.9), toneMapped: true })
  const u: ShotUniforms = {
    uSheen: { value: 1 },
    uSky: { value: new THREE.Color('#9fbad6') },
    uGlint: { value: -1 },
  }
  mat.onBeforeCompile = sh => {
    sh.uniforms.uSheen = u.uSheen
    sh.uniforms.uSky = u.uSky
    sh.uniforms.uGlint = u.uGlint
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFres;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec3 fN = normalize(normalMatrix * normal);
        vec3 fV = normalize(-mvPosition.xyz);
        float fd = 1.0 - clamp(abs(dot(fN, fV)), 0.0, 1.0);
        vFres = fd * fd;`,
      )
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uSheen;\nuniform vec3 uSky;\nuniform float uGlint;\nvarying float vFres;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          float gx = vMapUv.x * 0.8 + vMapUv.y * 0.45 - uGlint;
          float glint = exp(-gx * gx * 70.0);
        #else
          float glint = 0.0;
        #endif
        float refl = uSheen * (0.04 + 0.55 * vFres);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSky, refl) + uSky * glint * 0.16 * uSheen;`,
      )
  }
  mat.customProgramCacheKey = () => 'tower-work-shot'
  return { mat, u }
}

export interface Unit {
  root: THREE.Group
  shot: THREE.Mesh
  shotMat: THREE.MeshBasicMaterial
  u: ShotUniforms
}

export function buildUnit(frameGeo: THREE.BufferGeometry, map: THREE.Texture, mobile: boolean): Unit {
  const root = new THREE.Group()
  const frame = new THREE.Mesh(frameGeo, MAT.mullion())
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
