import * as THREE from 'three'
import { MAT, T, latticeGeometry, mergeAll } from '../kit/steel'

/*
 * A climbing hammerhead tower crane on the tower's core (it rides up with the
 * frontier): lattice mast in a climbing collar, slewing unit + operator cab,
 * a 52 m triangular jib with a walkway and a trolley, a counter-jib with
 * concrete counterweights, the hoist winch and a HARK board, the cat-head
 * peak with pendant bars, and a hook block on two falls of rope. Crane
 * yellow — the construction accent.
 *
 *   crane.root.position.y   base height (set by World from the frontier)
 *   crane.set(yaw, reach, drop)
 *     yaw   radians (0 = jib toward +x)
 *     reach 0..1 trolley position along the jib
 *     drop  metres of cable below the jib
 *   crane.hookWorld         world position of the hook (read after update;
 *                           includes the pendulum swing)
 *   crane.hook              an Object3D at the hook — parent loads to it (they
 *                           swing with it), or copy its world matrix
 *   crane.swing             world-space offset (m) of the hook from straight
 *                           below the trolley (the pendulum; 0 under reduced
 *                           motion). Add it to Crane.hookPosition() to match
 *                           the swinging hook.
 *
 * The hook block swings as a damped pendulum driven by the trolley's own
 * acceleration (slewing, trolleying, a jump), so a crane that moves carries
 * its load with weight and settles. Aircraft-warning lights on the peak and
 * both jib ends glow at dusk and blink slowly at night (steady under reduced
 * motion).
 */

export const MAST_H = 16
export const JIB_L = 52
const CJIB_L = 16
/** height of the jib's bottom chords above the slewing ring */
const JIB_Y = 1.2
const G = 9.81

function boardTexture() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 208
  const g = c.getContext('2d')!
  const draw = () => {
    g.fillStyle = '#15181b'
    g.fillRect(0, 0, 1024, 208)
    g.strokeStyle = T.craneYellow
    g.lineWidth = 10
    g.strokeRect(5, 5, 1014, 198)
    g.fillStyle = '#f4f1ea'
    g.font = "800 132px 'Big Shoulders Display Variable', 'Archivo Variable', sans-serif"
    g.textBaseline = 'middle'
    g.textAlign = 'center'
    g.fillText('HARK DIGITAL', 500, 110)
    g.fillStyle = T.signal
    g.beginPath()
    g.arc(940, 104, 16, 0, Math.PI * 2)
    g.fill()
  }
  draw()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  document.fonts?.ready.then(() => {
    draw()
    tex.needsUpdate = true
  })
  return tex
}

function hazardTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = T.craneYellow
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#15181b'
  for (let i = -64; i < 128; i += 32) {
    g.beginPath()
    g.moveTo(i, 0)
    g.lineTo(i + 16, 0)
    g.lineTo(i + 16 + 64, 64)
    g.lineTo(i + 64, 64)
    g.closePath()
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

export class Crane {
  root = new THREE.Group()
  slew = new THREE.Group()
  trolley = new THREE.Group()
  hook = new THREE.Group()
  hookWorld = new THREE.Vector3()
  /** world offset (m) of the hook from plumb below the trolley (pendulum) */
  swing = new THREE.Vector3()
  private hang = new THREE.Group()
  private cables: THREE.Mesh[] = []
  private drop = 20
  private reach = 0.6
  private yaw = 0.6
  private warn: THREE.MeshBasicMaterial
  private cabLight: THREE.MeshBasicMaterial
  // pendulum state (world xz): offset s, velocity v; suspension point history
  private s = new THREE.Vector2()
  private v = new THREE.Vector2()
  private pPrev = new THREE.Vector2()
  private vPrev = new THREE.Vector2()
  private primed = 0

  constructor(mobile: boolean) {
    this.root.name = 'crane'
    const yellow = MAT.craneYellow()
    const shadow = !mobile

    // mast (a few metres of it sit down inside the core's climbing collar)
    const mast = new THREE.Mesh(latticeGeometry({ len: MAST_H + 6, size: 2.1, bay: 2.1, chord: 0.2 }), yellow)
    mast.position.y = -6
    mast.castShadow = shadow
    this.root.add(mast)
    const collar = new THREE.Mesh(
      mergeAll([
        new THREE.BoxGeometry(3.4, 0.5, 3.4).translate(0, 0.25, 0),
        new THREE.BoxGeometry(3.0, 0.3, 3.0).translate(0, 3.2, 0),
        ...[-1, 1].flatMap(sx => [-1, 1].map(sz => new THREE.BoxGeometry(0.25, 3.2, 0.25).translate(sx * 1.45, 1.6, sz * 1.45))),
      ]),
      MAT.steel(),
    )
    this.root.add(collar)

    this.slew.position.y = MAST_H
    this.root.add(this.slew)
    // everything that slews, merged by material (few draw calls):
    // yellow = platform, cab, jib, counter-jib, cat-head; steel = slewing ring,
    // walkway, jib-tip cap, winch
    const cabAt = new THREE.Vector3(2.3, -0.2, 1.9)
    const jibGeo = latticeGeometry({ len: JIB_L, size: 2.0, bay: 2.3, chord: 0.17, triangular: true })
    jibGeo.rotateY(-Math.PI / 2)
    jibGeo.rotateZ(-Math.PI / 2)
    jibGeo.translate(0, JIB_Y + 0.58, 0)
    const cjibGeo = latticeGeometry({ len: CJIB_L, size: 1.6, bay: 2, chord: 0.15 })
    cjibGeo.rotateZ(Math.PI / 2)
    cjibGeo.translate(0, JIB_Y + 0.8, 0)
    const yellowSlew = new THREE.Mesh(
      mergeAll([
        new THREE.BoxGeometry(4.2, 0.5, 2.6).translate(0, 0.75, 0),
        new THREE.BoxGeometry(2.3, 2.5, 2.2).translate(cabAt.x, cabAt.y, cabAt.z),
        new THREE.BoxGeometry(2.4, 0.2, 2.3).translate(cabAt.x, cabAt.y + 1.3, cabAt.z),
        jibGeo,
        cjibGeo,
        latticeGeometry({ len: 8, size: 1.4, bay: 2, chord: 0.14 }).translate(0, JIB_Y, 0),
      ]),
      yellow,
    )
    yellowSlew.castShadow = shadow
    this.slew.add(yellowSlew)
    const steelSlew = new THREE.Mesh(
      mergeAll([
        new THREE.CylinderGeometry(1.5, 1.6, 0.9, 24).translate(0, 0.1, 0),
        new THREE.BoxGeometry(JIB_L - 2, 0.08, 0.7).translate(JIB_L / 2 + 1, JIB_Y - 0.05, 0),
        new THREE.BoxGeometry(0.4, 1.4, 2.1).translate(JIB_L, JIB_Y + 0.6, 0),
        new THREE.BoxGeometry(3.2, 1.6, 2.0).translate(-CJIB_L + 7.5, JIB_Y + 1.6, 0),
      ]),
      MAT.steel(),
    )
    this.slew.add(steelSlew)
    // cab glass (dark, a warm lamp inside at night)
    const cabGlass = new THREE.Mesh(
      mergeAll([
        new THREE.BoxGeometry(0.06, 1.6, 1.9).translate(1.17, 0.25, 0),
        new THREE.BoxGeometry(2.0, 1.3, 0.06).translate(0.05, 0.35, 1.12),
        new THREE.BoxGeometry(2.0, 1.3, 0.06).translate(0.05, 0.35, -1.12),
      ]).translate(cabAt.x, cabAt.y, cabAt.z),
      new THREE.MeshStandardMaterial({ color: '#1d2a33', metalness: 0.85, roughness: 0.08 }),
    )
    this.slew.add(cabGlass)
    this.cabLight = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a0'), toneMapped: false })
    const cabLamp = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5).rotateY(Math.PI / 2).translate(cabAt.x + 0.9, cabAt.y + 0.8, cabAt.z), this.cabLight)
    this.slew.add(cabLamp)
    // counterweights
    const weights: THREE.BufferGeometry[] = []
    for (let i = 0; i < 4; i++) weights.push(new THREE.BoxGeometry(1.05, 2.8, 2.4).translate(-CJIB_L + 1.0 + i * 1.12, JIB_Y - 0.6, 0))
    const cw = new THREE.Mesh(mergeAll(weights), MAT.concrete())
    cw.castShadow = shadow
    this.slew.add(cw)
    // the HARK board, both sides of the counter-jib
    const boards = mergeAll([
      new THREE.PlaneGeometry(9.2, 1.87).translate(-CJIB_L * 0.52, JIB_Y + 0.8, 0.86),
      new THREE.PlaneGeometry(9.2, 1.87).rotateY(Math.PI).translate(-CJIB_L * 0.52, JIB_Y + 0.8, -0.86),
    ])
    this.slew.add(new THREE.Mesh(boards, new THREE.MeshBasicMaterial({ map: boardTexture(), color: new THREE.Color(0.85, 0.85, 0.85) })))
    // pendant bars from the cat-head to the jib and counter-jib
    const top = new THREE.Vector3(0, JIB_Y + 8.1, 0)
    const pend = new THREE.BufferGeometry().setFromPoints([
      top, new THREE.Vector3(JIB_L * 0.42, JIB_Y + 1.16, 0),
      top, new THREE.Vector3(JIB_L * 0.8, JIB_Y + 1.16, 0),
      top, new THREE.Vector3(-CJIB_L + 1, JIB_Y + 1.6, 0.7),
      top, new THREE.Vector3(-CJIB_L + 1, JIB_Y + 1.6, -0.7),
    ])
    this.slew.add(new THREE.LineSegments(pend, new THREE.LineBasicMaterial({ color: '#2a2a2a' })))
    // aircraft-warning lights: peak, jib tip, counter-jib end
    this.warn = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a1a'), toneMapped: false })
    const lamps = mergeAll(
      [new THREE.Vector3(0, JIB_Y + 8.4, 0), new THREE.Vector3(JIB_L + 0.2, JIB_Y + 1.5, 0), new THREE.Vector3(-CJIB_L - 0.2, JIB_Y + 1.8, 0)].map(p =>
        new THREE.SphereGeometry(0.26, 10, 6).translate(p.x, p.y, p.z),
      ),
    )
    this.slew.add(new THREE.Mesh(lamps, this.warn))

    // trolley (rides the bottom chords) + two falls of rope + hook block
    this.slew.add(this.trolley)
    this.trolley.position.y = JIB_Y - 0.45
    const tro = new THREE.Mesh(
      mergeAll([
        new THREE.BoxGeometry(2.0, 0.5, 2.2),
        ...[-0.7, 0.7].flatMap(x => [-0.95, 0.95].map(z => new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12).rotateX(Math.PI / 2).translate(x, 0.35, z))),
        new THREE.CylinderGeometry(0.35, 0.35, 0.2, 14).rotateX(Math.PI / 2).translate(0, -0.35, 0.3),
        new THREE.CylinderGeometry(0.35, 0.35, 0.2, 14).rotateX(Math.PI / 2).translate(0, -0.35, -0.3),
      ]),
      MAT.steel(),
    )
    this.trolley.add(tro)
    this.trolley.add(this.hang)
    this.hang.position.y = -0.35
    const ropes = new THREE.Mesh(
      mergeAll([new THREE.CylinderGeometry(0.04, 0.04, 1, 5).translate(0, 0, -0.3), new THREE.CylinderGeometry(0.04, 0.04, 1, 5).translate(0, 0, 0.3)]),
      MAT.rubber(),
    )
    this.hang.add(ropes)
    this.cables.push(ropes)
    this.hang.add(this.hook)
    const hazard = new THREE.MeshStandardMaterial({ map: hazardTexture(), metalness: 0.2, roughness: 0.55 })
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.3, 0.7), hazard)
    block.position.y = 0.4
    this.hook.add(block)
    const hookSteel = mergeAll([
      new THREE.CylinderGeometry(0.45, 0.45, 0.72, 16).rotateX(Math.PI / 2).translate(0, 1.05, 0),
      new THREE.TorusGeometry(0.3, 0.09, 8, 16, Math.PI * 1.4).rotateZ(Math.PI * 0.8).translate(0, -0.55, 0),
      new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8).translate(0, -0.2, 0),
    ])
    this.hook.add(new THREE.Mesh(hookSteel, MAT.steel()))
    this.set(0.6, 0.6, 20)
  }

  set(yaw: number, reach: number, drop: number) {
    this.yaw = yaw
    this.slew.rotation.y = -yaw
    this.reach = THREE.MathUtils.clamp(reach, 0.08, 0.98)
    this.drop = Math.max(1.5, drop)
    this.trolley.position.x = this.reach * JIB_L
    // the hook hangs `drop` below the jib's slewing-ring datum (matches hookPosition)
    const len = this.drop - 0.3 + this.trolley.position.y + this.hang.position.y
    this.hook.position.y = -len
    for (const c of this.cables) {
      c.scale.y = Math.max(0.1, len - 1.1)
      c.position.y = -(len - 1.1) / 2
    }
  }

  /**
   * Where the hook WILL be for a given pose — deterministic, for placing a
   * load in the same frame (world.crane.hookWorld is one frame behind, since
   * the world updates after chapters). baseY = the crane's base height
   * (World: min(FLOORS, built + 2) * FLOOR_H). Add `crane.swing` to follow
   * the pendulum.
   */
  static hookPosition(out: THREE.Vector3, baseY: number, yaw: number, reach: number, drop: number) {
    const r = THREE.MathUtils.clamp(reach, 0.08, 0.98) * JIB_L
    return out.set(Math.cos(yaw) * r, baseY + MAST_H + 0.3 - Math.max(1.5, drop), Math.sin(yaw) * r)
  }

  /**
   * Per frame (World calls it after set()): pendulum, warning lights, hook
   * world position. dt seconds, time seconds, night 0..1, calm = reduced motion.
   */
  update(dt = 0, time = 0, night = 0, calm = false) {
    // suspension point (the trolley) in world xz
    const r = this.reach * JIB_L
    const px = this.root.position.x + Math.cos(this.yaw) * r
    const pz = this.root.position.z + Math.sin(this.yaw) * r
    const L = Math.max(2, this.drop)
    if (calm || dt <= 0) {
      this.s.set(0, 0)
      this.v.set(0, 0)
      this.primed = 0
    } else {
      const vx = (px - this.pPrev.x) / dt
      const vz = (pz - this.pPrev.y) / dt
      // teleports (nav jumps, first frames) don't kick the load
      const jump = this.primed < 2 || Math.hypot(px - this.pPrev.x, pz - this.pPrev.y) > 4
      let ax = jump ? 0 : (vx - this.vPrev.x) / dt
      let az = jump ? 0 : (vz - this.vPrev.y) / dt
      const aMax = 3
      const aL = Math.hypot(ax, az)
      if (aL > aMax) {
        ax *= aMax / aL
        az *= aMax / aL
      }
      this.vPrev.set(jump ? 0 : vx, jump ? 0 : vz)
      this.primed++
      // s'' = -(g/L) s - a - c s'   (small-angle pendulum, damped), two substeps
      const w2 = G / L
      const c = 0.5
      const h = dt / 2
      for (let i = 0; i < 2; i++) {
        this.v.x += (-w2 * this.s.x - ax - c * this.v.x) * h
        this.v.y += (-w2 * this.s.y - az - c * this.v.y) * h
        this.s.x += this.v.x * h
        this.s.y += this.v.y * h
      }
      const sMax = L * 0.09
      const sl = this.s.length()
      if (sl > sMax) this.s.multiplyScalar(sMax / sl)
    }
    this.pPrev.set(px, pz)
    // world offset → the hang group's local tilt (slew space is rotated by -yaw)
    const cy = Math.cos(this.yaw)
    const sy = Math.sin(this.yaw)
    const lx = this.s.x * cy + this.s.y * sy
    const lz = -this.s.x * sy + this.s.y * cy
    this.hang.rotation.set(-Math.asin(THREE.MathUtils.clamp(lz / L, -0.3, 0.3)), 0, Math.asin(THREE.MathUtils.clamp(lx / L, -0.3, 0.3)))
    this.swing.set(this.s.x, 0, this.s.y)

    // warning lights: faint by day, bright at dusk/night, a slow blink (steady when calm)
    const ph = (time % 1.5) / 1.5
    const pulse = calm ? 1 : 0.12 + 0.88 * (THREE.MathUtils.smoothstep(ph, 0, 0.08) * (1 - THREE.MathUtils.smoothstep(ph, 0.45, 0.6)))
    this.warn.color.set('#ff2a1a').multiplyScalar(0.5 + night * 5.5 * pulse)
    this.cabLight.color.set('#ffd9a0').multiplyScalar(0.05 + night * 1.2)

    this.hook.updateWorldMatrix(true, false)
    this.hookWorld.setFromMatrixPosition(this.hook.matrixWorld)
  }
}
