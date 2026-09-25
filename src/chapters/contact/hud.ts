import { el, rise } from '../../core/dom'
import { BRAND, CONTACT, OTHER_CONCEPTS } from '../../content'

/*
 * TOPPING OUT — the contact spec plate. One graphite plate (left and centred
 * on landscape, along the bottom on portrait): the address as the big green
 * signage plate, Copy email, the sister concepts, Back to top, the colophon.
 *
 * Layout is MEASURED (on resize / font load / size change, never per frame)
 * so the camera can frame the tower in whatever space the plate leaves: `art`
 * is that free rectangle in CSS px. Short screens step the plate down through
 * fit levels until it leaves the tower enough room.
 */

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Hud {
  stage: HTMLElement
  probe: HTMLElement
  wrap: HTMLElement
  panel: HTMLElement
  title: HTMLElement
  mail: HTMLAnchorElement
  copyBtn: HTMLButtonElement
  dirty: boolean
}

export interface HudLayout {
  W: number
  H: number
  portrait: boolean
  /** free area for the 3D, CSS px */
  art: Rect
  panel: Rect
}

const ICON_MAIL =
  '<svg class="ct-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5.5" width="18" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="2"/><path d="m4.4 7.2 7.6 5.8 7.6-5.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="miter"/></svg>'

/** Portrait layout (plate along the bottom). Keep in sync with contact.css. */
export const PORTRAIT_QUERY = '(max-width: 767px), (max-aspect-ratio: 9/10)'
export const SHORT_LANDSCAPE = '(orientation: landscape) and (max-height: 500px)'

/** Copy text: async Clipboard API first, then a hidden-textarea fallback. */
export async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* denied or unsupported: fall through */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;'
  const active = document.activeElement as HTMLElement | null
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  active?.focus?.({ preventScroll: true })
  return ok
}

/** A polite live region OUTSIDE the aria-hidden stage, so the copy result is announced. */
function liveRegion() {
  const id = 'ct-copy-live'
  let node = document.getElementById(id)
  if (!node) {
    node = document.createElement('p')
    node.id = id
    node.className = 'sr-only'
    node.setAttribute('role', 'status')
    node.setAttribute('aria-live', 'polite')
    document.body.appendChild(node)
  }
  return node
}

export function buildHud(stage: HTMLElement): Hud {
  const probe = el('div', 'ct-probe', undefined, stage)
  const wrap = el('div', 'ct-wrap', undefined, stage)
  const panel = el('div', 'hud-panel ct-panel', undefined, wrap)

  // decorative title-block strip (a drawing sheet's corner stamp)
  const block = el('div', 'ct-block', undefined, panel)
  block.setAttribute('aria-hidden', 'true')
  el('span', '', 'A-601 · Topping out', block)
  el('span', 'ct-block-el', 'Sheet 07 / 07', block)

  el('p', 'hud-eyebrow ct-eyebrow', CONTACT.eyebrow, panel)
  const words = CONTACT.title.split(' ')
  const last = words.pop() ?? ''
  const title = rise(el('h2', 'hud-title ct-title', undefined, panel), `${words.join(' ')} <em>${last}</em>`)
  el('p', 'hud-body ct-body', CONTACT.body, panel)

  const cta = el('div', 'ct-cta', undefined, panel)
  const mail = el('a', 'hud-btn ct-mail', undefined, cta)
  mail.href = CONTACT.href
  mail.innerHTML = `${ICON_MAIL}<span class="ct-mail-addr"></span><span class="ct-go" aria-hidden="true">→</span>`
  mail.querySelector('.ct-mail-addr')!.textContent = BRAND.email

  const copyBtn = el('button', 'hud-btn hud-btn--ghost ct-copy', undefined, cta)
  copyBtn.type = 'button'
  copyBtn.innerHTML =
    '<span class="ct-copy-idle">Copy<span class="ct-copy-more"> email</span></span><span class="ct-copy-done" aria-hidden="true">Copied</span><span class="ct-copy-fail" aria-hidden="true">Copy failed</span>'

  el('hr', 'hud-rule ct-rule', undefined, panel)

  const more = el('div', 'ct-more', undefined, panel)
  el('p', 'hud-label ct-more-label', 'Other concepts', more)
  const list = el('ul', 'ct-links', undefined, more)
  for (const c of OTHER_CONCEPTS) {
    const li = el('li', '', undefined, list)
    const a = el('a', 'ct-link', undefined, li)
    a.href = c.url
    a.target = '_blank'
    a.rel = 'noopener'
    el('span', '', c.name, a)
    el('span', 'ct-arr', '↗', a).setAttribute('aria-hidden', 'true')
  }

  const foot = el('div', 'ct-foot', undefined, panel)
  const top = el('button', 'ct-top', undefined, foot)
  top.type = 'button'
  el('span', '', 'Back to top', top)
  el('span', 'ct-arr', '↑', top).setAttribute('aria-hidden', 'true')
  top.addEventListener('click', e => {
    const hark = window.__hark
    if (!hark) return
    hark.land('hero')
    if (e.detail === 0) hark.engine.focusChapter('hero')
  })
  const legal = el('p', 'ct-legal', undefined, foot)
  const parts = [`© ${new Date().getFullYear()} ${BRAND.name}`, ...BRAND.locale.split(' · ')]
  parts.forEach((p, i) => {
    if (i) legal.append(' · ')
    el('span', 'ct-nw', p, legal)
  })

  const hud: Hud = { stage, probe, wrap, panel, title, mail, copyBtn, dirty: true }

  const live = liveRegion()
  let resetT = 0
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(BRAND.email)
    window.clearTimeout(resetT)
    copyBtn.classList.toggle('is-copied', ok)
    copyBtn.classList.toggle('is-failed', !ok)
    live.textContent = ok ? `Copied ${BRAND.email} to the clipboard.` : `Copy failed. The address is ${BRAND.email}.`
    resetT = window.setTimeout(() => {
      copyBtn.classList.remove('is-copied', 'is-failed')
      live.textContent = ''
    }, 1900)
  })

  const dirty = () => (hud.dirty = true)
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(dirty)
    ro.observe(probe)
    ro.observe(panel)
  }
  window.addEventListener('resize', dirty)
  // the chrome's plates are measured too (portrait): again once they're shown
  window.addEventListener('hark:reveal', dirty)
  document.fonts?.ready.then(dirty).catch(() => {})
  return hud
}

