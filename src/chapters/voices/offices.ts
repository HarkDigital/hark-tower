import * as THREE from 'three'
import { rng } from '../../core/math'
import { FLOOR_H, T, TOWER_W } from '../../kit/steel'

/*
 * THE TENANTS' FLOORS — lit offices behind the tower's curtain wall.
 *
 * One InstancedMesh of bay-sized glass units (6 m x one floor) laid over the
 * tower's own mirror glass on the two faces the drone flies along (+z, +x).
 * Each unit is an INTERIOR-MAPPED office: the fragment shader traces the view
 * ray into a virtual room behind the glass (walls, ceiling light strips,
 * floor, a desk + monitor, a plant) and through up to three silhouette cards
 * (people standing / seated — no faces, backlit by the room), so the offices
 * have real parallax as the camera moves past. The glass on top is a
 * MeshStandardMaterial (sky reflections from scene.environment, Fresnel), with
 * a mirror-glass spandrel band and mullion lines that match the tower's panes.
 *
 * `uLit` (floors, fractional) switches offices on floor by floor: each unit
 * lights at its own `litAt` (floor + a random order within the floor), and an
 * unlit unit collapses so the tower's own mirror glass shows. Everything is a
 * pure function of uLit — any scroll position poses exactly.
 */

export const HALF = TOWER_W / 2
/** the tower's curtain wall: 20 units of 1.545 m per face, 0.45 m outboard of the grid */
const GLASS_HALF = HALF + 0.45
export const MOD = (GLASS_HALF * 2) / 20
/** one office = four curtain-wall units */
export const BAY = MOD * 4
/** the overlay sits just in front of the tower's glass */
export const FACE = GLASS_HALF + 0.08
export const MAX_FLOORS = 40
/** vision glass between the transoms (the tower's spandrel bands are outside) */
export const VIS_BOT = 0.62
export const VIS_TOP = 3.52
/** ceiling height inside the offices */
export const CEIL = VIS_TOP

/** where each tenant lives: face 0 = +z (bays left→right), face 1 = +x (bays from the +z corner toward −z) */
export const TENANT_SPOTS = [
  { face: 0, bay: 0, floor: 23 },
  { face: 0, bay: 1, floor: 24 },
  { face: 0, bay: 2, floor: 25 },
  { face: 0, bay: 3, floor: 26 },
  { face: 0, bay: 4, floor: 27 },
  // round the corner onto the east face (the hoist runs up bay 3 there)
  { face: 1, bay: 0, floor: 28 },
  { face: 1, bay: 1, floor: 29 },
  { face: 1, bay: 2, floor: 30 },
] as const

/** Outward normal and "right" (as seen from outside) of a face. */
export function faceAxes(face: number, n: THREE.Vector3, r: THREE.Vector3) {
  if (face === 0) {
    n.set(0, 0, 1)
    r.set(1, 0, 0)
  } else {
    n.set(1, 0, 0)
    r.set(0, 0, -1)
  }
}

/** Bottom-centre of bay `bay` on `face` at `floor`, on the overlay plane. */
export function bayOrigin(face: number, bay: number, floor: number, out: THREE.Vector3) {
  const a = -GLASS_HALF + BAY * (bay + 0.5)
  if (face === 0) out.set(a, floor * FLOOR_H, FACE)
  else out.set(FACE, floor * FLOOR_H, -a)
  return out
}

/* ------------------------------------------------------------------ layouts */

/** per-office layout, packed into instance attributes */
interface Layout {
  /** x: litAt (floor + order), y: seed, z: 1 = tenant, w: light level */
  a: [number, number, number, number]
  /**
   * figures: x, depth (negative), type, scale (negative = mirrored: profiles face −x).
   * Types: 0 none, 1 standing, 2 seated at a desk, 3 walking (profile),
   * 4 standing (profile), 5 seated (profile).
   */
  f0: [number, number, number, number]
  f1: [number, number, number, number]
  f2: [number, number, number, number]
  /** desk x, desk front z (negative), desk half width (0 = none), plant x (99 = none) */
  d: [number, number, number, number]
}

const NONE: [number, number, number, number] = [0, -3, 0, 1]

/** hand-placed interiors for the eight tenants (the camera stops at these) */
const TENANT_LAYOUTS: Omit<Layout, 'a'>[] = [
  // Fabbri Builders: at the desk, a colleague by the glass turned to them with the plans
  { f0: [-0.9, -2.9, 2, 1], f1: [1.35, -1.25, 4, -1.02], f2: NONE, d: [-0.55, -1.9, 1.05, 2.3] },
  // Shriver's: two people talking mid-room, a plant by the glass
  { f0: [0.3, -3.35, 4, 0.97], f1: [1.08, -3.15, 4, -1.03], f2: NONE, d: [0, -6.2, 1.2, -2.25] },
  // CrossFit Off The Grid: standing at the window, a desk further back
  { f0: [-0.6, -0.95, 1, 1.04], f1: [1.2, -4.8, 2, 1], f2: NONE, d: [1.55, -3.8, 0.9, 99] },
  // Bellview Winery: at the meeting table, one at its head
  { f0: [-0.6, -3.5, 2, 0.98], f1: [1.95, -2.75, 5, -1.02], f2: NONE, d: [0.05, -2.3, 1.45, -2.3] },
  // PEG Glass: looking out at the city, the studio desk behind
  { f0: [0.9, -0.9, 1, 1], f1: [-1.3, -4.6, 2, 0.98], f2: NONE, d: [-1.0, -3.6, 0.95, 99] },
  // Our Lady of Mercy Academy: presenting, one listening at the table
  { f0: [-1.35, -5.2, 4, 1.02], f1: [0.7, -2.9, 2, 0.98], f2: NONE, d: [0.95, -1.9, 1.05, 99] },
  // The Home Hero: heads down at the desk, a plant
  { f0: [0.2, -2.8, 2, 1.02], f1: NONE, f2: NONE, d: [0.55, -1.8, 1.1, -2.3] },
  // ProviderSoft: a team at their desks, one walking through
  { f0: [-1.25, -3.0, 2, 1], f1: [1.15, -3.0, 2, 0.97], f2: [0.05, -5.6, 3, -1.03], d: [0, -1.95, 1.9, 99] },
]

