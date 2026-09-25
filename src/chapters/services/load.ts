import * as THREE from 'three'
import { MAT, mergeAll } from '../../kit/steel'

/*
 * A stillage of curtain-wall units on the crane hook: six 1.5 x 4 m glazed
 * units standing in a steel rack, on four slings. The next floors' glass,
 * flying in. It hangs from world.crane.hookWorld (which already carries the
 * crane's pendulum swing) and turns slowly on the hook at idle.
 */

const H = 4.3
const SLING = 2.4

export class Stillage {
  root = new THREE.Group()
  private body = new THREE.Group()

  constructor(mobile: boolean) {
    const b = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)
    const top = -SLING
    const steel: THREE.BufferGeometry[] = []
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) steel.push(b(0.1, H, 0.1, sx * 0.7, top - H / 2, sz * 0.92))
    for (const sz of [-1, 1]) steel.push(b(1.5, 0.1, 0.1, 0, top, sz * 0.92), b(1.5, 0.12, 0.12, 0, top - H + 0.3, sz * 0.92))
    for (const sx of [-1, 1]) steel.push(b(0.1, 0.1, 1.94, sx * 0.7, top, 0))
    steel.push(b(1.6, 0.16, 2.0, 0, top - H + 0.08, 0))
    const frame = new THREE.Mesh(mergeAll(steel), MAT.steel())
    const panes: THREE.BufferGeometry[] = []
    for (let i = 0; i < 6; i++) panes.push(b(0.04, 4.0, 1.5, -0.5 + i * 0.2, top - H + 0.22 + 2.0, 0))
    const glass = new THREE.Mesh(mergeAll(panes), MAT.glass())
    const edges: THREE.BufferGeometry[] = []
    for (let i = 0; i < 6; i++)
      for (const sz of [-1, 1]) edges.push(b(0.06, 4.0, 0.05, -0.5 + i * 0.2, top - H + 0.22 + 2.0, sz * 0.75))
    const mullions = new THREE.Mesh(mergeAll(edges), MAT.mullion())
    const sling = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(
        [-1, 1].flatMap(sx => [-1, 1].flatMap(sz => [new THREE.Vector3(0, 0, 0), new THREE.Vector3(sx * 0.7, top, sz * 0.92)])),
      ),
      new THREE.LineBasicMaterial({ color: '#1b1e22' }),
    )
    frame.castShadow = glass.castShadow = !mobile
    this.body.add(frame, glass, mullions, sling)
    this.root.add(this.body)
  }

  /** hook: world position of the hook; yaw: the jib's yaw (the rack hangs square to it) */
  update(hook: THREE.Vector3, yaw: number, time: number, calm: boolean) {
    this.root.position.copy(hook)
    this.root.position.y -= 0.35
    this.body.rotation.y = -yaw + (calm ? 0.35 : 0.35 + Math.sin(time * 0.23) * 0.3)
  }
}
