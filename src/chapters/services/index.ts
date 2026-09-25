import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { clamp, lerp } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { Callout } from '../../core/dom'
import { MAT, Sparks, personGeometry } from '../../kit/steel'
import { applySite, beat, FLOOR_H } from '../common'
import { CAR, FACE, GATE_SLABS, Hoist } from './hoist'
import { BOARD, createBoards, createHeaders, loadFonts, whenFonts, type Boards } from './boards'
import { Fitout } from './fitout'
import { Hud } from './hud'
import { Stillage } from './load'
import * as TL from './timeline'
import { forInstances, instancedDepth } from './mats'
import './services.css'

/*
 * FLOORS — eleven floors, eleven services. The camera rides the construction
 * hoist up the +x face of the tower (the car and its mast frame the
 * foreground). At each stop the landing gate lifts, the floor's drawing is
 * drafted on its board, the curtain wall drops in, the ceiling lights come on
 * and the board sweeps into a lit sign — while the steel keeps going up above.
 * The spec plate names the floor in view: LEVEL 19 · 01 / 11.
 *
 * Everything is a pure function of `local` (src/chapters/services/timeline.ts);
 * frame.time only drives idle motion (the beacon, sparks, car hum).
 */

const yOf = (slab: number) => slab * FLOOR_H