function genericLayout(r: () => number): Omit<Layout, 'a'> {
  const hasDesk = r() < 0.68
  const d: [number, number, number, number] = hasDesk
    ? [(r() - 0.5) * 2.4, -1.5 - r() * 2.6, 0.75 + r() * 0.55, r() < 0.35 ? (r() < 0.5 ? -2.3 : 2.3) : 99]
    : [0, -3, 0, r() < 0.4 ? (r() < 0.5 ? -2.3 : 2.3) : 99]
  const figs: [number, number, number, number][] = []
  const n = r() < 0.28 ? 0 : r() < 0.72 ? 1 : 2
  for (let k = 0; k < n; k++) {
    const seated = hasDesk && k === 0 && r() < 0.6
    const s = 0.95 + r() * 0.1
    if (seated) {
      // behind the desk facing the glass, or side-on at its end
      if (r() < 0.62) figs.push([d[0] + (r() - 0.5) * d[2], d[1] - 1.0, 2, s])
      else {
        const side = r() < 0.5 ? -1 : 1
        figs.push([d[0] + side * (d[2] + 0.38), d[1] - 0.4, 5, -side * s])
      }
    } else {
      // standing (facing us or side-on) or walking through
      const p = r()
      const type = p < 0.3 ? 1 : p < 0.62 ? 4 : 3
      figs.push([(r() - 0.5) * 4.2, -1.1 - r() * 5.5, type, (r() < 0.5 ? -1 : 1) * s])
    }
  }
  while (figs.length < 3) figs.push(NONE)
  return { f0: figs[0], f1: figs[1], f2: figs[2], d }
}

/* ------------------------------------------------------------------ shader */

const VERT_HEAD = /* glsl */ `
  attribute vec4 aOfA;
  attribute vec4 aOfF0;
  attribute vec4 aOfF1;
  attribute vec4 aOfF2;
  attribute vec4 aOfD;
  uniform float uLit;
  uniform float uSwayTop;
  varying vec3 vOfP;
  varying vec3 vOfRay;
  varying float vOfOn;
  varying vec4 vOfA;
  varying vec4 vOfF0;
  varying vec4 vOfF1;
  varying vec4 vOfF2;
  varying vec4 vOfD;
  varying vec3 vOfT;
`

const VERT_BODY = /* glsl */ `
  // lights on: each office fades up over a tenth of a floor of uLit
  float ofOn = smoothstep(aOfA.x, aOfA.x + 0.12, uLit);
  vOfOn = ofOn;
  vOfA = aOfA; vOfF0 = aOfF0; vOfF1 = aOfF1; vOfF2 = aOfF2; vOfD = aOfD;
  mat4 ofM = modelMatrix * instanceMatrix;
  mat4 ofInv = inverse(ofM);
  vOfT = normalize(mat3(ofM) * vec3(1.0, 0.0, 0.0));
  vOfP = transformed;
  vOfRay = transformed - (ofInv * vec4(cameraPosition, 1.0)).xyz;
  // wind sway (cantilever, like the tower) in world x, taken back to local space
  float ofH = clamp((ofM * vec4(transformed, 1.0)).y / 240.0, 0.0, 1.2);
  transformed += (ofInv * vec4(uSwayTop * ofH * ofH, 0.0, 0.0, 0.0)).xyz;
  // unlit offices collapse: the tower's own mirror glass shows there
  transformed *= step(0.0005, ofOn);
`

