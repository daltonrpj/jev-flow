import assert from 'node:assert/strict';
import test from 'node:test';
import { SHIP_TESTES } from './ship-tests.mjs';

const ids = [
  'clausulas-red-flag', 'slop-deteccao', 'hedging-evasiva', 'deflexao-suporte',
  'bug-gemeo-rastreio', 'qualidade-dado-portao', 'lacuna-docs',
  'cache-decisao-semantica', 'compactacao-contexto', 'especificidade-entrada',
  'mudanca-fase-regime', 'conformidade-spec',
];

const firstCaseAnswers = [
  'risk_area: termination | material_risk: yes',
  'slop: yes | useful: no',
  'evasive: yes | grounded: no',
  'route: human | critical: yes',
  'same_root: yes | independent: no',
  'anomaly: yes | collection_error: yes',
  'answers: no | outdated: no',
  'reusable: no | material_change: yes',
  'block_a: 3 | block_b: 0',
  'specific: no | needs_clarification: yes',
  'shift: yes | worse: yes',
  'status: absent | evidence: no',
];

const yn = value => value ? 'yes' : 'no';
const replyFor = [
  e => 'risk_area: ' + ({ nenhum: 'none', prazo: 'term', rescisao: 'termination', sigilo: 'rights', pagamento: 'payment' })[e.tema] + ' | material_risk: ' + yn(e.risco),
  e => 'slop: ' + yn(e.slop) + ' | useful: ' + yn(e.util),
  e => 'evasive: ' + yn(e.evasiva) + ' | grounded: ' + yn(e.fundamentada),
  e => 'route: ' + ({ auto: 'auto', doc: 'docs', humano: 'human' })[e.rota] + ' | critical: ' + yn(e.critico),
  e => 'same_root: ' + yn(e.gemeo) + ' | independent: ' + yn(e.independentes),
  e => 'anomaly: ' + yn(e.anomalo) + ' | collection_error: ' + yn(e.erro_coleta),
  e => 'answers: ' + yn(e.responde) + ' | outdated: ' + yn(e.desatualizada),
  e => 'reusable: ' + yn(e.aderente) + ' | material_change: ' + yn(e.mudou_o_importa),
  e => 'block_a: ' + e.bloco_a + ' | block_b: ' + e.bloco_b,
  e => 'specific: ' + yn(e.especifico) + ' | needs_clarification: ' + yn(e.precisa_perguntar),
  e => 'shift: ' + yn(e.mudou) + ' | worse: ' + yn(e.piorou),
  e => 'status: ' + ({ conforme: 'complete', parcial: 'partial', ausente: 'absent' })[e.conformidade] + ' | evidence: ' + yn(e.evidencia),
];

test('Ship Pack retains twelve IDs, fifty-two fixtures, and typed answer contracts', () => {
  assert.deepEqual(SHIP_TESTES.map(item => item.id), ids);
  assert.equal(SHIP_TESTES.reduce((count, item) => count + item.casos.length, 0), 52);
  for (const item of SHIP_TESTES) {
    assert.match(item.nome, /[A-Za-z]/);
    assert.match(item.descricao, /[A-Za-z]/);
    for (const [key, question] of Object.entries(item.perguntas)) {
      assert.ok(['choice', 'noul', 'score'].includes(question.type), item.id + ':' + key);
      assert.match(question.instructions, /[A-Za-z]/);
      if (question.type === 'choice') assert.ok(Object.keys(question.criteria).length >= 3);
      if (question.type === 'score') assert.equal(question.criteria.length, 4);
    }
    for (const itemCase of item.casos) {
      assert.deepEqual(Object.keys(itemCase.esperado), Object.keys(item.perguntas));
      assert.ok(itemCase.input.length > 20);
      for (const [key, value] of Object.entries(itemCase.esperado)) {
        const question = item.perguntas[key];
        if (question.type === 'choice') assert.ok(Object.hasOwn(question.criteria, value));
        if (question.type === 'noul') assert.equal(typeof value, 'boolean');
        if (question.type === 'score') assert.ok(Number.isInteger(value) && value >= 0 && value <= 3);
      }
    }
  }
});

test('English LLM replies parse to the existing schema and score each first fixture', () => {
  SHIP_TESTES.forEach((item, index) => {
    const input = item.casos[0].input;
    const prompt = item.promptLLM(input);
    assert.ok(prompt.includes(input), item.id);
    assert.doesNotMatch(prompt, /\bsim\b|\bnão\b|\bnao\b/i, item.id);
    const parsed = item.parseLLM(firstCaseAnswers[index]);
    assert.deepEqual(parsed, item.casos[0].esperado, item.id);
    assert.equal(item.scorer(parsed, item.casos[0].esperado), 1, item.id);
  });
});

test('all fifty-two fixture answers are representable in the English LLM protocol', () => {
  SHIP_TESTES.forEach((item, index) => {
    for (const itemCase of item.casos) {
      const parsed = item.parseLLM(replyFor[index](itemCase.esperado));
      assert.deepEqual(parsed, itemCase.esperado, item.id + ': ' + itemCase.input);
      assert.equal(item.scorer(parsed, itemCase.esperado), 1, item.id);
    }
  });
});

test('blank or malformed LLM output does not score a false expected answer', () => {
  for (const item of SHIP_TESTES) {
    for (const output of ['', 'No answer', 'unknown: no', 'status: maybe | evidence: maybe']) {
      const parsed = item.parseLLM(output);
      assert.ok(Object.values(parsed).every(value => value === null), item.id);
      assert.equal(item.scorer(parsed, item.casos[0].esperado), 0, item.id);
    }
  }
});

test('choice aliases map to stable IDs and invalid choices abstain', () => {
  const legal = SHIP_TESTES[0];
  for (const [answer, id] of Object.entries({
    none: 'nenhum', term: 'prazo', termination: 'rescisao',
    rights: 'sigilo', payment: 'pagamento',
  })) {
    assert.equal(legal.parseLLM('risk_area: ' + answer + ' | material_risk: no').tema, id);
  }
  assert.equal(legal.parseLLM('risk_area: invented | material_risk: no').tema, null);
  const support = SHIP_TESTES[3];
  assert.equal(support.parseLLM('route: docs | critical: no').rota, 'doc');
  assert.equal(support.parseLLM('route: human | critical: yes').rota, 'humano');
  assert.equal(support.scorer({ rota: 'auto', critico: true }, { rota: 'humano', critico: true }), 0.5);
  const compliance = SHIP_TESTES[11];
  assert.equal(compliance.parseLLM('status: partial | evidence: yes').conformidade, 'parcial');
  assert.equal(compliance.scorer({ conformidade: 'parcial', evidencia: false }, { conformidade: 'parcial', evidencia: true }), 0.6);
});

test('context scores preserve one-band tolerance and reject missing or out-of-range replies', () => {
  const context = SHIP_TESTES[8];
  assert.deepEqual(context.parseLLM('block_a: 3 | block_b: 0'), { bloco_a: 3, bloco_b: 0 });
  assert.deepEqual(context.parseLLM('block_a: 4 | block_b: -1'), { bloco_a: null, bloco_b: null });
  assert.deepEqual(context.parseLLM('block_a: 3'), { bloco_a: 3, bloco_b: null });
  assert.equal(context.scorer({ bloco_a: 2.4, bloco_b: 0.4 }, { bloco_a: 3, bloco_b: 0 }), 1);
  assert.equal(context.scorer({ bloco_a: null, bloco_b: null }, { bloco_a: 3, bloco_b: 0 }), 0);
});
