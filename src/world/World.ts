import * as THREE from 'three'
import type { Frame } from '../core/types'
import { Tower } from './tower'
import { Crane, MAST_H } from './crane'
import { City } from './city'
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
 *  - SHADOWS: one sun shadow map (desktop) centred on params.focus.
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
  /** crane: jib yaw (radians, 0 = +x), trolley reach 0..1, cable drop (m) */
  crane: { yaw: number; reach: number; drop: number }
  /** world point the sun's shadow frustum centres on (usually the frontier) */
  focus: THREE.Vector3
  /** fog density multiplier (1 = the time of day's own) */
  fog: number
  /** multiplier on sky reflections (scene.environmentIntensity) */
  env: number
}

type Key = {
  t: number
  zenith: string
  horizon: string
  sunEl: number
  sun: string
  sunI: number
  sky: string
  ground: string
  hemiI: number
  fog: string
  fogD: number
  lights: number
}

const KEYS: Key[] = [
  { t: 0, zenith: '#34466a', horizon: '#f0b98f', sunEl: 2, sun: '#ffb67a', sunI: 2.4, sky: '#8fa3c7', ground: '#5a4a3c', hemiI: 0.75, fog: '#d9c1aa', fogD: 0.0019, lights: 0.05 },
  { t: 0.25, zenith: '#2f64b0', horizon: '#bcd6ec', sunEl: 28, sun: '#fff4e2', sunI: 3.4, sky: '#a9c8ef', ground: '#6b6258', hemiI: 0.95, fog: '#bfd3e6', fogD: 0.0008, lights: 0 },
  { t: 0.5, zenith: '#355f9b', horizon: '#ffd09a', sunEl: 9, sun: '#ffbf6e', sunI: 3.1, sky: '#9fb6d6', ground: '#6e5a48', hemiI: 0.8, fog: '#efcfab', fogD: 0.0013, lights: 0.02 },
  { t: 0.75, zenith: '#1b2748', horizon: '#ff8c5f', sunEl: 0.5, sun: '#ff7c4a', sunI: 1.5, sky: '#5a6b93', ground: '#3b3140', hemiI: 0.55, fog: '#b98a7e', fogD: 0.0016, lights: 0.6 },
  { t: 1, zenith: '#060a17', horizon: '#1b2442', sunEl: -12, sun: '#8ea4e0', sunI: 0.45, sky: '#2c3a63', ground: '#161820', hemiI: 0.4, fog: '#141a2b', fogD: 0.0015, lights: 1 },
]

export const WORLD_DEFAULTS = {
  time: 0.3,
  built: 0,
  glazed: 0,
  fitted: 0,
  ghost: 1,
  crown: 0,
  fog: 1,
  env: 1,
}

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith, uHorizon, uSunColor, uFogColor, uSunDir;
  uniform float uTime, uNight, uCloud;
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
    vec3 col = mix(uHorizon, uZenith, 1.0 - (1.0 - up) * (1.0 - up) * (1.0 - up));
    col = mix(col, uFogColor, (1.0 - smoothstep(0.0, 0.12, el)) * 0.6);
    // sun disc + glow
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    float glow = sd * sd * sd * sd;
    col += uSunColor * (glow * glow * 0.9 + glow * 0.35) * (1.0 - uNight * 0.85);
    col += uSunColor * smoothstep(0.9993, 0.9998, sd) * 6.0 * step(0.0, uSunDir.y + 0.02) * (1.0 - uNight);
    // clouds: a high, thin deck lit from the sun side
    if (el > 0.02) {
      vec2 cp = d.xz / (el + 0.08) * 1.4 + vec2(uTime * 0.004, 0.0);
      float c = smoothstep(0.52, 0.85, fbm(cp)) * uCloud * smoothstep(0.02, 0.2, el);
      vec3 cc = mix(uHorizon * 1.05, vec3(1.0), 0.35) * (1.0 - uNight * 0.8) + uSunColor * glow * 0.6;
      col = mix(col, cc, c * 0.8);
    }
    // stars at night
    if (uNight > 0.01 && el > 0.0) {
      vec2 sp = d.xz / (el + 0.3) * 180.0;
      float s = step(0.9975, hash(floor(sp))) * uNight * smoothstep(0.05, 0.4, el);
      col += vec3(s);
    }
    // below the horizon: the far city haze
    col = mix(col, uFogColor * 0.85, 1.0 - smoothstep(-0.02, 0.0, el));
    col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
  }
