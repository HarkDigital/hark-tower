import * as THREE from 'three'

/*
 * THE SQUALL — everything the wind brings, all driven on the GPU from one
 * clock (no per-frame CPU loops):
 *
 *   StormSky     a low, racing overcast (red-grey, lit orange from under at
 *                the horizon) drawn as a transparent dome over the world's
 *                sky; `storm` thickens it, `clear` breaks it into gaps
 *   WindStreaks  thin wind-blown streaks (spray / rain) raking across the
 *                frontier along +x, camera-facing ribbons
 *   Debris       plywood offcuts, tarp scraps and paper tumbling past on the
 *                wind (lit, fogged, instanced)
 *
 * Wind blows along world +x (the direction the tower sways).
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

export class StormSky {
  mesh: THREE.Mesh
  private u = {
    uStorm: { value: 0 },
    uClear: { value: 0 },
    uTime: { value: 0 },
    uDark: { value: new THREE.Color('#2a2226') },
    uLit: { value: new THREE.Color('#8a4a36') },
    uFogCol: { value: new THREE.Color('#b98a7e') },
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
        uniform float uStorm, uClear, uTime;
        uniform vec3 uDark, uLit, uFogCol;
        varying vec3 vDir;
        ${noise(mobile ? 3 : 5)}
        void main() {
          vec3 d = normalize(vDir);
          float el = d.y;
          if (el < -0.04) discard;
          // a low cloud deck: project onto a plane, race it downwind (+x)
          vec2 p = d.xz / (el + 0.09);
          vec2 w = vec2(uTime * 0.045, uTime * 0.01);
          float n = sFbm(p * 0.75 + w);
          float n2 = sFbm(p * 2.1 + w * 1.8 + 3.7);
          float c = n * 0.62 + n2 * 0.38;
          float lo = mix(0.3, 0.66, uClear);
          float cover = smoothstep(lo, lo + 0.26, c);
          // a veil of murk everywhere + dense cloud where the deck is thick
          float a = uStorm * mix(0.38, 0.94, cover);
          // colour: bruised red-grey above, lit rust underneath toward the horizon
          vec3 col = mix(uLit, uDark, smoothstep(0.02, 0.32, el));
          col *= 0.72 + 0.55 * n2;
          col = mix(uFogCol * 0.9, col, smoothstep(0.0, 0.16, el));
          a *= smoothstep(-0.04, 0.05, el);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }
      `,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1400, 48, 20), mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -9
  }
  update(storm: number, clear: number, time: number, fogColor: THREE.Color | null, camera: THREE.Vector3) {
    this.u.uStorm.value = storm
    this.u.uClear.value = clear
    this.u.uTime.value = time
    if (fogColor) this.u.uFogCol.value.copy(fogColor)
    this.mesh.position.copy(camera)
    this.mesh.visible = storm > 0.002
  }
}

export class WindStreaks {
  mesh: THREE.Mesh
  private u = {
    uTime: { value: 0 },
    uSpeed: { value: 34 },
    uOpacity: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uSize: { value: new THREE.Vector3(150, 56, 120) },
    uWind: { value: new THREE.Vector3(1, -0.06, 0.08).normalize() },
    uColor: { value: new THREE.Color('#e6ddd4') },
  }
  constructor(count: number) {
    const base = new THREE.PlaneGeometry(1, 1)
    const g = new THREE.InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.attributes.position)
    const seeds = new Float32Array(count * 4)
    let s = 11
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < count * 4; i++) seeds[i] = rnd()
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    g.instanceCount = count
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
      // camera-facing ribbons: the winding depends on the wind vs the view
      side: THREE.DoubleSide,
      uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime, uSpeed;
        uniform vec3 uCenter, uSize, uWind;
        varying float vA;
        varying float vU;
        void main() {
          float spd = mix(0.65, 1.35, aSeed.w) * uSpeed;
          vec3 p;
          p.x = mod(aSeed.x * uSize.x + uTime * spd, uSize.x) - uSize.x * 0.5;
          p.y = (aSeed.y - 0.5) * uSize.y + sin(uTime * 1.3 + aSeed.w * 20.0) * 0.5 - p.x * 0.06;
          p.z = (aSeed.z - 0.5) * uSize.z + p.x * 0.08;
          vA = 1.0 - smoothstep(0.72, 1.0, abs(p.x) / (uSize.x * 0.5));
          p += uCenter;
          vec3 toCam = cameraPosition - p;
          float dist = length(toCam);
          vec3 side = normalize(cross(uWind, toCam / max(dist, 1e-3)));
          float len = mix(5.0, 16.0, fract(aSeed.w * 7.31));
          float wid = max(0.05, dist * 0.0016) * mix(0.7, 1.5, fract(aSeed.w * 3.17));
          vec3 pos = p + uWind * position.x * len + side * position.y * wid;
          vU = position.x + 0.5;
          vA *= smoothstep(7.0, 18.0, dist) * (1.0 - smoothstep(110.0, 190.0, dist));
          vA *= mix(0.35, 1.0, fract(aSeed.w * 13.7));
          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec3 uColor;
        varying float vA;
        varying float vU;
        void main() {
          // bright head (downwind end), fading tail
          float a = vA * uOpacity * vU * vU * (1.0 - smoothstep(0.9, 1.0, vU));
          if (a <= 0.002) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
    })
    this.mesh = new THREE.Mesh(g, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
  }
  update(opacity: number, time: number, center: THREE.Vector3, speed: number) {
    this.u.uOpacity.value = opacity
    this.u.uTime.value = time
    this.u.uSpeed.value = speed
    this.u.uCenter.value.copy(center)
    this.mesh.visible = opacity > 0.003
  }
}

export class Debris {
  mesh: THREE.InstancedMesh
  private u = {
    uTime: { value: 0 },
    uSpeed: { value: 18 },
    uAmount: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uSize: { value: new THREE.Vector3(130, 46, 90) },
  }
  constructor(count: number) {
    const g = new THREE.BoxGeometry(1, 0.035, 0.7)
    const seeds = new Float32Array(count * 4)
    let s = 29
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < count * 4; i++) seeds[i] = rnd()
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4))
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0, roughness: 0.85, side: THREE.DoubleSide })
    const u = this.u
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, u)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 aSeed;
          uniform float uTime, uSpeed, uAmount;
          uniform vec3 uCenter, uSize;
          mat3 dbRot(vec3 a, float ang) {
            float c = cos(ang), s = sin(ang), t = 1.0 - c;
            return mat3(t*a.x*a.x + c, t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
                        t*a.x*a.y - s*a.z, t*a.y*a.y + c, t*a.y*a.z + s*a.x,
                        t*a.x*a.z + s*a.y, t*a.y*a.z - s*a.x, t*a.z*a.z + c);
          }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 dbAxis = normalize(vec3(aSeed.z - 0.5, 0.7, aSeed.y - 0.5));
          float dbAng = uTime * mix(1.6, 5.5, fract(aSeed.w * 5.7)) + aSeed.x * 6.283;
          mat3 dbR = dbRot(dbAxis, dbAng);
          vec3 objectNormal = dbR * vec3(normal);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`,
        )
        .replace(
          '#include <begin_vertex>',
          `float dbSpd = mix(0.55, 1.1, aSeed.w) * uSpeed;
          vec3 dbC;
          dbC.x = mod(aSeed.x * uSize.x + uTime * dbSpd, uSize.x) - uSize.x * 0.5;
          dbC.y = (aSeed.y - 0.5) * uSize.y + sin(uTime * (0.7 + aSeed.w) + aSeed.z * 30.0) * 2.2;
          dbC.z = (aSeed.z - 0.5) * uSize.z + sin(uTime * 0.9 + aSeed.x * 17.0) * 1.5;
          float dbEdge = 1.0 - smoothstep(0.78, 1.0, abs(dbC.x) / (uSize.x * 0.5));
          float dbScale = mix(0.35, 1.7, fract(aSeed.w * 9.1)) * dbEdge * step(fract(aSeed.w * 3.31) * 0.999, uAmount);
          vec3 transformed = dbR * (position * dbScale) + dbC + uCenter;`,
        )
    }
    mat.customProgramCacheKey = () => 'shield-debris'
    this.mesh = new THREE.InstancedMesh(g, mat, count)
    const palette = ['#b8905c', '#9c7a52', '#ff6a1a', '#e9e4da', '#5b6168', '#c9a46a']
    const c = new THREE.Color()
    for (let i = 0; i < count; i++) {
      this.mesh.setMatrixAt(i, new THREE.Matrix4())
      this.mesh.setColorAt(i, c.set(palette[i % palette.length]))
    }
    this.mesh.frustumCulled = false
  }
  update(amount: number, time: number, center: THREE.Vector3, speed: number) {
    this.u.uAmount.value = amount
    this.u.uTime.value = time
    this.u.uSpeed.value = speed
    this.u.uCenter.value.copy(center)
    this.mesh.visible = amount > 0.01
  }
}