const FIT = ['ct-fit-1', 'ct-fit-2', 'ct-fit-3'] as const
/** The chrome's top plates (whichever are shown at this width). */
const TOP_PLATES = ['.ch-top .ch-brand', '.ch-top .ch-nav', '.ch-top .ch-menu-btn']

/**
 * Portrait: the top of the tower's free area. The tower may rise into the
 * top band's empty middle (brand left, menu right) — unless a chrome plate
 * reaches across the tower's centre line (narrow phones: the brand plate
 * runs past the middle), then it starts below the plates.
 */
function portraitTop(band: DOMRect) {
  let top = Math.max(band.top * 0.5, 34)
  const cx = (band.left + band.right) / 2
  for (const sel of TOP_PLATES) {
    const r = document.querySelector(sel)?.getBoundingClientRect()
    if (!r || r.width < 1 || r.height < 1) continue
    if (r.left < cx + 48 && r.right > cx - 48) top = Math.max(top, r.bottom + 14)
  }
  return top
}

export function measureHud(hud: Hud, W: number, H: number): HudLayout {
  const stage = hud.stage
  const portrait = matchMedia(PORTRAIT_QUERY).matches
  const short = matchMedia(SHORT_LANDSCAPE).matches
  stage.classList.remove(...FIT)
  const band = hud.probe.getBoundingClientRect()
  const bandH = Math.max(1, band.height)
  // portrait: the plate may take most of the band, the tower lives above it
  const limit = portrait ? bandH * (H < 720 ? 0.74 : 0.64) : bandH
  if (!short) for (let i = 0; i < FIT.length && hud.panel.offsetHeight > limit; i++) stage.classList.add(FIT[i])

  // offset* ignore the reveal transform, so the measure is stable mid-reveal
  const w = hud.wrap.getBoundingClientRect()
  const x0 = w.left + hud.panel.offsetLeft
  const y0 = w.top + hud.panel.offsetTop
  const panel = { x0, y0, x1: x0 + hud.panel.offsetWidth, y1: y0 + hud.panel.offsetHeight }

  let art: Rect
  if (!portrait) {
    const gap = Math.max(24, W * 0.025)
    art = { x0: panel.x1 + gap, x1: band.right, y0: band.top, y1: band.bottom }
  } else {
    const gap = Math.max(12, H * 0.016)
    const top = portraitTop(band)
    art = { x0: band.left, x1: band.right, y0: top, y1: Math.max(top + 90, panel.y0 - gap) }
  }
  return { W, H, portrait, art, panel }
}
