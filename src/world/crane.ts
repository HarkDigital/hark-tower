import * as THREE from 'three'
import { MAT, latticeGeometry } from '../kit/steel'

/*
 * A climbing tower crane on the tower's core (it rides up with the frontier):
 * lattice mast, slewing unit + cab, a 52 m jib with a trolley, a counter-jib
 * with concrete counterweights, the A-frame peak with pendant lines, and a
 * hook block on a cable. Crane yellow — the construction accent.
 *
 *   crane.root.position.y   base height (set by World from the frontier)
 *   crane.set(yaw, reach, drop)
 *     yaw   radians (0 = jib toward +x)
 *     reach 0..1 trolley position along the jib
 *     drop  metres of cable below the jib
 *   crane.hookWorld         world position of the hook (read after update)
 *   crane.hook              an Object3D at the hook — parent loads to it, or
 *                           copy its world matrix
 */

export const MAST_H = 30
export const JIB_L = 52
const CJIB_L = 16

export class Crane {
  root = new THREE.Group()
  slew = new THREE.Group()
  trolley = new THREE.Group()
  hook = new THREE.Group()
  hookWorld = new THREE.Vector3()
  private cable: THREE.Mesh
  private drop = 20
  private reach = 0.6

  constructor(mobile: boolean) {
    this.root.name = 'crane'
    const yellow = MAT.craneYellow()
    const mast = new THREE.Mesh(latticeGeometry({ len: MAST_H, size: 2.1, bay: 2.1 }), yellow)
    mast.castShadow = !mobile
    this.root.add(mast)

    this.slew.position.y = MAST_H
    this.root.add(this.slew)
    // slewing ring + cab
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.8, 24), MAT.steel())
    this.slew.add(ring)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2), yellow)
    cab.position.set(1.8, -0.6, 1.4)
    this.slew.add(cab)
    const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(2.25, 1.2, 1.4), MAT.glass())
    cabGlass.position.set(2.2, -0.3, 1.6)
    this.slew.add(cabGlass)

    // jib: a triangular lattice lying along +x
    const jib = new THREE.Mesh(latticeGeometry({ len: JIB_L, size: 1.7, bay: 2.2, triangular: true }), yellow)
    jib.rotation.z = -Math.PI / 2
    jib.position.y = 1.2
    jib.castShadow = !mobile
    this.slew.add(jib)
    // counter-jib + counterweights
    const cjib = new THREE.Mesh(latticeGeometry({ len: CJIB_L, size: 1.5, bay: 2 }), yellow)
    cjib.rotation.z = Math.PI / 2
    cjib.position.y = 1.2
    this.slew.add(cjib)
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.6, 2.2), MAT.concrete())
      w.position.set(-CJIB_L + 1.2 + i * 1.15, 0.2, 0)
      this.slew.add(w)
    }
    // A-frame peak + pendant lines to the jib tip and the counter-jib end
    const peak = new THREE.Mesh(latticeGeometry({ len: 8, size: 1.2, bay: 2 }), yellow)
    peak.position.y = 1.2
    this.slew.add(peak)
    const pendMat = new THREE.LineBasicMaterial({ color: '#2a2a2a' })
    const pend = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 9.2, 0),
      new THREE.Vector3(JIB_L * 0.7, 2, 0),
      new THREE.Vector3(0, 9.2, 0),
      new THREE.Vector3(-CJIB_L + 1, 2, 0),
    ])
    this.slew.add(new THREE.LineSegments(pend, pendMat))
    // a small red aircraft-warning light at the jib tip and the peak
    const warn = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a1a').multiplyScalar(4), toneMapped: false })
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), warn)
    tip.position.set(JIB_L, 2.2, 0)
    this.slew.add(tip)
    const top = tip.clone()
    top.position.set(0, 9.4, 0)
    this.slew.add(top)

    // trolley + cable + hook block
    this.slew.add(this.trolley)
    this.trolley.position.y = 0.3
    const tro = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.6), MAT.steel())
    this.trolley.add(tro)
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), MAT.rubber())
    this.trolley.add(this.cable)
    this.trolley.add(this.hook)
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.5), MAT.safety())
    block.position.y = 0.6
    this.hook.add(block)
    const hk = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 16, Math.PI * 1.4), MAT.steel())
    hk.rotation.z = Math.PI * 0.8
    hk.position.y = -0.15
    this.hook.add(hk)
    this.set(0.6, 0.6, 20)
  }

  set(yaw: number, reach: number, drop: number) {
    this.slew.rotation.y = -yaw
    this.reach = THREE.MathUtils.clamp(reach, 0.08, 0.98)
    this.drop = Math.max(1.5, drop)
    this.trolley.position.x = this.reach * JIB_L
    this.hook.position.y = -this.drop
    this.cable.scale.y = this.drop
    this.cable.position.y = -this.drop / 2
  }

  update() {
    this.hook.updateWorldMatrix(true, false)
    this.hookWorld.setFromMatrixPosition(this.hook.matrixWorld)
  }
}