const FRAG_HEAD = /* glsl */ `
  uniform vec3 uAccent[8];
  uniform float uInterior;
  varying vec3 vOfP;
  varying vec3 vOfRay;
  varying float vOfOn;
  varying vec4 vOfA;
  varying vec4 vOfF0;
  varying vec4 vOfF1;
  varying vec4 vOfF2;
  varying vec4 vOfD;
  varying vec3 vOfT;

  float ofHash(float n) { return fract(sin(n) * 43758.5453); }
  float ofBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
  float ofCap(vec2 p, vec2 a, vec2 b, float r) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
  }
  float ofCro(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
  // a round-ended cone from a (radius ra) to b (radius rb): limbs that taper (iq)
  float ofUCap(vec2 p, vec2 a, vec2 b, float ra, float rb) {
    p -= a;
    b -= a;
    float h = dot(b, b);
    vec2 q = vec2(dot(p, vec2(b.y, -b.x)), dot(p, b)) / h;
    q.x = abs(q.x);
    float bb = ra - rb;
    vec2 c = vec2(sqrt(max(h - bb * bb, 1e-6)), bb);
    float k = ofCro(c, q);
    if (k < 0.0) return sqrt(h * dot(q, q)) - ra;
    if (k > c.x) return sqrt(h * (dot(q, q) + 1.0 - 2.0 * q.y)) - rb;
    return dot(c, q) - ra;
  }
  // a two-segment limb: a → b → c with radii ra, rb, rc
  float ofLimb(vec2 p, vec2 a, vec2 b, vec2 c, float ra, float rb, float rc) {
    return min(ofUCap(p, a, b, ra, rb), ofUCap(p, b, c, rb, rc));
  }
  // a trapezoid (half widths r1 bottom, r2 top, half height he) (iq)
  float ofTrap(vec2 p, float r1, float r2, float he) {
    vec2 k1 = vec2(r2, he);
    vec2 k2 = vec2(r2 - r1, 2.0 * he);
    p.x = abs(p.x);
    vec2 ca = vec2(p.x - min(p.x, (p.y < 0.0) ? r1 : r2), abs(p.y) - he);
    vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot(k2, k2), 0.0, 1.0);
    float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
    return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
  }
  float ofEll(vec2 p, vec2 c, vec2 r) { return (length((p - c) / r) - 1.0) * min(r.x, r.y); }

  /*
   * People, seen through the glass. Feet at y = 0, metres; the profile poses
   * face +x. Each pose writes four layers, back to front (d.x: chair and
   * shoes, d.y: trousers/skirt, d.z: shirt/jacket, d.w: skin), plus hair.
   */
  void ofStandF(vec2 p, float v, inout vec4 d, inout float hair) {
    vec2 m = vec2(abs(p.x), p.y);
    vec2 hc = vec2(0.0, 1.635);
    float head = ofEll(p, hc, vec2(0.092, 0.114));
    d.w = min(d.w, min(head, ofCap(p, vec2(0.0, 1.46), vec2(0.0, 1.54), 0.042)));
    // facing us: a hairline; facing into the room: the back of the head
    float line = v > 0.62 ? hc.y - 0.07 : hc.y + 0.035;
    hair = min(hair, max(head - 0.012, line - p.y));
    d.z = min(d.z, ofTrap(p - vec2(0.0, 1.17), 0.148, 0.182, 0.2) - 0.03);
    if (v < 0.36) {
      // arms at the sides
      d.z = min(d.z, ofLimb(m, vec2(0.19, 1.34), vec2(0.228, 1.08), vec2(0.218, 0.86), 0.05, 0.042, 0.034));
      d.w = min(d.w, length(m - vec2(0.216, 0.815)) - 0.04);
    } else if (v < 0.72) {
      // a phone or a coffee in one hand
      d.z = min(d.z, ofLimb(p, vec2(-0.19, 1.34), vec2(-0.228, 1.08), vec2(-0.218, 0.86), 0.05, 0.042, 0.034));
      d.w = min(d.w, length(p - vec2(-0.216, 0.815)) - 0.04);
      d.z = min(d.z, ofLimb(p, vec2(0.19, 1.34), vec2(0.225, 1.07), vec2(0.13, 1.19), 0.05, 0.042, 0.034));
      d.w = min(d.w, length(p - vec2(0.105, 1.21)) - 0.04);
    } else {
      // hands in pockets
      d.z = min(d.z, ofLimb(m, vec2(0.19, 1.34), vec2(0.238, 1.1), vec2(0.17, 0.95), 0.05, 0.043, 0.036));
    }
    if (fract(v * 7.3) < 0.3) {
      // a skirt, dark tights
      d.y = min(d.y, ofTrap(p - vec2(0.0, 0.775), 0.205, 0.148, 0.2) - 0.012);
      d.x = min(d.x, ofLimb(m, vec2(0.075, 0.62), vec2(0.078, 0.36), vec2(0.075, 0.07), 0.046, 0.037, 0.03));
    } else {
      d.y = min(d.y, ofTrap(p - vec2(0.0, 0.9), 0.155, 0.15, 0.09) - 0.02);
      d.y = min(d.y, ofLimb(m, vec2(0.085, 0.95), vec2(0.09, 0.52), vec2(0.088, 0.09), 0.078, 0.056, 0.043));
    }
    d.x = min(d.x, ofCap(m, vec2(0.085, 0.035), vec2(0.1, 0.035), 0.036));
  }

  void ofSeatF(vec2 p, float v, inout vec4 d, inout float hair) {
    vec2 m = vec2(abs(p.x), p.y);
    vec2 hc = vec2(0.0, 1.215);
    float head = ofEll(p, hc, vec2(0.092, 0.114));
    d.w = min(d.w, min(head, ofCap(p, vec2(0.0, 1.04), vec2(0.0, 1.12), 0.042)));
    hair = min(hair, max(head - 0.012, (v > 0.5 ? hc.y - 0.07 : hc.y + 0.035) - p.y));
    d.z = min(d.z, ofTrap(p - vec2(0.0, 0.755), 0.15, 0.18, 0.19) - 0.03);
    // forearms reach forward to the keyboard
    d.z = min(d.z, ofLimb(m, vec2(0.188, 0.92), vec2(0.235, 0.7), vec2(0.17, 0.72), 0.05, 0.042, 0.036));
    d.w = min(d.w, length(m - vec2(0.148, 0.728)) - 0.038);
    // knees toward us, shins down
    d.y = min(d.y, ofCap(m, vec2(0.1, 0.5), vec2(0.11, 0.46), 0.078));
    d.y = min(d.y, ofUCap(m, vec2(0.115, 0.45), vec2(0.118, 0.08), 0.05, 0.04));
    d.x = min(d.x, ofCap(m, vec2(0.11, 0.035), vec2(0.12, 0.035), 0.036));
    // the task chair: mesh back, seat, gas lift, five-star base
    float chair = ofBox(p - vec2(0.0, 0.87), vec2(0.17, 0.235)) - 0.05;
    chair = min(chair, ofBox(p - vec2(0.0, 0.45), vec2(0.23, 0.028)) - 0.012);
    chair = min(chair, ofCap(p, vec2(0.0, 0.08), vec2(0.0, 0.43), 0.022));
    chair = min(chair, ofCap(p, vec2(-0.27, 0.05), vec2(0.27, 0.05), 0.02));
    d.x = min(d.x, chair);
  }

  void ofWalk(vec2 p, float v, inout vec4 d, inout float hair) {
    vec2 hc = vec2(0.035, 1.625);
    float head = ofEll(p, hc, vec2(0.1, 0.114));
    d.w = min(d.w, min(head, ofCap(p, vec2(0.0, 1.45), vec2(0.02, 1.53), 0.044)));
    hair = min(hair, max(head - 0.012, -dot(p - hc, vec2(-0.55, 0.835)) - 0.012));
    d.z = min(d.z, ofUCap(p, vec2(0.022, 1.33), vec2(0.0, 1.03), 0.12, 0.108));
    // arms swing against the stride
    d.z = min(d.z, ofLimb(p, vec2(0.012, 1.33), vec2(-0.07, 1.09), vec2(-0.14, 0.885), 0.048, 0.04, 0.033));
    d.w = min(d.w, length(p - vec2(-0.152, 0.85)) - 0.039);
    d.z = min(d.z, ofLimb(p, vec2(0.02, 1.33), vec2(0.09, 1.1), vec2(0.185, 0.93), 0.046, 0.039, 0.032));
    d.w = min(d.w, length(p - vec2(0.2, 0.905)) - 0.037);
    // the stride: front heel down, back foot rolling off the toe
    d.y = min(d.y, length(p - vec2(0.0, 0.965)) - 0.105);
    d.y = min(d.y, ofLimb(p, vec2(0.0, 0.96), vec2(0.13, 0.55), vec2(0.19, 0.095), 0.08, 0.056, 0.042));
    d.y = min(d.y, ofLimb(p, vec2(0.0, 0.96), vec2(-0.06, 0.54), vec2(-0.2, 0.14), 0.078, 0.055, 0.041));
    d.x = min(d.x, ofCap(p, vec2(0.165, 0.042), vec2(0.29, 0.05), 0.036));
    d.x = min(d.x, ofCap(p, vec2(-0.25, 0.1), vec2(-0.14, 0.038), 0.033));
  }

  void ofStandP(vec2 p, float v, inout vec4 d, inout float hair) {
    vec2 hc = vec2(0.025, 1.635);
    float head = ofEll(p, hc, vec2(0.1, 0.114));
    d.w = min(d.w, min(head, ofCap(p, vec2(0.0, 1.46), vec2(0.015, 1.54), 0.044)));
    hair = min(hair, max(head - 0.012, -dot(p - hc, vec2(-0.55, 0.835)) - 0.012));
    d.z = min(d.z, ofUCap(p, vec2(0.012, 1.33), vec2(0.0, 1.03), 0.12, 0.108));
    if (v < 0.5) {
      d.z = min(d.z, ofLimb(p, vec2(0.005, 1.33), vec2(-0.008, 1.075), vec2(0.045, 0.86), 0.048, 0.04, 0.033));
      d.w = min(d.w, length(p - vec2(0.055, 0.825)) - 0.039);
    } else {
      // mid-conversation: a forearm up
      d.z = min(d.z, ofLimb(p, vec2(0.005, 1.33), vec2(0.02, 1.08), vec2(0.2, 1.13), 0.048, 0.04, 0.033));
      d.w = min(d.w, length(p - vec2(0.232, 1.14)) - 0.038);
    }
    d.y = min(d.y, length(p - vec2(0.0, 0.965)) - 0.1);
    d.y = min(d.y, ofLimb(p, vec2(-0.01, 0.96), vec2(-0.02, 0.53), vec2(-0.04, 0.09), 0.076, 0.054, 0.041));
    d.y = min(d.y, ofLimb(p, vec2(0.01, 0.96), vec2(0.025, 0.53), vec2(0.0, 0.09), 0.078, 0.056, 0.042));
    d.x = min(d.x, ofCap(p, vec2(-0.03, 0.04), vec2(0.13, 0.042), 0.036));
  }

  void ofSeatP(vec2 p, float v, inout vec4 d, inout float hair) {
    vec2 hc = vec2(0.075, 1.21);
    float head = ofEll(p, hc, vec2(0.1, 0.114));
    d.w = min(d.w, min(head, ofCap(p, vec2(0.035, 1.04), vec2(0.055, 1.12), 0.044)));
    hair = min(hair, max(head - 0.012, -dot(p - hc, vec2(-0.55, 0.835)) - 0.012));
    d.z = min(d.z, ofUCap(p, vec2(0.035, 0.93), vec2(-0.02, 0.63), 0.12, 0.112));
    d.z = min(d.z, ofLimb(p, vec2(0.025, 0.92), vec2(0.075, 0.69), vec2(0.33, 0.75), 0.047, 0.04, 0.033));
    d.w = min(d.w, length(p - vec2(0.36, 0.755)) - 0.037);
    d.y = min(d.y, ofUCap(p, vec2(-0.02, 0.53), vec2(0.4, 0.52), 0.092, 0.062));
    d.y = min(d.y, ofUCap(p, vec2(0.405, 0.5), vec2(0.425, 0.09), 0.055, 0.041));
    d.x = min(d.x, ofCap(p, vec2(0.405, 0.042), vec2(0.53, 0.045), 0.034));
    float chair = ofBox(p - vec2(-0.19, 0.87), vec2(0.03, 0.235)) - 0.03;
    chair = min(chair, ofBox(p - vec2(0.02, 0.44), vec2(0.23, 0.028)) - 0.012);
    chair = min(chair, ofCap(p, vec2(0.02, 0.08), vec2(0.02, 0.42), 0.022));
    chair = min(chair, ofCap(p, vec2(-0.25, 0.05), vec2(0.29, 0.05), 0.02));
    d.x = min(d.x, chair);
  }

  // clothes, skin and hair from a figure's seed (linear albedo, muted office wear)
  vec3 ofTopC(float h) {
    h *= 8.0;
    if (h < 1.0) return vec3(0.6, 0.6, 0.58);    // white shirt
    if (h < 2.0) return vec3(0.28, 0.36, 0.46);  // pale blue
    if (h < 3.0) return vec3(0.03, 0.04, 0.075); // navy
    if (h < 4.0) return vec3(0.055, 0.055, 0.06);// charcoal
    if (h < 5.0) return vec3(0.1, 0.17, 0.3);    // chambray
    if (h < 6.0) return vec3(0.07, 0.1, 0.07);   // forest
    if (h < 7.0) return vec3(0.2, 0.045, 0.05);  // burgundy
    return vec3(0.2, 0.21, 0.22);                // mid-grey knit
  }
  vec3 ofBotC(float h) {
    h *= 6.0;
    if (h < 1.0) return vec3(0.028, 0.035, 0.065); // navy
    if (h < 2.0) return vec3(0.045, 0.045, 0.05);  // charcoal
    if (h < 3.0) return vec3(0.02);                // black
    if (h < 4.0) return vec3(0.26, 0.21, 0.13);    // khaki
    if (h < 5.0) return vec3(0.05, 0.08, 0.15);    // denim
    return vec3(0.14, 0.14, 0.14);                 // grey
  }
  vec3 ofSkinC(float h) {
    return mix(mix(vec3(0.6, 0.4, 0.3), vec3(0.34, 0.19, 0.11), clamp(h * 2.0, 0.0, 1.0)), vec3(0.1, 0.055, 0.035), clamp(h * 2.0 - 1.0, 0.0, 1.0));
  }
  vec3 ofHairC(float h) {
    if (h < 0.55) return vec3(0.022, 0.017, 0.014);
    if (h < 0.8) return vec3(0.09, 0.05, 0.028);
    if (h < 0.92) return vec3(0.34, 0.24, 0.12);
    return vec3(0.26, 0.26, 0.25);
  }

  // a pointed leaf from a to b, widest ~45% along
  float ofLeaf(vec2 p, vec2 a, vec2 b, float w) {
    vec2 m = mix(a, b, 0.45);
    return min(ofUCap(p, a, m, 0.006, w), ofUCap(p, m, b, w, 0.004));
  }
  // a planter by the glass: a snake plant or a fiddle-leaf fig.
  // x: pot, y: leaves, z: trunk, w: the nearest leaf's shade
  vec4 ofPlant(vec2 p, float ps) {
    float potW = 0.15 + 0.05 * ofHash(ps + 1.3);
    float potH = 0.32 + 0.12 * ofHash(ps + 2.9);
    float pot = ofTrap(p - vec2(0.0, potH * 0.5), potW * 0.8, potW, potH * 0.5) - 0.01;
    float leaf = 1e3;
    float stem = 1e3;
    float shade = 1.0;
    if (ofHash(ps) < 0.45) {
      // stiff blades fanned out of the pot
      for (int i = 0; i < 9; i++) {
        float fi = float(i);
        float u = fi / 8.0 - 0.5;
        float hh = ofHash(ps + fi * 3.7);
        vec2 b = vec2(u * potW * 1.2, potH - 0.03);
        float len = (0.5 + 0.5 * hh) * (1.0 - 0.55 * abs(u));
        vec2 tip = b + normalize(vec2(u * 0.7 + (hh - 0.5) * 0.18, 1.0)) * len;
        float dl = ofUCap(p, b, tip, 0.03, 0.003);
        if (dl < leaf) { leaf = dl; shade = 0.75 + 0.5 * hh; }
      }
    } else {
      // a slim trunk, broad leaves up its top two-thirds
      float top = potH + 0.8 + 0.4 * ofHash(ps + 4.1);
      stem = ofUCap(p, vec2(0.0, potH - 0.03), vec2(0.025, top - 0.06), 0.02, 0.011);
      for (int i = 0; i < 12; i++) {
        float fi = float(i);
        float k = fi / 11.0;
        float hh = ofHash(ps + fi * 5.1);
        float s = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;
        float ang = mix(-0.45, 0.55, hh) + k * 0.6;
        float len = mix(0.19, 0.28, ofHash(ps + fi * 2.3)) * (1.0 - 0.3 * k);
        vec2 b = vec2(0.02 * k, mix(potH + 0.38, top, k));
        vec2 dir = vec2(s * cos(ang), sin(ang));
        if (i == 11) dir = vec2(0.15, 1.0);
        float dl = ofLeaf(p, b, b + dir * len, 0.3 * len);
        if (dl < leaf) { leaf = dl; shade = 0.7 + 0.6 * hh; }
      }
    }
    return vec4(pot, leaf, stem, shade);
  }
  // the city reflected in the glass, at infinity: a skyline profile along the
  // face's reflected azimuth (so it slides across the panes as the drone moves)
  float ofSkyline(vec3 r) {
    float az = atan(r.x, max(r.z, 1e-3));
    float c = floor(az * 16.0 + 40.0);
    float h1 = ofHash(c * 1.37 + 2.0);
    float top = -0.03 + h1 * h1 * 0.2;
    // a second, nearer row, broader and lower
    float c2 = floor(az * 7.0 + 40.0);
    float h2 = ofHash(c2 * 2.11 + 9.0);
    top = max(top, -0.08 + h2 * 0.1);
    return smoothstep(-0.004, 0.004, top - r.y);
  }
  // Schlick on the glass (cos = view · normal)
  float ofFresnel(float c, float f0) { float k = 1.0 - c; float k2 = k * k; return f0 + (1.0 - f0) * k2 * k2 * k; }
`

