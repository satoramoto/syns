/*
 * The SVG documents the experiments draw, as strings: each one self-contained,
 * well under the engine's 131072-character cap unless it probes the cap.
 */

const NS = 'xmlns="http://www.w3.org/2000/svg"'
const W = 240
const H = 80

/** An `<svg>` of the usual size around `body`. */
export const doc = (body: string, w = W, h = H) => `<svg ${NS} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

const label = (x: number, y: number, s: string) =>
  `<text x="${x}" y="${y}" font-family="-apple-system, system-ui, sans-serif" font-size="10" fill="#8e8e93">${s}</text>`

export const LINEAR = doc(
  `<defs>
    <linearGradient id="h" x1="0" x2="1"><stop offset="0" stop-color="#2f80ed"/><stop offset="1" stop-color="#9b51e0"/></linearGradient>
    <linearGradient id="v" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#27ae60"/><stop offset="0.5" stop-color="#f2c94c" stop-opacity="0.6"/><stop offset="1" stop-color="#eb5757"/></linearGradient>
  </defs>
  <rect x="8" y="8" width="140" height="14" rx="7" fill="url(#h)"/>
  <rect x="8" y="30" width="140" height="6" rx="3" fill="url(#h)" opacity="0.5"/>
  <rect x="168" y="8" width="24" height="64" rx="4" fill="url(#v)"/>
  ${label(8, 60, 'horizontal, vertical, stop-opacity')}`,
)

export const RADIAL = doc(
  `<defs>
    <radialGradient id="r" cx="0.35" cy="0.35" r="0.65"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#56ccf2"/><stop offset="1" stop-color="#2f80ed"/></radialGradient>
    <radialGradient id="g" fx="0.5" fy="0.5"><stop offset="0" stop-color="#f2994a" stop-opacity="1"/><stop offset="1" stop-color="#f2994a" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="40" cy="40" r="30" fill="url(#r)"/>
  <circle cx="120" cy="40" r="34" fill="url(#g)"/>
  ${label(170, 44, 'sphere, glow')}`,
)

export const BLUR = doc(
  `<defs>
    <filter id="b1"><feGaussianBlur stdDeviation="1"/></filter>
    <filter id="b4" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
  </defs>
  <rect x="10" y="20" width="40" height="40" fill="#2f80ed"/>
  <rect x="70" y="20" width="40" height="40" fill="#2f80ed" filter="url(#b1)"/>
  <rect x="130" y="20" width="40" height="40" fill="#2f80ed" filter="url(#b4)"/>
  ${label(10, 74, 'sharp, 1, 4')}`,
)

export const SHADOW = doc(
  `<defs>
    <filter id="ds" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="2" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity="0.35"/></filter>
    <filter id="old" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="2"/><feOffset dx="2" dy="2" result="o"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="14" y="14" width="80" height="40" rx="6" fill="#fff" stroke="#ddd" filter="url(#ds)"/>
  <rect x="124" y="14" width="80" height="40" rx="6" fill="#fff" stroke="#ddd" filter="url(#old)"/>
  ${label(14, 72, 'feDropShadow, blur+offset+merge')}`,
)

export const MASKS = doc(
  `<defs>
    <clipPath id="c"><circle cx="40" cy="36" r="26"/></clipPath>
    <linearGradient id="fade" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
    <mask id="m"><rect x="80" y="10" width="70" height="52" fill="url(#fade)"/></mask>
  </defs>
  <g clip-path="url(#c)"><rect x="0" y="0" width="80" height="80" fill="#9b51e0"/><rect x="0" y="30" width="80" height="12" fill="#f2c94c"/></g>
  <rect x="80" y="10" width="70" height="52" fill="#27ae60" mask="url(#m)"/>
  <rect x="160" y="10" width="30" height="52" fill="#eb5757" opacity="0.25"/>
  <rect x="196" y="10" width="30" height="52" fill="#eb5757" fill-opacity="0.6" stroke="#eb5757" stroke-opacity="1"/>
  ${label(8, 76, 'clipPath, mask, opacity, fill-opacity')}`,
)

export const FONTS = doc(
  `<text x="8" y="16" font-family="-apple-system, system-ui, sans-serif" font-size="13">System sans 13</text>
  <text x="8" y="32" font-family="Georgia, serif" font-style="italic" font-size="13">Serif italic</text>
  <text x="8" y="48" font-family="ui-monospace, Menlo, monospace" font-size="12" font-weight="700">Mono bold 0123</text>
  <text x="8" y="66" font-family="system-ui" font-size="10" letter-spacing="2" text-decoration="underline" fill="#2f80ed">tracked, underlined</text>
  <text x="232" y="30" font-family="system-ui" font-size="20" text-anchor="end" fill="#eb5757">end</text>
  <path id="arc" d="M150 70 Q190 40 232 70" fill="none"/>
  <text font-size="9" font-family="system-ui"><textPath href="#arc">along a path</textPath></text>`,
)

export const PATTERN = doc(
  `<defs>
    <pattern id="p" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8 L8 0" stroke="#8e8e93" stroke-width="1"/></pattern>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#2f80ed"/></marker>
    <symbol id="dot" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#27ae60"/></symbol>
  </defs>
  <rect x="8" y="8" width="70" height="50" fill="url(#p)" stroke="#8e8e93"/>
  <line x1="96" y1="50" x2="150" y2="14" stroke="#2f80ed" stroke-width="2" marker-end="url(#arrow)"/>
  <use href="#dot" x="170" y="10" width="20" height="20"/><use href="#dot" x="196" y="30" width="30" height="30"/>
  ${label(8, 74, 'pattern, marker, symbol+use')}`,
)

/** SMIL: a blink (discrete opacity), a fade, a rotation and a path morph. */
const SMIL_BODY = `
  <circle cx="20" cy="30" r="8" fill="#eb5757"><animate attributeName="opacity" values="1;0" dur="1s" calcMode="discrete" repeatCount="indefinite"/></circle>
  <circle cx="60" cy="30" r="8" fill="#2f80ed"><animate attributeName="opacity" values="1;0.1;1" dur="2s" repeatCount="indefinite"/></circle>
  <g transform="translate(100 30)"><rect x="-9" y="-9" width="18" height="18" fill="#9b51e0"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="3s" repeatCount="indefinite"/></rect></g>
  <path fill="#27ae60" d="M140 20 L160 20 L160 40 L140 40 Z"><animate attributeName="d" dur="2s" repeatCount="indefinite" values="M140 20 L160 20 L160 40 L140 40 Z;M150 18 L162 30 L150 42 L138 30 Z;M140 20 L160 20 L160 40 L140 40 Z"/></path>
  <rect x="180" y="26" width="0" height="8" fill="#f2994a"><animate attributeName="width" values="0;50;0" dur="2s" repeatCount="indefinite"/></rect>
  ${label(8, 66, 'blink, fade, rotate, morph d, grow')}`

export const SMIL = doc(SMIL_BODY)

/** CSS animation inside the document's own `<style>`. */
const CSS_BODY = `
  <style>
    @keyframes spin { to { transform: rotate(360deg) } }
    @keyframes pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.15 } }
    @keyframes slide { from { transform: translateX(0) } to { transform: translateX(80px) } }
    .spin { transform-origin: 30px 30px; animation: spin 1.5s linear infinite }
    .pulse { animation: pulse 1.2s ease-in-out infinite }
    .slide { animation: slide 2s ease-in-out infinite alternate }
  </style>
  <rect class="spin" x="20" y="20" width="20" height="20" fill="#9b51e0"/>
  <circle class="pulse" cx="80" cy="30" r="10" fill="#2f80ed"/>
  <rect class="slide" x="110" y="24" width="12" height="12" rx="6" fill="#27ae60"/>
  ${label(8, 66, 'CSS @keyframes: spin, pulse, slide')}`

export const CSS_KEYFRAMES = doc(CSS_BODY)

export const HOVER = doc(
  `<style>
    .cell { fill: #e0e0e0; transition: fill 120ms }
    .cell:hover { fill: #2f80ed }
    .grow { transform-origin: 200px 30px; transition: transform 150ms }
    .grow:hover { transform: scale(1.4) }
  </style>
  <rect class="cell" x="8" y="10" width="36" height="36" rx="4"/>
  <rect class="cell" x="50" y="10" width="36" height="36" rx="4"/>
  <rect class="cell" x="92" y="10" width="36" height="36" rx="4"/>
  <circle class="grow" cx="200" cy="30" r="14" fill="#f2994a"/>
  ${label(8, 66, 'CSS :hover with transitions')}`,
)

export const TITLE = doc(
  `<rect x="8" y="10" width="60" height="40" fill="#2f80ed"><title>Blue: 42 tokens</title></rect>
  <circle cx="110" cy="30" r="20" fill="#27ae60"><title>Green circle tooltip</title></circle>
  ${label(8, 66, 'hover for a native <title> tooltip')}`,
)

export const SCRUB_SCRIPT = doc(
  `<text id="t" x="8" y="30" font-size="14" fill="#27ae60">script did not run (stripped or blocked)</text>
  <script>document.getElementById('t').textContent = 'SCRIPT RAN'; document.getElementById('t').setAttribute('fill', 'red')</script>`,
  320,
)

export const SCRUB_ONLOAD = `<svg ${NS} width="320" height="40" onload="document.getElementById('t').textContent='ONLOAD RAN'"><text id="t" x="8" y="24" font-size="14" fill="#27ae60" onclick="this.textContent='ONCLICK RAN'">onload did not run (click me too)</text></svg>`

export const SCRUB_HREF = doc(
  `<image href="https://github.githubassets.com/favicons/favicon.png" x="8" y="8" width="32" height="32"/>
  <a href="https://example.com"><text x="48" y="24" font-size="12" fill="#2f80ed">external a href</text></a>
  ${label(48, 44, 'an external image shows left if not stripped')}`,
  320,
)

export const SCRUB_DATA_HREF = doc(
  `<image x="8" y="8" width="32" height="32" href="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Ccircle cx='5' cy='5' r='5' fill='%23eb5757'/%3E%3C/svg%3E"/>
  ${label(48, 28, 'a data: image (red dot) shows left if kept')}`,
  320,
)

export const SCRUB_FOREIGN = doc(
  `<foreignObject x="8" y="8" width="300" height="40"><div xmlns="http://www.w3.org/1999/xhtml" style="font: 13px system-ui; color: #eb5757">FOREIGN OBJECT HTML DRAWN <b>bold</b></div></foreignObject>
  ${label(8, 66, 'blank above: foreignObject stripped')}`,
  320,
)

/** A document of exactly `n` characters, padded with a comment. */
export const sized = (n: number) => {
  const head = `<svg ${NS} width="240" height="24"><text x="4" y="16" font-size="12">${n} characters</text><!--`
  const tail = '--></svg>'
  return head + 'x'.repeat(Math.max(0, n - head.length - tail.length)) + tail
}
