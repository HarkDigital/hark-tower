import * as THREE from 'three'

/*
 * The city around the site (Philadelphia-ish): a street grid (48 m blocks,
 * 10 m streets), instanced buildings with three facade systems — glass
 * curtain-wall towers, brick/limestone mid-rises with punched windows and
 * precast offices with ribbon windows — setbacks, podiums and rooftop plant.
 *
 * LAYOUT, for the chapter cameras:
 *  - the site (|x|,|z| < 60) sits in a ring of streets and sidewalks
 *  - a public square opens in front of the main (+z) and east (+x) faces, so
 *    cameras that orbit the frontier from that side (frontierCamera's angles,
 *    portrait's longer distances) never sit inside a building
 *  - mid-rise near the site (the new tower dominates), two skyline clusters
 *    further out behind it (Center City to the west, University City south)
 *
 * The ground carries the rest: asphalt with lane markings, sidewalks, the
 * square's lawn and paths, and the construction site itself — packed earth
 * with gravel patches, a haul road from the gate, tyre tracks and puddles.
 * At dusk windows light by floor and bay (warm and cool offices), shopfronts
 * glow, and street lights come on along every street.
 */

/** the public square in front of the site (camera side) */
export function inPlaza(x: number, z: number) {
  const d = Math.hypot(x, z)
  const a = Math.atan2(x, z)
  return d < 158 && a > -0.42 && a < 1.8
}

const CLUSTERS = [
  { x: -390, z: -170, r: 280, peak: 250 },
  { x: 240, z: -440, r: 210, peak: 185 },
  { x: -120, z: 470, r: 170, peak: 120 },
]

export class City {
  root = new THREE.Group()
  private lightsU = { value: 0 }

