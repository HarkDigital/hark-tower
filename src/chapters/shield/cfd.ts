import * as THREE from 'three'
import { FLOORS, FLOOR_H, TOWER_W } from '../../kit/steel'

/*
 * THE WIND-LOAD ANALYSIS — an engineering overlay on the tower, drawn the way
 * a CFD package presents its results (not weather):
 *
 *   PressureSkin  the design envelope (the finished tower, 30 x 30 x 240 m)
 *                 painted with the wind pressure coefficient Cp as a banded
 *                 contour map with isobars: hazard orange where the wind
 *                 stagnates on the windward face, through pale neutral, to
 *                 blueprint cyan and deep blue where the flow separates at the
 *                 leading corners (suction). A scan line paints it in from
 *                 the bottom. Below the steel frontier it rides the tower's
 *                 sway; above it, it holds still with the blueprint ghost.
 *   Streamlines   a bundle of 3D streamlines (potential flow round the body,
 *                 separating off the sides into a flapping Kármán wake),
 *                 drawn as thin camera-facing ribbons coloured by the same Cp
 *                 ramp (Bernoulli: fast = suction), with particle dashes that
 *                 travel at the local flow speed.
 *
 * Both are driven by one `clock` (metres of flow): the chapter feeds it from
 * scroll (and, outside reduced motion, from time). Geometry is built once;
 * nothing is allocated per frame.
 *
 * The wind blows toward -x/+z (from the +x/-z quarter): the +x face (the one
 * the camera sees full on) is windward, the +z face takes the corner suction,
 * and a crane on free slew weathervanes its jib downwind (yaw WIND_YAW).
 */

export const TOWER_TOP = FLOORS * FLOOR_H
const HALF = TOWER_W / 2
const WIND_AZ = 0.7
/** direction the wind blows toward (unit, horizontal) */
export const WIND = new THREE.Vector3(-Math.cos(WIND_AZ), 0, Math.sin(WIND_AZ))
/** across-wind (the flow frame's v axis) */
const ACROSS = new THREE.Vector3(-WIND.z, 0, WIND.x)
/** crane jib yaw (0 = +x, toward +z) that points downwind */
export const WIND_YAW = Math.atan2(WIND.z, WIND.x)

/** Cp range of the colour key */
export const CP_MIN = -1.5
export const CP_MAX = 1.0
/** the colour key (sRGB), evenly spaced from CP_MIN to CP_MAX */
export const RAMP = ['#1f4fd8', '#3d8cff', '#8fd6ff', '#e9f1ee', '#f2b705', '#ff6a1a'] as const
/** isobar bands across the key */
export const BANDS = 20

const RAMP_GLSL = /* glsl */ `
  uniform vec3 uRamp[6];
  vec3 cpRamp(float x) {
    x = clamp(x, 0.0, 1.0) * 5.0;
    vec3 c = mix(uRamp[0], uRamp[1], clamp(x, 0.0, 1.0));
    c = mix(c, uRamp[2], clamp(x - 1.0, 0.0, 1.0));
    c = mix(c, uRamp[3], clamp(x - 2.0, 0.0, 1.0));
    c = mix(c, uRamp[4], clamp(x - 3.0, 0.0, 1.0));
    return mix(c, uRamp[5], clamp(x - 4.0, 0.0, 1.0));
  }
  float cpKey(float cp) { return (cp - (${CP_MIN.toFixed(2)})) / ${(CP_MAX - CP_MIN).toFixed(2)}; }
`

function rampUniform() {
  return { value: RAMP.map(h => new THREE.Color(h)) }
}

// ------------------------------------------------------------------ pressure skin

/** the skin sits just outside the steel (columns + the frame's sway at the frontier) */
const SKIN = HALF + 0.55

