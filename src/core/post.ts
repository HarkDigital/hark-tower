import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

/*
 * Post-processing for Hark Tower: Render → Sanitize (NaN guard) → Bloom →
 * Output → FINAL.
 *
 * FINAL is an architectural-film finish (gentle vignette, fine grain, a touch
 * of lens aberration, flash and fade) plus the BLUEPRINT CUT: approaching a
 * chapter boundary the frame is redrawn as an architect's blueprint — the
 * scene's edges (a Sobel pass on luminance) become pale cyan linework on
 * blueprint-blue drafting paper with a grid, converting from the top of the
 * frame down like a sheet being laid on the table. At the boundary the sheet
 * is clean (grid only), which hides the swap; the next chapter is then drawn
 * in, and the paper lifts away.
 *
 * `params.draft` (0..1) lets a chapter hold part of the blueprint look on
 * purpose (e.g. the Blueprint chapter).
 *
 * Keep the Post API (params / resetParams / setSize / render / compileAsync /
 * setFadeTone) and the uTransition / uFade / uFlash / uGlitch uniforms — the
 * engine drives them.
 */

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDpr: { value: 1 },
    /** 0..1, peaks exactly at a chapter boundary (engine-driven) */
    uTransition: { value: 0 },
    /** 0..1 heat haze / wind shimmer a chapter can add */
    uGlitch: { value: 0 },
    uAberration: { value: 0.0012 },
    uGrain: { value: 0.03 },
    uVignette: { value: 0.32 },
    /** 0..1 wash to white */
    uFlash: { value: 0 },
    /** 0..1 fade to uFadeColor (reduced-motion cuts) */
    uFade: { value: 0 },
    /** 0..1 chapter-held blueprint look */
    uDraft: { value: 0 },
    uPaper: { value: new THREE.Color('#0d3566') },
    uLine: { value: new THREE.Color('#cfeaff') },
    uFadeColor: { value: new THREE.Color('#0d3566') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uDpr, uTransition, uGlitch, uAberration, uGrain, uVignette, uFlash, uFade, uDraft;
    uniform vec2 uResolution;
    uniform vec3 uPaper, uLine, uFadeColor;
    varying vec2 vUv;

    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float pow2(float x) { return x * x; }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

    // Sobel edge strength on luminance, sampled at a DPR-scaled pixel step
    float edges(vec2 uv) {
      vec2 px = uDpr * 1.25 / uResolution;
      float tl = luma(texture2D(tDiffuse, uv + px * vec2(-1.0, 1.0)).rgb);
      float t = luma(texture2D(tDiffuse, uv + px * vec2(0.0, 1.0)).rgb);
      float tr = luma(texture2D(tDiffuse, uv + px * vec2(1.0, 1.0)).rgb);
      float l = luma(texture2D(tDiffuse, uv + px * vec2(-1.0, 0.0)).rgb);
      float r = luma(texture2D(tDiffuse, uv + px * vec2(1.0, 0.0)).rgb);
      float bl = luma(texture2D(tDiffuse, uv + px * vec2(-1.0, -1.0)).rgb);
      float b = luma(texture2D(tDiffuse, uv + px * vec2(0.0, -1.0)).rgb);
      float br = luma(texture2D(tDiffuse, uv + px * vec2(1.0, -1.0)).rgb);
      float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
      float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
      return sqrt(gx * gx + gy * gy);
    }

    vec3 paper(vec2 uv) {
      vec2 p = uv * uResolution / uDpr;                   // CSS px
      vec2 g1 = abs(fract(p / 24.0 + 0.5) - 0.5) * 24.0;  // minor grid
      vec2 g2 = abs(fract(p / 120.0 + 0.5) - 0.5) * 120.0; // major grid
      float minor = 1.0 - smoothstep(0.0, 0.9, min(g1.x, g1.y));
      float major = 1.0 - smoothstep(0.0, 1.2, min(g2.x, g2.y));
      vec3 c = uPaper * (0.9 + 0.2 * (1.0 - length(uv - 0.5)));
      c = mix(c, uLine, minor * 0.08 + major * 0.18);
      // paper tooth
      c += (hash(floor(p)) - 0.5) * 0.02;
      return c;
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float g = clamp(uGlitch, 0.0, 1.0);
      uv.x += g * 0.003 * sin(uv.y * 70.0 + uTime * 9.0);

      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * uAberration).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * uAberration).b;

      // ---- the blueprint (cut) — converts from the top of the frame down
      float t = clamp(uTransition, 0.0, 1.0);
      float m = max(clamp(t * 1.7 - (1.0 - uv.y) * 0.7, 0.0, 1.0), clamp(uDraft, 0.0, 1.0));
      if (m > 0.001) {
        float e = edges(uv);
        // linework fades out near the boundary: the sheet is clean at the swap
        float ink = smoothstep(0.08, 0.35, e) * (1.0 - smoothstep(0.72, 0.98, t));
        vec3 bp = mix(paper(uv), uLine, ink * 0.9);
        // a bright drafting edge where the sheet is being laid
        float front = exp(-pow2((m - 0.5) * 7.0)) * (1.0 - step(0.999, m)) * step(0.001, t);
        bp += uLine * front * 0.12;
        col = mix(col, bp, smoothstep(0.0, 1.0, m));
      }

      col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
      float v = 1.0 - smoothstep(0.35, 1.05, length(c * vec2(1.0, 0.9)) * 1.4);
      col *= mix(1.0, 0.62 + 0.38 * v, uVignette);
      col += (hash(vUv * uResolution + fract(uTime * 7.13) * 91.0) - 0.5) * uGrain;
      col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

