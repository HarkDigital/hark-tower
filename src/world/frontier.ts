import * as THREE from 'three'
import { FLOOR_H, FLOORS, HIVIS, MAT, T, TC, TOWER_W, Sparks, iBeamGeometry, instancedDepth, latticeGeometry, mergeAll, personGeometry, tint } from '../kit/steel'

/*
 * THE FRONTIER — the working top of the steel, which follows the erection up
 * the tower (world.tower.frontier) so every chapter's camera finds a real site
 * there:
 *
 *  - temporary timber plank decking on the top completed level, with the
 *    raising gang (a few ironworkers in hi-vis) and two beam bundles on
 *    dunnage waiting to be flown into place
 *  - yellow edge protection (posts, top/mid rails, toe boards) round the level
 *  - the jump-form rig climbing the concrete core ahead of the steel
 *  - a rack-and-pinion construction hoist on the east (+x) face: mast from the
 *    ground to the frontier, tied back every 12 m, its car shuttling up/down
 *  - sodium work lights on poles that switch on toward dusk (and at dawn),
 *    with a warm point light pooling on the steel
 *  - sparks bursting now and then at the bolt-up / splice points (off under
 *    reduced motion; params.activity scales them)
 *
 * When a floor completes, the kit is jumped up to the next level (a quick,
 * eased lift over the last ~12% of the floor) — never a pop.
 */

const HALF = TOWER_W / 2
const MAST_SEG = 6
const MAST_X = HALF + 0.45 + 1.35
const MAST_Z = -6
const HOIST_V = 1.6

export interface FrontierState {
  /** floors of steel erected (damped, fractional) */
  built: number
  /** height of the concrete core top (m) */
  coreTop: number
  /** 0..1 work lights */
  lights: number
  /** 0..1 how busy the gang is (sparks) */
  activity: number
  /** reduced motion: no sparks, the hoist parked */
  calm: boolean
  /** false = the hoist is hidden (a chapter rides its own) */
  hoist?: boolean
  time: number
  dt: number
  /** x sway at a height (m) */
  swayAt: (y: number) => number
}

function glowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color(T.sodium) }, uOn: { value: 0 }, uSizeM: { value: 2.4 }, uPx: { value: 900 } },
    vertexShader: /* glsl */ `
      uniform float uSizeM, uPx;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(uSizeM * projectionMatrix[1][1] * 0.5 * uPx / max(-mv.z, 1.0), 2.0, 96.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOn;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = 1.0 - smoothstep(0.0, 1.0, d);
        a = a * a;
        float core = 1.0 - smoothstep(0.0, 0.18, d);
        gl_FragColor = vec4(uColor * (a * 0.9 + core * 3.0) * uOn, 1.0);
      }
    `,
  })
}

export class Frontier {
  root = new THREE.Group()
  /** the top-level kit (decking, rails, gang, bundles, lights) */
  private level = new THREE.Group()
  private rig = new THREE.Group()
  private hoistMast: THREE.InstancedMesh
  private hoistTies: THREE.InstancedMesh
  private car = new THREE.Group()
  private lampMat: THREE.MeshBasicMaterial
  private glow: THREE.ShaderMaterial
  private light: THREE.PointLight
  private sparks: Sparks
  private emitters: THREE.Vector3[] = []
  private nextBurst: number[] = []
  private bursting: number[] = []
  private tmp = new THREE.Vector3()
  /** height (m) of the working level the kit currently sits on */
  levelY = 0

