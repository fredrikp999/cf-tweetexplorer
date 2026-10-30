// Turns a briefing's Markdown into what is worth reading aloud, and wraps it in a template's delivery style.
// Gemini TTS takes its direction in a separate `style` input ("warm and calm"); inside the text only <angle-bracket tags> such as
// <short pause> mean anything. Pure functions: no Worker APIs, so Node can test them.
// Imported by the Worker, so: `import type`, no TypeScript-only runtime syntax.

export type Pause = 'none' | 'short' | 'long';
export interface ScriptStyle { intro: string; outro: string; pause: Pause }
export interface ScriptContext { title: string; date: string; posts: number; accounts: number }

export const MAX_CHARS = 3500;   // per request: long briefings are sent in pieces at paragraph boundaries

const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cellsOf = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** One piece of Markdown as speakable text. <tags>, |backchannels| and any [bracket] that are left are dropped, so briefing text can never inject a delivery cue. */
export function speakable(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')            // [@openai](https://x.com/...) -> @openai
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\bTL;?DR\b\s*(\([^)]*\))?\s*:?/gi, 'In short,')
    .replace(/[`*]|__/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>|]/g, ' ')
    .replace(/@(\w)/g, '$1')                            // "@name" is read as the name
    .replace(/\s+/g, ' ')
    .trim();
}
const sentence = (s: string) => (s && !/[.!?:;]$/.test(s) ? s + '.' : s);

/** The paragraphs of a briefing, as plain sentences: headings and list items become their own short paragraphs, tables are read
 *  row by row without the header, charts and code are skipped. */
export function paragraphs(md: string): string[] {
  const lines = md.replace(/```[\s\S]*?(```|$)/g, '\n').split('\n'), out: string[] = [];
  let buf: string[] = [];
  const flush = () => { const p = speakable(buf.join(' ')); if (p) out.push(p); buf = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpMatchArray | null;
    if (!line.trim()) { flush(); continue; }
    if (HR.test(line)) { flush(); continue; }
    if (line.includes('|') && i + 1 < lines.length && SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush(); i += 1;                                  // the header row and the |---| row are not read
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) { i++; const p = speakable(cellsOf(lines[i]).join(', ')); if (p) out.push(sentence(p)); }
      continue;
    }
    if ((m = line.match(/^#{1,6}\s+(.*)/))) { flush(); const p = speakable(m[1]); if (p) out.push(sentence(p)); continue; }
    if ((m = line.match(/^\s*([-*]|\d+\.)\s+(.*)/))) { flush(); const p = speakable(m[2]); if (p) out.push(sentence(p)); continue; }
    buf.push(line);
  }
  flush();
  return out;
}

/** A short plain-language direction such as "warm and calm". Brackets, tags and pipes are dropped; Gemini drifts on long directions. */
export function cleanStyle(s: string): string {
  return String(s ?? '').replace(/[<>\[\]|\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function fill(tpl: string, c: ScriptContext): string {
  return tpl.replace(/\{title\}/g, c.title).replace(/\{date\}/g, c.date).replace(/\{posts\}/g, String(c.posts)).replace(/\{accounts\}/g, String(c.accounts)).replace(/\s+/g, ' ').trim();
}

/** Splits one over-long paragraph at sentence ends. */
const pieces = (p: string): string[] => {
  if (p.length <= MAX_CHARS) return [p];
  const out: string[] = []; let cur = '';
  for (const s of p.split(/(?<=[.!?])\s+/)) {
    if (cur && cur.length + s.length + 1 > MAX_CHARS) { out.push(cur); cur = ''; }
    cur = cur ? cur + ' ' + s : s;
  }
  if (cur) out.push(cur);
  return out.flatMap((x) => (x.length > MAX_CHARS ? x.match(new RegExp(`.{1,${MAX_CHARS}}`, 'g')) ?? [] : [x]));
};

/** The text to send to the speech model, in pieces of at most MAX_CHARS characters. The style travels separately, the same for every piece. */
export function buildScript(md: string, t: ScriptStyle, ctx: ScriptContext): string[] {
  const tag = t.pause === 'none' ? '' : t.pause === 'long' ? '<long pause>' : '<short pause>';
  const items = [fill(t.intro, ctx), ...paragraphs(md).flatMap(pieces), fill(t.outro, ctx)].filter(Boolean);
  const chunks: string[] = []; let cur: string[] = [], len = 0;
  const close = () => { if (cur.length) chunks.push(cur.join(tag ? `\n${tag}\n` : '\n')); cur = []; len = 0; };
  for (const it of items) {
    if (cur.length && len + it.length > MAX_CHARS) close();
    cur.push(it);
    len += it.length + (tag ? tag.length + 2 : 1);
  }
  close();
  return chunks;
}