/** minimum seconds between two white-flash onsets (WCAG 2.3.1) */
const FLASH_GAP = 0.4

export type PostParams = {
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  aberration: number
  grain: number
  vignette: number
  /** wobble 0..1 */
  glitch: number
  /** white wash 0..1 */
  flash: number
  exposure: number
  /** 0..1 hold part of the blueprint look (drafting-table moments) */
  draft: number
}

/** Bloom only catches HDR (> ~1.0): emissive lamps, LEDs, speculars. */
export const POST_DEFAULTS: PostParams = {
  bloomStrength: 0.4,
  bloomRadius: 0.45,
  bloomThreshold: 0.95,
  aberration: 0.0012,
  grain: 0.03,
  vignette: 0.32,
  glitch: 0,
  flash: 0,
  exposure: 1,
  draft: 0,
}

/**
 * Scrubs NaN/Inf and clamps runaway HDR right after the scene render. A single
 * bad fragment would otherwise smear across the whole frame through bloom.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), c.a);
    }
  `,
}

export class Post {
  composer: EffectComposer
  bloom: UnrealBloomPass
  final: ShaderPass
  /**
   * Chapters write targets here every frame (the engine resets them to
   * defaults first); values are damped so nothing pops at a cut.
   */
  params: PostParams = { ...POST_DEFAULTS }
  private current: PostParams = { ...POST_DEFAULTS }
  transition = 0
  fade = 0
  private lastFlashAt = -1e9
  private flashLive = false
  private flashOk = true

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    /** skip MSAA (retina / mobile: already supersampled; MSAA half-float targets are huge) */
    noMsaa: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: noMsaa ? 0 : 4,
    })
    this.composer = new EffectComposer(renderer, rt)
    this.composer.addPass(new RenderPass(scene, camera))
    this.composer.addPass(new ShaderPass(SanitizeShader))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.45, 0.4, 1.0)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.final = new ShaderPass(FinalShader)
    this.composer.addPass(this.final)
  }

  /** Colour the reduced-motion fade passes through (blueprint blue by default). */
  setCutColor(color: THREE.ColorRepresentation) {
    ;(this.final.uniforms.uFadeColor.value as THREE.Color).set(color)
  }

  /** Engine hook (kept for compatibility; themes may tint the fade by scene tone). */
  setFadeTone(_tone: number) {}

  resetParams() {
    Object.assign(this.params, POST_DEFAULTS)
  }

  /**
   * Compile every post-processing shader in parallel so the first composer
   * render doesn't block on synchronous links.
   */
  compileAsync(): Promise<unknown> {
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const b = this.bloom as unknown as Record<string, unknown>
    const mats: THREE.Material[] = []
    const add = (m: unknown) => {
      if (m && (m as THREE.Material).isMaterial) mats.push(m as THREE.Material)
    }
    for (const pass of this.composer.passes) add((pass as unknown as { material?: unknown }).material)
    for (const m of (b.separableBlurMaterials as unknown[]) ?? []) add(m)
    add(b.compositeMaterial)
    add(b.blendMaterial)
    add(b.materialHighPassFilter)
    add(b.copyMaterial)
    return Promise.all(mats.map(m => this.renderer.compileAsync(new THREE.Mesh(quad.geometry, m), cam).catch(() => {})))
  }

  setSize(w: number, h: number, dpr: number) {
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(w, h)
    this.bloom.resolution.set((w * dpr) / 2, (h * dpr) / 2)
    this.final.uniforms.uResolution.value.set(w * dpr, h * dpr)
    this.final.uniforms.uDpr.value = dpr
  }

  render(dt: number, time: number) {
    const k = 1 - Math.exp(-6 * dt)
    const c = this.current
    const p = this.params
    for (const key of Object.keys(p) as (keyof PostParams)[]) {
      // flash & glitch respond instantly so chapters can punch them
      c[key] = key === 'flash' || key === 'glitch' ? p[key] : c[key] + (p[key] - c[key]) * k
    }
    // flash budget (WCAG 2.3.1): a flash starting within FLASH_GAP of the last is dropped
    if (c.flash > 0.02) {
      if (!this.flashLive) {
        this.flashLive = true
        this.flashOk = time - this.lastFlashAt >= FLASH_GAP
        if (this.flashOk) this.lastFlashAt = time
      }
      if (!this.flashOk) c.flash = 0
    } else this.flashLive = false
    this.bloom.strength = c.bloomStrength
    this.bloom.radius = c.bloomRadius
    this.bloom.threshold = c.bloomThreshold
    this.renderer.toneMappingExposure = c.exposure
    const u = this.final.uniforms
    u.uTime.value = time
    u.uTransition.value = this.transition
    u.uGlitch.value = c.glitch
    u.uAberration.value = c.aberration
    u.uGrain.value = c.grain
    u.uVignette.value = c.vignette
    u.uFlash.value = c.flash
    u.uDraft.value = c.draft
    u.uFade.value = this.fade
    this.composer.render(dt)
  }
}
