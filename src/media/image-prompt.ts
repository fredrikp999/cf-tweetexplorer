// Builds the prompt for a briefing's picture from a template's prompt and the briefing text. Pure functions, so Node can test them.
// Imported by the Worker, so: no TypeScript-only runtime syntax beyond `import type`.
import { paragraphs } from './audio-script.ts';

export interface ImageContext { title: string; date: string; tldr: string }
export const EXCERPT_CHARS = 800;       // image models read only a few hundred tokens of prompt
export const PROMPT_MAX = 1500;

const plain = (s: string) => s.replace(/\*\*|__|[`#>]/g, '').replace(/\s+/g, ' ').trim();

/** The start of the briefing as plain sentences, cut at a sentence end when it can be. */
export function excerpt(md: string, max = EXCERPT_CHARS): string {
  const text = paragraphs(md).join(' ');
  if (text.length <= max) return text;
  const cut = text.slice(0, max), end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '')).trim();
}

/** The template's prompt with {title} {date} {tldr} {briefing} filled in. A template that uses neither {tldr} nor {briefing} still gets the
 *  briefing: its excerpt is added after the prompt, so the picture always follows the text. */
export function imagePrompt(md: string, template: string, ctx: ImageContext): string {
  const tldr = plain(ctx.tldr), body = excerpt(md);
  const uses = /\{(tldr|briefing)\}/.test(template);
  const out = template.replace(/\{title\}/g, ctx.title).replace(/\{date\}/g, ctx.date).replace(/\{tldr\}/g, tldr || body.slice(0, 300)).replace(/\{briefing\}/g, body).replace(/[ \t]+/g, ' ').trim();
  return (uses ? out : `${out}\n\nThe briefing: ${body}`).slice(0, PROMPT_MAX);
}
