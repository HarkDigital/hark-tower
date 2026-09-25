import * as THREE from 'three'
import { MARK_PATHS } from '../../ui/mark'
import { MAT, T, mergeAll } from '../../kit/steel'

/*
 * The project board bolted to the street face of the hoarding — every city
 * site has one: HARK TOWER in Big Shoulders, NOW BUILDING in signal green,
 * the mark, a hazard base band, and a small elevation drawing of the tower
 * going up behind it. Purely decorative site signage; it is the first thing
 * the hero's reveal sees before the camera tilts up the drawn tower.
 */

const W_M = 5.9
const H_M = 2.1
const PX = 220
const DISPLAY = "'Big Shoulders Display Variable', 'Archivo Variable', 'Arial Narrow', sans-serif"
const MONO = "'IBM Plex Mono', ui-monospace, monospace"

function paint(g: CanvasRenderingContext2D, w: number, h: number) {
  const m = (v: number) => v * PX
  g.clearRect(0, 0, w, h)
  g.fillStyle = '#14171b'
  g.fillRect(0, 0, w, h)
  // top rail: signal green
  g.fillStyle = T.signal
  g.fillRect(0, 0, w, m(0.06))
  // hazard base band
  const band = m(0.2)
  g.save()
  g.beginPath()
  g.rect(0, h - band, w, band)
  g.clip()
  g.fillStyle = '#16191d'
  g.fillRect(0, h - band, w, band)
  g.fillStyle = T.craneYellow
  const step = m(0.24)
  for (let x = -band; x < w + band; x += step) {
    g.beginPath()
    g.moveTo(x, h)
    g.lineTo(x + step / 2, h)
    g.lineTo(x + step / 2 + band, h - band)
    g.lineTo(x + band, h - band)
    g.closePath()
    g.fill()
  }
  g.restore()

  // the mark
  const markH = m(0.92)
  g.save()
  g.translate(m(0.3), m(0.3))
  g.scale(markH / 1889.9, markH / 1889.9)
  g.fillStyle = T.paper
  for (const d of MARK_PATHS.loops) g.fill(new Path2D(d))
  g.fillStyle = T.signal
  g.fill(new Path2D(MARK_PATHS.diamond))
  g.restore()

  // HARK TOWER
  const x0 = m(1.42)
  g.fillStyle = T.paper
  g.textBaseline = 'alphabetic'
  g.font = `850 ${m(0.98)}px ${DISPLAY}`
  g.fillText('HARK TOWER', x0, m(1.18))
  // NOW BUILDING + the building in one line
  g.fillStyle = T.signal
  g.font = `500 ${m(0.25)}px ${MONO}`
  g.fillText('NOW BUILDING', m(0.32), m(1.66))
  const nb = g.measureText('NOW BUILDING').width
  g.fillStyle = 'rgba(244,241,234,0.82)'
  g.font = `500 ${m(0.17)}px ${MONO}`
  g.fillText('60 FLOORS · STEEL + GLASS', m(0.32) + nb + m(0.22), m(1.64))

  // a thin elevation drawing of the tower at the right end
  const ew = m(0.34)
  const ex = w - m(0.3) - ew
  const eTop = m(0.46)
  const eBot = m(1.3)
  g.strokeStyle = T.line
  g.lineWidth = 3
  g.strokeRect(ex, eTop, ew, eBot - eTop)
  g.globalAlpha = 0.5
  g.lineWidth = 2
  for (let i = 1; i < 12; i++) {
    const y = eTop + ((eBot - eTop) * i) / 12
    g.beginPath()
    g.moveTo(ex, y)
    g.lineTo(ex + ew, y)
    g.stroke()
  }
  g.globalAlpha = 1
  const ch = m(0.22)
  g.save()
  g.translate(ex + ew / 2 - ch / 2, eTop - ch - m(0.04))
  g.scale(ch / 1889.9, ch / 1889.9)
  g.fillStyle = T.signal
  for (const d of MARK_PATHS.loops) g.fill(new Path2D(d))
  g.restore()
}

/** The board, centred at x = cx on the hoarding's street face (z = face), facing +z. */
export function projectBoard(cx: number, face: number, mobile: boolean) {
  const scale = mobile ? 0.6 : 1
  const cv = document.createElement('canvas')
  cv.width = Math.round(W_M * PX * scale)
  cv.height = Math.round(H_M * PX * scale)
  const g = cv.getContext('2d')!
  const draw = () => {
    g.setTransform(scale, 0, 0, scale, 0, 0)
    paint(g, cv.width / scale, cv.height / scale)
  }
  draw()
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const fonts = document.fonts
  if (fonts) {
    Promise.all([fonts.load(`850 100px ${DISPLAY}`), fonts.load(`500 40px ${MONO}`)])
      .catch(() => undefined)
      .then(() => fonts.ready)
      .then(() => {
        draw()
        tex.needsUpdate = true
      })
  }
  const group = new THREE.Group()
  const face3 = new THREE.Mesh(new THREE.PlaneGeometry(W_M, H_M), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 }))
  face3.position.set(cx, 0.22 + H_M / 2, face + 0.16)
  face3.receiveShadow = !mobile
  // a steel frame proud of the plywood
  const frame = new THREE.Mesh(
    mergeAll([
      new THREE.BoxGeometry(W_M + 0.2, 0.1, 0.12).translate(cx, 0.22 + H_M + 0.05, face + 0.1),
      new THREE.BoxGeometry(W_M + 0.2, 0.1, 0.12).translate(cx, 0.17, face + 0.1),
      new THREE.BoxGeometry(0.1, H_M + 0.2, 0.12).translate(cx - W_M / 2 - 0.05, 0.22 + H_M / 2, face + 0.1),
      new THREE.BoxGeometry(0.1, H_M + 0.2, 0.12).translate(cx + W_M / 2 + 0.05, 0.22 + H_M / 2, face + 0.1),
    ]),
    MAT.mullion(),
  )
  group.add(face3, frame)
  return group
}
