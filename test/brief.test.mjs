import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorOf, continuity, langOf, normalizeThemes, readingMinutes, sectionsOf, themesOf } from '../src/site/brief.ts';

const OLD = `**Nvidia's Brev platform disclosed a breach.**

**AI developer platforms under attack.** Nvidia told Brev users that keys may have been exposed. [@a](https://x.com/a/status/1)

**AI speeding up attackers, and disclosure.** Chainalysis confirmed a breach.

**Notable posts**
- @x: something (120 likes)`;

describe('briefing structure', () => {
  test('bold lead-ins become headings; the bold TL;DR stays', () => {
    const n = normalizeThemes(OLD);
    assert.ok(n.startsWith("**Nvidia's Brev platform disclosed a breach.**"));
    assert.ok(n.includes('## AI developer platforms under attack\n\nNvidia told'));
    assert.ok(n.includes('## Notable posts'));
    assert.deepEqual(themesOf(OLD), ['AI developer platforms under attack', 'AI speeding up attackers, and disclosure']);
  });
  test('real headings are kept, and anchors are unique', () => {
    const s = sectionsOf('**TL;DR.**\n\n## Same\ntext\n## Same\nmore');
    assert.deepEqual(s.map((x) => x.anchor), ['same', 'same-2']);
    assert.equal(anchorOf('AI speeding up attackers, and disclosure'), 'ai-speeding-up-attackers-and-disclosure');
    assert.equal(anchorOf('Regeringen och Sverigedemokraterna'), 'regeringen-och-sverigedemokraterna');
  });
  test('a bold phrase inside a sentence is not a heading', () => {
    assert.deepEqual(themesOf('**TL;DR**\n\n**Wow** this is a sentence with no stop'), []);
  });
  test('language and reading time', () => {
    assert.equal(langOf('Regeringen säger att det är för tidigt och att Sverige inte har en plan för det som kommer, men det är också en fråga om vad som händer efter valet och om de kan enas.'), 'sv');
    assert.equal(langOf(OLD), 'en');
    assert.equal(readingMinutes('word '.repeat(660)), 3);
  });
  test('themes carried on from yesterday', () => {
    assert.deepEqual(continuity(['AI developer platforms under attack', 'Browser and endpoint risks'], ['Attacks on AI developer platforms', 'Local models']), ['continuing', 'new']);
    assert.deepEqual(continuity(['Anything'], undefined), [null]);
  });
});
