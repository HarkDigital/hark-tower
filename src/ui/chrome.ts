import type { Engine, EngineState } from '../core/Engine'
import type { Frame } from '../core/types'
import type { Sound } from './sound'
import { BRAND, MICROCOPY } from '../content'
import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { holdInert, releaseInert } from './inert'
import { mountRotateGate } from './rotate'
import { bindScene, holdScene, releaseScene, sceneHeld } from './scene'

/*
 * Persistent chrome: architectural site signage + a drawing set's title block.
 *
 *   top-left      the site hoarding sign: a graphite plate with a hazard
 *                 stripe edge, the Hark mark, the real "Hark.Digital"
 *                 wordmark (its dot a signal-green LED) and a small
 *                 "Concept · Tower" tag (-> back to the start)
 *   top-right     a graphite nav plate, Work · Services · Contact, each with
 *                 its sheet number, and the signal-green "Start a project"
 *                 signage plate. <= 820px: "Menu" opens a full-screen sheet
 *                 styled as the set's DRAWING INDEX (a real modal dialog:
 *                 focus trap, Escape, inert background with a fallback for
 *                 browsers without `inert`, focus returns to Menu)
 *   bottom-left   Sound: a plate with a status LED and a small live meter
 *                 (aria-pressed)
 *   bottom-right  the TITLE BLOCK: live elevation of the steel frontier
 *                 ("EL. +096.0 M", decorative), the level being erected
 *                 ("L24"), the sheet ("03 / 07 · Floors") and the plain
 *                 business name ("Services"), beside a construction PHASING
 *                 diagram: seven little elevations of the tower, one per
 *                 chapter, growing taller left to right. Phases already
 *                 built are steel, the current one is lit signal green, the
 *                 ones to come are cyan blueprint ghosts. Each is a >= 24 px
 *                 button that lands on its chapter.
 *
 * Every text sits on a graphite plate dark enough for >= 4.5:1 over the
 * brightest dawn or morning sky the world can put behind it. Short-landscape
 * phones get compact plates (ui.css).
 *
 * API used by main.ts: createChrome(root, engine, sound) → { update(frame, state) }.
 * Navigation always uses engine.land(id) (lands on settled copy; long jumps cut).
 */

/** Plain business names beside each chapter's poetic label. */
const BUSINESS: Record<string, string> = {
  hero: 'Home',
  work: 'Work',
  services: 'Services',
  voices: 'Clients',
  shield: 'Security',
  process: 'Process',
  contact: 'Contact',
}
const NAV = ['work', 'services', 'contact']
const MENU_QUERY = '(max-width: 820px)'
/** the tower's full height (m): 60 floors x 4 m */
const TOWER_H = 240
const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** "EL. +096.0 M" */
function elevation(y: number) {
  const v = Math.max(0, Math.min(999.9, y))
  // round once to tenths, then split (a hair under a whole metre gave '240.-1')
  const t = Math.round(v * 10)
  const whole = Math.floor(t / 10)
  const tenth = t % 10
  return `EL. +${pad(whole, 3)}.${tenth} M`
}
/** the level being erected: GL at grade, then L01..L60 */
function level(y: number) {
  if (y < 0.05) return 'GL'
  return `L${pad(Math.max(1, Math.min(60, Math.ceil(y / 4 - 1e-3))))}`
}