  constructor(private mobile: boolean) {
    this.root.name = 'frontier'
    const shadow = !mobile
    this.root.add(this.level, this.rig, this.car)

    // ---- timber plank decking (+ dunnage) on part of the top level ----------
    const timber: THREE.BufferGeometry[] = []
    let seed = 3
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const bays: [number, number][] = [
      [-2, 1], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [-2, -1], [-1, -2], [0, -2], [-2, 0],
    ]
    for (const [bi, bj] of bays) {
      const x0 = bi * 6
      const z0 = bj * 6
      // boards run across the bay: 0.25 m wide scaffold boards with small gaps
      const n = 20
      for (let k = 0; k < n; k++) {
        if (rnd() < 0.12) continue
        const z = z0 + 0.3 + k * 0.28
        const len = 5.4 + rnd() * 0.5
        timber.push(new THREE.BoxGeometry(len, 0.05, 0.24).translate(x0 + 3, 0.1 + rnd() * 0.01, z))
      }
    }
    // dunnage under the bundles
    for (const [x, z, rot] of [
      [-10.5, 6.2, 0],
      [-7.5, 6.2, 0],
      [5.8, -10.5, 1],
      [5.8, -7.5, 1],
    ] as const) {
      const g = new THREE.BoxGeometry(0.2, 0.16, 2.2)
      if (rot) g.rotateY(Math.PI / 2)
      timber.push(g.translate(x, 0.2, z))
    }
    const planks = new THREE.Mesh(mergeAll(timber), new THREE.MeshStandardMaterial({ color: '#a8845a', roughness: 0.85, metalness: 0 }))
    planks.castShadow = planks.receiveShadow = shadow
    this.level.add(planks)

    // ---- beam bundles: primer-red wide-flange beams, two layers ------------
    const beams: THREE.BufferGeometry[] = []
    for (let layer = 0; layer < 2; layer++) {
      for (let k = 0; k < 4 - layer; k++) {
        beams.push(iBeamGeometry(6, { depth: 0.46, width: 0.22 }).translate(-12, 0.51 + layer * 0.47, 5.45 + k * 0.26 + layer * 0.13))
        const b = iBeamGeometry(6, { depth: 0.46, width: 0.22 })
        b.rotateY(Math.PI / 2)
        beams.push(b.translate(5.1 + k * 0.26 + layer * 0.13, 0.51 + layer * 0.47, -6))
      }
    }
    const bundles = new THREE.Mesh(mergeAll(beams), MAT.primer())
    bundles.castShadow = shadow
    this.level.add(bundles)

    // ---- edge protection: posts, top rail, mid rail, toe board ----------------
    const rail: THREE.BufferGeometry[] = []
    const E = HALF + 0.55
    for (const s of [-1, 1]) {
      for (const axis of [0, 1]) {
        const along = (a: number, y: number, h: number, t: number) => {
          const g = axis === 0 ? new THREE.BoxGeometry(TOWER_W + 1.2, h, t) : new THREE.BoxGeometry(t, h, TOWER_W + 1.2)
          return axis === 0 ? g.translate(0, y, s * E + a) : g.translate(s * E + a, y, 0)
        }
        rail.push(along(0, 1.1, 0.07, 0.07), along(0, 0.58, 0.06, 0.06), along(0, 0.2, 0.22, 0.03))
        for (let k = 0; k <= 12; k++) {
          const t = -HALF - 0.55 + k * ((TOWER_W + 1.1) / 12)
          const post = new THREE.BoxGeometry(0.07, 1.15, 0.07)
          rail.push(axis === 0 ? post.translate(t, 0.6, s * E) : post.translate(s * E, 0.6, t))
        }
      }
    }
    // work-light poles at the corners and mid-sides
    const lampPts: THREE.Vector3[] = []
    for (const [x, z] of [
      [-HALF - 0.3, HALF + 0.3],
      [HALF + 0.3, HALF + 0.3],
      [HALF + 0.3, -HALF - 0.3],
      [-HALF - 0.3, -HALF - 0.3],
      [0, HALF + 0.3],
      [HALF + 0.3, 0],
    ]) {
      rail.push(new THREE.BoxGeometry(0.1, 3.4, 0.1).translate(x, 1.7, z))
      lampPts.push(new THREE.Vector3(x * 0.97, 3.45, z * 0.97))
    }
    const rails = new THREE.Mesh(mergeAll(rail), MAT.craneYellow())
    rails.castShadow = shadow
    this.level.add(rails)

    // ---- sodium lamps: heads + additive glow points + one warm point light ---
    const heads: THREE.BufferGeometry[] = lampPts.map(p => new THREE.BoxGeometry(0.55, 0.3, 0.55).translate(p.x, p.y, p.z))
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(T.sodium), toneMapped: false })
    this.level.add(new THREE.Mesh(mergeAll(heads), this.lampMat))
    const gg = new THREE.BufferGeometry().setFromPoints(lampPts.map(p => p.clone().add(new THREE.Vector3(0, -0.1, 0))))
    this.glow = glowMaterial()
    const glowPts = new THREE.Points(gg, this.glow)
    glowPts.frustumCulled = false
    this.level.add(glowPts)
    // the light lives on the root and never hides (a light appearing or
    // disappearing changes every material's program): only its intensity moves
    this.light = new THREE.PointLight(T.sodium, 0, 70, 2)
    this.root.add(this.light)

    // ---- the raising gang: connectors at the bundles and the edge, a
    //      signaller guiding the next piece in (one merged, varied crew) ------
    const crew: [number, number, number, 'stand' | 'walk' | 'work' | 'reach', number][] = [
      [-9.6, 7.4, 2.6, 'work', 0],
      [-6.2, 5.0, -0.8, 'reach', 1],
      [8.0, -9.0, 1.9, 'work', 0],
      [12.4, 12.6, 0.6, 'stand', 2],
      [-13.0, -4.0, 1.2, 'walk', 1],
      [2.2, 13.4, 3.4, 'stand', 0],
    ]
    const crewN = mobile ? 4 : crew.length
    const gang = crew
      .slice(0, crewN)
      .map(([x, z, ry, pose, vest], i) => personGeometry({ pose, vest: HIVIS[vest], seed: 31 + i * 5 }).rotateY(ry).translate(x, 0.13, z))
    const people = new THREE.Mesh(mergeAll(gang), MAT.person())
    people.castShadow = shadow
    this.level.add(people)

    // ---- jump-form rig round the core top: two working decks on brackets,
    //      a mesh screen round the lower one, handrails (light, open)
    const R = 5.3
    const rigParts: THREE.BufferGeometry[] = []
    const railParts: THREE.BufferGeometry[] = []
    for (const s of [-1, 1]) {
      for (const y of [-0.35, -3.1]) {
        rigParts.push(new THREE.BoxGeometry(2 * R + 0.3, 0.14, 1.0).translate(0, y, s * (R - 0.4)))
        rigParts.push(new THREE.BoxGeometry(1.0, 0.14, 2 * R - 1.7).translate(s * (R - 0.4), y, 0))
      }
      for (const t of [-R, -R / 3, R / 3, R]) {
        rigParts.push(new THREE.BoxGeometry(0.14, 5.2, 0.14).translate(t, -2.6, s * R))
        rigParts.push(new THREE.BoxGeometry(0.14, 5.2, 0.14).translate(s * R, -2.6, t))
      }
      railParts.push(new THREE.BoxGeometry(2 * R + 0.3, 0.07, 0.07).translate(0, 0.75, s * R))
      railParts.push(new THREE.BoxGeometry(0.07, 0.07, 2 * R + 0.3).translate(s * R, 0.75, 0))
      railParts.push(new THREE.BoxGeometry(2 * R + 0.3, 0.3, 0.05).translate(0, -3.1 + 0.25, s * (R + 0.03)))
      railParts.push(new THREE.BoxGeometry(0.05, 0.3, 2 * R + 0.3).translate(s * (R + 0.03), -3.1 + 0.25, 0))
    }
    const rigMesh = new THREE.Mesh(mergeAll(rigParts), MAT.steel())
    rigMesh.castShadow = shadow
    this.rig.add(rigMesh)
    this.rig.add(new THREE.Mesh(mergeAll(railParts), MAT.craneYellow()))
    // perforated screen panels on the lower deck (semi-open: the core reads through)
    const screenParts: THREE.BufferGeometry[] = []
    for (const s of [-1, 1]) {
      screenParts.push(new THREE.PlaneGeometry(2 * R, 2.2).translate(0, -4.3, s * (R + 0.08)))
      const g = new THREE.PlaneGeometry(2 * R, 2.2)
      g.rotateY(s > 0 ? Math.PI / 2 : -Math.PI / 2)
      screenParts.push(g.translate(s * (R + 0.08), -4.3, 0))
    }
    const screen = new THREE.Mesh(
      mergeAll(screenParts),
      new THREE.MeshStandardMaterial({ color: '#9aa1a6', metalness: 0.5, roughness: 0.5, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }),
    )
    this.rig.add(screen)

    // ---- construction hoist: instanced mast sections + ties + the car -------
    const seg = latticeGeometry({ len: MAST_SEG, size: 0.9, bay: 1.5, chord: 0.09 })
    const nSeg = Math.ceil((FLOORS * FLOOR_H + 6) / MAST_SEG)
    this.hoistMast = new THREE.InstancedMesh(seg, MAT.steel({ instanced: true }), nSeg)
    for (let i = 0; i < nSeg; i++) this.hoistMast.setMatrixAt(i, new THREE.Matrix4().makeTranslation(MAST_X, i * MAST_SEG, MAST_Z))
    this.hoistMast.frustumCulled = false
    this.hoistMast.castShadow = shadow
    this.hoistMast.customDepthMaterial = instancedDepth()
    this.root.add(this.hoistMast)
    const tie = new THREE.BoxGeometry(MAST_X - HALF - 0.1, 0.12, 0.12).translate(-(MAST_X - HALF - 0.1) / 2, 0, 0)
    const nTie = Math.ceil(nSeg / 2)
    this.hoistTies = new THREE.InstancedMesh(tie, MAT.steel({ instanced: true }), nTie)
    for (let i = 0; i < nTie; i++) this.hoistTies.setMatrixAt(i, new THREE.Matrix4().makeTranslation(MAST_X, 6 + i * 12, MAST_Z))
    this.hoistTies.frustumCulled = false
    this.root.add(this.hoistTies)
    const carParts = mergeAll([
      tint(new THREE.BoxGeometry(1.7, 2.6, 3.2).translate(0, 1.3, 0), '#9aa3aa'),
      tint(new THREE.BoxGeometry(1.8, 0.18, 3.3).translate(0, 2.7, 0), T.craneYellow),
      tint(new THREE.BoxGeometry(1.8, 0.14, 3.3).translate(0, 0.07, 0), T.craneYellow),
      tint(new THREE.BoxGeometry(0.04, 1.2, 2.6).translate(0.86, 1.55, 0), '#2a3036'),
    ])
    const carMesh = new THREE.Mesh(carParts, MAT.person())
    carMesh.position.set(MAST_X + 0.45 + 0.9, 0, MAST_Z)
    carMesh.castShadow = shadow
    this.car.add(carMesh)

    // ---- sparks at the bolt-up points ---------------------------------------
    this.sparks = new Sparks(mobile ? 120 : 240, 0.45, mobile ? 3.2 : 2.4)
    this.root.add(this.sparks.points)
    for (let i = 0; i < 3; i++) {
      this.emitters.push(new THREE.Vector3())
      this.nextBurst.push(1 + i * 1.3)
      this.bursting.push(0)
    }
  }

  update(s: FrontierState, pxHeight: number) {
    const built = THREE.MathUtils.clamp(s.built, 0, FLOORS)
    const fl = Math.floor(built)
    const fr = built - fl
    // the kit sits on the top completed level; lifted to the next over the last 12% of a floor
    const lift = THREE.MathUtils.smoothstep(fr, 0.88, 1)
    const levelF = Math.min(FLOORS, fl + lift)
    const y = levelF * FLOOR_H
    this.levelY = y
    const done = built >= FLOORS - 0.05
    // no edge protection at grade: the kit comes up with the first level
    this.level.visible = levelF > 0.95 && !done
    this.level.position.set(s.swayAt(y), y, 0)
    this.rig.visible = !done && built > 0.02
    this.rig.position.set(s.swayAt(s.coreTop), s.coreTop, 0)

    // hoist: mast up to just above the working level
    const top = y + 3
    this.hoistMast.count = Math.max(1, Math.ceil(top / MAST_SEG))
    this.hoistTies.count = Math.max(0, Math.floor((top - 6) / 12) + 1)
    this.hoistMast.visible = this.hoistTies.visible = built > 1.2 && !done && s.hoist !== false
    // car: rides between the ground and the working level with dwells at both ends
    const H = Math.max(0, y)
    const travel = H / HOIST_V
    const dwell = 7
    const period = 2 * (travel + dwell)
    let carY = H
    if (!s.calm && H > 4) {
      const t = (s.time + 11) % period
      if (t < dwell) carY = H
      else if (t < dwell + travel) carY = H - (t - dwell) * HOIST_V
      else if (t < 2 * dwell + travel) carY = 0
      else carY = (t - 2 * dwell - travel) * HOIST_V
    }
    this.car.visible = this.hoistMast.visible
    this.car.position.set(s.swayAt(carY), carY, 0)

    // work lights
    const on = s.lights
    this.lampMat.color.copy(TC.sodium).multiplyScalar(0.25 + on * 3.2)
    this.glow.uniforms.uOn.value = on
    this.glow.uniforms.uPx.value = pxHeight
    this.light.intensity = this.level.visible ? on * 140 : 0
    this.light.position.set(4 + s.swayAt(y + 7), y + 7, 8)

    // sparks: 3 bolt-up points on the camera-facing faces; bursts now and then
    const partial = fl + 1 <= FLOORS
    const boltY = fr < 0.45 ? fl * FLOOR_H + 1.2 : (fl + 1) * FLOOR_H - 0.35
    const pts: [number, number][] = [
      [HALF, 3],
      [3, HALF],
      [HALF, -9],
    ]
    for (let i = 0; i < 3; i++) this.emitters[i].set(pts[i][0] + s.swayAt(boltY), boltY, pts[i][1])
    if (!s.calm && partial && !done && built > 0.3 && s.activity > 0.01) {
      for (let i = 0; i < 3; i++) {
        if (s.time >= this.nextBurst[i]) {
          const h = Math.abs(Math.sin((s.time + i * 7.1) * 12.9898) * 43758.5453) % 1
          this.bursting[i] = 0.22 + 0.2 * h
          this.nextBurst[i] = s.time + (2.2 + 3.8 * h) / Math.max(0.2, s.activity)
        }
        if (this.bursting[i] > 0) {
          this.bursting[i] -= s.dt
          this.tmp.copy(this.emitters[i])
          this.sparks.emit(this.tmp, Math.max(2, Math.round(170 * s.dt)), 3.4)
        }
      }
    } else {
      for (let i = 0; i < 3; i++) this.bursting[i] = 0
    }
    this.sparks.update(Math.min(s.dt, 0.05))
  }
}
