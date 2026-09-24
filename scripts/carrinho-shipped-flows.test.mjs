import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCarrinhoPage, createSeededRandom } from '../services/jev-flow/carrinho-page.mjs';
import { validateFlow, loadFlow, runFlow } from '../services/jev-flow/engine.mjs';
import { choiceAnswer, noulAnswer, scoreAnswer } from '../services/jev/client.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const examples = ['deflexao-suporte', 'portao-qualidade-dado', 'analise-clausula'];
const requiredJevlets = {
  'deflexao-suporte': 'deflecao-suporte',
  'portao-qualidade-dado': 'qualidade-dado',
  'analise-clausula': 'sinais-alerta',
};

function fixtureClient(fixture) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async ask({ state, questions }) {
      calls++;
      assert.deepEqual(state, fixture.input);
      const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => {
        const expected = fixture.answers[id];
        assert.notEqual(expected, undefined, 'fixture answer missing: ' + id);
        if (question.type === 'noul') return [id, noulAnswer(expected)];
        if (question.type === 'score') return [id, scoreAnswer(expected, question.criteria)];
        const options = Object.keys(question.criteria);
        assert.ok(options.includes(expected));
        return [id, choiceAnswer(expected,
          Object.fromEntries(options.map(option => [option, option === expected ? 1 : 0])))];
      }));
      return {
        model: 'fixture',
        answers,
        usage: { input_tokens: 100, output_tokens: 10 },
        latencyMs: 1,
        costEstimateUsd: 0,
      };
    },
  };
}

test('cart page preserves route contract and both locales with the upgraded scene', () => {
  const models = ['sample/model', '<script>alert(1)</script>'];
  const pt = buildCarrinhoPage({ llmModels: models });
  const en = buildCarrinhoPage({ llmModels: models, locale: 'en' });
  assert.match(pt, /<html lang="pt-BR">/u);
  assert.match(en, /<html lang="en">/u);
  assert.match(pt, /Quase-batidas/u);
  assert.match(en, /Near misses/u);
  assert.match(en, /\/jev\/flows\?lang=en/u);
  assert.doesNotMatch(pt + en, /Atlas|\/jev\/games/u);
  assert.ok(pt.includes('/api/jev/decide'));
  assert.ok(pt.includes('/api/jev/llm-decide'));
  assert.ok(pt.includes('drawSpeedo') && pt.includes('skylineBand'));
  assert.ok(pt.includes('nearMiss') && pt.includes('decisionFx'));
  assert.ok(pt.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  for (const page of [pt, en]) {
    const start = page.indexOf('<script>') + '<script>'.length;
    const end = page.indexOf('</script>', start);
    assert.ok(start > 0 && end > start);
    new Function(page.slice(start, end));
  }
  const a = createSeededRandom(42);
  const b = createSeededRandom(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('three shipped flows validate and all nine fixtures run with default jevlet resolution', async () => {
  let executed = 0;
  for (const id of examples) {
    const path = join(root, 'services', 'jev-flow', 'examples', id + '.flow.json');
    const raw = readFileSync(path, 'utf8');
    assert.doesNotMatch(raw, /(?:[A-Z]:\\|Atlas|data\/jev|@example\.com)/u);
    const flow = JSON.parse(raw);
    assert.equal(flow.id, id);
    assert.equal(flow.nodes[flow.start].jevlet, requiredJevlets[id]);
    assert.equal(validateFlow(flow).ok, true, id + ' fails validation');
    assert.equal(loadFlow(id).id, id);
    assert.equal(flow.fixtures.length, 3);
    for (const fixture of flow.fixtures) {
      const client = fixtureClient(fixture);
      const run = await runFlow(flow, fixture.input, {
        client, useCache: false, gravar: false,
      });
      assert.equal(run.ok, true, id + '/' + fixture.id + ': ' + JSON.stringify(run.steps));
      assert.equal(client.calls, 1, id + '/' + fixture.id);
      assert.equal(run.vars.status, fixture.esperado.status, id + '/' + fixture.id);
      for (const node of fixture.esperado.pathIncludes) {
        assert.ok(run.path.includes(node), id + '/' + fixture.id + ' missing ' + node);
      }
      executed++;
    }
  }
  assert.equal(executed, 9);
});
