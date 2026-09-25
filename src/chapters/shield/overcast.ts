import * as THREE from 'three'

/*
 * THE OVERCAST — a thin, high, cool-grey cloud veil drawn as a transparent
 * dome over the world's sky while the wind load is analysed. It is not a
 * storm: no rain, no debris — just flatter, cooler light, so the analysis
 * colours (the pressure map and the streamlines) carry the scene. `amount`
 * thickens it; `clear` breaks it into gaps as the late light returns. It
 * drifts downwind with the analysis clock (static under reduced motion).
 */

const noise = (octaves: number) => /* glsl */ `
  float sHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float sNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float sFbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < ${octaves}; i++) { v += a * sNoise(p); p = p * 2.03 + 5.1; a *= 0.5; } return v; }
`

export class Overcast {
  mesh: THREE.Mesh
  private u = {
    uAmount: { value: 0 },
    uClear: { value: 0 },
    uDrift: { value: new THREE.Vector2() },
    uDark: { value: new THREE.Color('#4a525c') },
    uLit: { value: new THREE.Color('#a7a49c') },
    uFogCol: { value: new THREE.Color('#b9b2a8') },
  }
  constructor(mobile: boolean) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: this.u,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAmount, uClear;
        uniform vec2 uDrift;
        uniform vec3 uDark, uLit, uFogCol;
        varying vec3 vDir;
        ${noise(mobile ? 3 : 4)}
        void main() {
          vec3 d = normalize(vDir);
          float el = d.y;
          if (el < -0.04) discard;
          // a high, flat deck: project onto a plane and let it drift downwind
          vec2 p = d.xz / (el + 0.12);
          float n = sFbm(p * 0.55 + uDrift);
          float n2 = sFbm(p * 1.7 + uDrift * 1.6 + 3.7);
          float c = n * 0.65 + n2 * 0.35;
          float lo = mix(0.34, 0.7, uClear);
          float cover = smoothstep(lo, lo + 0.3, c);
          float a = uAmount * mix(0.34, 0.8, cover);
          vec3 col = mix(uLit, uDark, smoothstep(0.03, 0.4, el));
          col *= 0.84 + 0.3 * n2;
          col = mix(uFogCol, col, smoothstep(0.0, 0.14, el));
          a *= smoothstep(-0.04, 0.06, el);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }
      `,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 20), mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -9
  }
  /** `drift` in metres of flow (the analysis clock); `wind` its horizontal direction */
  update(amount: number, clear: number, drift: number, wind: THREE.Vector3, fogColor: THREE.Color | null, camera: THREE.Vector3) {
    this.u.uAmount.value = amount
    this.u.uClear.value = clear
    this.u.uDrift.value.set(wind.x, wind.z).multiplyScalar(drift * 0.0016)
    if (fogColor) this.u.uFogCol.value.copy(fogColor)
    this.mesh.position.copy(camera)
    this.mesh.visible = amount > 0.002
  }
}
