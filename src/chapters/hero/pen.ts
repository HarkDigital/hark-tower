import * as THREE from 'three'
import { T } from '../../kit/steel'

/*
 * PEN LINES — architectural linework that is DRAWN, stroke by stroke.
 *
 * Every segment carries its own schedule (start, duration) on one shared
 * clock `uDraw`: a segment begins when uDraw passes `start` and is fully
 * inked `dur` later; the fragment shader keeps only the part of the segment
 * behind the pen (vT <= progress) and brightens the pen head. So a tower's
 * verticals shoot up while each floor line snaps across as the pen passes
 * it — the building is drafted, not faded in.
 *
 *   const pen = new PenLines()
 *   pen.seg(a, b, start, dur)            // any number of segments
 *   const lines = pen.build({ color, opacity, head })
 *   setDraw(lines, t)                     // each frame
 */

export class PenLines {
  private pos: number[] = []
  private t: number[] = []
  private sched: number[] = []

  seg(a: THREE.Vector3, b: THREE.Vector3, start: number, dur: number) {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
    this.t.push(0, 1)
    const d = Math.max(1e-4, dur)
    this.sched.push(start, d, start, d)
    return this
  }

  /** A polyline drawn as one continuous stroke over [start, start + dur]. */
  poly(points: THREE.Vector3[], start: number, dur: number) {
    let total = 0
    for (let i = 1; i < points.length; i++) total += points[i].distanceTo(points[i - 1])
    let acc = 0
    for (let i = 1; i < points.length; i++) {
      const l = points[i].distanceTo(points[i - 1])
      this.seg(points[i - 1], points[i], start + (acc / total) * dur, (l / total) * dur)
      acc += l
    }
    return this
  }

  get count() {
    return this.t.length / 2
  }

  build(o: { color?: THREE.ColorRepresentation; opacity?: number; head?: number; depthTest?: boolean; fog?: boolean } = {}) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('aT', new THREE.Float32BufferAttribute(this.t, 1))
    g.setAttribute('aSched', new THREE.Float32BufferAttribute(this.sched, 2))
    g.computeBoundingSphere()
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: o.depthTest ?? true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uColor: { value: new THREE.Color(o.color ?? T.line) },
        uOpacity: { value: o.opacity ?? 0.6 },
        uHead: { value: o.head ?? 2.2 },
        uDraw: { value: 0 },
        uFade: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aT;
        attribute vec2 aSched;
        varying float vT;
        varying float vP;
        uniform float uDraw;
        void main() {
          vT = aT;
          vP = clamp((uDraw - aSched.x) / aSched.y, 0.0, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity, uHead, uFade;
        varying float vT;
        varying float vP;
        void main() {
          if (vP <= 0.0 || vT > vP + 0.0005) discard;
          // the pen head: a hot spot just behind the moving tip (gone once the stroke is done)
          float head = (1.0 - smoothstep(0.0, 0.05, vP - vT)) * (1.0 - step(0.9995, vP));
          float a = (uOpacity + head * uHead) * uFade;
          if (a <= 0.002) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
    })
    const lines = new THREE.LineSegments(g, mat)
    lines.frustumCulled = false
    return lines
  }
}

export function setDraw(lines: THREE.LineSegments, draw: number, fade = 1) {
  const u = (lines.material as THREE.ShaderMaterial).uniforms
  u.uDraw.value = draw
  u.uFade.value = fade
  lines.visible = fade > 0.002 && draw > 0
}
