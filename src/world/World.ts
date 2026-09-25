import * as THREE from 'three'
import type { Frame } from '../core/types'
import { Tower, CROWN_Y, CROWN_H, type TowerState } from './tower'
import { Crane, MAST_H } from './crane'
import { City } from './city'
import { Frontier, type FrontierState } from './frontier'
import { Site } from './site'
import { FLOORS, FLOOR_H } from '../kit/steel'

/*
 * The shared world for Hark Tower: a city at the edge of a construction site,
 * and THE TOWER rising in the middle of it, with a climbing crane on top.
 *
 *  - TIME OF DAY (params.time 0..1): dawn 0 → morning 0.25 → golden hour 0.5
 *    → dusk 0.75 → night 1. Drives the sky dome (gradient, sun, clouds,
 *    stars), sun + fill light colours, fog, city window lights, and the sky
 *    reflections on every metal/glass surface (PMREM keyframes).
 *  - THE TOWER (src/world/tower.ts): params.built / glazed / fitted (floors),
 *    ghost (blueprint of the unbuilt floors), crown (the Hark mark sign).
 *    world.tower.frontier = height of the erected steel in metres.
 *  - THE CRANE (src/world/crane.ts): rides on the core above the frontier;
 *    params.crane {yaw, reach 0..1, drop metres}; world.crane.hookWorld.
 *  - THE FRONTIER (src/world/frontier.ts): the working top of the steel —
 *    plank decking, edge protection, the raising gang, beam bundles, the
 *    jump-form rig, the construction hoist, sodium work lights (dimmed at
 *    dawn, full from golden hour; params.worklights scales them), sparks at
 *    the bolt-up points (params.activity).
 *  - STEEL SETTLES: pieces being placed hang above / outside their seats only
 *    while the build is catching up with the scroll; at rest all are seated.
 *  - THE SITE (src/world/site.ts): hoarding with the Hark graphic, site
 *    office, laydown yard, trucks, crew; street trees, cars, street lights.
 *    A chapter that stages its own ground site sets params.site = 0 every
 *    frame (hides everything inside the hoarding, and the hoarding).
 *  - SHADOWS: one sun shadow map (desktop) centred on params.focus.
 *  - THE SUN walks round the tower through the day (per-keyframe azimuth):
 *    dawn behind it, morning front-left (main face lit), golden hour
 *    front-right (both visible faces warm), sunset behind-right; blue hour
 *    and night after. Reflections include a far skyline and the city below
 *    under the haze (warm at golden hour, lit streets at night).
 *
 * Chapters set world.params every frame they care; the engine resets them to
 * defaults first; values are damped (so cuts never pop and the tower builds
 * visibly when a nav jump lands).
 */

export interface WorldParams {
  /** 0 dawn … 0.25 morning … 0.5 golden … 0.75 dusk … 1 night */
  time: number
  /** floors of steel erected (0..60, fractional = the floor being placed) */
  built: number
  /** floors with curtain wall (lags steel) */
  glazed: number
  /** floors lit inside (lags glass) */
  fitted: number
  /** 0..1 blueprint wireframe of the floors still to build */
  ghost: number
  /** 0..1 the Hark crown sign (only once all floors are built) */
  crown: number
  /**
   * crane: jib yaw (radians, 0 = +x), trolley reach 0..1, cable drop (m);
   * away 0..1 lowers the crane down into the core (dismantling it on camera
   * after topping out); snap = true skips the pose smoothing this frame
   * (for chapters that carry a load and need the hook exactly where asked)
   */
  crane: { yaw: number; reach: number; drop: number; away: number; snap: boolean }
  /** world point the sun's shadow frustum centres on (usually the frontier) */
  focus: THREE.Vector3
  /** fog density multiplier (1 = the time of day's own) */
  fog: number
  /** multiplier on sky reflections (scene.environmentIntensity) */
  env: number
  /** wind sway at the tower top (m); the phase runs on its own clock (reduced motion: keep 0) */
  sway: number
  /** 0..1 how busy the frontier is (spark bursts); 1 default, 0 = quiet */
  activity: number
  /**
   * 1 = show the world's ground site inside the hoarding (hoarding, apron,
   * set-out, cabins, laydown, trucks, ground crew); 0 = hide it because the
   * chapter stages its own (streets, trees and cars outside always show)
   */
  site: number
  /** 0..1 the world's construction hoist on the +x face (0 = hidden, for chapters that ride their own) */
  hoist: number
  /** multiplier on the frontier's sodium work lights (e.g. dim them at dawn close-ups) */
  worklights: number
}

