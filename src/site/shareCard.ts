// The picture a topic shows when its link is shared (og:image): 1200×630, drawn as SVG here and turned into a PNG by src/media/png.ts.
// Pure (no Worker APIs), so Node can test it. It says what the page says at a glance: the topic's name, whether it is new, rising or falling, where it is in its life
// (src/signal/lifecycle.ts), and its last 14 days drawn as the current along the foot of the card, the site's wave mark made of the topic's own numbers.
// Text is set in Bricolage Grotesque (the site's face), bundled in latin only: the renderer has no other fonts, so names are reduced to what that can show.
import { PHASE_LABEL, lifecycle, smooth } from '../signal/lifecycle.ts';
import type { TopicState } from '../signal/topicpage.ts';

export const CARD_W = 1200, CARD_H = 630;
export const CARD_FONT = 'Bricolage Grotesque';

export interface CardInput {
  label: string; area: 'ai' | 'politics';
  state: TopicState | null; change: number | null;
  /** Items per day, oldest first, and their days (ISO). */
  series: { days: string[]; counts: number[] };
  /** The host the card names at its foot ("undercurrent.agentcortex.net"). */
  host: string;
}

const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** What the bundled font can show: Latin letters, digits and common punctuation. Anything else is dropped (a name in another script keeps what it can, or becomes "Topic"). */
export function latinOnly(s: string): string {
  return String(s ?? '').normalize('NFC').replace(/[^ -~ -ſ‐-‧]/g, '').replace(/\s+/g, ' ').trim();
}
/** Breaks a name into at most `max` lines of about `per` characters, cutting the last with an ellipsis. */
export function wrapLines(text: string, per: number, max: number): string[] {
  const words = text.split(' ').filter(Boolean), lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const word = w.length > per ? w.slice(0, per - 1) + '…' : w;
    if (cur && (cur + ' ' + word).length > per) { lines.push(cur); cur = word; } else cur = cur ? cur + ' ' + word : word;
  }
  if (cur) lines.push(cur);
  if (lines.length > max) { const kept = lines.slice(0, max); kept[max - 1] = kept[max - 1].replace(/[ ,;:.-]*$/, '') + '…'; return kept; }
  return lines;
}
/** The size of the name: as large as fits in two lines across the card. */
function nameSize(label: string): { size: number; lines: string[] } {
  for (const size of [96, 84, 74, 64, 56]) {
    const per = Math.floor(1040 / (size * 0.56)), lines = wrapLines(label, per, 2);
    if (lines.length <= 2 && !lines.some((l) => l.endsWith('…'))) return { size, lines };
  }
  return { size: 56, lines: wrapLines(label, Math.floor(1040 / (56 * 0.56)), 2) };
}
/** A smooth path through points (Catmull-Rom as cubic Béziers). */
function curve(pts: Array<readonly [number, number]>): string {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
/** A pill: an optional drawn mark (no glyphs the font may lack), then words. Returns its SVG and width. */
function pill(px: number, py: number, text: string, o: { fill?: string; stroke?: string; ink: string; mark?: 'up' | 'down' | 'dot' | 'loop' | 'upright' | 'downright' | 'flat' }): { svg: string; w: number } {
  const fs = 24, pad = 20, iw = o.mark ? 26 : 0, w = Math.round(text.length * fs * 0.7 + pad * 2 + iw), h = 46, cy = py + h / 2, mx = px + pad + 9;
  const marks: Record<string, string> = {
    up: `<path d="M${mx - 9},${cy + 7} L${mx},${cy - 8} L${mx + 9},${cy + 7} Z" fill="${o.ink}"/>`,
    down: `<path d="M${mx - 9},${cy - 7} L${mx},${cy + 8} L${mx + 9},${cy - 7} Z" fill="${o.ink}"/>`,
    dot: `<circle cx="${mx}" cy="${cy}" r="7" fill="${o.ink}"/>`,
    upright: `<path d="M${mx - 8},${cy + 8} L${mx + 7},${cy - 7} M${mx - 3},${cy - 8} H${mx + 8} V${cy + 3}" stroke="${o.ink}" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    downright: `<path d="M${mx - 8},${cy - 8} L${mx + 7},${cy + 7} M${mx + 8},${cy - 3} V${cy + 8} H${mx - 3}" stroke="${o.ink}" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    loop: `<path d="M${mx + 8},${cy} A8,8 0 1 1 ${mx + 3},${cy - 7.4}" stroke="${o.ink}" stroke-width="3.4" fill="none" stroke-linecap="round"/><path d="M${mx + 1},${cy - 12} L${mx + 6},${cy - 7} L${mx},${cy - 3}" stroke="${o.ink}" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    flat: `<path d="M${mx - 9},${cy} H${mx + 6} M${mx + 1},${cy - 6} L${mx + 8},${cy} L${mx + 1},${cy + 6}" stroke="${o.ink}" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  };
  return { w, svg: `<g><rect x="${px}" y="${py}" width="${w}" height="${h}" rx="${h / 2}" fill="${o.fill ?? 'none'}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="2.5"` : ''}/>${o.mark ? marks[o.mark] : ''}<text x="${px + pad + iw}" y="${cy + 8.5}" font-size="${fs}" font-weight="800" letter-spacing="1" fill="${o.ink}">${x(text)}</text></g>` };
}

const ACCENT = '#ff7aa1', TEAL = '#7fd3df', TEXT = '#f2f6f5', MUTED = '#9fb4b2';
const PHASE_INK = { emerging: '#5fd39b', peaking: ACCENT, fading: MUTED, returning: '#b8a1f0', steady: TEAL } as const;
const PHASE_ICON = { emerging: 'upright', peaking: 'up', fading: 'downright', returning: 'loop', steady: 'flat' } as const;

/** The card as SVG text. Same input, same picture. */
export function shareCardSvg(c: CardInput): string {
  const label = latinOnly(c.label) || 'Topic', { size, lines } = nameSize(label), counts = c.series.counts.map((v) => Math.max(0, Number(v) || 0));
  const lc = lifecycle(counts, c.series.days), total = counts.reduce((a, b) => a + b, 0);

  // ---- the current: the last 14 days along the foot, smoothed, with the peak marked
  const top = Math.max(1, ...smooth(counts)), y0 = 600, y1 = 410, n = counts.length;
  const right = CARD_W - 64, px = (i: number) => (n > 1 ? (i / (n - 1)) * right : CARD_W / 2), py = (v: number) => y0 - (v / top) * (y0 - y1);
  const pts = n > 1 ? smooth(counts).map((v, i) => [px(i), py(v)] as const) : [[0, y0], [CARD_W, y0]] as const;
  const line = curve(pts as Array<readonly [number, number]>) + (n > 1 ? ` L${CARD_W},${pts[pts.length - 1][1].toFixed(1)}` : '');   // on to the edge, level, after today
  const area = `${line} L${CARD_W},${CARD_H} L0,${CARD_H} Z`;
  const peak = lc && n > 1 ? `<circle cx="${px(lc.peak).toFixed(1)}" cy="${py(smooth(counts)[lc.peak]).toFixed(1)}" r="11" fill="${ACCENT}" stroke="#0d1718" stroke-width="5"/>` : '';
  // the drifting currents of the masthead, faint, behind the topic's own
  const wave = (yy: number, a: number, per: number) => { let d = `M0 ${yy} Q${per / 4} ${yy - a} ${per / 2} ${yy}`; for (let k = per; k <= CARD_W + per; k += per / 2) d += ` T${k} ${yy}`; return d; };

  // ---- the words
  const nameTop = 214, lead = Math.round(size * 1.02), nameSvg = lines.map((l, i) => `<text x="72" y="${nameTop + i * lead}" font-size="${size}" font-weight="800" letter-spacing="-1.5" fill="${TEXT}">${x(l)}</text>`).join('');
  let pillX = 72;
  const pillY = nameTop + (lines.length - 1) * lead + 34, pills: string[] = [];
  const add = (p: { svg: string; w: number }) => { pills.push(p.svg); pillX += p.w + 14; };
  if (c.state === 'new') add(pill(pillX, pillY, 'NEW', { fill: '#f5b93a', ink: '#2a1700', mark: 'dot' }));
  else if (c.state === 'rising') add(pill(pillX, pillY, c.change && c.change >= 1.5 ? `RISING ×${c.change.toFixed(1)}` : 'RISING', { fill: ACCENT, ink: '#2a0614', mark: 'up' }));
  else if (c.state === 'falling') add(pill(pillX, pillY, 'FALLING', { stroke: MUTED, ink: MUTED, mark: 'down' }));
  if (lc) add(pill(pillX, pillY, PHASE_LABEL[lc.phase].toUpperCase(), { stroke: PHASE_INK[lc.phase], ink: PHASE_INK[lc.phase], mark: PHASE_ICON[lc.phase] }));
  const stat = total ? `<text x="${pillX + 6}" y="${pillY + 31}" font-size="24" font-weight="600" fill="${MUTED}">${total.toLocaleString('en-GB')} ${total === 1 ? 'mention' : 'mentions'} in ${n} days</text>` : '';
  const host = latinOnly(c.host).slice(0, 48);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" font-family="${CARD_FONT}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1516"/><stop offset="1" stop-color="#16302f"/></linearGradient>
<radialGradient id="glow" cx="0.92" cy="0.05" r="0.75"><stop offset="0" stop-color="#d93a6c" stop-opacity=".42"/><stop offset="1" stop-color="#d93a6c" stop-opacity="0"/></radialGradient>
<linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ACCENT}" stop-opacity=".42"/><stop offset="1" stop-color="${ACCENT}" stop-opacity=".02"/></linearGradient>
<linearGradient id="mk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d93a6c"/><stop offset="1" stop-color="#8e1645"/></linearGradient>
</defs>
<rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/><rect width="${CARD_W}" height="${CARD_H}" fill="url(#glow)"/>
<g fill="none" stroke="${TEAL}" stroke-linecap="round"><path d="${wave(470, 18, 340)}" stroke-opacity=".10" stroke-width="3"/><path d="${wave(520, 26, 460)}" stroke-opacity=".08" stroke-width="3"/></g>
<path d="${area}" fill="url(#fill)"/><path d="${line}" fill="none" stroke="${ACCENT}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>${peak}
<g transform="translate(72 60) scale(1.75)"><rect width="32" height="32" rx="9" fill="url(#mk)"/><path d="M7 10.5h18" stroke="#fff" stroke-opacity=".55" stroke-width="1.8" stroke-linecap="round"/><path d="M5 18.5c3.6-4.2 7.2-4.2 10.8 0s7.2 4.2 11.2 0" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M8.5 24.5c2.5-2.7 5-2.7 7.5 0s5 2.7 7.5 0" fill="none" stroke="#fff" stroke-opacity=".65" stroke-width="2" stroke-linecap="round"/></g>
<text x="146" y="99" font-size="34" font-weight="800" fill="${TEXT}">Undercurrent</text><text x="${146 + 34 * 0.58 * 12 + 14}" y="99" font-size="26" font-weight="600" fill="${MUTED}">${c.area === 'politics' ? 'Politics' : 'AI'} · topic</text>
${nameSvg}
${pills.join('')}${stat}
<rect y="${CARD_H - 44}" width="${CARD_W}" height="44" fill="#071011" fill-opacity=".55"/>
<text x="72" y="${CARD_H - 15}" font-size="22" font-weight="600" fill="${TEXT}" fill-opacity=".9">What’s rising in ${c.area === 'politics' ? 'politics' : 'AI'}, before it’s news</text>
<text x="${CARD_W - 72}" y="${CARD_H - 15}" font-size="22" font-weight="600" fill="${TEAL}" text-anchor="end">${x(host)}</text>
</svg>`;
}
