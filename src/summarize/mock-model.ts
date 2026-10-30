// A scripted stand-in for the real model so the whole pipeline (tools, streaming, UI) can be tested
// without an API key. Enabled only by SUMMARY_MOCK=1 (dev). It reads the instruction the harness writes
// ("First call <tool> with {json}"), calls that tool, then "summarizes" what came back.
import { Model } from '@strands-agents/sdk';
import type { Message } from '@strands-agents/sdk';

const textOf = (m: Message): string =>
  (m.content as Array<Record<string, any>>).map((b) => (b.type === 'textBlock' ? b.text : b.type === 'toolResultBlock' ? (b.content ?? []).map((c: any) => c.text ?? '').join('') : '')).join('\n');

export class MockModel extends Model {
  updateConfig(): void {}
  getConfig(): Record<string, never> { return {}; }
  async *stream(messages: Message[]): AsyncGenerator<any> {
    const last = messages[messages.length - 1];
    yield { type: 'modelMessageStartEvent', role: 'assistant' };
    const gotResult = (last.content as Array<Record<string, any>>).some((b) => b.type === 'toolResultBlock');
    if (!gotResult) {
      const prompt = textOf(messages[0]);
      const m = prompt.match(/First call (\w+) with (\{.*\})/);
      if (m) {
        yield { type: 'modelContentBlockStartEvent', start: { type: 'toolUseStart', name: m[1], toolUseId: 'mock-1' } };
        yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'toolUseInputDelta', input: m[2] } };
        yield { type: 'modelContentBlockStopEvent' };
        yield { type: 'modelMessageStopEvent', stopReason: 'toolUse' };
        return;
      }
    }
    // Answer from whatever data is in front of us: a tool result, or the inline <tweets> block.
    let tweets: Array<Record<string, any>> = [], count = 0, note = '';
    try {
      if (gotResult) { const j = JSON.parse(textOf(last)); tweets = j.tweets ?? []; count = j.count ?? tweets.length; note = j.note ?? ''; }
      else { const t = textOf(messages[0]).match(/<tweets>\n([\s\S]*?)\n<\/tweets>/); if (t) { tweets = JSON.parse(t[1]); count = tweets.length; } }
    } catch { /* leave empty */ }
    const top = [...tweets].sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0)).slice(0, 3);
    const body = tweets.length
      ? `**TL;DR (mock): ${count} tweets.**\n\n### Themes\nMost of the activity came from ${[...new Set(tweets.map((t) => t.by))].slice(0, 4).join(', ')}.\n\n### Notable posts\n${top.map((t) => `- [${t.by}](${t.url}) — ${t.likes} likes`).join('\n')}\n${note ? `\n_${note}_` : ''}`
      : '**No tweets to summarize (mock).**';
    yield { type: 'modelContentBlockStartEvent' };
    for (const chunk of body.match(/[\s\S]{1,40}/g) ?? []) yield { type: 'modelContentBlockDeltaEvent', delta: { type: 'textDelta', text: chunk } };
    yield { type: 'modelContentBlockStopEvent' };
    yield { type: 'modelMetadataEvent', usage: { inputTokens: 1200, outputTokens: 340, totalTokens: 1540 } };
    yield { type: 'modelMessageStopEvent', stopReason: 'endTurn' };
  }
}
