import * as THREE from 'three'

/*
 * The city around the site: a few hundred instanced towers on a street grid,
 * taller toward the centre, facades in cool greys/blues that pick up the sky
 * (metalness + the sky environment), windows that light up at dusk
 * (uLights 0..1, a per-window hash so they flicker on one by one).
 * The construction site (|x|,|z| < 70) is left clear.
 */

export class City {
  root = new THREE.Group()
  private lightsU = { value: 0 }

  constructor(mobile: boolean) {
    this.root.name = 'city'
    const mats: THREE.Matrix4[] = []
    const cols: number[] = []
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const BLOCK = 48
    const R = mobile ? 520 : 760
    const palette = ['#5b6672', '#6f7a86', '#4b5561', '#7d8691', '#56606b', '#8a929b', '#3f4953', '#6a7784']
    const c = new THREE.Color()
    for (let bx = -R; bx <= R; bx += BLOCK) {
      for (let bz = -R; bz <= R; bz += BLOCK) {
        const d = Math.hypot(bx, bz)
        if (d > R) continue
        if (Math.abs(bx) < 70 && Math.abs(bz) < 70) continue
        // 1–3 buildings per block
        const n = 1 + Math.floor(rnd() * (mobile ? 2 : 3))
        for (let i = 0; i < n; i++) {
          if (mobile && rnd() < 0.25) continue
          const w = 12 + rnd() * 18
          const dz = 12 + rnd() * 18
          const centre = Math.max(0, 1 - d / R)
          const h = 14 + Math.pow(rnd(), 2.2) * (60 + 170 * centre) + centre * 30
          const x = bx + (rnd() - 0.5) * (BLOCK - w - 8)
          const z = bz + (rnd() - 0.5) * (BLOCK - dz - 8)
          if (Math.abs(x) < 60 && Math.abs(z) < 60) continue
          mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, dz)))
          c.set(palette[Math.floor(rnd() * palette.length)])
          cols.push(c.r, c.g, c.b)
        }
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.38 })
    const lights = this.lightsU
    mat.onBeforeCompile = shader => {
      shader.uniforms.uLights = lights
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCityPos;\nvarying vec3 vCityN;\nvarying float vSeed;')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vec4 cityWp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vCityPos = cityWp.xyz;
          vCityN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);
          vSeed = instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.071;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uLights;
          varying vec3 vCityPos;
          varying vec3 vCityN;
          varying float vSeed;
          float cityHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // facade grid: 3.6 m floors, 2.4 m window bays (walls only). Half the
          // towers are glass curtain walls (big panes, thin spandrels), the rest
          // punched windows in stone.
          float cityWall = 1.0 - step(0.6, abs(vCityN.y));
          vec2 cityFu = vec2(abs(vCityN.x) > 0.5 ? vCityPos.z : vCityPos.x, vCityPos.y);
          float cityCurtain = step(0.5, fract(vSeed * 7.31));
          vec2 cityCellSize = mix(vec2(2.4, 3.6), vec2(1.6, 3.6), cityCurtain);
          vec2 cityCell = floor(cityFu / cityCellSize);
          vec2 cityF = fract(cityFu / cityCellSize);
          float cityWin = mix(
            step(0.2, cityF.x) * step(cityF.x, 0.8) * step(0.25, cityF.y) * step(cityF.y, 0.78),
            step(0.04, cityF.x) * step(0.14, cityF.y) * step(cityF.y, 0.96),
            cityCurtain) * cityWall;
          // windows: dark tinted glass that mirrors the sky; stone/spandrel lighter
          diffuseColor.rgb = mix(diffuseColor.rgb * mix(1.15, 0.9, cityCurtain), diffuseColor.rgb * vec3(0.32, 0.4, 0.5), cityWin);`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          metalnessFactor = mix(0.08, 0.95, cityWin);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(0.85, 0.1 + 0.12 * cityHash(cityCell + vSeed), cityWin);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            float h = cityHash(cityCell + vSeed);
            float on = step(1.0 - uLights * 0.72, h) * cityWin;
            // by day the odd lit window is dim; after dusk they glow
            totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * on * (0.6 + 0.8 * cityHash(cityCell + 3.1 + vSeed)) * (0.25 + 0.75 * uLights);
          }`,
        )
    }
    mat.customProgramCacheKey = () => 'city-facades'
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length)
    mats.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols), 3)
    mesh.frustumCulled = false
    this.root.add(mesh)

    // the ground: asphalt with a faint street grid, the site as packed earth
    const gmat = new THREE.MeshStandardMaterial({ color: '#3b3f44', roughness: 0.95, metalness: 0 })
    gmat.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec2 g = abs(fract((vGround + 24.0) / 48.0) - 0.5) * 48.0;
            float street = 1.0 - step(5.0, min(g.x, g.y));
            float site = step(abs(vGround.x), 62.0) * step(abs(vGround.y), 62.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.17, 0.18), street * (1.0 - site));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.36, 0.3), site);
          }`,
        )
    }
    gmat.customProgramCacheKey = () => 'city-ground'
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), gmat)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = !mobile
    this.root.add(ground)
  }

  update(lights: number) {
    this.lightsU.value = lights
  }
}
