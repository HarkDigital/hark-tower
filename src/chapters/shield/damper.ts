import * as THREE from 'three'
import { MAT, T, iBeamGeometry, mergeAll } from '../../kit/steel'

/*
 * THE TUNED MASS DAMPER — a polished steel sphere (stacked plates, like the
 * real ones) hung on four cable bundles from two plate girders, passing
 * through a ring frame set into the floor, with eight hydraulic dampers laid
 * round it in a pinwheel between the sphere's band and the ring.
 *
 * It lives in the corner bay of the 6 m grid (x 9..15, z 9..15), centred on
 * the floor-45 level (y 180) so the ONE slab it passes through is hidden
 * under the ring frame + a dark floor opening, and it clears every beam and
 * column of the frame (the bay limits it to Ø5.4 m — the size of the real
 * thing in the tallest towers). The cables hang from girders under floor
 * 46's top beams, through the floor-45 storey.
 *
 *   frame   fixed to the building (ring frame, opening, hanger girders):
 *           moved by the tower's own sway at this height
 *   mass    the sphere + its band and cap ring: tower sway + counter-swing
 *   dampers + cables are re-posed every frame between the two.
 *
 * `fill` sweeps the solid in from the bottom up (the blueprint drawing is
 * "filled in by steel"); the cyan ghost linework shows only above the sweep.
 */

export const TMD = { x: 12, y: 180, z: 12, r: 2.7 } as const
const R = TMD.r
/** the fixed ring frame in the floor */
const RING_IN = R + 0.3
const RING_OUT = 3.32
const RING_H = 0.62
/** the sphere's damper band (a little above the equator, over the ring frame) */
const BAND_Y = 0.62
const BAND_R = Math.sqrt(R * R - BAND_Y * BAND_Y) + 0.03
/** hanger girders under floor 46's top beams (187.75) */
const GIRDER_D = 0.7
const HANG_Y = 187.75 - 0.3 - GIRDER_D / 2 - TMD.y
const HANG_Z = 0.95
const CAP_R = 1.1
const CAP_Y = Math.sqrt(R * R - CAP_R * CAP_R) + 0.04
const BAY = 3
/** the floor-45 concrete tops out 0.08 above the level; the opening sits over it */
const FLOOR_TOP = 0.1

export interface FillUniforms {
  uFill: { value: number }
  uEdge: { value: THREE.Color }
  uEdgeOn: { value: number }
}

type Src = { vertexShader: string; fragmentShader: string }

/**
 * Patch a standard material: discard above the fill height (world y) and add
 * a hot cyan seam at the sweep front.
 */
function fillPatch(mat: THREE.MeshStandardMaterial, u: FillUniforms, key: string, extra?: (s: Src) => void) {
  mat.onBeforeCompile = shader => {
    shader.uniforms.uFill = u.uFill
    shader.uniforms.uEdge = u.uEdge
    shader.uniforms.uEdgeOn = u.uEdgeOn
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFillY;\nvarying vec3 vTmdLocal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fwp = instanceMatrix * fwp;
        #endif
        vFillY = (modelMatrix * fwp).y;
        vTmdLocal = transformed;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vFillY;\nvarying vec3 vTmdLocal;\nuniform float uFill;\nuniform vec3 uEdge;\nuniform float uEdgeOn;',
      )
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (vFillY > uFill) discard;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float fd = (uFill - vFillY) * 3.5;
        totalEmissiveRadiance += uEdge * exp(-fd * fd) * uEdgeOn;`,
      )
    extra?.(shader)
  }
  mat.customProgramCacheKey = () => `tmd-${key}`
}

/** stacked-plate seams + fake local reflections (the frame round it, the city below) */
function sphereExtras(s: Src) {
  s.fragmentShader = s.fragmentShader
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      {
        float bandP = (vTmdLocal.y + ${R.toFixed(2)}) / 0.3;
        float bandF = fract(bandP);
        float bd = min(bandF, 1.0 - bandF);
        float bw = max(fwidth(bandP), 1e-4);
        float seam = (1.0 - smoothstep(0.0, bw * 1.1 + 0.006, bd)) * (1.0 - smoothstep(0.06, 0.22, bw));
        roughnessFactor = clamp(roughnessFactor + seam * 0.14, 0.0, 1.0);
        diffuseColor.rgb *= 1.0 - seam * 0.2;
      }`,
    )
    .replace(
      '#include <lights_fragment_maps>',
      `#include <lights_fragment_maps>
      #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
      {
        vec3 rw = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
        // below the horizon: the hazy city and the floors under it (darker, warm)
        float below = smoothstep(-0.3, 0.03, rw.y);
        radiance *= mix(vec3(0.5, 0.44, 0.4), vec3(1.0), below);
        // the steel frame round it: dark column stripes + slab lines near the horizon
        float band = 1.0 - smoothstep(0.22, 0.55, abs(rw.y));
        float az = atan(rw.z, rw.x);
        float cols = smoothstep(0.84, 0.95, abs(sin(az * 4.0 + 0.785)));
        float slabs = smoothstep(0.9, 0.98, abs(sin(rw.y * 16.0 + 0.2))) * band;
        radiance *= (1.0 - 0.5 * cols * band) * (1.0 - 0.3 * slabs);
      }
      #endif`,
    )
}