export default function create(): Chapter {
  const group = new THREE.Group()
  const B = beat(0, TL.COUNT, TL.A, TL.B)
  let hoist: Hoist | null = null
  let boards: Boards | null = null
  let headers: ReturnType<typeof createHeaders> | null = null
  let fitout: Fitout | null = null
  let workers: THREE.InstancedMesh | null = null
  let sparks: Sparks | null = null
  let hud: Hud | null = null
  let note: Callout | null = null
  let load: Stillage | null = null
  let noteText = ''
  const anchor = new THREE.Vector3()
  const proj = new THREE.Vector3()
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const one = new THREE.Vector3(1, 1, 1)
  const zero = new THREE.Vector3(0, 0, 0)
  const v = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)

  const place = (i: number, x: number, y: number, z: number, rotY: number, show = true) => {
    if (!workers) return
    q.setFromAxisAngle(up, rotY)
    m.compose(v.set(x, y, z), q, show ? one : zero)
    workers.setMatrixAt(i, m)
  }

  return {
    id: 'services',
    group,
    anchors: B.centers,

    async init(ctx) {
      const fonts = await loadFonts()
      hoist = new Hoist(ctx.mobile, yOf)
      group.add(hoist.root)
      await nextFrame()
      boards = createBoards(ctx.renderer, ctx.mobile, yOf)
      group.add(boards.mesh)
      headers = createHeaders(GATE_SLABS, s => ({ x: FACE + 0.365, y: yOf(s) + 2.9, z: CAR.cz }), ctx.mobile)
      group.add(headers.mesh)
      if (!fonts) {
        // slow network: painted with fallbacks for now, repaint when the faces land
        const b = boards
        const h = headers
        whenFonts().then(() => {
          b.refresh()
          h.redraw()
        })
      }
      await nextFrame()
      fitout = new Fitout(yOf)
      group.add(fitout.root)
      workers = new THREE.InstancedMesh(personGeometry(), forInstances(MAT.person()), 2)
      workers.frustumCulled = false
      workers.castShadow = !ctx.mobile
      workers.customDepthMaterial = instancedDepth()
      group.add(workers)
      load = new Stillage(ctx.mobile)
      group.add(load.root)
      sparks = new Sparks(ctx.mobile ? 90 : 220, 0.1)
      group.add(sparks.points)
      hud = new Hud(ctx.stage, k => window.__hark?.land('services', true, B.centers[k]))
      // a drawing annotation on the floor being fitted out (landscape only)
      note = new Callout(ctx.stage, { side: 'right', offset: { x: 44, y: -16 } })
      note.root.classList.add('sv-note')
    },

    update(local, frame, ctx) {
      applySite(ctx, 'services', local)
      // Floors rides its own hoist: park the world's (no second, unexplained lift)
      ctx.world.params.hoist = 0
      const p = ctx.world.params
      const built = TL.builtFor(local)
      p.built = built
      p.glazed = Math.max(0, built - 6)
      p.fitted = Math.max(0, built - 12)
      const slab = TL.hoistSlab(local)
      const carY = yOf(slab)
      const frontier = built * FLOOR_H
      // shadows centred between the car and the steel
      p.focus.set(8, (carY + frontier) / 2, 6)
      // the crane flies the next floors' glass in over the +z side, slewing slowly
      // (hanging low beside the headline in the intro, hoisted clear as the plate arrives)
      p.crane.yaw = lerp(1.78, 1.45, local)
      p.crane.reach = 0.42
      p.crane.drop = lerp(24, 16, TL.smoother((local - 0.07) / 0.1))
      if (!hoist || !boards || !headers || !fitout || !workers || !sparks || !hud || !load) return
      // (hookWorld is last frame's: the crane moves slowly and damped, so it never shows)
      load.update(ctx.world.crane.hookWorld, p.crane.yaw, frame.time, ctx.reducedMotion)

      // the hoist: mast grows with the building, a landing at every poured slab
      const poured = Math.max(0, Math.floor(built - 1.9))
      const landings = Math.min(GATE_SLABS, poured)
      const mastTop = Math.max(carY + 6.2, yOf(landings) + 4.5)
      hoist.gateOpen.fill(0)
      for (let k = 0; k < TL.COUNT; k++) {
        const s = TL.stopState(k, local)
        const sl = TL.slabOf(k)
        if (sl - 1 < GATE_SLABS) hoist.gateOpen[sl - 1] = s.gate
        boards.set(k, s.draw, s.lit)
        // the world's own curtain wall reaches this floor ~6 floors behind the steel
        fitout.set(k, s.glass, s.lights, ctx.reducedMotion, p.glazed >= sl + 2.2)
      }
      // the top landing opens as the car arrives there at the end
      const topOpen = clamp((local - 0.975) / 0.02)
      if (TL.TOP_SLAB - 1 < GATE_SLABS) hoist.gateOpen[TL.TOP_SLAB - 1] = topOpen
      const speed = TL.hoistSpeed(local)
      hoist.update(carY, mastTop, landings, frame.time, ctx.reducedMotion, speed)
      let nb = 0
      for (let k = 0; k < TL.COUNT; k++) if (TL.slabReady(TL.slabOf(k), built)) nb = k + 1
      boards.setVisible(nb)
      headers.setVisible(landings)

      // people (the scale): the car operator, and a fitter waiting at the open landing
      place(0, CAR.cx - 0.25, carY, CAR.cz + 0.7, -Math.PI / 2)
      const k = Math.round(slab - TL.SLAB0)
      const docked = k >= 0 && k < TL.COUNT && Math.abs(slab - TL.slabOf(k)) < 0.01
      const gate = docked ? TL.stopState(k, local).gate : 0
      place(1, FACE - 1.1, carY, CAR.cz - 2.1, Math.PI / 2 + 0.4, gate > 0.5)
      workers.instanceMatrix.needsUpdate = true

      // sparks: brackets welded at the slab edge while the curtain wall goes in
      // (the world's own gang bolts up the steel at the frontier)
      if (!ctx.reducedMotion && docked) {
        const s = TL.stopState(k, local)
        if (s.glass > 0.02 && s.glass < 0.98 && Math.random() < 0.4) sparks.emit(v.set(FACE + 0.1, carY + 0.05, 9 - s.glass * 22), 5, 1.6)
      }
      sparks.update(frame.dt)

      // the annotation: the sheet's status while the car is docked
      if (note) {
        let vis = 0
        if (docked && frame.width > frame.height) {
          const s = TL.stopState(k, local)
          vis = TL.smoother((s.p - 0.3) / 0.06) * (1 - TL.smoother((s.p - 0.93) / 0.05))
          const sheet = `A-${200 + TL.levelOf(TL.slabOf(k))}`
          const text = s.lit >= 0.99 ? `${sheet} · Fitted out` : s.glass < 1 ? `${sheet} · Glazing` : `${sheet} · Lighting`
          if (text !== noteText) {
            noteText = text
            note.label.textContent = text
          }
          // the sheet's right edge, level with the glyph: the label runs out over the new glass
          anchor.set(BOARD.x, yOf(TL.slabOf(k)) + BOARD.y + BOARD.h * 0.62, BOARD.z - BOARD.w / 2)
          // only where it fits on the right (flipped left it would sit on the board or the plate)
          proj.copy(anchor).project(ctx.camera)
          const x = (proj.x * 0.5 + 0.5) * frame.width
          if (!(x + 44 + 8 + text.length * 7.3 + 18 < frame.width - 12)) vis = 0
        }
        note.update(anchor, ctx.camera, frame.width, frame.height, vis)
      }

      // the copy
      const introOn = local > 0.012 && local < TL.A + 0.1 * TL.SPAN
      hud.update(introOn, TL.cardIndex(local), speed > 0.04)

      // bloom only what is really lit (the signs, sparks, the beacon), not the bright morning sky
      ctx.post.params.bloomThreshold = 1.15
      ctx.post.params.bloomStrength = 0.55
    },

    camera(local, frame, out) {
      const portrait = frame.height > frame.width
      const slab = TL.hoistSlab(local)
      const y = yOf(slab)
      const start = 1 - TL.smoother(local / 0.09)
      const end = TL.smoother((local - TL.B) / (1 - TL.B))
      // a slow drift round the corner over the whole ride
      const phi = lerp(portrait ? 0.46 : 0.56, portrait ? 0.3 : 0.36, TL.smoother(local)) + start * 0.1 - end * 0.08
      const D = (portrait ? 56 : 27) + end * 7 - start * 2
      // portrait: the plate owns the bottom half, so the car rides in the upper part
      // (during the intro the plate is up top instead, and the car sits lower)
      const lookZ = portrait ? lerp(6.2, 10.5, start) : 14.2
      const lookY = portrait ? lerp(-4, 3, start) : 6.8
      out.target.set(FACE, y + lookY + end * 13 - start * 1.5, lookZ)
      out.position.set(FACE + Math.cos(phi) * D, y + (portrait ? 1 : 2.4) - start * 1.5 + end * 3, lookZ + Math.sin(phi) * D)
      // the car hums while it runs
      const speed = TL.hoistSpeed(local)
      if (!frame.reducedMotion && speed > 0) {
        const a = 0.035 * speed
        out.position.x += Math.sin(frame.time * 31) * a
        out.position.y += Math.sin(frame.time * 23 + 1.3) * a
      }
      out.fov = portrait ? 50 : 46
      out.parallax = 0.5
    },
  }
}
