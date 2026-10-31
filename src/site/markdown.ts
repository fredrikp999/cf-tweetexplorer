// Markdown for the public pages: the subset the summarizer writes. Model output is untrusted, so everything is escaped first and
// links are only emitted to x.com / twitter.com and to addresses the caller lists (the RSS and Hacker News pages the writer was given).

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---- Markdown (the subset the summarizer writes)
const SAFE_LINK = /^https:\/\/(?:x|twitter)\.com\/[\w./?=&%#@:+~-]{1,300}$/;
// `allowed`: exact addresses a link may also point to besides x.com: the RSS and Hacker News pages the writer was given.
export const inline = (t: string, allowed?: ReadonlySet<string>) => esc(t)
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
  // esc() already turned & into &amp;, so undo that only for the allow-list test
  .replace(/\[([^\]\n]+)\]\((https?:[^\s)]+)\)/g, (m, text: string, href: string) => {
    const raw = href.replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    return SAFE_LINK.test(raw) || allowed?.has(raw) ? `<a href="${esc(raw)}" rel="noopener noreferrer nofollow" target="_blank">${text}</a>` : text;
  });

const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

function prose(text: string, ok?: ReadonlySet<string>): string {
  const out: string[] = []; let list = null as { tag: string; items: string[] } | null;
  const flush = () => { if (list) { out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`); list = null; } };
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpMatchArray | null;
    if (HR.test(line)) { flush(); out.push('<hr>'); continue; }
    // A table: a header row, a |---|---| row, then rows until the first line without a pipe.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush();
      const head = cells(line); let j = i + 2; const rows: string[][] = [];
      while (j < lines.length && lines[j].includes('|') && lines[j].trim()) rows.push(cells(lines[j++]));
      // Numbers line up on the right, text stays on the left.
      const num = head.map((_, k) => rows.length > 0 && rows.every((r) => /^[\d\s.,%+\u2212-]+[kKmM]?$/.test(r[k] ?? '')));
      out.push(`<div class="tw"><table><thead><tr>${head.map((c, k) => `<th${num[k] ? ' class="n"' : ''}>${inline(c, ok)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) =>
        `<tr>${head.map((_, k) => `<td${num[k] ? ' class="n"' : ''}>${inline(r[k] ?? '', ok)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      i = j - 1; continue;
    }
    if ((m = line.match(/^\s*([-*]|\d+\.)\s+(.*)/))) {
      const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (list?.tag !== tag) { flush(); list = { tag, items: [] }; }
      list!.items.push(`<li>${inline(m[2], ok)}</li>`);
    } else {
      flush();
      if ((m = line.match(/^(#{1,3})\s+(.*)/))) out.push(`<h${m[1].length + 1}>${inline(m[2], ok)}</h${m[1].length + 1}>`);
      else if (line.trim()) out.push(`<p>${inline(line, ok)}</p>`);
    }
  }
  flush(); return out.join('');
}

function chart(body: string): string {
  try {
    const spec = JSON.parse(body) as { title?: unknown; labels?: unknown[]; values?: unknown[] };
    const labels = (spec.labels ?? []).slice(0, 30).map(String), values = (spec.values ?? []).slice(0, 30).map(Number);
    if (!labels.length || values.length !== labels.length || values.some((v) => !Number.isFinite(v) || v < 0)) return '';
    const max = Math.max(...values) || 1;
    return `<figure class="bars">${spec.title ? `<figcaption>${esc(spec.title)}</figcaption>` : ''}${labels.map((l, i) =>
      `<div><span>${esc(l)}</span><i style="width:${Math.round((values[i] / max) * 100)}%"></i><b>${esc(values[i])}</b></div>`).join('')}</figure>`;
  } catch { return ''; }
}

export function markdown(src: string, links?: readonly string[]): string {
  const ok = links?.length ? new Set(links) : undefined;
  const out: string[] = []; const re = /```(\w*)\n([\s\S]*?)(```|$)/g; let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push(prose(src.slice(last, m.index), ok));
    if (m[1] === 'chart') out.push(chart(m[2]));
    else out.push(`<pre><code>${esc(m[2])}</code></pre>`);
    last = re.lastIndex;
  }
  out.push(prose(src.slice(last), ok)); return out.join('');
}