function flatRing(inner: number, outer: number, y: number, up: boolean, seg = 128) {
  const g = new THREE.RingGeometry(inner, outer, seg, 1)
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2)
  g.translate(0, y, 0)
  return g
}

/** a closed rectangular-section ring (lathe) */
function boxRing(inner: number, outer: number, h: number, seg = 112) {
  const pts = [
    new THREE.Vector2(inner, -h / 2),
    new THREE.Vector2(outer, -h / 2),
    new THREE.Vector2(outer, h / 2),
    new THREE.Vector2(inner, h / 2),
    new THREE.Vector2(inner, -h / 2),
  ]
  return new THREE.LatheGeometry(pts, seg)
}

/** cylinder along +y from 0..len (dampers / cables are re-posed per frame) */
function rodGeometry(r: number, len: number, seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1)
  g.translate(0, len / 2, 0)
  return g
}

const Y = new THREE.Vector3(0, 1, 0)
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _d = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const _one = new THREE.Vector3(1, 1, 1)
const _sc = new THREE.Vector3()

export interface DamperState {
  /** tower sway (m, x) at the damper's height */
  sway: number
  /** counter-swing of the mass relative to the building (m, x) */
  swing: number
  /** 0..1 the solid sweep (bottom → top) */
  fill: number
  /** 0..1 ghost linework opacity */
  ghost: number
  /** 0..1 ghost glitch */
  glitch: number
  /** 0..1 draw-in of the ghost (bottom → top) */
  draw: number
  /** 0..1 status stripe drawn round the ring frame */
  ring: number
  /** floors of steel the tower actually shows (damped) — the opening follows the deck */
  built: number
  time: number
  reduced: boolean
}

export class Damper {
  root = new THREE.Group()
  frame = new THREE.Group()
  mass = new THREE.Group()
  sphere: THREE.Mesh
  private fillU: FillUniforms = {
    uFill: { value: -1e4 },
    uEdge: { value: new THREE.Color(T.line).multiplyScalar(2.2) },
    uEdgeOn: { value: 1 },
  }
  private ghostMat: THREE.ShaderMaterial
  private ringMat: THREE.ShaderMaterial
  private stripe: THREE.Mesh
  private bodies: THREE.InstancedMesh
  private rods: THREE.InstancedMesh
  private cables: THREE.InstancedMesh
  private opening: THREE.Object3D
  /** damper ends: lugs on the ring frame (frame) and on the sphere's band (mass) */
  private ringLugs: THREE.Vector3[] = []
  private bandLugs: THREE.Vector3[] = []
  private cableTop: THREE.Vector3[] = []
  private cableBot: THREE.Vector3[] = []

