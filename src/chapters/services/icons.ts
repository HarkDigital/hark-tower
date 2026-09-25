/*
 * The eleven service glyphs as STROKES (polylines in a 100 x 100 box centred
 * on 0,0, y down), in drawing order — so the sheet can draft them line by
 * line (each pixel of the atlas knows how far along the pen it lies).
 * One line weight, round caps: an architect's pen, not an icon font.
 */

export type Pt = [number, number]
export type Stroke = Pt[]

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 40): Stroke => {
  const s: Stroke = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n
    s.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return s
}
const circle = (cx: number, cy: number, r: number, start = -Math.PI / 2) => arc(cx, cy, r, start, start + Math.PI * 2, 48)
const rect = (x: number, y: number, w: number, h: number): Stroke => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
  [x, y],
]
const rrect = (x: number, y: number, w: number, h: number, r: number): Stroke => {
  const s: Stroke = []
  const c: [number, number, number][] = [
    [x + w - r, y + r, -Math.PI / 2],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, Math.PI / 2],
    [x + r, y + r, Math.PI],
  ]
  s.push([x + r, y])
  for (const [cx, cy, a] of c) s.push(...arc(cx, cy, r, a, a + Math.PI / 2, 6))
  s.push([x + r, y])
  return s
}
const cubic = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 18): Stroke => {
  const s: Stroke = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    s.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return s
}
const join = (...parts: Stroke[]): Stroke => parts.flatMap((p, i) => (i === 0 ? p : p.slice(1)))

export const GLYPHS: Record<string, Stroke[]> = {
  // </> — code
  'software-development': [
    [
      [-18, -24],
      [-42, 0],
      [-18, 24],
    ],
    [
      [18, -24],
      [42, 0],
      [18, 24],
    ],
    [
      [9, -34],
      [-9, 34],
    ],
  ],
  // a browser window with a layout grid and a pointer
  'web-design': [
    rrect(-46, -36, 92, 72, 6),
    [
      [-46, -20],
      [46, -20],
    ],
    circle(-37, -28, 2.2),
    circle(-29, -28, 2.2),
    [
      [-12, -20],
      [-12, 36],
    ],
    [
      [-12, 6],
      [46, 6],
    ],
    [
      [8, 14],
      [8, 40],
      [15, 33],
      [21, 45],
      [26, 42],
      [20, 31],
      [30, 30],
      [8, 14],
    ],
  ],
  // a cart
  ecommerce: [
    [
      [-46, -30],
      [-34, -30],
      [-24, 14],
      [30, 14],
      [39, -18],
      [-29, -18],
    ],
    [
      [-27, 0],
      [34, 0],
    ],
    circle(-16, 28, 6),
    circle(23, 28, 6),
  ],
  // a magnifier with a four-point spark (search + AI answers)
  'seo-geo': [
    circle(-8, -8, 27),
    [
      [12, 12],
      [40, 40],
    ],
    join(
      cubic([-8, -24], [-6, -10], [-6, -10], [8, -8]),
      cubic([8, -8], [-6, -6], [-6, -6], [-8, 8]),
      cubic([-8, 8], [-10, -6], [-10, -6], [-24, -8]),
      cubic([-24, -8], [-10, -10], [-10, -10], [-8, -24]),
    ),
  ],
  // a gauge with its needle in the green
  'page-speed': [
    arc(0, 12, 42, Math.PI, Math.PI * 2, 48),
    ...[0, 1, 2, 3, 4].map(i => {
      const a = Math.PI + (i / 4) * Math.PI
      return [
        [Math.cos(a) * 42, 12 + Math.sin(a) * 42],
        [Math.cos(a) * 32, 12 + Math.sin(a) * 32],
      ] as Stroke
    }),
    [
      [0, 12],
      [26, -14],
    ],
    circle(0, 12, 5),
    [
      [-42, 12],
      [42, 12],
    ],
  ],
  // a chip
  'ai-consulting': [
    rrect(-26, -26, 52, 52, 6),
    rect(-12, -12, 24, 24),
    ...[-13, 0, 13].flatMap(o => [
      [
        [o, -26],
        [o, -40],
      ] as Stroke,
      [
        [26, o],
        [40, o],
      ] as Stroke,
      [
        [o, 26],
        [o, 40],
      ] as Stroke,
      [
        [-26, o],
        [-40, o],
      ] as Stroke,
    ]),
  ],
  // a quadcopter, top-down
  'aerial-media': [
    rrect(-10, -10, 20, 20, 5),
    ...(
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as Pt[]
    ).flatMap(([sx, sy]) => [
      [
        [sx * 9, sy * 9],
        [sx * 21, sy * 21],
      ] as Stroke,
      circle(sx * 30, sy * 30, 13),
    ]),
  ],
  // a bug, struck through
  'hack-remediation': [
    join(cubic([0, -18], [18, -18], [20, 10], [0, 32]), cubic([0, 32], [-20, 10], [-18, -18], [0, -18])),
    circle(0, -26, 8),
    [
      [0, -12],
      [0, 30],
    ],
    ...[-8, 6, 20].flatMap((y, i) => [
      [
        [16, y],
        [30, y - 8 + i * 8],
      ] as Stroke,
      [
        [-16, y],
        [-30, y - 8 + i * 8],
      ] as Stroke,
    ]),
    [
      [-5, -33],
      [-12, -44],
    ],
    [
      [5, -33],
      [12, -44],
    ],
    [
      [-42, 42],
      [42, -42],
    ],
  ],
  // a shield with a check
  security: [
    join(
      cubic([0, -44], [14, -34], [26, -32], [38, -31]),
      [
        [38, -31],
        [38, 0],
      ],
      cubic([38, 0], [38, 22], [20, 36], [0, 46]),
      cubic([0, 46], [-20, 36], [-38, 22], [-38, 0]),
      [
        [-38, 0],
        [-38, -31],
      ],
      cubic([-38, -31], [-26, -32], [-14, -34], [0, -44]),
    ),
    [
      [-15, 2],
      [-4, 14],
      [17, -12],
    ],
  ],
  // the accessibility figure
  'ada-accessibility': [
    circle(0, 0, 44),
    circle(0, -24, 5.5),
    [
      [-24, -11],
      [0, -7],
      [24, -11],
    ],
    [
      [0, -7],
      [0, 10],
    ],
    [
      [-14, 33],
      [0, 10],
      [14, 33],
    ],
  ],
  // blocks: a page assembled from parts (build, rescue, extend)
  wordpress: [
    rect(-40, -40, 36, 36),
    rect(4, -40, 36, 36),
    rect(-40, 4, 36, 36),
    [
      [10, 14],
      [22, 2],
      [34, 14],
      [22, 26],
      [10, 14],
    ],
    [
      [22, 26],
      [22, 42],
    ],
  ],
}

/** Fallback glyph: a diamond (the callout node). */
export const DIAMOND: Stroke[] = [
  [
    [0, -34],
    [34, 0],
    [0, 34],
    [-34, 0],
    [0, -34],
  ],
]

/** Total pen length of a glyph. */
export function strokeLength(strokes: Stroke[]) {
  let L = 0
  for (const s of strokes) for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1])
  return L
}