export class PressureSkin {
  mesh: THREE.Mesh
  private u = {
    uRamp: rampUniform(),
    uWind: { value: WIND.clone() },
    uAlpha: { value: 0 },
    uScan: { value: 0 },
    uClock: { value: 0 },
    uFrontier: { value: 0 },
    uLo: { value: 120 },
    uPaintTop: { value: 0 },
    uSwayTop: { value: new THREE.Vector3() },
    uLine: { value: new THREE.Color('#dff4ff') },
  }

  constructor(lo = 118) {
    this.u.uLo.value = lo
    // four faces, subdivided up the height so the sway bends them like the frame
    const segs = 28
    const pos: number[] = []
    const nrm: number[] = []
    const idx: number[] = []
    const faces: [THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)],
      [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)],
      [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1)],
      [new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)],
    ]
    for (const [n, t] of faces) {
      const base = pos.length / 3
      for (let j = 0; j <= segs; j++) {
        const y = lo + ((TOWER_TOP - lo) * j) / segs
        for (const s of [-1, 1]) {
          pos.push(n.x * SKIN + t.x * s * SKIN, y, n.z * SKIN + t.z * s * SKIN)
          nrm.push(n.x, 0, n.z)
        }
      }
      for (let j = 0; j < segs; j++) {
        const a = base + j * 2
        // wound so the outward side is the front face
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    g.setIndex(idx)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      // solid for the streamlines drawn after it (they pass behind the body)
      depthWrite: true,
      toneMapped: false,
      fog: false,
      side: THREE.FrontSide,
      uniforms: this.u,
      vertexShader: /* glsl */ `
        uniform float uFrontier;
        uniform vec3 uSwayTop;
        varying vec3 vP;
        varying vec3 vN;
        void main() {
          vec3 p = position;
          vP = p;
          vN = normal;
          float h = clamp(p.y / ${TOWER_TOP.toFixed(1)}, 0.0, 1.2);
          p += uSwayTop * h * h * (1.0 - smoothstep(uFrontier, uFrontier + 8.0, p.y));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uWind, uLine;
        uniform float uAlpha, uScan, uClock, uLo, uPaintTop;
        varying vec3 vP;
        varying vec3 vN;
        ${RAMP_GLSL}
        float cpAt(vec3 p, vec3 n) {
          float w = -dot(n, uWind);
          vec3 t = vec3(-n.z, 0.0, n.x);
          float f = dot(uWind, t);
          // across the face, -1 at the edge the flow arrives from
          float sl = dot(p, t) / ${SKIN.toFixed(2)} * (f < 0.0 ? -1.0 : 1.0);
          float h = clamp(p.y / ${TOWER_TOP.toFixed(1)}, 0.0, 1.0);
          // windward: stagnation (shifted upwind by the oblique wind) at ~0.8 H,
          // falling off to the edges, the top, and round the downstream corner
          float dw = (sl + 0.55 * abs(f)) / 1.45;
          float dh = (h - 0.8) / 0.55;
          float cw = 1.0 * (1.0 - 0.85 * dw * dw) * (1.0 - 0.45 * dh * dh);
          cw -= 1.25 * abs(f) * smoothstep(0.45, 1.0, sl);
          // side: the flow separates at the leading corner (peak suction) and recovers
          float cs = -0.62 - 0.95 * exp(-(sl + 1.0) * 2.2) - 0.25 * smoothstep(0.86, 1.0, h);
          // leeward: the wake's base pressure
          float cl = -0.48 - 0.1 * (1.0 - h);
          float cp = w >= 0.0 ? mix(cs, cw, smoothstep(0.2, 0.7, w)) : mix(cs, cl, smoothstep(0.55, 0.95, -w));
          // vortex shedding: a slow ripple travelling down the suction faces
          cp += 0.12 * sin(uClock * 0.05 + p.y * 0.09 - sl * 2.4) * (1.0 - smoothstep(0.1, 0.5, w));
          return cp;
        }
        void main() {
          if (vP.y < uLo) discard;
          float x = cpKey(cpAt(vP, vN));
          // banded contour fill + isobars at the band edges
          float b = x * ${BANDS.toFixed(1)};
          vec3 band = cpRamp((floor(b) + 0.5) / ${BANDS.toFixed(1)});
          vec3 col = mix(cpRamp(x), band, 0.8);
          float fw = max(fwidth(b), 1e-4);
          float d = abs(fract(b + 0.5) - 0.5);
          float iso = 1.0 - smoothstep(fw * 0.5, fw * 1.5, d);
          // the analysis mesh: one panel per mullion bay (1.5 m) x one storey
          vec2 g = vec2(dot(vP, vec3(-vN.z, 0.0, vN.x)) / 1.5, vP.y / ${FLOOR_H.toFixed(1)});
          vec2 gw = max(fwidth(g), vec2(1e-4));
          vec2 gd = abs(fract(g + 0.5) - 0.5) / gw;
          float mesh = (1.0 - smoothstep(0.3, 1.1, min(gd.x, gd.y))) * (1.0 - smoothstep(0.25, 0.5, max(gw.x, gw.y)));
          // painted on the curtain wall only (up to its top), by a scan from the bottom
          float top = min(uScan, uPaintTop);
          float painted = 1.0 - smoothstep(top - 0.25, top, vP.y);
          float front = exp(-(uScan - vP.y) * (uScan - vP.y) * 0.5) * step(vP.y, uPaintTop + 0.3);
          float edge = exp(-(uPaintTop - vP.y) * (uPaintTop - vP.y) * 6.0) * step(uPaintTop, uScan);
          float a = 0.2 + 0.55 * iso + 0.1 * mesh;
          col = mix(col, col * 1.2 + 0.06, iso);
          col = mix(col, uLine * 1.5, max(front, edge * 0.8));
          a = max(a * painted, max(front * 0.95, edge * 0.8));
          a *= uAlpha * smoothstep(uLo, uLo + 26.0, vP.y);
          // no discard above the paint: the envelope stays solid (depth only)
          // so streamlines passing behind the tower are hidden by it
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }
      `,
    })
    this.mesh = new THREE.Mesh(g, mat)
    this.mesh.frustumCulled = false
    // after the tower's own ghost + the damper drawing (they read through it),
    // before the streamlines (hidden where they pass behind the body)
    this.mesh.renderOrder = 4
  }

  /**
   * `scan` 0..1 paints the curtain wall from the bottom up to its top
   * (`glazedTop`, m); `frontier` (m) is where the skin stops riding the sway.
   */
  update(alpha: number, scan: number, clock: number, frontier: number, glazedTop: number, swayTop: THREE.Vector3) {
    const u = this.u
    u.uAlpha.value = alpha
    u.uPaintTop.value = glazedTop
    u.uScan.value = u.uLo.value - 1 + (glazedTop + 2 - u.uLo.value) * scan
    u.uClock.value = clock
    u.uFrontier.value = frontier
    u.uSwayTop.value.copy(swayTop)
    this.mesh.visible = alpha > 0.003
  }
}

