import { el, rise, setRise } from '../../core/dom'
import { SECTIONS, SERVICES } from '../../content'
import { COUNT, levelOf, slabOf } from './timeline'

/*
 * DOM for Floors. Scroll decides WHAT is on screen (the intro, or which
 * floor's spec plate); CSS transitions decide how it arrives, so wherever
 * the scroll rests the copy is settled and exact.
 *
 *   intro  hazard eyebrow + "Eleven ways to be heard." (hoisted words)
 *   plate  LEVEL 19 · 01 / 11 ··········· ▲ Rising / ■ Docked (the car)
 *          title · blurb · tags · a 01–11 landing index (buttons)
 *
 * All eleven items share one grid cell, so the plate never changes size.
 */

const pad = (n: number) => String(n).padStart(2, '0')
const setOn = (node: Element, on: boolean, cls = 'is-on') => {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on)
}

export class Hud {
  private intro: HTMLElement
  private introTitle: HTMLElement
  private card: HTMLElement
  private level: HTMLElement
  private count: HTMLElement
  private status: HTMLElement
  private items: { root: HTMLElement; title: HTMLElement }[] = []
  private keys: HTMLButtonElement[] = []
  private shown = -2
  private introOn = false
  private cardOn = false
  private lastMoving: boolean | null = null

  constructor(stage: HTMLElement, onKey: (k: number) => void) {
    this.intro = el('div', 'sv-intro', undefined, stage)
    el('p', 'hud-eyebrow', `${SECTIONS.services.eyebrow} · 01–${pad(COUNT)}`, this.intro)
    this.introTitle = rise(el('h2', 'hud-h2 sv-intro-title', undefined, this.intro), 'Eleven ways to be <em>heard.</em>')
    // three unbreakable phrases, so a narrow phone wraps between them (never inside 'Fit-out')
    const sub = el('p', 'hud-label sv-intro-sub', undefined, this.intro)
    const phrases = ['Hoist car 1', `Levels ${levelOf(slabOf(0))}–${levelOf(slabOf(COUNT - 1))}`, 'Fit-out']
    phrases.forEach((t, i) => {
      el('span', 'sv-nowrap', t, sub)
      if (i < phrases.length - 1) sub.append(' · ')
    })

    this.card = el('div', 'sv-card hud-panel', undefined, stage)
    const head = el('p', 'hud-label sv-head', undefined, this.card)
    const left = el('span', 'sv-head-l', undefined, head)
    this.level = el('span', 'sv-level', '', left)
    el('span', 'sv-dot', ' · ', left)
    this.count = el('span', 'sv-count', '', left)
    const right = el('span', 'sv-head-r', undefined, head)
    this.status = el('span', 'sv-status', '', right)

    const stack = el('div', 'sv-stack', undefined, this.card)
    for (const s of SERVICES) {
      const root = el('div', 'sv-item', undefined, stack)
      const title = rise(el('h3', 'hud-h2 sv-title', undefined, root), s.title)
      el('p', 'hud-body sv-blurb', s.blurb, root)
      const tags = el('ul', 'hud-tags sv-tags', undefined, root)
      for (const t of s.tags) el('li', 'hud-tag', t, tags)
      this.items.push({ root, title })
    }
    const keys = el('div', 'sv-keys', undefined, this.card)
    SERVICES.forEach((s, k) => {
      const b = el('button', 'sv-key', s.num, keys)
      b.type = 'button'
      b.title = `Level ${levelOf(slabOf(k))} · ${s.title}`
      b.setAttribute('aria-label', `${s.num} ${s.title}`)
      b.addEventListener('click', () => onKey(k))
      this.keys.push(b)
    })
  }

  /**
   * introOn: the section headline; shown: the service on the plate (-1 none);
   * moving: the car is travelling (the status says so; the chrome's title
   * block already reads out the steel's elevation).
   */
  update(introOn: boolean, shown: number, moving: boolean) {
    if (introOn !== this.introOn) {
      this.introOn = introOn
      setOn(this.intro, introOn)
      setRise(this.introTitle, introOn)
    }
    const cardOn = shown >= 0
    if (cardOn !== this.cardOn) {
      this.cardOn = cardOn
      setOn(this.card, cardOn)
    }
    if (cardOn && shown !== this.shown) {
      this.shown = shown
      this.items.forEach((it, k) => {
        setOn(it.root, k === shown)
        setRise(it.title, k === shown)
      })
      this.keys.forEach((b, k) => setOn(b, k === shown))
      this.level.textContent = `Level ${levelOf(slabOf(shown))}`
      this.count.textContent = `${SERVICES[shown].num} / ${pad(COUNT)}`
    }
    if (!cardOn) return
    if (moving !== this.lastMoving) {
      this.lastMoving = moving
      this.status.textContent = moving ? '▲ Rising' : '■ Docked'
      setOn(this.status, moving, 'is-moving')
    }
  }
}