/*
 * The interior. Runs inside main() after normal_fragment_maps; declares
 * ofEmit (added to the emissive radiance), ofF0 / ofDiffuse (the glass's
 * reflectance and a little diffuse for the spandrel), used after
 * lights_physical_fragment.
 */
const FRAG_BODY = /* glsl */ `
  vec3 ofEmit = vec3(0.0);
  vec3 ofMirror = vec3(0.2, 0.34, 0.44);       // the tower's mirror-tint glass (linear)
  vec3 ofF0 = ofMirror;
  vec3 ofDiffuse = ofMirror * 0.08;
  float ofRough = 0.06;
  vec3 ofTilt = vec3(0.0);
  {
    vec2 q = vOfP.xy;
    float on = vOfOn;
    float tenant = vOfA.z;
    float level = vOfA.w;
    float seed = vOfA.y;
    float dist = length(vOfRay);
    // pixel footprint in metres at this distance (AA for everything procedural)
    float px = max(0.004, dist * 0.0011);

    // the tower's curtain-wall grid: mullions at every unit edge, transoms at
    // the spandrel lines and the slab joint
    float mxd = abs(q.x / ${MOD.toFixed(4)} - floor(q.x / ${MOD.toFixed(4)} + 0.5)) * ${MOD.toFixed(4)};
    float tyd = min(min(abs(q.y - ${VIS_BOT.toFixed(2)}), abs(q.y - ${VIS_TOP.toFixed(2)})), min(q.y, ${FLOOR_H.toFixed(1)} - q.y));
    float joint = max(1.0 - smoothstep(0.045 - px * 0.5, 0.045 + px * 0.5, mxd), 1.0 - smoothstep(0.03 - px * 0.5, 0.03 + px * 0.5, tyd));
    float vision = step(${VIS_BOT.toFixed(2)}, q.y) * step(q.y, ${VIS_TOP.toFixed(2)});
    float spand = 1.0 - vision;
    float paneH = ofHash(floor(q.x / ${MOD.toFixed(4)}) * 7.1 + seed * 0.37);

    vec3 rd = normalize(vOfRay);
    rd.z = min(rd.z, -0.02);
    float cosV = -rd.z;
    vec3 room = vec3(0.0);
    if (vision > 0.001 && on > 0.001) {
      vec3 ro = vec3(q, 0.0);
      vec3 sgn = vec3(rd.x >= 0.0 ? 1.0 : -1.0, rd.y >= 0.0 ? 1.0 : -1.0, -1.0);
      vec3 rdS = sgn * max(abs(rd), vec3(1e-4));
      vec3 inv = 1.0 / rdS;
      const float RX = 3.0;
      const float RD = 9.0;
      float tx = (sgn.x * RX - ro.x) * inv.x;
      float ty = ((rd.y >= 0.0 ? ${CEIL.toFixed(2)} : 0.0) - ro.y) * inv.y;
      float tz = (-RD - ro.z) * inv.z;
      float t = min(tx, min(ty, tz));
      vec3 h = ro + rdS * t;

      // the office's light: warm 3000K or neutral 4000K, per office
      vec3 lightC = mix(vec3(1.0, 0.84, 0.64), vec3(0.95, 0.94, 0.9), step(0.62, ofHash(seed * 3.1)));
      vec3 accent = uAccent[int(clamp(floor(ofHash(seed * 7.7) * 8.0), 0.0, 7.0))];
      if (tenant > 0.5) accent = uAccent[int(clamp(seed, 0.0, 7.0))];
      float sw = max(0.02, (t + dist) * 0.0011);
      // wall-washer scallops from the ceiling strips (every 2.4 m)
      if (t == tz) {
        // back wall: the tenant's colour, washed by the ceiling lights
        float scB = exp(-(fract(h.x / 2.0 + 0.5) - 0.5) * (fract(h.x / 2.0 + 0.5) - 0.5) * 22.0) * smoothstep(1.2, ${CEIL.toFixed(2)}, h.y);
        room = accent * (0.5 + 0.28 * smoothstep(0.0, ${CEIL.toFixed(2)}, h.y) + 0.35 * scB);
        // a doorway to the core corridor, dimmer than the room
        float door = (1.0 - smoothstep(0.0, sw, ofBox(h.xy - vec2(ofHash(seed) * 2.8 - 1.4, 1.02), vec2(0.42, 1.02))));
        room = mix(room, vec3(0.62, 0.58, 0.52), door * 0.9);
      } else if (t == ty) {
        if (rd.y >= 0.0) {
          // ceiling: acoustic tile with linear LED strips parallel to the glass
          float s = abs(fract((h.z - 0.6) / 2.4) - 0.5) * 2.4;
          float strip = 1.0 - smoothstep(0.05, 0.05 + sw, s);
          room = vec3(0.3) + strip * vec3(3.4);
        } else {
          // floor: carpet with pools of light under the strips
          float pool = 0.5 + 0.5 * cos((h.z - 0.6) / 2.4 * 6.2832);
          room = vec3(0.13, 0.125, 0.12) * (0.7 + 0.6 * pool);
        }
      } else {
        // side walls: warm grey, scalloped by the wall washers, darker at the glass
        float u = fract((h.z - 0.6) / 2.4 + 0.5) - 0.5;
        float sc = exp(-u * u * 26.0) * smoothstep(1.3, ${CEIL.toFixed(2)}, h.y);
        room = vec3(0.6, 0.57, 0.53) * (0.4 + 0.24 * smoothstep(0.4, ${CEIL.toFixed(2)}, h.y) + 0.45 * sc) * (0.6 + 0.4 * smoothstep(0.0, 3.5, -h.z));
      }
      room *= lightC;

      // --- furniture and people: nearest hit wins ---
      vec3 sil = vec3(0.028, 0.024, 0.022) + accent * 0.02;
      // desk (a box) + a monitor seen from behind
      if (vOfD.z > 0.01) {
        vec3 bmin = vec3(vOfD.x - vOfD.z, 0.0, vOfD.y - 0.8);
        vec3 bmax = vec3(vOfD.x + vOfD.z, 0.74, vOfD.y);
        vec3 t0 = (bmin - ro) * inv;
        vec3 t1 = (bmax - ro) * inv;
        vec3 tn3 = min(t0, t1);
        vec3 tf3 = max(t0, t1);
        float tn = max(max(tn3.x, tn3.y), tn3.z);
        float tf = min(min(tf3.x, tf3.y), tf3.z);
        if (tn < tf && tn > 0.0 && tn < t) {
          t = tn;
          room = (tn == tn3.y) ? vec3(0.34, 0.3, 0.26) * lightC : vec3(0.05, 0.045, 0.04);
        }
        float tm = (vOfD.y - 0.5 - ro.z) * inv.z;
        if (tm > 0.0 && tm < t) {
          vec2 pm = (ro + rdS * tm).xy - vec2(vOfD.x + vOfD.z * 0.5, 0.0);
          float mon = min(ofBox(pm - vec2(0.0, 1.0), vec2(0.27, 0.16)) - 0.01, ofBox(pm - vec2(0.0, 0.8), vec2(0.03, 0.08)));
          float a = 1.0 - smoothstep(-sw, sw, mon);
          if (a > 0.5) t = tm;
          room = mix(room, sil * 1.4, a);
        }
      }
      // People and plants are drawn on upright cards turned to face the
      // camera (they're round things: a card square to the glass would thin
      // to a sliver seen from an angle). Lit by the ceiling from above and by
      // the daylight through the glass; a little of the room's light between
      // them and the glass keeps them soft, like people behind tinted glazing.
      vec3 camL = ro - vOfRay;
      vec3 illumTop = lightC * 0.74 + vec3(0.17, 0.19, 0.21);
      vec3 illumLow = lightC * 0.42 + vec3(0.17, 0.19, 0.21);
      // plant by the glass
      if (vOfD.w < 50.0) {
        vec2 F = vec2(vOfD.w, -0.75);
        vec2 vd = normalize(F - camL.xz);
        float den = dot(rdS.xz, vd);
        float tp = den > 1e-3 ? dot(F - ro.xz, vd) / den : -1.0;
        if (tp > 0.0 && tp < t) {
          vec3 P = ro + rdS * tp;
          vec2 pp = vec2(dot(P.xz - F, vec2(-vd.y, vd.x)), P.y);
          if (abs(pp.x) < 0.62 && pp.y < 1.9) {
            float fw = max(0.004, (tp + dist) * 0.0011) * 1.2;
            vec4 pl = ofPlant(pp, seed * 5.37 + vOfD.w * 1.9);
            float a = 1.0 - smoothstep(-fw, fw, min(pl.x, min(pl.y, pl.z)));
            if (a > 0.002) {
              float ph = ofHash(seed * 2.71 + vOfD.w);
              vec3 potC = ph < 0.4 ? vec3(0.5, 0.5, 0.48) : (ph < 0.7 ? vec3(0.035) : vec3(0.3, 0.12, 0.06));
              vec3 c = vec3(0.07, 0.05, 0.035);
              c = mix(c, vec3(0.04, 0.085, 0.032) * pl.w * mix(0.75, 1.3, smoothstep(0.5, 1.7, pp.y)), 1.0 - smoothstep(-fw, fw, pl.y));
              c = mix(c, potC, 1.0 - smoothstep(-fw, fw, pl.x));
              c *= mix(illumLow, illumTop, smoothstep(0.1, 1.7, pp.y));
              c = mix(c, room, 0.08);
              if (a > 0.5) t = tp;
              room = mix(room, c, a);
            }
          }
        }
      }
      // people: standing, talking, walking through, seated at their desks
      for (int k = 0; k < 3; k++) {
        vec4 f = k == 0 ? vOfF0 : (k == 1 ? vOfF1 : vOfF2);
        if (f.z < 0.5) continue;
        vec2 F = f.xy;
        vec2 vd = normalize(F - camL.xz);
        float den = dot(rdS.xz, vd);
        if (den < 1e-3) continue;
        float tc = dot(F - ro.xz, vd) / den;
        if (tc <= 0.0 || tc >= t) continue;
        vec3 P = ro + rdS * tc;
        float sc = abs(f.w);
        // f.w < 0 mirrors the pose (profiles face −x)
        vec2 pf = vec2(dot(P.xz - F, vec2(-vd.y, vd.x)) * sign(f.w), P.y) / sc;
        if (pf.x < -0.46 || pf.x > 0.66 || pf.y < -0.05 || pf.y > 1.83) continue;
        float fs = seed * 13.1 + float(k) * 7.3 + f.x * 3.7;
        float v = ofHash(fs + 7.9);
        vec4 dd = vec4(1e3);
        float dh = 1e3;
        if (f.z < 1.5) ofStandF(pf, v, dd, dh);
        else if (f.z < 2.5) ofSeatF(pf, v, dd, dh);
        else if (f.z < 3.5) ofWalk(pf, v, dd, dh);
        else if (f.z < 4.5) ofStandP(pf, v, dd, dh);
        else ofSeatP(pf, v, dd, dh);
        // AA a touch soft: they're behind two layers of glass
        float fw = max(0.004, (tc + dist) * 0.0011) * 1.3 / sc;
        float dAll = min(min(min(dd.x, dd.y), min(dd.z, dd.w)), dh);
        float a = 1.0 - smoothstep(-fw, fw, dAll);
        if (a < 0.002) continue;
        vec3 c = vec3(0.022, 0.021, 0.022);
        c = mix(c, ofBotC(ofHash(fs + 1.7)), 1.0 - smoothstep(-fw, fw, dd.y));
        c = mix(c, ofTopC(ofHash(fs)), 1.0 - smoothstep(-fw, fw, dd.z));
        c = mix(c, ofSkinC(ofHash(fs + 3.1)), 1.0 - smoothstep(-fw, fw, dd.w));
        c = mix(c, ofHairC(ofHash(fs + 5.3)), 1.0 - smoothstep(-fw, fw, dh));
        // round, not cut out: a little darker toward the outline
        c *= mix(illumLow, illumTop, smoothstep(0.1, 1.7, pf.y)) * mix(0.82, 1.0, smoothstep(0.0, 0.05, -dAll));
        c = mix(c, room, 0.1);
        if (a > 0.5) t = tc;
        room = mix(room, c, a);
      }
      // the whole room: the office's level x the chapter's interior intensity
      room *= uInterior * level * on;
      // light through the glass: tinted, minus what the glass reflects
      float fr = ofFresnel(cosV, 0.08);
      ofEmit = room * vec3(0.74, 0.82, 0.85) * (1.0 - fr) * vision;
    }
    // glass reflectance: the lit vision glass lets the room through; the
    // spandrels match the tower's (a slightly darker, softer mirror)
    vec3 visionF0 = vec3(0.065, 0.078, 0.086);
    ofF0 = mix(ofMirror * 0.62, visionF0, vision * on);
    ofDiffuse = mix(ofMirror * 0.05, vec3(0.0), vision * on);
    ofRough = mix(0.16, 0.035 + 0.05 * paneH, vision);
    // the city in the reflection: where the reflected ray meets the skyline
    // (or the streets below) the glass reflects dark buildings, not sky
    vec3 refl = vec3(rd.x, rd.y, -rd.z);
    float city = ofSkyline(refl);
    ofF0 *= 1.0 - 0.72 * city;
    ofEmit += vec3(0.05, 0.055, 0.06) * city * (1.0 - joint) * mix(0.35, 1.0, 1.0 - vision * on);
    // joints: dark gasket lines
    ofEmit *= 1.0 - joint;
    ofF0 = mix(ofF0, vec3(0.07), joint);
    ofDiffuse = mix(ofDiffuse, vec3(0.04, 0.043, 0.047), joint);
    ofRough = mix(ofRough, 0.42, joint);
    ofTilt = (vOfT * (paneH - 0.5) * 0.05 + vec3(0.0, 1.0, 0.0) * (ofHash(paneH * 91.7) - 0.5) * 0.035) * (1.0 - joint);
  }
  totalEmissiveRadiance += ofEmit;
`