type Key = {
  t: number
  zenith: string
  horizon: string
  /** sun elevation (deg) */
  sunEl: number
  /** sun azimuth (rad): sun direction = (sin az, ·, -cos az); 0 = behind the tower from +z */
  az: number
  sun: string
  /** the sky's glow round the sun (defaults to the sun colour; the afterglow after sunset) */
  glow?: string
  sunI: number
  sky: string
  ground: string
  hemiI: number
  fog: string
  fogD: number
  /** city window + street lights 0..1 */
  lights: number
  /** cloud cover 0..1 */
  cloud: number
  /** how fast the horizon colour gives way to the zenith (elevation, 0..1; small = a thin horizon band) */
  band: number
}

const KEYS: Key[] = [
  // dawn: low sun just behind the tower, peach haze, cool zenith, a few lights still on
  { t: 0, zenith: '#2b3d66', horizon: '#f4b183', sunEl: 1.5, az: -0.75, sun: '#ffb070', sunI: 2.2, sky: '#8e98b8', ground: '#5a4a3e', hemiI: 0.7, fog: '#d3b39c', fogD: 0.0014, lights: 0.3, cloud: 0.75, band: 0.24 },
  // early morning: sun climbing on the left, the haze burning off
  { t: 0.12, zenith: '#2f5c9e', horizon: '#dcd3c6', sunEl: 13, az: -1.7, sun: '#ffe2bd', sunI: 3.0, sky: '#9db6dc', ground: '#5d554c', hemiI: 0.85, fog: '#cdd2d4', fogD: 0.00085, lights: 0.04, cloud: 0.7, band: 0.3 },
  // morning: clean blue, main face lit from the front-left
  { t: 0.25, zenith: '#2a5eab', horizon: '#c3d9ec', sunEl: 30, az: -2.5, sun: '#fff3e0', sunI: 3.5, sky: '#a8c6ec', ground: '#6b6258', hemiI: 0.95, fog: '#c2d4e4', fogD: 0.0006, lights: 0, cloud: 0.6, band: 0.36 },
  // midday / afternoon: high sun swinging round the front
  { t: 0.38, zenith: '#2659a6', horizon: '#cfdfec', sunEl: 40, az: -3.25, sun: '#fff7ea', sunI: 3.6, sky: '#adc8ea', ground: '#6e655a', hemiI: 0.95, fog: '#c8d6e2', fogD: 0.00058, lights: 0, cloud: 0.55, band: 0.38 },
  // golden hour: low warm sun front-right, both visible faces glowing
  { t: 0.52, zenith: '#34598f', horizon: '#ffc98c', sunEl: 12, az: -4.0, sun: '#ffbd6a', sunI: 3.3, sky: '#9fb2d0', ground: '#6e5a48', hemiI: 0.62, fog: '#dcc2a4', fogD: 0.00062, lights: 0.02, cloud: 0.65, band: 0.2 },
  // late golden: long shadows, amber
  { t: 0.64, zenith: '#2e4a7d', horizon: '#ffb070', sunEl: 5, az: -4.9, sun: '#ffa257', sunI: 2.8, sky: '#8a98bb', ground: '#5e4a3e', hemiI: 0.58, fog: '#d5a887', fogD: 0.00075, lights: 0.12, cloud: 0.7, band: 0.2 },
  // sunset: the sun sets behind-right, orange sky, the city switching on
  { t: 0.74, zenith: '#26335e', horizon: '#ff8752', sunEl: 0.2, az: -5.7, sun: '#ff7a45', sunI: 1.7, sky: '#5d6a96', ground: '#3b3140', hemiI: 0.55, fog: '#be8676', fogD: 0.001, lights: 0.55, cloud: 0.8, band: 0.15, glow: '#ff7a45' },
  // blue hour: deep blue sky, a last ember band on the horizon, city lit
  { t: 0.86, zenith: '#0c1838', horizon: '#d9735a', sunEl: -5, az: -6.0, sun: '#6f7fb8', sunI: 0.7, sky: '#34457a', ground: '#1f2130', hemiI: 0.5, fog: '#6a5266', fogD: 0.0009, lights: 0.92, cloud: 0.55, band: 0.075, glow: '#ff6440' },
  // night
  { t: 1, zenith: '#040815', horizon: '#15203f', sunEl: -14, az: -6.3, sun: '#8ea4e0', sunI: 0.42, sky: '#27365f', ground: '#15171f', hemiI: 0.42, fog: '#352f45', fogD: 0.0009, lights: 1, cloud: 0.4, band: 0.1, glow: '#1b2442' },
]

