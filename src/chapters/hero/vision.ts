import * as THREE from 'three'
import { logoOutlines, logoShapes } from '../../logo/logo'
import { FLOORS, FLOOR_H, TOWER_W, mergeAll } from '../../kit/steel'
import { CROWN_H, CROWN_Y, TOWER_H } from '../../world/tower'
import { PenLines } from './pen'

/*
 * THE VISION — the whole tower drafted in the dawn sky before a single beam
 * exists. The same envelope as the world's blueprint ghost (floor outlines,
 * perimeter grid lines, bracing every five floors, the Hark crown outline),
 * but drawn with a pen: the verticals shoot up, each floor snaps around as the
 * pen passes it, the crown is traced last. Once drawn it hands over to the
 * world's ghost (same geometry) and fades out.
 *
 * Draw clock (uDraw): 0 → 1. The pen reaches the roof at PEN_TOP.
 */

const HALF = TOWER_W / 2
const BAYS = 5
const BAY = TOWER_W / BAYS
/** matches the world's crown outline (src/world/tower.ts buildCrown: sign z 0.2, ghost +0.05) */
const CROWN_C = new THREE.Vector3(0, CROWN_Y + CROWN_H / 2, 0.25)
export const PEN_TOP = 0.8

export function buildVision() {
  const pen = new PenLines()
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
  const at = (y: number) => (y / TOWER_H) * PEN_TOP

  // verticals: every perimeter grid line, one stroke from the ground to the roof
  for (let i = 0; i <= BAYS; i++) {
    for (const j of [0, BAYS]) {
      pen.seg(v(-HALF + i * BAY, 0, -HALF + j * BAY), v(-HALF + i * BAY, TOWER_H, -HALF + j * BAY), 0, PEN_TOP)
      if (i !== 0 && i !== BAYS) pen.seg(v(-HALF + j * BAY, 0, -HALF + i * BAY), v(-HALF + j * BAY, TOWER_H, -HALF + i * BAY), 0, PEN_TOP)
    }
  }
  // floor outlines: each one drawn round as the pen passes (front face first)
  const lap = 0.0042
  for (let f = 0; f <= FLOORS; f++) {
    const y = f * FLOOR_H
    const s = Math.max(0, at(y) - 0.006)
    pen.seg(v(-HALF, y, HALF), v(HALF, y, HALF), s, lap)
    pen.seg(v(HALF, y, HALF), v(HALF, y, -HALF), s + lap, lap)
    pen.seg(v(HALF, y, -HALF), v(-HALF, y, -HALF), s + 2 * lap, lap)
    pen.seg(v(-HALF, y, -HALF), v(-HALF, y, HALF), s + 3 * lap, lap)
  }
  // bracing every five floors, drawn with the rise
  for (let f = 0; f < FLOORS; f += 5) {
    const y0 = f * FLOOR_H
    const y1 = Math.min(TOWER_H, (f + 5) * FLOOR_H)
    const s = at(y0)
    const d = at(y1) - at(y0)
    pen.seg(v(-HALF, y0, HALF), v(HALF, y1, HALF), s, d)
    pen.seg(v(HALF, y0, -HALF), v(-HALF, y1, -HALF), s, d)
    pen.seg(v(HALF, y0, HALF), v(HALF, y1, -HALF), s, d)
    pen.seg(v(-HALF, y0, -HALF), v(-HALF, y1, HALF), s, d)
  }
  // the crown's sign frame posts, as the world's ghost draws them
  for (const x of [-9, 9]) pen.seg(v(x, TOWER_H, 0), v(x, CROWN_Y + CROWN_H, 0), PEN_TOP, 0.1)
  const ghost = pen.build({ opacity: 0.42, head: 2.6 })

  // the crown: every contour of the Hark mark traced at once, last
  const crownPen = new PenLines()
  for (const line of logoOutlines(logoShapes(), 120)) {
    const pts = line.map(p => new THREE.Vector3(CROWN_C.x + p.x * CROWN_H, CROWN_C.y + p.y * CROWN_H, CROWN_C.z))
    crownPen.poly(pts, PEN_TOP + 0.02, 0.16)
  }
  const crown = crownPen.build({ opacity: 0.8, head: 2.2 })

  // drafting furniture: a height dimension up the left edge with a tick every ten
  // floors, extension lines, and the base width across the front
  const dim = new PenLines()
  const dx = -HALF - 7
  const dz = HALF
  dim.seg(v(dx, 0, dz), v(dx, TOWER_H, dz), 0.02, PEN_TOP)
  for (let f = 0; f <= FLOORS; f += 10) {
    const y = f * FLOOR_H
    const s = 0.02 + at(y)
    // architectural slash tick + an extension line back to the envelope
    dim.seg(v(dx - 0.9, y - 0.9, dz), v(dx + 0.9, y + 0.9, dz), s, 0.01)
    dim.seg(v(dx - 1.2, y, dz), v(-HALF - 0.8, y, dz), s, 0.02)
  }
  const bz = HALF + 7
  dim.seg(v(-HALF, 0.06, bz), v(HALF, 0.06, bz), 0.0, 0.12)
  for (let i = 0; i <= BAYS; i++) {
    const x = -HALF + i * BAY
    dim.seg(v(x - 0.7, 0.06, bz + 0.7), v(x + 0.7, 0.06, bz - 0.7), 0.02 * i, 0.01)
    dim.seg(v(x, 0.06, bz + 1.2), v(x, 0.06, HALF + 0.8), 0.02 * i, 0.03)
  }
  const dims = dim.build({ opacity: 0.55, head: 1.6 })

  const preview = buildPreview()

  const group = new THREE.Group()
  group.name = 'hero-vision'
  group.add(ghost, crown, dims, preview.glass, preview.crown)
  return { group, ghost, crown, dims, preview }
}

