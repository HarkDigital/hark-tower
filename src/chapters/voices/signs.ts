import * as THREE from 'three'

/*
 * Tenant signs: the client's company (and the person) in paper-white vinyl on
 * a dark painted-glass fascia across the spandrel band over their office —
 * door lettering, scaled to the building. One canvas texture per tenant; the
 * panel is glossy (it catches the sky like the glass around it) and the
 * lettering carries a little self-light so it reads in the tower's shade.
 */

export const SIGN_W = 5.9
export const SIGN_H = 1.0
/** centre of the fascia above floor level: the spandrel band from 3.52 to 4.62 m */
export const SIGN_Y = 4.07

const DISPLAY = "'Big Shoulders Display Variable', 'Archivo Variable', 'Arial Narrow', sans-serif"
const MONO = "'IBM Plex Mono', ui-monospace, monospace"

/** Resolve once the sign faces are usable (or after a short timeout). */
export function signFontsReady(): Promise<boolean> {
  if (!document.fonts?.load) return Promise.resolve(false)
  const load = Promise.all([document.fonts.load(`800 100px ${DISPLAY}`), document.fonts.load(`500 32px ${MONO}`)]).then(
    () => true,
    () => false,
  )
  return Promise.race([load, new Promise<boolean>(r => setTimeout(() => r(false), 1500))])
}

/** Draw text with manual tracking (canvas letterSpacing is missing in Safari). */
function tracked(g: CanvasRenderingContext2D, text: string, cx: number, y: number, track: number) {
  const widths = [...text].map(ch => g.measureText(ch).width)
  const total = widths.reduce((a, b) => a + b, 0) + track * Math.max(0, text.length - 1)
  let x = cx - total / 2
  ;[...text].forEach((ch, i) => {
    g.fillText(ch, x, y)
    x += widths[i] + track
  })
}

export interface Sign {
  /** the fascia: a glossy painted-glass panel + the vinyl lettering on it */
  mesh: THREE.Group
  setOpacity(o: number): void
  redraw(): void
}

export function makeSign(company: string, person: string, mobile: boolean): Sign {
  const W = mobile ? 1024 : 1536
  const H = Math.round((W * SIGN_H) / SIGN_W)
  const cv = document.createElement('canvas')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d')!
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter

  const draw = () => {
    g.clearRect(0, 0, W, H)
    // a hairline frame just inside the panel's edge
    g.strokeStyle = 'rgba(244, 241, 234, 0.16)'
    g.lineWidth = Math.max(1, W / 1024)
    g.strokeRect(W * 0.012, H * 0.08, W * 0.976, H * 0.84)
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    const k = W / 1536
    // the company: heavy display caps, fitted to the band
    const name = company.toUpperCase()
    let size = 118 * k
    g.font = `800 ${size}px ${DISPLAY}`
    const maxW = W - 190 * k
    const w0 = g.measureText(name).width
    if (w0 > maxW) {
      size *= maxW / w0
      g.font = `800 ${size}px ${DISPLAY}`
    }
    g.fillStyle = '#e8e4da'
    const wName = g.measureText(name).width
    g.fillText(name, (W - wName) / 2, H * 0.58)
    // the person: mono caps, tracked, with rules either side
    g.font = `500 ${31 * k}px ${MONO}`
    g.fillStyle = 'rgba(244, 241, 234, 0.82)'
    const line = person.toUpperCase()
    const track = 31 * k * 0.16
    const lw = [...line].reduce((a, ch) => a + g.measureText(ch).width, 0) + track * (line.length - 1)
    const ly = H * 0.83
    tracked(g, line, W / 2, ly, track)
    g.fillStyle = 'rgba(244, 241, 234, 0.42)'
    const ruleW = Math.min(150 * k, (W - lw) / 2 - 40 * k)
    if (ruleW > 10) {
      g.fillRect(W / 2 - lw / 2 - 24 * k - ruleW, ly - 11 * k, ruleW, 2 * k)
      g.fillRect(W / 2 + lw / 2 + 24 * k, ly - 11 * k, ruleW, 2 * k)
    }
    tex.needsUpdate = true
  }
  draw()

  // the panel catches the sky like the glass around it
  const panelMat = new THREE.MeshStandardMaterial({
    color: '#15191e',
    roughness: 0.14,
    metalness: 0,
    envMapIntensity: 1.1,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  })
  // the lettering is unlit (a fixed, legible white below the bloom threshold,
  // in sun or in the tower's shade)
  const letterMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    polygonOffsetUnits: -5,
  })
  const geo = new THREE.PlaneGeometry(SIGN_W, SIGN_H)
  const mesh = new THREE.Group()
  const panel = new THREE.Mesh(geo, panelMat)
  const letters = new THREE.Mesh(geo, letterMat)
  letters.position.z = 0.01
  letters.renderOrder = 2
  mesh.add(panel, letters)
  let last = -1
  return {
    mesh,
    setOpacity(o: number) {
      if (o === last) return
      last = o
      panelMat.opacity = o
      letterMat.opacity = o
      mesh.visible = o > 0.002
    },
    redraw: draw,
  }
}