/** KEYS with every colour pre-parsed (linear), so a frame never parses a hex string. */
type KeyColors = { zenith: THREE.Color; horizon: THREE.Color; sun: THREE.Color; glow: THREE.Color; sky: THREE.Color; ground: THREE.Color; fog: THREE.Color }
const KC: KeyColors[] = KEYS.map(k => ({
  zenith: new THREE.Color(k.zenith),
  horizon: new THREE.Color(k.horizon),
  sun: new THREE.Color(k.sun),
  glow: new THREE.Color(k.glow ?? k.sun),
  sky: new THREE.Color(k.sky),
  ground: new THREE.Color(k.ground),
  fog: new THREE.Color(k.fog),
}))

export const WORLD_DEFAULTS = {
  time: 0.3,
  built: 0,
  glazed: 0,
  fitted: 0,
  ghost: 1,
  crown: 0,
  fog: 1,
  env: 1,
  sway: 0,
  activity: 1,
  site: 1,
  hoist: 1,
  worklights: 1,
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith, uHorizon, uSunColor, uGlowColor, uFogColor, uSunDir;
  uniform float uTime, uNight, uCloud, uBand;
  varying vec3 vDir;
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 7.3; a *= 0.5; } return v; }
  void main() {
    vec3 d = normalize(vDir);
    float el = d.y;
    // gradient: horizon glow → zenith, with a denser haze band at the horizon
    float up = clamp(el, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-up / max(uBand, 0.02)));
    col = mix(col, uFogColor, (1.0 - smoothstep(0.0, 0.12 - 0.07 * uNight, el)) * mix(0.6, 0.75, uNight));
    // sun disc + glow
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    float glow = sd * sd * sd * sd;
    // the glow hugs the horizon once the sun is down (afterglow)
    float low = mix(1.0, 1.0 - smoothstep(0.0, 0.22, el), uNight);
    col += uGlowColor * (glow * glow * 0.9 + glow * 0.35) * (1.0 - uNight * 0.55) * low;
    col += uSunColor * smoothstep(0.9993, 0.9998, sd) * 6.0 * step(0.0, uSunDir.y + 0.02) * (1.0 - uNight);
    // clouds: a high, thin deck lit from the sun side
    if (el > 0.02) {
      vec2 cp = d.xz / (el + 0.08) * 1.4 + vec2(uTime * 0.004, 0.0);
      float c = smoothstep(0.52, 0.85, fbm(cp)) * uCloud * smoothstep(0.02, 0.2, el);
      // clouds: lit by the horizon by day, afterglow-edged and zenith-dark at night
      vec3 cc = mix(mix(uHorizon * 1.05, vec3(1.0), 0.35), uZenith * 1.7 + uHorizon * 0.12 * (1.0 - smoothstep(0.1, 0.35, el)), uNight) + uGlowColor * glow * 0.6;
      col = mix(col, cc, c * 0.8);
    }
    // stars at night
    if (uNight > 0.01 && el > 0.0) {
      vec2 sp = d.xz / (el + 0.3) * 180.0;
      float s = step(0.9975, hash(floor(sp))) * uNight * smoothstep(0.05, 0.4, el);
      col += vec3(s);
    }
    // below the horizon: the far city haze
    col = mix(col, uFogColor, 1.0 - smoothstep(-0.02, 0.0, el));
    col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`

/*
 * The lower half of the world for the reflection captures only: a far
 * skyline on the horizon, and below it the city under the haze. From the
 * frontier's heights most of what a curtain wall reflects is BELOW the
 * horizon, so this is what the glass shows: the warm horizon haze at golden
 * hour (brightest toward the sun), the darker city by day (the blue sky above
 * is what the glass shows then), street lights at night. The city is drawn as
 * seen from ~120 m up: lots in sun and shade, streets, fading into the haze
 * with distance, so a pane's slight tilt shows a different part of it than
 * its neighbour's.
 */
const SKYLINE_FRAG = /* glsl */ `
  uniform vec3 uFogColor, uHorizon, uGlowColor, uSunDir, uZenith;
  uniform float uNight, uLights;
  varying vec3 vDir;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float hash2(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main() {
    vec3 d = normalize(vDir);
    float a = atan(d.z, d.x);
    float el = asin(clamp(d.y, -1.0, 1.0));
    // two layers of buildings on the horizon: near (wide, taller) and far (narrow, lower)
    float c1 = floor(a * 22.0);
    float c2 = floor(a * 61.0);
    float h1 = 0.012 + 0.07 * pow(hash(c1 * 1.7), 2.5);
    float h2 = 0.005 + 0.03 * hash(c2 * 3.1);
    float top = max(h1, h2);
    if (el > top) discard;
    // the haze: the fog warmed by the horizon, brighter on the sun's side
    vec2 sxz = normalize(uSunDir.xz + vec2(1e-4, 0.0));
    float toSun = dot(normalize(d.xz + vec2(1e-4, 0.0)), sxz) * 0.5 + 0.5;
    float day = 1.0 - uNight;
    // warm keys (dawn, golden hour, sunset) lift the whole lower half toward the
    // horizon glow, so glass seen from above still mirrors it; by day it stays
    // as it was (dark city, the blue sky above is what the glass shows)
    float warm = clamp((uHorizon.r - uHorizon.b) * 1.6, 0.0, 1.0) * day;
    vec3 haze = mix(uFogColor, uHorizon, mix(0.45, 0.72, warm) * day) + uGlowColor * (0.3 * toSun * toSun * day);
    // skyline silhouettes: darker than the sky (they read as a reflection), hazier when warm
    float nearL = step(h2, h1);
    vec3 sil = mix(mix(uFogColor * 0.62, uFogColor * 0.4 + uHorizon * 0.06, nearL), haze * mix(0.66, 0.56, nearL), warm);
    // below: the city seen from ~120 m up (streets, rooftops, lots), fading
    // into the haze with distance; a pane's slight tilt shows a different part
    // of it than its neighbour's (a mirror, not paint)
    float dn = max(-el, 0.0);
    vec2 gp = d.xz / max(-d.y, 0.015) * 120.0;
    float gd = length(gp);
    vec2 sc = abs(fract(gp / 48.0) - 0.5) * 48.0;
    float street = 1.0 - smoothstep(4.0, 6.5, min(sc.x, sc.y));
    // lots: each block split its own way (no checkerboard)
    vec2 blkId = floor(gp / 48.0);
    vec2 lot = floor((gp + vec2(hash2(blkId), hash2(blkId + 2.0)) * 11.0) / mix(9.0, 21.0, hash2(blkId + 5.0))) + blkId * 7.0;
    float roof = hash2(lot + 3.0);
    float lit = 1.0 - smoothstep(0.0, 1.0, abs(hash2(lot + 11.0) - 0.5) * 12.0);
    // roofs in the low sun (warm) and in shadow (the sky's blue), streets in shade
    vec3 litRoof = uFogColor * mix(mix(0.4, 0.62, warm), 0.2, uNight) * (0.72 + 0.56 * roof) + uGlowColor * 0.14 * warm * roof;
    vec3 shadeRoof = mix(uFogColor * 0.4, uZenith * 0.9 + uFogColor * 0.22, 0.55 * day) * (0.8 + 0.4 * roof);
    vec3 below = mix(litRoof, shadeRoof, step(0.55, hash2(lot + 17.0)) * 0.65);
    below = mix(below, mix(uFogColor * 0.26, uZenith * 0.5 + uFogColor * 0.1, 0.5 * day) * mix(1.0, 0.55, uNight), street * 0.85);
    float far = 1.0 - exp(-gd / mix(1500.0, 1100.0, warm));
    below = mix(below, mix(uFogColor * 0.55, mix(sil, haze, 0.55), warm), far);
    // a thin bright band right under the horizon line (the haze at the far edge)
    below = mix(below, haze, exp(-dn / 0.025) * mix(0.35, 0.85, warm));
    vec3 col = el > 0.0 ? sil : below;
    // windows at night: the skyline's; below, street lights along every street
    // and the odd lit roof-light (coarse enough to survive the PMREM)
    vec2 w = vec2(a * 900.0, el * 900.0);
    float win = step(0.62, hash(floor(w.x) * 7.1 + floor(w.y) * 13.7)) * step(0.3, fract(w.x)) * step(0.4, fract(w.y));
    vec2 lp = abs(fract(gp / 24.0) - 0.5) * 24.0;
    float lamps = street * (1.0 - smoothstep(1.5, 5.0, min(lp.x, lp.y))) + (1.0 - street) * lit * step(0.8, roof);
    float lights = el > 0.0 ? win * 0.9 : lamps * 1.4 * (1.0 - far * 0.6) * smoothstep(0.004, 0.03, dn);
    col += vec3(1.0, 0.72, 0.42) * lights * uLights;
    gl_FragColor = vec4(col, 1.0);
  }
`

const ENV_STEPS = 12

export class World {
  object = new THREE.Group()
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  tower: Tower
  crane: Crane
  city: City
  frontier: Frontier
  site: Site
  params: WorldParams = {
    ...WORLD_DEFAULTS,
    crane: { yaw: 0.6, reach: 0.55, drop: 18, away: 0, snap: false },
    focus: new THREE.Vector3(0, 0, 0),
  }
  /** the crane's smoothed pose this frame (what's drawn) */
  cranePose = { yaw: 0.6, reach: 0.55, drop: 18, away: 0 }
  private cur = {
    time: WORLD_DEFAULTS.time,
    built: 0,
    glazed: 0,
    fitted: 0,
    ghost: 1,
    crown: 0,
    fog: 1,
    env: 1,
    sway: 0,
    swayPhase: 0,
    activity: 1,
    away: 0,
    worklights: 1,
    yaw: 0.6,
    reach: 0.55,
    drop: 18,
  }
  private first = true
  private skyU = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uGlowColor: { value: new THREE.Color() },
    uFogColor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 0.2, -1) },
    uTime: { value: 0 },
    uNight: { value: 0 },
    uCloud: { value: 0.8 },
    uLights: { value: 0 },
    uBand: { value: 0.3 },
  }
  private dome: THREE.Mesh
  private envScene = new THREE.Scene()
  private envMaps: (THREE.Texture | null)[] = new Array(ENV_STEPS + 1).fill(null)
  private envIndex = -1
  private pmrem: THREE.PMREMGenerator | null = null
  private fog: THREE.FogExp2
  private tmpV = new THREE.Vector3()
  /** 0..1: the steel / curtain wall still catching up with the scroll (pieces settle as it falls to 0) */
  private motion = 0
  /** persistent per-frame inputs for the tower and the frontier (no per-frame allocation) */
  private towerState: Required<TowerState> = {
    sway: 0,
    swayPhase: 0,
    built: 0,
    glazed: 0,
    fitted: 0,
    ghost: 1,
    crown: 0,
    night: 0,
    camToCrown: 200,
    motion: 0,
    horizon: new THREE.Color(),
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    sky: 1,
    warm: 0,
  }
  private frontierState: FrontierState

  constructor(
    private scene: THREE.Scene,
    private mobile: boolean,
    private renderer?: THREE.WebGLRenderer,
  ) {
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: true,
      fog: false,
      uniforms: this.skyU,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    })
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24), skyMat)
    this.dome.frustumCulled = false
    this.dome.renderOrder = -10
    this.object.add(this.dome)
    // the env-capture scene uses the same sky material (clouds and all)
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat)
    this.envScene.add(envDome)
    // (a full sphere inside the dome: it discards above the skyline)
    const skyline = new THREE.Mesh(
      new THREE.SphereGeometry(45, 64, 32),
      new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: this.skyU, vertexShader: SKY_VERT, fragmentShader: SKYLINE_FRAG }),
    )
    this.envScene.add(skyline)

    this.sun = new THREE.DirectionalLight(0xffffff, 3)
    if (!mobile) {
      this.sun.castShadow = true
      this.sun.shadow.mapSize.set(2048, 2048)
      const cam = this.sun.shadow.camera
      cam.left = -55
      cam.right = 55
      cam.top = 55
      cam.bottom = -55
      cam.near = 1
      cam.far = 400
      this.sun.shadow.bias = -0.0004
      this.sun.shadow.normalBias = 0.04
    }
    scene.add(this.sun)
    scene.add(this.sun.target)
    this.hemi = new THREE.HemisphereLight(0xb8d2f0, 0x6b6258, 0.9)
    scene.add(this.hemi)
    this.fog = new THREE.FogExp2(0xcfdbe4, 0.0012)
    scene.fog = this.fog

    // the city, the tower and the crane live in the scene (not in the camera-centred object)
    this.city = new City(mobile)
    scene.add(this.city.root)
    this.tower = new Tower(mobile)
    scene.add(this.tower.root)
    this.crane = new Crane(mobile)
    scene.add(this.crane.root)
    this.frontier = new Frontier(mobile)
    scene.add(this.frontier.root)
    this.site = new Site(mobile)
    scene.add(this.site.root)

    if (renderer) this.pmrem = new THREE.PMREMGenerator(renderer)
    const tower = this.tower
    this.frontierState = {
      built: 0,
      coreTop: 0,
      lights: 0,
      hoist: true,
      activity: 1,
      calm: false,
      time: 0,
      dt: 0,
      swayAt: (y: number) => tower.swayAt(y),
    }
  }

  resetParams() {
    const p = this.params
    p.time = WORLD_DEFAULTS.time
    p.built = WORLD_DEFAULTS.built
    p.glazed = WORLD_DEFAULTS.glazed
    p.fitted = WORLD_DEFAULTS.fitted
    p.ghost = WORLD_DEFAULTS.ghost
    p.crown = WORLD_DEFAULTS.crown
    p.fog = WORLD_DEFAULTS.fog
    p.env = WORLD_DEFAULTS.env
    p.sway = WORLD_DEFAULTS.sway
    p.activity = WORLD_DEFAULTS.activity
    p.site = WORLD_DEFAULTS.site
    p.hoist = WORLD_DEFAULTS.hoist
    p.worklights = WORLD_DEFAULTS.worklights
    p.crane.yaw = 0.6
    p.crane.reach = 0.55
    p.crane.drop = 18
    p.crane.away = 0
    p.crane.snap = false
    p.focus.set(0, this.tower.frontier, 0)
  }

  /** keyframe sample (persistent, filled by sample()): keys a → b at k */
  private sa = KEYS[0]
  private sb = KEYS[1]
  private sca = KC[0]
  private scb = KC[1]
  private sk = 0

  /** Sample the keyframes at t (0..1) into sa/sb/sca/scb/sk. */
  private sample(t: number) {
    t = THREE.MathUtils.clamp(t, 0, 1)
    let i = 0
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++
    this.sa = KEYS[i]
    this.sb = KEYS[i + 1]
    this.sca = KC[i]
    this.scb = KC[i + 1]
    this.sk = THREE.MathUtils.smoothstep(t, KEYS[i].t, KEYS[i + 1].t)
  }

  /**
   * Give the scene a real environment before shader prewarm: lit programs key
   * on the env map, so compiling without one builds programs nobody uses.
   */
  warmEnv(t = 0) {
    this.envFor(t, 0)
  }

  /** Capture the sky (+ skyline and city below) at keyframe `idx` into a PMREM. */
  private buildEnv(idx: number) {
    if (!this.pmrem || this.envMaps[idx]) return
    const saved = this.skyState(idx / ENV_STEPS)
    this.envMaps[idx] = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, { size: this.mobile ? 64 : 128 }).texture
    this.skyState(saved)
  }

  /**
   * Sky reflections for time `t` (PMREM keyframes, cached). The current one is
   * built on demand; the rest are warmed one per frame after the first second
   * so scrolling into a new time of day never stalls on a capture.
   */
  private envFor(t: number, time: number) {
    if (!this.pmrem) return
    const idx = Math.round(THREE.MathUtils.clamp(t, 0, 1) * ENV_STEPS)
    if (idx !== this.envIndex) {
      this.buildEnv(idx)
      this.envIndex = idx
      this.scene.environment = this.envMaps[idx]
    } else if (time > 1.2 && this.envPending) {
      let next = -1
      for (let i = 0; i < this.envMaps.length; i++)
        if (!this.envMaps[i]) {
          next = i
          break
        }
      if (next >= 0) this.buildEnv(next)
      else this.envPending = false
    }
  }
  private envPending = true

  /** Apply the sky uniforms for time t; returns the previous time for restoring. */
  private lastSkyT = 0
  private skyState(t: number) {
    const prev = this.lastSkyT
    this.lastSkyT = t
    this.sample(t)
    const a = this.sa
    const b = this.sb
    const ca = this.sca
    const cb = this.scb
    const k = this.sk
    const u = this.skyU
    u.uZenith.value.copy(ca.zenith).lerp(cb.zenith, k)
    u.uHorizon.value.copy(ca.horizon).lerp(cb.horizon, k)
    u.uSunColor.value.copy(ca.sun).lerp(cb.sun, k)
    u.uGlowColor.value.copy(ca.glow).lerp(cb.glow, k)
    u.uFogColor.value.copy(ca.fog).lerp(cb.fog, k)
    const el = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(a.sunEl, b.sunEl, k))
    // the sun walks round the tower (see the keys): behind at dawn, front-left
    // in the morning, front-right at golden hour, sets behind-right
    const az = THREE.MathUtils.lerp(a.az, b.az, k)
    u.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
    u.uNight.value = THREE.MathUtils.smoothstep(t, 0.72, 0.97)
    u.uCloud.value = THREE.MathUtils.lerp(a.cloud, b.cloud, k)
    u.uLights.value = THREE.MathUtils.lerp(a.lights, b.lights, k)
    u.uBand.value = THREE.MathUtils.lerp(a.band, b.band, k)
    return prev
  }

  update(frame: Frame, camera: THREE.Camera) {
    const p = this.params
    const c = this.cur
    const k = this.first ? 1 : 1 - Math.exp(-3.2 * frame.dt)
    const kb = this.first ? 1 : 1 - Math.exp(-2.2 * frame.dt)
    this.first = false
    c.time += (p.time - c.time) * k
    c.built += (p.built - c.built) * kb
    // exponential damping never quite arrives: snap the last centimetres so
    // 'topped out' (built = 60) really happens
    if (Math.abs(p.built - c.built) < 0.02) c.built = p.built
    c.glazed += (p.glazed - c.glazed) * kb
    c.fitted += (p.fitted - c.fitted) * kb
    if (Math.abs(p.glazed - c.glazed) < 0.02) c.glazed = p.glazed
    if (Math.abs(p.fitted - c.fitted) < 0.02) c.fitted = p.fitted
    // pieces only hang above / outside their seats while the build is moving;
    // once the scroll rests they settle (nothing hovers at rest)
    const lag = Math.max(Math.abs(p.built - c.built), Math.abs(p.glazed - c.glazed))
    const moving = THREE.MathUtils.smoothstep(lag, 0.0, 0.05)
    this.motion += (moving - this.motion) * (moving > this.motion ? 1 : k)
    c.ghost += (p.ghost - c.ghost) * k
    c.crown += (p.crown - c.crown) * k
    c.fog += (p.fog - c.fog) * k
    c.env += (p.env - c.env) * k
    // reduced motion: the tower never sways, whatever a chapter asks for
    c.sway += ((frame.reducedMotion ? 0 : p.sway) - c.sway) * (1 - Math.exp(-1.6 * frame.dt))
    c.swayPhase += frame.dt * 2.1
    c.activity += (p.activity - c.activity) * k
    let dy = p.crane.yaw - c.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    c.yaw += dy * k
    c.reach += (p.crane.reach - c.reach) * k
    c.drop += (p.crane.drop - c.drop) * k
    c.away += (p.crane.away - c.away) * kb
    if (p.crane.snap) {
      c.yaw = p.crane.yaw
      c.reach = p.crane.reach
      c.drop = p.crane.drop
      c.away = p.crane.away
    }
    c.worklights += (p.worklights - c.worklights) * k
    this.cranePose.yaw = c.yaw
    this.cranePose.reach = c.reach
    this.cranePose.drop = c.drop
    this.cranePose.away = c.away

    // sky + lights for the time of day
    this.skyState(c.time)
    const a = this.sa
    const b = this.sb
    const kk = this.sk
    const u = this.skyU
    u.uTime.value = frame.time
    this.sun.color.copy(u.uSunColor.value)
    this.sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, kk)
    this.hemi.color.copy(this.sca.sky).lerp(this.scb.sky, kk)
    this.hemi.groundColor.copy(this.sca.ground).lerp(this.scb.ground, kk)
    this.hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, kk)
    this.fog.color.copy(u.uFogColor.value)
    this.fog.density = THREE.MathUtils.lerp(a.fogD, b.fogD, kk) * c.fog
    this.renderer?.setClearColor(u.uFogColor.value)
    const lights = u.uLights.value
    this.city.update(lights)
    this.site.update(lights)
    this.site.onSite.visible = p.site > 0.5
    this.scene.environmentIntensity = c.env * (1 - u.uNight.value * 0.55)
    this.envFor(c.time, frame.time)

    // the tower
    const night = u.uNight.value
    const ts = this.towerState
    ts.sway = c.sway
    ts.swayPhase = c.swayPhase
    ts.built = c.built
    ts.glazed = c.glazed
    ts.fitted = c.fitted
    ts.ghost = c.ghost
    ts.crown = c.crown
    ts.night = night
    ts.camToCrown = camera.position.distanceTo(this.tmpV.set(0, CROWN_Y + CROWN_H / 2, 0))
    ts.motion = this.motion
    // the curtain wall's sky: the horizon it mirrors at grazing angles, the
    // sun it glints (only while the sun is up), scaled down after dark
    ts.horizon.copy(u.uHorizon.value)
    ts.sunDir.copy(u.uSunDir.value)
    ts.sunColor.copy(u.uSunColor.value).multiplyScalar((this.sun.intensity / 3.3) * THREE.MathUtils.smoothstep(u.uSunDir.value.y, -0.01, 0.07))
    ts.sky = c.env * (1 - night * 0.7)
    const hz = u.uHorizon.value
    ts.warm = THREE.MathUtils.clamp((hz.r - hz.b) * 1.6, 0, 1) * (1 - night)
    // (reduced motion: the blueprint's scan line holds still)
    this.tower.update(ts, frame.reducedMotion ? 4 : frame.time)

    // the crane rides the core, two floors above the steel (hidden once the crown lights)
    const coreTop = Math.min(FLOORS, c.built + 2) * FLOOR_H
    // 'away' lowers the crane down through the core; without it the old rule
    // still applies (it goes when the crown reaches full brightness)
    const sink = c.away * (MAST_H + 16)
    this.crane.root.position.set(this.tower.swayAt(coreTop), coreTop - sink, 0)
    this.crane.root.visible = c.away < 0.99 && !(c.crown >= 0.98 && c.away < 0.01)
    this.crane.set(c.yaw, c.reach, c.drop)
    this.crane.update(frame.dt, frame.time, night, frame.reducedMotion)

    // the working frontier: work lights at dawn (dimmed: the dawn close-ups
    // are low and near, where full sodium glares) and from golden hour on
    const t = c.time
    const work = Math.max(0.55 * (1 - THREE.MathUtils.smoothstep(t, 0.04, 0.13)), THREE.MathUtils.smoothstep(t, 0.6, 0.73))
    const fs = this.frontierState
    fs.built = c.built
    fs.coreTop = coreTop
    fs.lights = work * c.worklights
    fs.hoist = p.hoist > 0.5
    fs.activity = c.activity
    fs.calm = frame.reducedMotion
    fs.time = frame.time
    fs.dt = frame.dt
    this.frontier.update(fs, this.renderer?.domElement.height ?? frame.height)

    // sun + shadow frustum centred on the focus point
    const sd = u.uSunDir.value
    this.sun.target.position.copy(p.focus)
    this.sun.position.copy(p.focus).addScaledVector(sd, 200)
    this.sun.target.updateMatrixWorld()

    this.object.position.copy(camera.position)
  }
}