/*
 * THE PREVIEW — once the pen has drafted it, the drawing becomes the building:
 * the finished curtain wall as a developer's render, standing over the real
 * site. The same unitised wall as the world tower (1.545 m units, transoms,
 * spandrel bands, a hair of tilt per unit so reflections break up pane by
 * pane), but translucent: the dawn shows through the vision glass while the
 * sky reflects off it. The crown is the Hark mark, unlit, on its frame.
 *
 *   uFade   0..1 overall
 *   uBase   metres: the glass starts here (clear of the real steel + core)
 *   uRise   metres: the render sweeps up the tower to here (the reveal)
 */
const GLASS_OUT = 0.45
const GH = HALF + GLASS_OUT
const MOD = (GH * 2) / 20

export type Preview = ReturnType<typeof buildPreview>

function buildPreview() {
  // four faces, outward normals; uv = metres along the face / height
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const face = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
    const w = GH * 2
    const quad = [
      [ax, 0, az, 0, 0],
      [bx, 0, bz, w, 0],
      [bx, TOWER_H, bz, w, TOWER_H],
      [ax, 0, az, 0, 0],
      [bx, TOWER_H, bz, w, TOWER_H],
      [ax, TOWER_H, az, 0, TOWER_H],
    ]
    for (const [x, y, z, u, v] of quad) {
      pos.push(x, y, z)
      nrm.push(nx, 0, nz)
      uv.push(u, v)
    }
  }
  face(-GH, GH, GH, GH, 0, 1)
  face(GH, GH, GH, -GH, 1, 0)
  face(GH, -GH, -GH, -GH, 0, -1)
  face(-GH, -GH, -GH, GH, -1, 0)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.computeBoundingSphere()

  const u = {
    uFade: { value: 0 },
    uBase: { value: 10 },
    uRise: { value: TOWER_H + 40 },
    uReflect: { value: 0.8 },
  }
  const mat = new THREE.MeshStandardMaterial({
    color: '#5f7b8c',
    metalness: 0.92,
    roughness: 0.06,
    envMapIntensity: 1.25,
    transparent: true,
    depthWrite: false,
    // the output is written premultiplied (below): reflection adds, the vision
    // glass only dims what's behind it by its own coverage
    premultipliedAlpha: true,
  })
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPvUv;\nvarying vec3 vPvT;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPvUv = uv;
        vPvT = normalize(mat3(modelMatrix) * vec3(normal.z, 0.0, -normal.x));`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uFade, uBase, uRise, uReflect;
        varying vec2 vPvUv;
        varying vec3 vPvT;
        float pvHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float pvLine(float d, float w) { float fw = max(fwidth(d), 1e-4); return 1.0 - smoothstep(w - fw, w + fw, d); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // unit coordinates: 1.545 m units, one floor tall
        vec2 cell = floor(vPvUv / vec2(${MOD.toFixed(4)}, ${FLOOR_H.toFixed(1)}));
        vec2 pu = vPvUv - cell * vec2(${MOD.toFixed(4)}, ${FLOOR_H.toFixed(1)});
        float paneH = pvHash(cell * vec2(0.37, 1.13) + vPvT.xz * 7.1);
        float mull = max(pvLine(min(pu.x, ${MOD.toFixed(4)} - pu.x), 0.05), max(pvLine(abs(pu.y - 0.62), 0.035), pvLine(abs(pu.y - 3.52), 0.035)));
        mull = max(mull, pvLine(min(pu.y, ${FLOOR_H.toFixed(1)} - pu.y), 0.035));
        // the corners read as the edge of the volume
        mull = max(mull, pvLine(min(vPvUv.x, ${(GH * 2).toFixed(3)} - vPvUv.x), 0.09));
        float spand = 1.0 - step(0.62, pu.y) * step(pu.y, 3.52);
        float vision = (1.0 - spand) * (1.0 - mull);
        diffuseColor.rgb = mix(diffuseColor.rgb * (0.94 + 0.12 * paneH), diffuseColor.rgb * vec3(0.6, 0.62, 0.64), spand);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.08, 0.09), mull);
        // coverage: the vision glass is a tint, spandrels and frames are solid-ish
        float y = vPvUv.y;
        float mask = smoothstep(uBase, uBase + 8.0, y) * (1.0 - smoothstep(uRise - 10.0, uRise, y));
        float cover = mix(mix(0.42, 0.64, spand), 0.84, mull);
        diffuseColor.a = cover * mask * uFade;
        float pvK = mask * uFade;
        // the render's leading edge while it sweeps up the tower
        float pvEdge = (1.0 - smoothstep(0.0, 3.0, abs(y - uRise + 4.0))) * step(uRise, ${(TOWER_H + 20).toFixed(1)}) * uFade;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(0.04 + 0.05 * paneH, 0.18, spand), 0.45, mull);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(0.94, 0.5, mull);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 tilt = vPvT * (paneH - 0.5) * 0.05 + up * (pvHash(cell.yx + 3.7) - 0.5) * 0.035;
          vec2 c = (pu - vec2(${(MOD / 2).toFixed(3)}, 2.07)) / vec2(${(MOD / 2).toFixed(3)}, 1.45);
          tilt += (vPvT * c.x * 0.018 + up * c.y * 0.01) * vision;
          normal = normalize(normal + (viewMatrix * vec4(tilt, 0.0)).xyz);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.45, 0.85, 1.2) * pvEdge * 1.4;`,
      )
      .replace('#include <premultiplied_alpha_fragment>', 'gl_FragColor.rgb *= uReflect * pvK + pvEdge;')
  }
  mat.customProgramCacheKey = () => 'hero-preview-glass'
  const glass = new THREE.Mesh(g, mat)
  glass.name = 'hero-preview'
  glass.renderOrder = 2

  // the crown: the Hark mark unlit on its steel frame
  const parts: THREE.BufferGeometry[] = []
  for (const x of [-9, -3, 3, 9]) parts.push(new THREE.BoxGeometry(0.5, CROWN_H + 4, 0.5).translate(x, CROWN_Y + (CROWN_H + 4) / 2 - 2.5, -1.2))
  for (const y of [CROWN_Y + 1, CROWN_Y + CROWN_H * 0.5, CROWN_Y + CROWN_H - 1]) parts.push(new THREE.BoxGeometry(19, 0.4, 0.4).translate(0, y, -1.2))
  const sign = new THREE.ShapeGeometry(logoShapes(), 12)
  sign.scale(CROWN_H, CROWN_H, 1).translate(CROWN_C.x, CROWN_C.y, 0.2)
  parts.push(sign)
  const crownMat = new THREE.MeshBasicMaterial({ color: '#161a1f', transparent: true, opacity: 0, depthWrite: false })
  const crown = new THREE.Mesh(mergeAll(parts), crownMat)
  crown.name = 'hero-preview-crown'
  crown.renderOrder = 3

  const set = (fade: number, base: number, rise: number) => {
    u.uFade.value = fade
    u.uBase.value = base
    u.uRise.value = rise
    crownMat.opacity = 0.88 * fade * THREE.MathUtils.smoothstep(rise, TOWER_H, TOWER_H + 12)
    glass.visible = fade > 0.003
    crown.visible = crownMat.opacity > 0.003
  }
  return { glass, crown, set }
}