  constructor(private mobile: boolean) {
    this.root.name = 'tmd'
    this.root.position.set(TMD.x, TMD.y, TMD.z)
    this.root.add(this.frame, this.mass)

    // ---------------------------------------------------------------- the mass
    const sphereMat = new THREE.MeshStandardMaterial({ color: '#d6dadf', metalness: 1, roughness: 0.12, envMapIntensity: 1.3 })
    fillPatch(sphereMat, this.fillU, 'sphere', sphereExtras)
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(R, mobile ? 64 : 96, mobile ? 40 : 64), sphereMat)
    this.sphere.receiveShadow = !mobile
    this.mass.add(this.sphere)

    const steel = MAT.steel().clone()
    steel.color.set('#353c43')
    steel.roughness = 0.36
    fillPatch(steel, this.fillU, 'steel')
    const band: THREE.BufferGeometry[] = [
      new THREE.CylinderGeometry(BAND_R, BAND_R, 0.3, 112, 1, true).translate(0, BAND_Y, 0),
      flatRing(BAND_R - 0.08, BAND_R, BAND_Y + 0.15, true, 112),
    ]
    for (let k = 0; k < 8; k++) {
      const th = ((k + 0.5) * Math.PI) / 4 + 0.63
      const lug = new THREE.BoxGeometry(0.34, 0.34, 0.3)
      lug.rotateY(-th)
      lug.translate(Math.cos(th) * (BAND_R + 0.12), BAND_Y, Math.sin(th) * (BAND_R + 0.12))
      band.push(lug)
      this.bandLugs.push(new THREE.Vector3(Math.cos(th) * (BAND_R + 0.24), BAND_Y, Math.sin(th) * (BAND_R + 0.24)))
    }
    const cap = new THREE.TorusGeometry(CAP_R, 0.1, 10, 64)
    cap.rotateX(Math.PI / 2)
    cap.translate(0, CAP_Y, 0)
    band.push(cap)
    for (let k = 0; k < 4; k++) {
      const th = Math.PI / 4 + (k * Math.PI) / 2
      band.push(new THREE.BoxGeometry(0.32, 0.4, 0.32).translate(Math.cos(th) * CAP_R, CAP_Y + 0.12, Math.sin(th) * CAP_R))
    }
    const bandMesh = new THREE.Mesh(mergeAll(band), steel)
    bandMesh.castShadow = bandMesh.receiveShadow = !mobile
    this.mass.add(bandMesh)

    // ---------------------------------------------------------------- the frame
    const ring: THREE.BufferGeometry[] = [boxRing(RING_IN, RING_OUT, RING_H)]
    // ring lugs (pinwheel dampers) on top of the ring frame
    for (let k = 0; k < 8; k++) {
      const th = ((k + 0.5) * Math.PI) / 4
      const lug = new THREE.BoxGeometry(0.4, 0.3, 0.36)
      lug.rotateY(-th)
      lug.translate(Math.cos(th) * (RING_IN + 0.17), RING_H / 2 + 0.15, Math.sin(th) * (RING_IN + 0.17))
      ring.push(lug)
      this.ringLugs.push(new THREE.Vector3(Math.cos(th) * (RING_IN + 0.17), BAND_Y, Math.sin(th) * (RING_IN + 0.17)))
    }
    // gussets out to the four bay columns
    for (let k = 0; k < 4; k++) {
      const th = Math.PI / 4 + (k * Math.PI) / 2
      const g = new THREE.BoxGeometry(1.05, RING_H * 0.8, 0.4)
      g.rotateY(-th)
      const r = (RING_OUT + BAY * Math.SQRT2 - 0.3) / 2
      g.translate(Math.cos(th) * r, 0, Math.sin(th) * r)
      ring.push(g)
    }
    const ringMesh = new THREE.Mesh(mergeAll(ring), steel)
    ringMesh.castShadow = ringMesh.receiveShadow = !mobile
    this.frame.add(ringMesh)

