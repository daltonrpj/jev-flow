import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dialogue = JSON.parse(await readFile(new URL('../media/jev-flow-deterministic-ai-explainer-en.json', import.meta.url), 'utf8'));
const transcript = await readFile(new URL('../media/jev-flow-deterministic-ai-explainer-en-transcript.md', import.meta.url), 'utf8');

test('the English two-speaker transcript exactly matches the TTS dialogue', () => {
  const body = transcript.split('## Exact narration\n')[1];
  assert.ok(body, 'transcript narration section exists');
  const sections = [...body.matchAll(/^### (\d+) · (Alex|Maya)\r?\n\r?\n([\s\S]*?)(?=\r?\n### |$)/gmu)];
  assert.equal(sections.length, dialogue.turns.length);
  sections.forEach((match, index) => {
    const turn = dialogue.turns[index];
    assert.equal(Number(match[1]), index + 1);
    assert.equal(match[2], turn.speaker);
    assert.equal(match[3].trim(), turn.text);
    assert.equal(turn.voice, turn.speaker === 'Alex' ? 'Charon' : 'Kore');
    assert.ok(turn.scene, `turn ${index + 1} has a visual scene`);
  });
  assert.match(transcript, /Jev does not learn from each frame/u);
  assert.match(transcript, /No OpenCV perception runs in this demo/u);
  assert.doesNotMatch(dialogue.turns.map(turn => turn.text).join('\n'), /\b(não|portugu[eê]s|concluído|obstáculo|simulação)\b/iu);
});