// ------------------------------------------------------------------ streamlines

/** potential flow round a cylinder of radius a, uniform unit flow along +u */
function flow(u: number, v: number, a: number, out: { u: number; v: number }) {
  const r2 = Math.max(u * u + v * v, a * a)
  const k = (a * a) / (r2 * r2)
  out.u = 1 - k * (u * u - v * v)
  out.v = -2 * k * u * v
}

export class Streamlines {
  mesh: THREE.Mesh
  private u = {
    uRamp: rampUniform(),
    uAlpha: { value: 0 },
    uDraw: { value: 0 },
    uClock: { value: 0 },
    uAcross: { value: ACROSS.clone() },
    uWind: { value: WIND.clone() },
    uWidth: { value: 0.0012 },
    uCyan: { value: new THREE.Color('#8fd6ff') },
  }

  constructor(mobile: boolean) {
    // two section sheets (like the cut planes of a CFD report): round the
    // curtain wall, and round the open storeys under the frontier
    const SHEETS = [146, 168]
    const perSheet = mobile ? 14 : 20
    const count = perSheet * SHEETS.length
    const ds = mobile ? 1.5 : 1.0
    const A = 23 // the cylinder the flow sees (clears the tower's corners)
    const U0 = -72
    const U1 = 112
    // seeded, deterministic
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

    const P: number[] = []
    const N: number[] = []
    const D: number[] = []
    const Wk: number[] = []
    const idx: number[] = []
    const vel = { u: 0, v: 0 }
    const mid = { u: 0, v: 0 }
    const line: number[] = [] // u, v, cp per point
    for (let i = 0; i < count; i++) {
      // across-wind offset: stratified, dense near the body
      const j = i % perSheet
      const side = j % 2 === 0 ? 1 : -1
      const r = (Math.floor(j / 2) + 0.25 + 0.5 * rnd()) / Math.ceil(perSheet / 2)
      const v0 = side * (1.6 + 30 * r * r)
      const y = SHEETS[Math.floor(i / perSheet)] + (rnd() - 0.5) * 3
      const body = y < TOWER_TOP + 2
      const phase = rnd()
      // integrate the streamline (arc-length steps, midpoint rule) upstream half
      line.length = 0
      let uu = U0
      let vv = v0
      let d0 = 0
      let cp0 = 0
      let sep = false
      let guard = 0
      while (uu < U1 && guard++ < 2000) {
        let cp: number
        if (!body) {
          cp = 0
        } else if (!sep) {
          flow(uu, vv, A, vel)
          cp = 1 - (vel.u * vel.u + vel.v * vel.v)
        } else {
          // separated: the shear layer relaxes back toward the free stream
          cp = cp0 * Math.exp(-uu / (1.6 * A))
        }
        line.push(uu, vv, cp)
        if (!body) {
          uu += ds
          continue
        }
        if (!sep) {
          flow(uu, vv, A, vel)
          let m = Math.hypot(vel.u, vel.v) || 1
          mid.u = uu + (vel.u / m) * ds * 0.5
          mid.v = vv + (vel.v / m) * ds * 0.5
          flow(mid.u, mid.v, A, vel)
          m = Math.hypot(vel.u, vel.v) || 1
          uu += (vel.u / m) * ds
          vv += (vel.v / m) * ds
          if (uu >= 0) {
            sep = true
            d0 = vv - v0
            flow(0, vv, A, vel)
            cp0 = Math.max(CP_MIN, 1 - (vel.u * vel.u + vel.v * vel.v))
          }
        } else {
          uu += ds
          vv = v0 + d0 * Math.exp(-uu / (2.6 * A))
        }
      }
      const n = line.length / 3
      if (n < 2) continue
      const base = P.length / 3
      // flight time (Bernoulli speed), arc length
      let tau = rnd() * 40
      let arc = 0
      for (let k = 0; k < n; k++) {
        const pu = line[k * 3]
        const pv = line[k * 3 + 1]
        const cp = Math.max(CP_MIN, Math.min(CP_MAX, line[k * 3 + 2]))
        const k1 = Math.min(n - 1, k + 1)
        const nu = k1 === k ? pu + (pu - line[(k - 1) * 3]) : line[k1 * 3]
        const nv = k1 === k ? pv + (pv - line[(k - 1) * 3 + 1]) : line[k1 * 3 + 1]
        if (k > 0) {
          const step = Math.hypot(pu - line[(k - 1) * 3], pv - line[(k - 1) * 3 + 1])
          arc += step
          tau += step / Math.sqrt(Math.max(0.06, 1 - cp))
        }
        const x = WIND.x * pu + ACROSS.x * pv
        const z = WIND.z * pu + ACROSS.z * pv
        const nx = WIND.x * nu + ACROSS.x * nv
        const nz = WIND.z * nu + ACROSS.z * nv
        // the wake: lines behind the body (and near its width) flap together
        const wr = pv / (1.9 * A)
        const wake = body ? Math.exp(-wr * wr) : 0
        for (const s of [-1, 1]) {
          P.push(x, y, z)
          N.push(nx, y, nz)
          D.push(tau, cp, arc, s)
          Wk.push(wake, pu, phase, 0)
        }
      }
      // normalise the arc length per line (draw-in and end fades)
      for (let k = 0; k < n * 2; k++) D[(base + k) * 4 + 2] /= Math.max(arc, 1)
      for (let k = 0; k < n - 1; k++) {
        const a = base + k * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
    g.setAttribute('aNext', new THREE.Float32BufferAttribute(N, 3))
    g.setAttribute('aData', new THREE.Float32BufferAttribute(D, 4))
    g.setAttribute('aWake', new THREE.Float32BufferAttribute(Wk, 4))
    g.setIndex(idx)
    const mat = new THREE.ShaderMaterial({
      // normal blending: on a bright sky the linework keeps its colour
      // instead of washing out to white
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      side: THREE.DoubleSide,
      uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute vec3 aNext;
        attribute vec4 aData;
        attribute vec4 aWake;
        uniform float uClock, uWidth;
        uniform vec3 uAcross, uWind;
        varying float vTau;
        varying float vCp;
        varying float vS;
        varying float vFade;
        float flap(float u, float wk, float ph) {
          // a Karman street: the wake swings across, growing downstream
          return wk * 6.5 * smoothstep(0.0, 110.0, u) * sin(u * 0.075 - uClock * 0.055 + ph * 0.8);
        }
        void main() {
          float ph = position.y * 0.05 + aWake.z;
          vec3 p = position + uAcross * flap(aWake.y, aWake.x, ph);
          float un = aWake.y + dot(aNext - position, uWind);
          vec3 q = aNext + uAcross * flap(un, aWake.x, ph);
          vec3 tng = q - p;
          float tl = length(tng);
          tng = tl > 1e-4 ? tng / tl : uWind;
          vec3 toCam = cameraPosition - p;
          float dist = length(toCam);
          vec3 sd = cross(tng, toCam / max(dist, 1e-3));
          float sl = length(sd);
          sd = sl > 1e-4 ? sd / sl : vec3(0.0, 1.0, 0.0);
          p += sd * aData.w * max(0.03, dist * uWidth);
          vTau = aData.x;
          vCp = aData.y;
          vS = aData.z;
          vFade = smoothstep(9.0, 26.0, dist) * (1.0 - smoothstep(220.0, 340.0, dist));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAlpha, uDraw, uClock;
        uniform vec3 uCyan;
        varying float vTau;
        varying float vCp;
        varying float vS;
        varying float vFade;
        ${RAMP_GLSL}
        void main() {
          // drawn in from upstream as the solver runs
          float drawn = 1.0 - smoothstep(uDraw * 1.12 - 0.08, uDraw * 1.12, vS);
          float ends = smoothstep(0.0, 0.08, vS) * (1.0 - smoothstep(0.72, 1.0, vS));
          // particle dashes, travelling at the local flow speed
          float ph = fract((vTau - uClock) / 24.0);
          float head = ph / 0.3;
          float dash = ph < 0.3 ? head * head * (1.0 - smoothstep(0.27, 0.3, ph)) : 0.0;
          float a = (0.16 + 0.84 * dash) * drawn * ends * vFade * uAlpha;
          if (a <= 0.002) discard;
          // drawing cyan; whiter where the flow speeds up round the corners,
          // warming toward the key's orange where it stagnates on the windward face
          vec3 col = mix(uCyan, vec3(1.0), (1.0 - smoothstep(-1.4, -0.2, vCp)) * 0.7);
          col = mix(col, uRamp[5], smoothstep(0.2, 0.85, vCp));
          col *= 1.0 + 0.4 * dash;
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }
      `,
    })
    this.mesh = new THREE.Mesh(g, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
  }

  update(alpha: number, draw: number, clock: number) {
    const u = this.u
    u.uAlpha.value = alpha
    u.uDraw.value = draw
    u.uClock.value = clock
    this.mesh.visible = alpha > 0.003
  }
}