    // hanger girders + cable pick-up plates
    const primer = MAT.primer().clone()
    fillPatch(primer, this.fillU, 'primer')
    const girders: THREE.BufferGeometry[] = []
    for (const z of [-HANG_Z, HANG_Z]) {
      girders.push(iBeamGeometry(BAY * 2 - 0.3, { depth: GIRDER_D, width: 0.34, flange: 0.05, web: 0.03 }).translate(-BAY + 0.15, HANG_Y, z))
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) girders.push(new THREE.BoxGeometry(0.8, 0.14, 0.5).translate(sx * 0.78, HANG_Y - GIRDER_D / 2 - 0.07, sz * HANG_Z))
    const girderMesh = new THREE.Mesh(mergeAll(girders), primer)
    girderMesh.castShadow = girderMesh.receiveShadow = !mobile
    this.frame.add(girderMesh)

    // the floor opening round the sphere: a dark void inside the ring frame
    const voidMat = new THREE.MeshStandardMaterial({ color: '#111316', roughness: 1, metalness: 0 })
    this.opening = new THREE.Mesh(flatRing(R - 0.4, RING_IN + 0.02, FLOOR_TOP + 0.01, true, 112), voidMat)
    this.opening.visible = false
    this.frame.add(this.opening)

    // the status stripe: an inset light on the ring frame's outer face (signal green, drawn round)
    this.ringMat = new THREE.ShaderMaterial({
      toneMapped: false,
      uniforms: {
        uColor: { value: new THREE.Color(T.signal) },
        uOn: { value: 0 },
        uTime: { value: 0 },
        uStrength: { value: 3.4 },
        uSweep: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vP;
        void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOn, uTime, uStrength, uSweep; varying vec3 vP;
        void main() {
          float ang = (atan(vP.z, vP.x) + 3.14159265) / 6.2831853;
          float drawn = 1.0 - smoothstep(uOn - 0.006, uOn, ang);
          if (drawn <= 0.001) discard;
          float s = fract(ang - uTime * 0.06);
          float head = (1.0 - smoothstep(0.0, 0.16, s)) * uSweep;
          gl_FragColor = vec4(uColor * uStrength * (0.62 + 1.5 * head) * drawn, 1.0);
        }
      `,
    })
    this.stripe = new THREE.Mesh(new THREE.CylinderGeometry(RING_OUT + 0.012, RING_OUT + 0.012, 0.16, 160, 1, true), this.ringMat)
    this.stripe.position.y = 0.06
    this.stripe.renderOrder = 1
    this.frame.add(this.stripe)

    // ---------------------------------------------------------------- dampers (8) + cables (8)
    const yellow = MAT.craneYellow().clone()
    fillPatch(yellow, this.fillU, 'yellow')
    const chrome = new THREE.MeshStandardMaterial({ color: '#e2e6ea', metalness: 1, roughness: 0.16 })
    fillPatch(chrome, this.fillU, 'chrome')
    const body = mergeAll([
      rodGeometry(0.15, 1.12, 16),
      new THREE.BoxGeometry(0.3, 0.26, 0.18).translate(0, 0.02, 0),
      new THREE.CylinderGeometry(0.18, 0.18, 0.1, 16).translate(0, 1.08, 0),
    ])
    const rod = mergeAll([rodGeometry(0.06, 1.05, 10), new THREE.BoxGeometry(0.22, 0.22, 0.16)])
    this.bodies = new THREE.InstancedMesh(body, yellow, 8)
    this.rods = new THREE.InstancedMesh(rod, chrome, 8)
    const cableMat = MAT.mullion().clone()
    fillPatch(cableMat, this.fillU, 'cable')
    this.cables = new THREE.InstancedMesh(rodGeometry(0.055, 1, 8), cableMat, 8)
    for (const m of [this.bodies, this.rods, this.cables]) {
      m.frustumCulled = false
      m.castShadow = !mobile
      this.root.add(m)
    }
    for (let k = 0; k < 4; k++) {
      const th = Math.PI / 4 + (k * Math.PI) / 2
      const sx = Math.sign(Math.cos(th))
      const sz = Math.sign(Math.sin(th))
      for (const o of [-0.17, 0.17]) {
        this.cableBot.push(new THREE.Vector3(Math.cos(th) * CAP_R + o, CAP_Y + 0.3, Math.sin(th) * CAP_R))
        this.cableTop.push(new THREE.Vector3(sx * 0.78 + o, HANG_Y - GIRDER_D / 2 - 0.12, sz * HANG_Z))
      }
    }

    this.ghostMat = this.buildGhost()
    this.pose(0, 0)
  }

  private buildGhost() {
    const pts: number[] = []
    const ids: number[] = []
    let line = 0
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => {
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z)
      ids.push(line, line)
    }
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const circle = (r: number, y: number, n = 64) => {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2
        const a1 = ((i + 1) / n) * Math.PI * 2
        seg(V(Math.cos(a0) * r, y, Math.sin(a0) * r), V(Math.cos(a1) * r, y, Math.sin(a1) * r))
      }
      line++
    }
    for (let i = -3; i <= 3; i++) {
      const y = (i / 4) * R
      circle(Math.sqrt(R * R - y * y), y)
    }
    for (let m = 0; m < 12; m++) {
      const az = (m / 12) * Math.PI
      const n = 40
      const p = (t: number) => V(Math.cos(az) * Math.sin(t) * R, Math.cos(t) * R, Math.sin(az) * Math.sin(t) * R)
      for (let i = 0; i < n; i++) seg(p((i / n) * Math.PI * 2), p(((i + 1) / n) * Math.PI * 2))
      line++
    }
    circle(RING_IN, RING_H / 2, 96)
    circle(RING_OUT, RING_H / 2, 96)
    circle(RING_OUT, -RING_H / 2, 96)
    circle(CAP_R, CAP_Y)
    for (let i = 0; i < 8; i++) {
      seg(this.ringLugs[i], this.bandLugs[i])
      line++
    }
    for (let i = 0; i < 8; i++) {
      seg(this.cableBot[i], this.cableTop[i])
      line++
    }
    for (const z of [-HANG_Z, HANG_Z]) {
      for (const dy of [-GIRDER_D / 2, GIRDER_D / 2]) seg(V(-BAY, HANG_Y + dy, z), V(BAY, HANG_Y + dy, z))
      line++
    }
    // centre line, and a diameter dimension (extension lines, ticks) above the sphere
    seg(V(0, -R - 1.2, 0), V(0, HANG_Y + 0.8, 0))
    line++
    const dy = R + 0.8
    seg(V(-R, dy, 0), V(R, dy, 0))
    seg(V(-R, 0.2, 0), V(-R, dy + 0.35, 0))
    seg(V(R, 0.2, 0), V(R, dy + 0.35, 0))
    seg(V(-R - 0.22, dy - 0.22, 0), V(-R + 0.22, dy + 0.22, 0))
    seg(V(R - 0.22, dy - 0.22, 0), V(R + 0.22, dy + 0.22, 0))
    line++

    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    g.setAttribute('aLine', new THREE.Float32BufferAttribute(ids, 1))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
      uniforms: {
        uColor: { value: new THREE.Color(T.line) },
        uAlpha: { value: 0 },
        uDraw: { value: 1 },
        uFill: this.fillU.uFill,
        uTime: { value: 0 },
        uGlitch: { value: 0 },
        uMinY: { value: TMD.y - R - 1.2 },
        uMaxY: { value: TMD.y + HANG_Y + 0.8 },
      },
      vertexShader: /* glsl */ `
        attribute float aLine;
        uniform float uTime, uGlitch;
        varying float vY;
        varying float vFlick;
        float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
        void main() {
          vec3 p = position;
          float tick = floor(uTime * 9.0);
          float jump = step(0.8, h1(aLine * 3.17 + tick * 0.61)) * uGlitch;
          p.x += (h1(aLine + tick * 1.73) - 0.5) * 0.9 * jump;
          p.y += (h1(aLine * 1.3 + tick * 0.37) - 0.5) * 0.35 * jump;
          vFlick = 1.0 - jump * 0.55;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vY = wp.y;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAlpha, uDraw, uFill, uMinY, uMaxY;
        varying float vY;
        varying float vFlick;
        void main() {
          float h = (vY - uMinY) / max(uMaxY - uMinY, 1e-3);
          float drawn = 1.0 - smoothstep(uDraw - 0.03, uDraw, h);
          float open = smoothstep(uFill - 0.2, uFill + 0.25, vY);
          float a = uAlpha * drawn * open * vFlick;
          if (a <= 0.002) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
    })
    const lines = new THREE.LineSegments(g, mat)
    lines.frustumCulled = false
    lines.renderOrder = 2
    this.root.add(lines)
    return mat
  }

  /** re-pose the dampers and cables between the frame (building) and the mass */
  private pose(frameX: number, massX: number) {
    for (let i = 0; i < 8; i++) {
      _a.copy(this.ringLugs[i]).x += frameX
      _b.copy(this.bandLugs[i]).x += massX
      _d.copy(_b).sub(_a).normalize()
      _q.setFromUnitVectors(Y, _d)
      this.bodies.setMatrixAt(i, _m.compose(_a, _q, _one))
      _q.setFromUnitVectors(Y, _d.negate())
      this.rods.setMatrixAt(i, _m.compose(_b, _q, _one))
    }
    for (let i = 0; i < 8; i++) {
      _a.copy(this.cableBot[i]).x += massX
      _b.copy(this.cableTop[i]).x += frameX
      _d.copy(_b).sub(_a)
      const len = _d.length()
      _q.setFromUnitVectors(Y, _d.normalize())
      this.cables.setMatrixAt(i, _m.compose(_a, _q, _sc.set(1, len, 1)))
    }
    this.bodies.instanceMatrix.needsUpdate = true
    this.rods.instanceMatrix.needsUpdate = true
    this.cables.instanceMatrix.needsUpdate = true
  }

  /** world position on the ring frame's status stripe, toward horizontal `dir` */
  stripeAt(out: THREE.Vector3, dir: THREE.Vector3) {
    return out.set(TMD.x + this.frame.position.x, TMD.y + 0.06, TMD.z).addScaledVector(dir, RING_OUT)
  }

  update(s: DamperState) {
    this.frame.position.x = s.sway
    this.mass.position.x = s.sway + s.swing
    this.pose(s.sway, s.sway + s.swing)
    // the solid sweep, bottom → top; parked far above when done (no discards)
    const lo = TMD.y - R - 0.4
    const hi = TMD.y + HANG_Y + 0.6
    this.fillU.uFill.value = s.fill >= 0.999 ? 1e4 : s.fill <= 0.001 ? -1e4 : lo + (hi - lo) * s.fill
    this.fillU.uEdgeOn.value = s.fill > 0.001 && s.fill < 0.999 ? 1 : 0
    const solid = s.fill > 0.001
    this.mass.visible = solid
    this.frame.visible = solid
    this.bodies.visible = this.rods.visible = this.cables.visible = solid
    this.sphere.castShadow = !this.mobile && s.fill >= 0.999
    // the opening shows once floor 45's metal deck is down (laid 0.8 floors
    // behind the steel, spreading from -x: this +x bay is covered last)
    this.opening.visible = solid && s.built >= 45 + 1.06
    // ghost
    const g = this.ghostMat.uniforms
    g.uAlpha.value = s.ghost
    g.uDraw.value = s.draw
    g.uTime.value = s.time
    g.uGlitch.value = s.reduced ? 0 : s.glitch
    // status stripe
    const r = this.ringMat.uniforms
    r.uOn.value = s.ring
    r.uTime.value = s.reduced ? 0 : s.time
    r.uSweep.value = s.reduced ? 0.4 : 1
    this.stripe.visible = solid && s.ring > 0.001
  }
}