const FRAG_NORMAL = /* glsl */ `
  // each unit sits a hair off true: reflections break up pane by pane (like the tower's)
  normal = normalize(normal + (viewMatrix * vec4(ofTilt, 0.0)).xyz);
`

const FRAG_LIGHTS = /* glsl */ `
  // glass is a dielectric with a coated F0: drive every path of the BRDF
  material.metalness = 0.0;
  material.roughness = max(ofRough, 0.0525) + geometryRoughness;
  material.diffuseColor = ofF0;
  material.diffuseContribution = ofDiffuse;
  material.specularColor = ofF0;
  material.specularColorBlended = ofF0;
  material.specularF90 = 1.0;
`

export interface Offices {
  mesh: THREE.InstancedMesh
  uniforms: { uLit: { value: number }; uSwayTop: { value: number }; uInterior: { value: number } }
  /** world position of the tenant's bay (bottom-centre) */
  tenantOrigin(i: number, out: THREE.Vector3): THREE.Vector3
}

/** Tenant accent colours for the back walls: timber, sage, terracotta, navy, limestone, walnut, olive, slate. */
const ACCENTS = ['#c8a57a', '#7f9a86', '#b8704f', '#48627f', '#d9cdb6', '#8d6a52', '#6b7c5c', '#8796a3']