  constructor(mobile: boolean) {
    this.root.name = 'city'
    const mats: THREE.Matrix4[] = []
    const cols: number[] = []
    const kinds: number[] = []
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const BLOCK = 48
    const R = mobile ? 620 : 1250
    const c = new THREE.Color()
    const glassTints = ['#5d7486', '#6c7f8c', '#4f6576', '#7a8b93', '#56707a', '#667a8e']
    const brick = ['#7b4b3a', '#8a5a44', '#6e4336', '#9a7a62', '#b3a38a', '#a49680']
    const precast = ['#a9a69e', '#8f8f8a', '#bdb8ac', '#9aa0a3']
    const add = (x: number, y0: number, z: number, w: number, h: number, d: number, kind: number, color: string) => {
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y0 + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d)))
      c.set(color)
      cols.push(c.r, c.g, c.b)
      kinds.push(kind)
    }
    for (let bx = -R; bx <= R; bx += BLOCK) {
      for (let bz = -R; bz <= R; bz += BLOCK) {
        const d = Math.hypot(bx, bz)
        if (d > R) continue
        if (Math.abs(bx) < 70 && Math.abs(bz) < 70) continue
        if (inPlaza(bx, bz)) continue
        // beyond the centre: low, sparser neighbourhoods fading into the haze
        const outer = d > 780
        if (outer && rnd() < 0.35) continue
        // skyline clusters: how "downtown" is this block?
        let boost = 0
        let peak = 0
        for (const k of CLUSTERS) {
          const kd = Math.hypot(bx - k.x, bz - k.z)
          const f = Math.max(0, 1 - kd / k.r)
          if (f > boost) {
            boost = f
            peak = k.peak
          }
        }
        const near = d < 210
        const tower = !near && !outer && (rnd() < boost * 0.9 || rnd() < 0.025)
        if (tower) {
          // one tower per block: podium, shaft, setback, plant
          const w = 22 + rnd() * 12
          const dz = 22 + rnd() * 12
          const h = 70 + Math.pow(rnd(), 0.9) * Math.max(60, peak * (0.35 + 0.75 * boost))
          const x = bx + (rnd() - 0.5) * (36 - w)
          const z = bz + (rnd() - 0.5) * (36 - dz)
          const glass = rnd() < 0.72
          const kind = glass ? 0 : rnd() < 0.5 ? 2 : 1
          const col = glass ? glassTints[Math.floor(rnd() * glassTints.length)] : kind === 2 ? precast[Math.floor(rnd() * precast.length)] : brick[3 + Math.floor(rnd() * 3)]
          add(bx, 0, bz, 36, 10 + rnd() * 8, 36, rnd() < 0.5 ? 1 : 2, rnd() < 0.5 ? brick[Math.floor(rnd() * 6)] : precast[Math.floor(rnd() * 4)])
          const shaft = h * (0.72 + rnd() * 0.12)
          add(x, 0, z, w, shaft, dz, kind, col)
          const sw = w * (0.62 + rnd() * 0.18)
          const sd = dz * (0.62 + rnd() * 0.18)
          add(x, shaft, z, sw, h - shaft, sd, kind, col)
          add(x, h, z, sw * 0.5, 3 + rnd() * 3, sd * 0.5, 3, '#6b6e70')
          continue
        }
        // mid-rise block: 2–4 buildings (Philly brick, limestone, precast, the odd glass)
        const n = outer ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * (mobile ? 2 : 3))
        for (let i = 0; i < n; i++) {
          if (mobile && rnd() < 0.2) continue
          const w = 11 + rnd() * 15
          const dz = 11 + rnd() * 15
          const x = bx + (rnd() - 0.5) * Math.max(0, 37 - w)
          const z = bz + (rnd() - 0.5) * Math.max(0, 37 - dz)
          if (Math.abs(x) < 72 && Math.abs(z) < 72) continue
          if (inPlaza(x, z)) continue
          const hMax = near ? 46 : outer ? 30 : 58 + boost * 50
          const h = 11 + Math.pow(rnd(), 1.6) * (hMax - 11)
          const r = rnd()
          const kind = r < 0.5 ? 1 : r < 0.8 ? 2 : 0
          const col = kind === 1 ? brick[Math.floor(rnd() * brick.length)] : kind === 2 ? precast[Math.floor(rnd() * precast.length)] : glassTints[Math.floor(rnd() * glassTints.length)]
          add(x, 0, z, w, h, dz, kind, col)
          if (rnd() < 0.55) add(x + (rnd() - 0.5) * w * 0.3, h, z + (rnd() - 0.5) * dz * 0.3, w * (0.2 + rnd() * 0.25), 2 + rnd() * 2.5, dz * (0.2 + rnd() * 0.25), 3, '#6d7072')
        }
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1)
    geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(new Float32Array(kinds), 1))
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.6 })
    const lights = this.lightsU
    mat.onBeforeCompile = shader => {
      shader.uniforms.uLights = lights
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aKind;\nvarying vec3 vCityPos;\nvarying vec3 vCityN;\nvarying float vSeed;\nvarying float vKind;\nvarying float vBase;')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vec4 cityWp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          vCityPos = cityWp.xyz;
          vCityN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);
          vSeed = instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.071 + instanceMatrix[3].y * 0.013;
          vKind = aKind;
          vBase = instanceMatrix[3].y - 0.5 * instanceMatrix[1].y;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uLights;
          varying vec3 vCityPos;
          varying vec3 vCityN;
          varying float vSeed;
          varying float vKind;
          varying float vBase;
          float cityHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          float cityBox(vec2 f, vec2 lo, vec2 hi) { return step(lo.x, f.x) * step(f.x, hi.x) * step(lo.y, f.y) * step(f.y, hi.y); }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          // facade systems by kind: 0 curtain wall, 1 punched masonry, 2 precast ribbon, 3 plant (blank)
          float cityWall = 1.0 - step(0.6, abs(vCityN.y));
          vec2 cityFu = vec2(abs(vCityN.x) > 0.5 ? vCityPos.z : vCityPos.x, vCityPos.y - vBase);
          float k0 = 1.0 - step(0.5, vKind);
          float k1 = step(0.5, vKind) * (1.0 - step(1.5, vKind));
          float k2 = step(1.5, vKind) * (1.0 - step(2.5, vKind));
          float k3 = step(2.5, vKind);
          vec2 cityCellSize = k0 * vec2(1.6, 3.9) + k1 * vec2(3.1, 3.5) + k2 * vec2(1.9, 3.7) + k3 * vec2(8.0, 8.0);
          vec2 cityCell = floor(cityFu / cityCellSize);
          vec2 cityF = fract(cityFu / cityCellSize);
          float cityWinC = cityBox(cityF, vec2(0.04, 0.24), vec2(0.96, 0.97));
          float cityWinM = cityBox(cityF, vec2(0.3, 0.28), vec2(0.7, 0.86));
          float cityWinP = cityBox(cityF, vec2(0.05, 0.36), vec2(0.97, 0.84));
          float cityWin = (k0 * cityWinC + k1 * cityWinM + k2 * cityWinP) * cityWall;
          // shopfronts: tall glass at street level on masonry/precast
          float shop = step(cityFu.y, 4.6) * step(0.5, vKind) * (1.0 - k3) * cityWall * step(0.08, fract(cityFu.x / 6.0)) * step(0.7, cityFu.y);
          cityWin = max(cityWin * step(4.6, cityFu.y), shop);
          // fade the pattern with distance (no moire on far towers)
          vec2 cfw = fwidth(cityFu / cityCellSize);
          float cityDetail = 1.0 - smoothstep(0.25, 0.7, max(cfw.x, cfw.y));
          float winFrac = k0 * 0.72 + k1 * 0.22 + k2 * 0.46;
          float cityWinA = mix(winFrac * cityWall, cityWin, cityDetail);
          vec3 wallCol = diffuseColor.rgb * mix(1.0, 0.72, k0);
          vec3 winCol = mix(diffuseColor.rgb * vec3(0.55, 0.62, 0.7), vec3(0.16, 0.19, 0.22), 1.0 - k0);
          diffuseColor.rgb = mix(wallCol, winCol, cityWinA);
          // roofs: dark membrane
          diffuseColor.rgb = mix(vec3(0.2, 0.2, 0.21) * (0.8 + 0.4 * cityHash(vec2(vSeed))), diffuseColor.rgb, cityWall);`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          metalnessFactor = mix(0.0, mix(0.7, 0.92, k0), cityWinA);`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(0.88, 0.06 + 0.16 * cityHash(cityCell + vSeed), cityWinA);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            // offices light by floor and bay; residences warmer and sparser; shops glow
            float floorN = cityCell.y;
            float bayN = floor(cityCell.x / (k0 > 0.5 ? 5.0 : 3.0));
            float hb = cityHash(vec2(floorN * 1.7 + vSeed, bayN + vSeed * 3.1));
            float hw = cityHash(cityCell + vSeed * 1.3);
            float dens = uLights * mix(0.42, 0.55, k1);
            float on = step(1.0 - dens, hb) * step(0.18, hw);
            vec3 tone = mix(vec3(1.0, 0.74, 0.46), vec3(0.8, 0.88, 1.0), step(0.7, cityHash(vec2(hb, vSeed))) * (1.0 - k1));
            float night = smoothstep(0.15, 0.6, uLights);
            float lit = on * mix(winFrac * 0.55, cityWin, cityDetail * 0.8 + 0.2) * (1.0 - k3);
            totalEmissiveRadiance += tone * lit * night * (0.55 + 0.7 * hw);
            totalEmissiveRadiance += vec3(1.0, 0.8, 0.55) * shop * night * 0.9 * step(0.35, cityHash(vec2(cityCell.x, vSeed)));
          }`,
        )
    }
    mat.customProgramCacheKey = () => 'city-facades-2'
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length)
    mats.forEach((m, i) => mesh.setMatrixAt(i, m))
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols), 3)
    mesh.frustumCulled = false
    this.root.add(mesh)

    // ---- the ground ----------------------------------------------------------
    const gmat = new THREE.MeshStandardMaterial({ color: '#3b3f44', roughness: 0.95, metalness: 0 })
    gmat.onBeforeCompile = shader => {
      shader.uniforms.uLights = lights
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xz;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uLights;
          varying vec2 vGround;
          float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          float gNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
          }
          float gFbm(vec2 p) { return gNoise(p) * 0.55 + gNoise(p * 2.3 + 5.1) * 0.3 + gNoise(p * 5.7 + 1.7) * 0.15; }
          float gBand(float d, float w) { float fw = max(fwidth(d), 1e-3); return 1.0 - smoothstep(w - fw, w + fw, d); }
          // a pair of tyre ruts (2.1 m gauge) along a circular arc: centre c, radius r,
          // angles a0..a1 (fading in and out at the ends); tread = along-track position
          float gRut(vec2 p, vec2 c, float r, float a0, float a1, out float tread) {
            vec2 d = p - c;
            float ang = atan(d.y, d.x);
            float inArc = smoothstep(a0, a0 + 0.12, ang) * (1.0 - smoothstep(a1 - 0.12, a1, ang));
            float off = length(d) - r;
            tread = ang * r;
            return max(gBand(abs(off - 1.05), 0.27), gBand(abs(off + 1.05), 0.27)) * inArc;
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float gRough = 0.95;
          vec3 gEmit = vec3(0.0);
          {
            vec2 p = vGround;
            float dist = length(p);
            // streets on x,z = 24 + 48k (10 m), sidewalks 3 m either side
            vec2 sc = abs(fract(p / 48.0) - 0.5) * 48.0;   // distance to the street centre line
            float street = 1.0 - step(5.0, min(sc.x, sc.y));
            float walk = (1.0 - street) * (1.0 - step(12.0, min(sc.x, sc.y)));
            float site = step(abs(p.x), 60.0) * step(abs(p.y), 60.0);
            float ang = atan(p.x, p.y);
            float plaza = step(dist, 158.0) * step(-0.42, ang) * step(ang, 1.8) * (1.0 - street) * (1.0 - walk) * (1.0 - site);
            float asphaltN = gNoise(p * 0.35);
            vec3 col = diffuseColor.rgb * (0.9 + 0.2 * asphaltN);
            // asphalt + markings (centre dashes, stop bars) — fade with distance
            float fade = 1.0 - smoothstep(180.0, 420.0, dist);
            vec3 asphalt = vec3(0.15, 0.155, 0.165) * (0.85 + 0.3 * asphaltN);
            float alongX = step(sc.y, sc.x);  // street running along x here?
            float cl = alongX > 0.5 ? sc.y : sc.x;
            float along = alongX > 0.5 ? p.x : p.y;
            float dash = gBand(cl, 0.08) * step(0.5, fract(along / 6.0)) * step(9.0, max(sc.x, sc.y));
            float stopbar = gBand(abs(max(sc.x, sc.y) - 7.0), 0.2) * step(cl, 5.0);
            asphalt = mix(asphalt, vec3(0.62, 0.55, 0.3), dash * fade * 0.8);
            asphalt = mix(asphalt, vec3(0.7), stopbar * fade * 0.7);
            col = mix(col, asphalt, street * (1.0 - site));
            col = mix(col, vec3(0.46, 0.45, 0.43) * (0.9 + 0.15 * gNoise(p * 1.3)), walk * (1.0 - site));
            // the square: lawn with paths
            vec3 lawn = vec3(0.2, 0.27, 0.13) * (0.8 + 0.4 * gFbm(p * 0.08));
            vec2 pc = p - vec2(60.0, 110.0);
            float path = max(gBand(abs(pc.x - pc.y * 0.4), 1.4), gBand(abs(length(pc) - 30.0), 1.4));
            lawn = mix(lawn, vec3(0.52, 0.49, 0.44), path);
            col = mix(col, lawn, plaza);
            // the site: packed earth (drier and damper patches), a speckle of
            // gravel, the haul roads, rutted tyre tracks with tread, puddles lying
            // in the ruts and the low spots (they mirror the sky)
            float n1 = gFbm(p * 0.09);
            float n2 = gFbm(p * 0.6 + 3.0);
            vec3 earth = mix(vec3(0.34, 0.28, 0.22), vec3(0.5, 0.44, 0.36), n1);
            earth = mix(earth, vec3(0.56, 0.53, 0.48), smoothstep(0.55, 0.7, gFbm(p * 0.05 + 9.0)) * 0.75);
            earth = mix(earth, earth * 0.72, smoothstep(0.58, 0.72, gFbm(p * 0.07 + 31.0)) * 0.8);
            earth *= 0.86 + 0.24 * n2;
            float road = max(step(abs(p.x - 22.0), 5.5) * step(18.0, p.y), step(max(abs(p.x), abs(p.y)), 25.0) * step(19.0, max(abs(p.x), abs(p.y))));
            vec3 gravel = vec3(0.47, 0.46, 0.43) * (0.85 + 0.3 * n2);
            earth = mix(earth, gravel, road);
            // stones: fine speckle, fading out with distance before it can shimmer
            vec2 sp = p * 6.0;
            float grDet = 1.0 - smoothstep(0.3, 0.9, length(fwidth(sp)));
            vec2 sCell = floor(sp);
            float st = gHash(sCell);
            vec2 sAt = vec2(gHash(sCell + 1.3), gHash(sCell + 5.7)) * 0.5 + 0.25;
            float sR = 0.1 + 0.22 * gHash(sCell + 9.1);
            float stoneA = step(0.62 - 0.25 * road, st) * (1.0 - smoothstep(sR * 0.6, sR, length(fract(sp) - sAt)));
            earth *= mix(1.0, mix(0.8, 1.2, gHash(sCell + 7.0)), stoneA * grDet);
            // tyre ruts: from the gate round to the west laydown, round the
            // tower on the haul road, a turning circle by the mixer, and out east
            float tr0; float tr1; float tr2; float tr3;
            float rut = gRut(p, vec2(-12.0, 62.0), 34.0, -2.3, 0.1, tr0);
            float rutB = gRut(p, vec2(-58.0, 8.0), 40.0, -0.9, 0.62, tr1);
            float rutC = gRut(p, vec2(12.0, 42.0), 8.5, -3.14, 3.14, tr2);
            float rutD = gRut(p, vec2(70.0, 50.0), 48.0, -3.2, -1.95, tr3);
            float ring = max(gBand(abs(max(abs(p.x), abs(p.y)) - 20.9), 0.27), gBand(abs(max(abs(p.x), abs(p.y)) - 23.1), 0.27));
            float tread = tr0 * step(0.5, rut) + tr1 * step(0.5, rutB) + tr2 * step(0.5, rutC) + tr3 * step(0.5, rutD) + (abs(p.x) > abs(p.y) ? p.y : p.x) * step(0.5, ring);
            // (broken up along their length: pressed in here, scuffed out there)
            float ruts = max(max(max(rut, rutB), max(rutC, rutD)), ring * 0.7) * (0.35 + 0.65 * smoothstep(0.3, 0.62, gFbm(p * 0.21 + 13.0)));
            float treadDet = 1.0 - smoothstep(0.2, 0.6, fwidth(tread / 0.32));
            float lug = mix(1.0, 0.75 + 0.25 * step(0.5, fract(tread / 0.32)), treadDet);
            earth *= 1.0 - ruts * (0.17 * lug + 0.04);
            // puddles: in the ruts where they dip, and in the low spots
            float lowN = gFbm(p * 0.11 + 17.0);
            float rutN = gFbm(p * 0.35 + 4.0);
            float lowSpot = smoothstep(0.64, 0.7, lowN) * (0.35 + 0.65 * road);
            float inRut = ruts * smoothstep(0.52, 0.6, rutN);
            float wet = max(lowSpot, inRut);
            float damp = max(smoothstep(0.58, 0.66, lowN) * (0.35 + 0.65 * road), ruts * smoothstep(0.44, 0.52, rutN));
            earth = mix(earth, earth * 0.7, damp);
            earth = mix(earth, earth * 0.28, wet);
            col = mix(col, earth, site);
            gRough = mix(gRough, mix(0.82, 0.04, wet), max(damp, ruts * 0.5) * site);
            // street lights along every street (both kerbs, every 24 m), at night
            vec2 lp = abs(fract((p + 12.0) / 24.0) - 0.5) * 24.0;
            float kerb = alongX > 0.5 ? abs(cl - 6.0) : abs(cl - 6.0);
            float lamp = exp(-(kerb * kerb + (alongX > 0.5 ? lp.x * lp.x : lp.y * lp.y)) / 9.0) * (1.0 - site) * step(cl, 9.0);
            // far away the lamps are sub-pixel: fade to their average glow (the city's night haze)
            float mpp = length(fwidth(p));
            float lampDetail = 1.0 - smoothstep(1.5, 6.0, mpp);
            float lampAvg = 0.12 * (1.0 - site);
            // plus the odd lit window / yard light out in the neighbourhoods
            vec2 cellL = floor(p / 9.0);
            float spark = step(0.93, gHash(cellL)) * exp(-dot(fract(p / 9.0) - 0.5, fract(p / 9.0) - 0.5) * 60.0) * (1.0 - street) * step(420.0, dist);
            gEmit += vec3(1.0, 0.68, 0.36) * (mix(lampAvg, lamp, lampDetail) + spark * lampDetail * 0.8 + 0.02 * step(420.0, dist) * (1.0 - lampDetail)) * smoothstep(0.2, 0.7, uLights) * 0.9;
            diffuseColor.rgb = col;
          }`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = gRough;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          totalEmissiveRadiance += gEmit;`,
        )
    }
    gmat.customProgramCacheKey = () => 'city-ground-3'
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(5600, 5600), gmat)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = !mobile
    this.root.add(ground)
  }

  /** 0 day … 1 night: window + street lights */
  update(lights: number) {
    this.lightsU.value = lights
  }
}