`

const ENV_STEPS = 8

export class World {
  object = new THREE.Group()
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  tower: Tower
  crane: Crane
  city: City
  params: WorldParams = {
    ...WORLD_DEFAULTS,
    crane: { yaw: 0.6, reach: 0.55, drop: 18 },
    focus: new THREE.Vector3(0, 0, 0),
  }
  private cur = {
    time: WORLD_DEFAULTS.time,
    built: 0,
    glazed: 0,
    fitted: 0,
    ghost: 1,
    crown: 0,
    fog: 1,
    env: 1,
    yaw: 0.6,
    reach: 0.55,
    drop: 18,
  }
  private first = true
  private skyU = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uFogColor: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 0.2, -1) },
    uTime: { value: 0 },
    uNight: { value: 0 },
    uCloud: { value: 0.8 },
  }
  private dome: THREE.Mesh
  private envScene = new THREE.Scene()
  private envMaps: (THREE.Texture | null)[] = new Array(ENV_STEPS + 1).fill(null)
  private envIndex = -1
  private pmrem: THREE.PMREMGenerator | null = null
  private fog: THREE.FogExp2
  private tmpA = new THREE.Color()
  private tmpB = new THREE.Color()

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

    if (renderer) this.pmrem = new THREE.PMREMGenerator(renderer)
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
    p.crane.yaw = 0.6
    p.crane.reach = 0.55
    p.crane.drop = 18
    p.focus.set(0, this.tower.frontier, 0)
  }

  /** Sample the keyframes at t (0..1). */
  private sample(t: number) {
    t = THREE.MathUtils.clamp(t, 0, 1)
    let i = 0
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++
    const a = KEYS[i]
    const b = KEYS[i + 1]
    const k = THREE.MathUtils.smoothstep(t, a.t, b.t)
    return { a, b, k }
  }

  private mixColor(out: THREE.Color, a: string, b: string, k: number) {
    return out.copy(this.tmpA.set(a)).lerp(this.tmpB.set(b), k)
  }

  /** Sky reflections for time `t` (PMREM keyframes, built lazily and cached). */
  private envFor(t: number) {
    if (!this.pmrem) return
    const idx = Math.round(THREE.MathUtils.clamp(t, 0, 1) * ENV_STEPS)
    if (idx === this.envIndex) return
    if (!this.envMaps[idx]) {
      // capture the sky at exactly this keyframe's time
      const saved = this.skyState(idx / ENV_STEPS)
      this.envMaps[idx] = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, { size: this.mobile ? 64 : 128 }).texture
      this.skyState(saved)
    }
    this.envIndex = idx
    this.scene.environment = this.envMaps[idx]
  }

  /** Apply the sky uniforms for time t; returns the previous time for restoring. */
  private lastSkyT = 0
  private skyState(t: number) {
    const prev = this.lastSkyT
    this.lastSkyT = t
    const { a, b, k } = this.sample(t)
    const u = this.skyU
    this.mixColor(u.uZenith.value, a.zenith, b.zenith, k)
    this.mixColor(u.uHorizon.value, a.horizon, b.horizon, k)
    this.mixColor(u.uSunColor.value, a.sun, b.sun, k)
    this.mixColor(u.uFogColor.value, a.fog, b.fog, k)
    const el = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(a.sunEl, b.sunEl, k))
    // the sun travels from behind-left (dawn) to behind-right (dusk)
    const az = THREE.MathUtils.lerp(-0.95, 0.95, t)
    u.uSunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
    u.uNight.value = THREE.MathUtils.smoothstep(t, 0.72, 0.97)
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
    c.glazed += (p.glazed - c.glazed) * kb
    c.fitted += (p.fitted - c.fitted) * kb
    c.ghost += (p.ghost - c.ghost) * k
    c.crown += (p.crown - c.crown) * k
    c.fog += (p.fog - c.fog) * k
    c.env += (p.env - c.env) * k
    let dy = p.crane.yaw - c.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    c.yaw += dy * k
    c.reach += (p.crane.reach - c.reach) * k
    c.drop += (p.crane.drop - c.drop) * k

    // sky + lights for the time of day
    this.skyState(c.time)
    const { a, b, k: kk } = this.sample(c.time)
    const u = this.skyU
    u.uTime.value = frame.time
    this.sun.color.copy(u.uSunColor.value)
    this.sun.intensity = THREE.MathUtils.lerp(a.sunI, b.sunI, kk)
    this.mixColor(this.hemi.color, a.sky, b.sky, kk)
    this.mixColor(this.hemi.groundColor, a.ground, b.ground, kk)
    this.hemi.intensity = THREE.MathUtils.lerp(a.hemiI, b.hemiI, kk)
    this.fog.color.copy(u.uFogColor.value)
    this.fog.density = THREE.MathUtils.lerp(a.fogD, b.fogD, kk) * c.fog
    this.renderer?.setClearColor(u.uFogColor.value)
    this.city.update(THREE.MathUtils.lerp(a.lights, b.lights, kk))
    this.scene.environmentIntensity = c.env * (1 - u.uNight.value * 0.55)
    this.envFor(c.time)

    // the tower
    const night = u.uNight.value
    this.tower.update({ built: c.built, glazed: c.glazed, fitted: c.fitted, ghost: c.ghost, crown: c.crown, night }, frame.time)

    // the crane rides the core, two floors above the steel (hidden once topped out)
    const coreTop = Math.min(FLOORS, c.built + 2) * FLOOR_H
    this.crane.root.position.set(0, coreTop, 0)
    this.crane.root.visible = c.crown < 0.98
    this.crane.set(c.yaw, c.reach, c.drop)
    this.crane.update()

    // sun + shadow frustum centred on the focus point
    const sd = u.uSunDir.value
    this.sun.target.position.copy(p.focus)
    this.sun.position.copy(p.focus).addScaledVector(sd, 200)
    this.sun.target.updateMatrixWorld()

    this.object.position.copy(camera.position)
    void MAST_H
  }
}
