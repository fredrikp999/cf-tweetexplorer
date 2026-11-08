// Embeddings from Workers AI: the vectors for a list of texts, in batches, unit length, with what they cost. The meaning of the numbers and what is done
// with them is in src/signal/vectors.ts.
import { EMBED_BATCH, EMBED_MODEL, EMBED_PER_M, unit } from '../signal/vectors.ts';

export interface Embedded { vectors: Float32Array[]; tokens: number; cost: number }

/** One vector per text, in order. Throws when the model fails or answers with the wrong number of vectors: callers go on without meaning, never fail for it. */
export async function embed(env: Env, texts: string[]): Promise<Embedded> {
  const vectors: Float32Array[] = [];
  let tokens = 0;
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const text = texts.slice(i, i + EMBED_BATCH).map((t) => t || ' ');
    const out = await env.AI.run(EMBED_MODEL as never, { text } as never) as { data?: number[][] };
    if (out.data?.length !== text.length) throw new Error('the embedding model gave no answer');
    for (const v of out.data) vectors.push(unit(v));
    tokens += Math.ceil(text.reduce((n, x) => n + x.length, 0) / 4);
  }
  return { vectors, tokens, cost: (tokens / 1_000_000) * EMBED_PER_M };
}
