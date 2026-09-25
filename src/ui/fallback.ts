import { BRAND, CONTACT } from '../content'
import { CHAPTER_COPY_IDS, buildChapterCopy } from '../core/srContent'
import { CHAPTERS } from '../chapters/index'
import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { unmountRotateGate } from './rotate'
import { releaseInert } from './inert'

/*
 * Plain HTML version for browsers without WebGL2 (and the last resort if
 * boot fails): every chapter's copy, in story order, visible, as a
 * typographic DRAWING SET. A cover sheet in blueprint blue (the tagline, the
 * manifesto and a real drawing index linking every sheet), then one sheet
 * per chapter on drawing paper: a sheet number and the chapter's label in
 * the corner, the copy set in Big Shoulders / Archivo / Plex Mono, and a
 * title-block strip along the foot of each sheet. Same copy as the live
 * site, verbatim, from srContent (buildChapterCopy). Styled by .fb-* in
 * ui.css.
 *
 * Landmarks: the banner <header> sits just before <main id="track">, so
 * "Skip to content" (#track) lands on the story itself, past the navigation.
 */

const BUSINESS: Record<string, string> = {
  hero: 'Home',
  work: 'Work',
  services: 'Services',
  voices: 'Clients',
  shield: 'Security',
  process: 'Process',
  contact: 'Contact',
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function renderFallback(root: HTMLElement) {
  document.documentElement.classList.add('no-webgl')
  unmountRotateGate()
  // boot can fail while the loader (or a menu) still holds the page inert: let go
  releaseInert('loader')
  releaseInert('menu')
  document.getElementById('loader')?.remove()
  document.getElementById('chrome')?.replaceChildren()
  root.style.pointerEvents = 'auto'

  // If boot failed after the smooth scroller was created, it would swallow the
  // wheel with nothing left to drive it: keep wheel scrolling native here.
  if (document.documentElement.classList.contains('lenis')) {
    window.addEventListener('wheel', e => e.stopPropagation(), { capture: true, passive: true })
    document.documentElement.classList.remove('lenis', 'lenis-smooth', 'lenis-stopped')
  }

  const order = CHAPTERS.map(c => c.id).filter(id => CHAPTER_COPY_IDS.includes(id))
  for (const id of CHAPTER_COPY_IDS) if (!order.includes(id)) order.push(id)
  const sheetNo = (i: number) => `A-${100 + i + 1}`
  const labelOf = (id: string) => CHAPTERS.find(c => c.id === id)?.label ?? ''

  // the banner, before <main>
  document.getElementById('fb-head')?.remove()
  const header = document.createElement('header')
  header.className = 'fb-head'
  header.id = 'fb-head'
  header.innerHTML = `
    <a class="fb-brand" href="#hero" aria-label="${esc(BRAND.name)}, top of page">
      <span class="fb-haz" aria-hidden="true"></span>
      <span class="fb-mark" aria-hidden="true">${markSvg('fb-mark-svg')}</span>
      <span class="fb-brand-text" aria-hidden="true">${WORDMARK}${CONCEPT_TAG}</span>
    </a>
    <nav class="fb-nav" aria-label="Primary">
      <a class="fb-link" href="#work">Work</a>
      <a class="fb-link" href="#services">Services</a>
      <a class="fb-link" href="#contact">Contact</a>
      <a class="hud-btn fb-cta" href="${CONTACT.href}">Start a project</a>
    </nav>`
  root.parentNode?.insertBefore(header, root)

  root.innerHTML = ''
  root.classList.add('fb')
  order.forEach((id, i) => {
    const copy = buildChapterCopy(id, true)
    if (!copy) return
    // item "stops" only steer the live story; here they're just headings
    copy.querySelectorAll<HTMLAnchorElement>('a[data-anchor][href^="#"]:not([data-land])').forEach(a => {
      const span = document.createElement('span')
      span.textContent = a.textContent
      a.replaceWith(span)
    })
    const sec = document.createElement('section')
    sec.className = `fb-sheet fb-sheet--${id}${id === 'hero' ? ' fb-cover' : ''}`
    sec.id = id
    const heading = copy.querySelector<HTMLElement>('h1, h2')
    if (heading) {
      heading.id = `fb-${id}-title`
      sec.setAttribute('aria-labelledby', heading.id)
    }
    const kicker = document.createElement('p')
    kicker.className = 'fb-k'
    kicker.setAttribute('aria-hidden', 'true')
    kicker.innerHTML = `<span class="fb-k-n">${sheetNo(i)}</span><span class="fb-k-l">${esc(labelOf(id))}</span><span class="fb-k-b">${esc(BUSINESS[id] ?? '')}</span>`
    const body = document.createElement('div')
    body.className = 'fb-body'
    body.appendChild(copy)
    sec.append(kicker, body)

    // the cover carries the set's drawing index: a real list of in-page links
    if (id === 'hero') {
      const index = document.createElement('nav')
      index.className = 'fb-index'
      index.setAttribute('aria-label', 'Drawing index')
      index.innerHTML = `<p class="fb-index-h" aria-hidden="true">Drawing index</p><ol>${order
        .map(
          (o, j) =>
            `<li><a href="#${o}"><span class="fb-index-n" aria-hidden="true">${sheetNo(j)}</span><span class="fb-index-b">${esc(BUSINESS[o] ?? o)}</span><span class="fb-index-l" aria-hidden="true">${esc(labelOf(o))}</span></a></li>`,
        )
        .join('')}</ol>`
      sec.appendChild(index)
    }

    const strip = document.createElement('p')
    strip.className = 'fb-strip'
    strip.setAttribute('aria-hidden', 'true')
    strip.innerHTML = `<span>Hark Tower</span><span>${sheetNo(i)}</span><span>${esc(labelOf(id))}</span><span>Drawn by ${esc(BRAND.name)}</span>`
    sec.appendChild(strip)
    root.appendChild(sec)
  })
}
