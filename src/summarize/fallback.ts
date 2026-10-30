// A model that tries a primary and, if the primary fails before producing anything for a reason that another
// provider would fix (out of credits, out of capacity, rate limited), carries on with a secondary. Once it has
// switched it stays switched for the rest of the run, so one answer never mixes two models.
import { Model } from '@strands-agents/sdk';
import type { Message } from '@strands-agents/sdk';

type Events = AsyncIterable<any>;

export class FallbackModel extends Model {
  usedFallback = false;
  // Explicit fields, not constructor parameter properties: Node's type stripping (the local server) does not support those.
  private primary: Model; private secondary: Model; private ids: { primary: string; secondary: string }; private worthy: (err: unknown) => boolean;
  constructor(primary: Model, secondary: Model, ids: { primary: string; secondary: string }, worthy: (err: unknown) => boolean) {
    super();
    this.primary = primary; this.secondary = secondary; this.ids = ids; this.worthy = worthy;
  }
  updateConfig(c: never): void { this.primary.updateConfig(c); }
  getConfig(): any { return this.primary.getConfig(); }
  /** The id of the model that actually answered (or will answer). */
  activeId(): string { return this.usedFallback ? this.ids.secondary : this.ids.primary; }

  async *stream(messages: Message[], options?: Parameters<Model['stream']>[1]): Events {
    if (!this.usedFallback) {
      // Hold back the opening event until a second one arrives: a failure after only "message start" is still a failure to start.
      const held: unknown[] = []; let committed = false;
      try {
        for await (const ev of this.primary.stream(messages, options)) {
          if (committed) { yield ev; continue; }
          held.push(ev);
          if (held.length > 1) { committed = true; for (const h of held) yield h; held.length = 0; }
        }
        for (const h of held) yield h;
        return;
      } catch (err) {
        if (committed || !this.worthy(err)) throw err;
        console.warn('primary model failed, using fallback:', err instanceof Error ? err.message : String(err));
        this.usedFallback = true;
      }
    }
    yield* this.secondary.stream(messages, options);
  }
}