export function createChrome(root: HTMLElement, engine: Engine, sound: Sound) {
  const slots = engine.slots
  const total = slots.length
  const indexOf = (id: string) => slots.findIndex(s => s.def.id === id)
  const biz = (id: string, fallback = '') => BUSINESS[id] ?? fallback
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  // the rotate card and the drawing-index sheet both cover the scene: stop rendering under them
  bindScene(engine)
  mountRotateGate(shown => (engine.paused = shown || sceneHeld()))
  // the score follows the build: altitude of the steel, the hour, the crown
  sound.bind(() => ({
    alt: engine.world.tower.frontier / TOWER_H,
    time: engine.world.params.time,
    crown: engine.world.params.crown,
  }))
  // dev-only handle for audio checks in headless tests
  if (import.meta.env.DEV) (window as unknown as { __harkSound?: Sound }).__harkSound = sound

  // ---------------------------------------------------------------- markup

  const brandInner = `<span class="ch-haz" aria-hidden="true"></span>
      <span class="ch-mark" aria-hidden="true">${markSvg('ch-mark-svg')}</span>
      <span class="ch-brand-text" aria-hidden="true">${WORDMARK}${CONCEPT_TAG}</span>`

  const links = NAV.filter(id => indexOf(id) >= 0)
    .map(
      id =>
        `<li><a class="ch-link" href="#${id}" data-go="${id}"><span class="ch-link-n" aria-hidden="true">${pad(indexOf(id) + 1)}</span>${biz(id)}</a></li>`,
    )
    .join('')

  const pips = slots
    .map(
      (s, i) =>
        `<li><button class="ch-pip" type="button" data-go="${s.def.id}" data-i="${i}" style="--i:${i}" aria-label="${esc(biz(s.def.id, s.def.label))}: chapter ${i + 1} of ${total}, ${esc(s.def.label)}"><i aria-hidden="true"></i></button></li>`,
    )
    .join('')

  const menuItems = slots
    .map(
      (s, i) =>
        `<li style="--i:${i}"><a class="ch-ml" href="#${s.def.id}" data-go="${s.def.id}">
          <span class="ch-ml-n" aria-hidden="true">A-${100 + i + 1}</span>
          <span class="ch-ml-name">${esc(biz(s.def.id, s.def.label))}</span><span class="sr-only">, </span>
          <span class="ch-ml-lab">${esc(s.def.label)}</span>
          <span class="ch-ml-now" aria-hidden="true">Now building</span>
        </a></li>`,
    )
    .join('')

  const soundInner = `<span class="ch-led" aria-hidden="true"></span><span class="ch-sound-k">${MICROCOPY.audio}</span><span class="ch-sound-st" aria-hidden="true">: <b>${MICROCOPY.audioOff}</b></span><span class="ch-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`

  root.innerHTML = `
  <div class="chr">
    <header class="ch-top">
      <a class="ch-brand ch-plate" href="#hero" data-go="hero" aria-label="${esc(BRAND.name)}, back to the start">
        ${brandInner}
      </a>
      <nav class="ch-nav" aria-label="Primary">
        <ul class="ch-links ch-plate">${links}</ul>
        <a class="hud-btn ch-cta" href="#contact" data-go="contact" data-focus>Start a project<span class="ch-cta-ar" aria-hidden="true"></span></a>
      </nav>
      <button class="ch-menu-btn ch-plate" type="button" aria-expanded="false" aria-controls="ch-menu" aria-haspopup="dialog">
        <span class="ch-menu-ic" aria-hidden="true"><i></i><i></i><i></i></span><span class="ch-menu-t">Menu</span>
      </button>
    </header>

    <div class="ch-bottom">
      <button class="ch-sound ch-plate" type="button" data-sound-toggle aria-pressed="false">${soundInner}</button>
      <div class="ch-tb ch-plate">
        <div class="ch-cells" aria-hidden="true">
          <p class="ch-cell ch-cell--el"><span class="ch-k">Elevation</span><span class="ch-v ch-el">EL. +000.0 M</span></p>
          <p class="ch-cell ch-cell--lv"><span class="ch-k">Level</span><span class="ch-v ch-lv">GL</span></p>
          <p class="ch-cell ch-cell--sh"><span class="ch-k ch-sh-k"></span><span class="ch-v ch-sh-v"></span></p>
        </div>
        <nav class="ch-pips" aria-label="Chapters">
          <ol>${pips}</ol>
        </nav>
      </div>
    </div>

    <div class="ch-menu" id="ch-menu" role="dialog" aria-modal="true" aria-label="Menu" data-lenis-prevent hidden>
      <div class="ch-menu-in">
        <div class="ch-menu-top">
          <span class="ch-brand ch-plate ch-menu-brand" aria-hidden="true">${brandInner}</span>
          <button class="ch-menu-btn ch-menu-close ch-plate" type="button">
            <span class="ch-menu-ic is-x" aria-hidden="true"><i></i><i></i><i></i></span><span class="ch-menu-t">Close</span>
          </button>
        </div>
        <div class="ch-menu-body">
          <p class="ch-menu-k" aria-hidden="true"><span>G-001</span><span>Drawing index</span></p>
          <nav class="ch-menu-nav" aria-label="Chapters"><ol class="ch-menu-list">${menuItems}</ol></nav>
          <div class="ch-menu-foot">
            <a class="hud-btn ch-menu-cta" href="#contact" data-go="contact">Start a project<span class="ch-cta-ar" aria-hidden="true"></span></a>
            <button class="ch-sound ch-plate ch-menu-sound" type="button" data-sound-toggle aria-pressed="false">${soundInner}</button>
          </div>
          <p class="ch-menu-mail"><a href="mailto:${BRAND.email}">${BRAND.email}</a></p>
        </div>
        <p class="ch-menu-strip" aria-hidden="true"><span>Hark Tower · G-001 · Drawing index</span><span>${esc(BRAND.locale)}</span></p>
      </div>
    </div>
  </div>`

  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!
  const chr = $('.chr')
  const top = $('.ch-top')
  const bottom = $('.ch-bottom')
  const menu = $('.ch-menu')
  const menuBtn = $<HTMLButtonElement>('.ch-top .ch-menu-btn')
  const menuClose = $<HTMLButtonElement>('.ch-menu-close')
  const navEls = [...root.querySelectorAll<HTMLAnchorElement>('.ch-link')]
  const pipEls = [...root.querySelectorAll<HTMLButtonElement>('.ch-pip')]
  const menuLinks = [...root.querySelectorAll<HTMLAnchorElement>('.ch-ml')]
  const soundBtns = [...root.querySelectorAll<HTMLButtonElement>('[data-sound-toggle]')]
  const bars = [...root.querySelectorAll<HTMLElement>('.ch-bottom .ch-meter i')]
  const elEl = $('.ch-el')
  const lvEl = $('.ch-lv')
  const shK = $('.ch-sh-k')
  const shV = $('.ch-sh-v')
  const tb = $('.ch-tb')

  // header-first tab order: the chrome comes before the active chapter's content
  const stagesEl = document.getElementById('stages')
  if (stagesEl && stagesEl.parentNode === root.parentNode && root.compareDocumentPosition(stagesEl) & Node.DOCUMENT_POSITION_PRECEDING) {
    stagesEl.parentNode!.insertBefore(root, stagesEl)
  }

  // ---------------------------------------------------------------- navigation

  const go = (id: string) => {
    if (indexOf(id) >= 0) engine.land(id)
  }

  root.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLElement>('[data-go]')
    if (!a || !root.contains(a)) return
    e.preventDefault()
    const id = a.dataset.go!
    const fromMenu = menuOpen && menu.contains(a)
    if (menuOpen) closeMenu(false)
    sound.blip(a.matches('.ch-cta, .ch-menu-cta') ? 5 : Math.max(0, indexOf(id)))
    go(id)
    // menu links always hand focus on (the sheet they lived in is gone); the top
    // nav, CTA, brand and pips do it for keyboard activation (click.detail 0)
    if (fromMenu || (e.detail === 0 && (a.matches('.ch-link, .ch-pip, .ch-brand') || a.hasAttribute('data-focus'))))
      engine.focusChapter(id)
  })

  // ------------------------------------------------------------- the readout

  let lastIndex = -1
  let cueIndex = -1
  const showSheet = (i: number, cue = false) => {
    const s = slots[i]
    if (!s) return
    shK.textContent = cue ? `Go to ${pad(i + 1)} · ${s.def.label}` : `${pad(i + 1)} / ${pad(total)} · ${s.def.label}`
    shV.textContent = biz(s.def.id, s.def.label)
    tb.classList.toggle('is-cue', cue)
  }
  pipEls.forEach((b, i) => {
    b.addEventListener('pointerenter', e => {
      if ((e as PointerEvent).pointerType === 'touch') return
      cueIndex = i
      showSheet(i, i !== lastIndex)
    })
    b.addEventListener('focus', () => {
      cueIndex = i
      showSheet(i, i !== lastIndex)
    })
    const uncue = () => {
      if (cueIndex !== i) return
      cueIndex = -1
      if (lastIndex >= 0) showSheet(lastIndex)
    }
    b.addEventListener('pointerleave', uncue)
    b.addEventListener('blur', uncue)
  })

  // --------------------------------------------------------------------- sound

  const syncSound = (on: boolean) => {
    for (const b of soundBtns) {
      b.setAttribute('aria-pressed', String(on))
      const st = b.querySelector('.ch-sound-st b')
      if (st) st.textContent = on ? MICROCOPY.audioOn : MICROCOPY.audioOff
    }
    chr.classList.toggle('is-sound', on)
    if (!on) for (const b of bars) b.style.transform = ''
  }
  for (const b of soundBtns) b.addEventListener('click', () => sound.toggle())
  sound.onChange.push(syncSound)
  syncSound(sound.enabled)

  // --------------------------------------------------------------- menu sheet

  let menuOpen = false
  let hideTimer = 0
  const focusables = () =>
    [...menu.querySelectorAll<HTMLElement>('a[href], button')].filter(el => !el.hidden && el.getClientRects().length > 0)
  const openMenu = () => {
    if (menuOpen) return
    menuOpen = true
    window.clearTimeout(hideTimer)
    menu.hidden = false
    // flush the closed state so the sheet's entrance runs
    void menu.offsetWidth
    chr.classList.add('is-menu')
    menuBtn.setAttribute('aria-expanded', 'true')
    holdInert('menu', [
      document.getElementById('stages'),
      document.getElementById('track'),
      document.querySelector<HTMLElement>('.skip-link'),
      top,
      bottom,
    ])
    engine.lenis.stop()
    // the sheet covers the whole frame: stop rendering once it is down
    hideTimer = window.setTimeout(
      () => {
        if (menuOpen) holdScene('menu')
      },
      reduced ? 0 : 480,
    )
    menu.scrollTop = 0
    const now = menuLinks[lastIndex] ?? menuLinks[0]
    now?.focus({ preventScroll: true })
  }
  const closeMenu = (restoreFocus = true) => {
    if (!menuOpen) return
    menuOpen = false
    window.clearTimeout(hideTimer)
    chr.classList.remove('is-menu')
    menuBtn.setAttribute('aria-expanded', 'false')
    releaseInert('menu')
    releaseScene('menu')
    engine.lenis.start()
    hideTimer = window.setTimeout(
      () => {
        if (!menuOpen) menu.hidden = true
      },
      reduced ? 20 : 420,
    )
    if (restoreFocus) menuBtn.focus({ preventScroll: true })
  }
  menuBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()))
  menuClose.addEventListener('click', () => closeMenu())
  // capture: the dialog's own trap runs ahead of the no-`inert` fallback in inert.ts
  window.addEventListener(
    'keydown',
    e => {
      if (!menuOpen) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        const i = f.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i === f.length - 1 ? 0 : i + 1
        e.preventDefault()
        f[next].focus()
      }
    },
    true,
  )
  const narrow = matchMedia(MENU_QUERY)
  narrow.addEventListener?.('change', e => {
    if (!e.matches) closeMenu(false)
  })

  // -------------------------------------------------------------------- update

  let lastEl = ''
  let lastLv = ''
  const lv = [0, 0, 0, 0]
  const shape = [0.34, 0.62, 0.5, 0.28]

  return {
    update(frame: Frame, state: EngineState) {
      const slot = state.slots[state.index]
      if (!slot) return

      if (state.index !== lastIndex) {
        const first = lastIndex < 0
        lastIndex = state.index
        if (cueIndex < 0) showSheet(state.index)
        if (!first && !reduced) {
          // a new sheet: the title block's value drops in like a landed beam
          if (typeof shV.animate === 'function')
            shV.animate([{ transform: 'translateY(-0.9em)', opacity: 0 }, { transform: 'translateY(0.06em)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], {
              duration: 520,
              easing: 'cubic-bezier(0.3, 0.9, 0.4, 1)',
            })
        }
        pipEls.forEach((p, i) => {
          p.classList.toggle('is-on', i === state.index)
          p.classList.toggle('is-past', i < state.index)
          if (i === state.index) p.setAttribute('aria-current', 'step')
          else p.removeAttribute('aria-current')
        })
        const activeId = slot.def.id
        navEls.forEach(a => {
          const on = a.dataset.go === activeId
          a.classList.toggle('is-active', on)
          if (on) a.setAttribute('aria-current', 'location')
          else a.removeAttribute('aria-current')
        })
        menuLinks.forEach((a, i) => {
          a.classList.toggle('is-now', i === state.index)
          if (i === state.index) a.setAttribute('aria-current', 'location')
          else a.removeAttribute('aria-current')
        })
        chr.dataset.chapter = activeId
      }

      // live elevation of the steel frontier (decorative)
      const y = engine.world.tower.frontier
      if (Number.isFinite(y)) {
        const e = elevation(y)
        if (e !== lastEl) {
          lastEl = e
          elEl.textContent = e
        }
        const l = level(y)
        if (l !== lastLv) {
          lastLv = l
          lvEl.textContent = l
        }
      }

      // sound meter follows the real signal (a calm fixed shape under reduced motion)
      if (sound.enabled && bars.length) {
        if (!reduced && sound.meter(lv)) {
          for (let i = 0; i < 4; i++) {
            const idle = 0.5 + 0.5 * Math.sin(frame.time * (1.1 + i * 0.37) + i * 1.7)
            const v = Math.min(1, 0.3 + shape[i] * 0.3 * idle + lv[i] * lv[i] * 0.7)
            bars[i].style.transform = `scaleY(${v.toFixed(3)})`
          }
        } else for (let i = 0; i < 4; i++) bars[i].style.transform = `scaleY(${(0.3 + shape[i]).toFixed(2)})`
      }
    },
  }
}