export function makeOffices(mobile: boolean): Offices {
  const rows: { m: THREE.Matrix4; L: Layout }[] = []
  const r = rng(24681)
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const up = new THREE.Vector3(0, 1, 0)
  const tenantAt = new Map<string, number>()
  TENANT_SPOTS.forEach((s, i) => tenantAt.set(`${s.face}:${s.bay}:${s.floor}`, i))
  for (let face = 0; face < 2; face++) {
    q.setFromAxisAngle(up, face === 0 ? 0 : Math.PI / 2)
    for (let floor = 0; floor < MAX_FLOORS; floor++) {
      for (let bay = 0; bay < 5; bay++) {
        const ti = tenantAt.get(`${face}:${bay}:${floor}`)
        const order = r()
        const vacant = r() < (mobile ? 0.2 : 0.14)
        const lay = genericLayout(r)
        bayOrigin(face, bay, floor, p)
        const m = new THREE.Matrix4().compose(p, q, one)
        const neighbour = TENANT_SPOTS.some(s => s.face === face && s.floor === floor)
        if (ti !== undefined) {
          const t = TENANT_LAYOUTS[ti]
          rows.push({ m, L: { a: [floor + 0.02, ti, 1, 1.12], ...t } })
        } else {
          // the ground floor is the lobby (always lit); tenants' floor-mates are never vacant
          const litAt = vacant && !neighbour && floor > 0 ? 999 : floor + order * 0.85
          rows.push({ m, L: { a: [litAt, 10 + r() * 1000, 0, 0.72 + r() * 0.36], ...lay } })
        }
      }
    }
  }

  const geo = new THREE.PlaneGeometry(BAY, FLOOR_H)
  geo.translate(0, FLOOR_H / 2, 0)
  const n = rows.length
  const attr = (key: 'a' | 'f0' | 'f1' | 'f2' | 'd') => {
    const arr = new Float32Array(n * 4)
    rows.forEach((row, i) => arr.set(row.L[key], i * 4))
    return new THREE.InstancedBufferAttribute(arr, 4)
  }
  geo.setAttribute('aOfA', attr('a'))
  geo.setAttribute('aOfF0', attr('f0'))
  geo.setAttribute('aOfF1', attr('f1'))
  geo.setAttribute('aOfF2', attr('f2'))
  geo.setAttribute('aOfD', attr('d'))

  const uniforms = {
    uLit: { value: 0 },
    uSwayTop: { value: 0 },
    uInterior: { value: 1 },
    uAccent: { value: ACCENTS.map(c => new THREE.Color(c)) },
  }
  const mat = new THREE.MeshStandardMaterial({
    color: T.glass,
    metalness: 0.9,
    roughness: 0.06,
    envMapIntensity: 1.2,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  mat.onBeforeCompile = shader => {
    shader.uniforms.uLit = uniforms.uLit
    shader.uniforms.uSwayTop = uniforms.uSwayTop
    shader.uniforms.uInterior = uniforms.uInterior
    shader.uniforms.uAccent = uniforms.uAccent
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${FRAG_LIGHTS}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_BODY}\n${FRAG_NORMAL}`)
  }
  mat.customProgramCacheKey = () => 'tower-voices-offices'

  const mesh = new THREE.InstancedMesh(geo, mat, n)
  rows.forEach((row, i) => mesh.setMatrixAt(i, row.m))
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.name = 'voices-offices'

  return {
    mesh,
    uniforms,
    tenantOrigin(i, out) {
      const s = TENANT_SPOTS[i]
      return bayOrigin(s.face, s.bay, s.floor, out)
    },
  }
}
