// Catálogo único dos nós Jev Flow. O engine, os validadores e as superfícies
// consumidoras devem derivar seus tipos deste arquivo, nunca duplicar a lista.

export const NODE_CATALOG_VERSION = 'jev-flow-node-catalog/1';

const definition = (value) => Object.freeze({
  ...value,
  glyph: value.glyph || String(value.shortLabel || value.type).slice(0, 2),
  colorToken: value.colorToken || `node-${value.group || 'default'}`,
  inputs: Object.freeze({ ...(value.inputs || {}) }),
  outputs: Object.freeze({ ...(value.outputs || {}) }),
  inspectorSchema: Object.freeze({ ...(value.inspectorSchema || {}) }),
});

const NODE_DEFINITIONS = Object.freeze([
  definition({
    type: 'jev.ask', group: 'judgment', label: 'Jev ask', shortLabel: 'Ask',
    description: 'Faz perguntas tipadas sobre um estado redigido.',
    what: 'Jev decide apenas a pergunta fechada; o código mantém a autoridade.',
    inputs: { questions: 'objeto de perguntas tipadas', jevlet: 'id opcional do jevlet' },
    outputs: { valores: 'respostas tipadas', redaction: 'metadados de redação' },
    costClass: 'jev', riskClass: 'medium', sideEffects: 'none', remote: true, generator: false, cache: true,
    fallback: 'unknown conservador quando Jev falha ou estado não é seguro',
    example: { type: 'jev.ask', questions: { relevant: { type: 'noul', instructions: 'É relevante?' } } },
    inspectorSchema: { questions: { type: 'object' }, jevlet: { type: 'string', optional: true } },
  }),
  definition({
    type: 'jev.jevlet', group: 'judgment', label: 'Jevlet', shortLabel: 'Jevlet',
    description: 'Invoca um julgamento tipado versionado do catálogo.',
    what: 'Reutiliza um jevlet testado e cacheável para um estado redigido.',
    inputs: { jevlet: 'id do jevlet', state: 'estado fornecido pelo flow' },
    outputs: { valores: 'respostas do jevlet', politica: 'política consultiva' },
    costClass: 'jev', riskClass: 'medium', sideEffects: 'none', remote: true, generator: false, cache: true,
    fallback: 'erro explícito ou resultado unknown; nunca autorização implícita',
    example: { type: 'jev.jevlet', jevlet: 'triagem-suporte' },
    inspectorSchema: { jevlet: { type: 'string', required: true } },
  }),
  definition({
    type: 'flow.if', group: 'control', label: 'Condition', shortLabel: 'If',
    description: 'Roteia por uma comparação fechada do contexto.',
    what: 'Executa a comparação no código e segue um dos dois ramos.',
    inputs: { when: 'expressão de comparação', then: 'id do ramo verdadeiro', else: 'id do ramo falso', onInvalid:'else opcional para Noul/Score numérico ausente ou inválido' },
    outputs: { route: 'ramo escolhido' },
    costClass: 'free', riskClass: 'low', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'erro de expressão aborta o roteamento',
    example: { type: 'flow.if', when: '{{judge.valores.score}} >= 0.7', then: 'ok', else: 'review' },
    inspectorSchema: { when: { type: 'string', required: true }, then: { type: 'string', required: true }, else: { type: 'string', required: true }, onInvalid:{type:'enum',values:['else'],optional:true} },
  }),
  definition({
    type: 'flow.switch', group: 'control', label: 'Switch', shortLabel: 'Switch',
    description: 'Roteia por uma chave exata com default obrigatório.',
    what: 'Mapeia o valor observado para um ramo sem julgamento remoto.',
    inputs: { on: 'expressão de chave', cases: 'tabela de ramos', onInvalid:'default opcional para chave ausente' },
    outputs: { route: 'ramo escolhido' },
    costClass: 'free', riskClass: 'low', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'default explícito ou término sem ação',
    example: { type: 'flow.switch', on: '{{input.kind}}', cases: { bug: 'debug', _default: 'ask' } },
    inspectorSchema: { on: { type: 'string', required: true }, cases: { type: 'object', required: true }, onInvalid:{type:'enum',values:['default'],optional:true} },
  }),
  definition({
    type: 'trigger.webhook', group: 'trigger', label: 'Webhook trigger', shortLabel: 'Hook',
    description: 'Marca um flow para uma run independente por POST em /api/jev/flows/<id>/hook; o corpo validado vira o input.',
    what: 'O servidor autentica e limita a requisição; este nó registra a origem no caminho da execução.',
    inputs: { path: 'optional catalog slug (the endpoint uses the flow ID)', response: 'summary (default) or full', secret: 'required JEVFLOW_HOOK_[A-Z0-9_]+ environment variable name, never its value' },
    outputs: { triggered: 'true após despacho do servidor', path: 'slug informado ou id do flow' },
    costClass: 'free', riskClass: 'low', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'sem rota HTTP integrada, o motor ainda pode executar o flow localmente; não presume chamada remota',
    example: { type: 'trigger.webhook', path: 'support', response: 'resumo', secret: 'JEVFLOW_HOOK_SUPPORT', next: 'judge' },
    inspectorSchema: { path: { type: 'string', optional: true }, response: { type: 'enum', values: ['resumo', 'completo'], optional: true }, secret: { type: 'string' } },
  }),
  definition({
    type: 'flow.call', group: 'control', label: 'Call flow', shortLabel: 'Call',
    description: 'Executa outro flow pelo id com input interpolado, orçamento agregado, profundidade máxima 2 e proteção contra ciclos.',
    what: 'A run filha não grava histórico próprio; sua falha e seu uso ficam visíveis no pai.',
    inputs: { flow: 'id literal do subflow', input: 'objeto opcional interpolado (padrão: input atual)' },
    outputs: { ok: 'sucesso da run filha', vars: 'variáveis finais', status: 'estado final', usage: 'uso agregado da run filha' },
    costClass: 'variable', riskClass: 'medium', sideEffects: 'delegated', remote: true, generator: false, cache: 'never',
    fallback: 'flow ausente, input inválido, ciclo ou orçamento excedido → passo vermelho observável',
    example: { type: 'flow.call', flow: 'reembolso-loja', input: { pedido: '{{input.pedido}}' }, next: 'decidir' },
    inspectorSchema: { flow: { type: 'string', required: true }, input: { type: 'object', optional: true } },
  }),
  definition({
    type: 'flow.each', group: 'control', label: 'Each item', shortLabel: 'Each',
    description: 'Aplica um subflow a cada item de um array, em sequência, com até 25 itens e orçamento checado antes de cada chamada.',
    what: 'Cada filho recebe {item, indice, total}; falhas parciais permanecem observáveis.',
    inputs: { list: 'expressão exata {{caminho}} para um array', flow: 'id literal do subflow' },
    outputs: { ok: 'todos os itens concluídos sem erro', ok_count: 'itens bem-sucedidos', total: 'itens', resultados: 'resultado e erro por item' },
    costClass: 'variable', riskClass: 'medium', sideEffects: 'delegated', remote: true, generator: false, cache: 'never',
    fallback: 'orçamento esgotado interrompe a sequência e preserva resultados anteriores',
    example: { type: 'flow.each', list: '{{input.pedidos}}', flow: 'sub-triagem', next: 'fim', onError: { next: 'tratar_falha' } },
    inspectorSchema: { list: { type: 'string', required: true }, flow: { type: 'string', required: true } },
  }),
  definition({
    type: 'note.sticky', group: 'annotation', label: 'Sticky note', shortLabel: 'Note',
    description: 'Anotação visual fora do caminho de execução.',
    what: 'Documenta uma política humana; não executa julgamento nem efeito.',
    inputs: { texto: 'conteúdo da nota', cor: 'cor opcional' }, outputs: {},
    costClass: 'free', riskClass: 'none', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'não participa da execução',
    example: { type: 'note.sticky', texto: 'Escalar dano real para revisão humana' },
    inspectorSchema: { texto: { type: 'string', required: true }, cor: { type: 'string', optional: true } },
  }),
  definition({
    type: 'rule.match', group: 'deterministic', label: 'Match rule', shortLabel: 'Match',
    description: 'Testa uma condição enumerada sem rede.',
    what: 'Compara equals, includes, regex, exists ou in no código.',
    inputs: { value: 'valor ou expressão', operator: 'operador enumerado', expected: 'alvo opcional' },
    outputs: { matched: 'booleano', value: 'valor observado' },
    costClass: 'free', riskClass: 'low', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'regex inválida ou operação desconhecida falha fechada',
    example: { type: 'rule.match', value: '{{input.kind}}', operator: 'equals', expected: 'bug' },
    inspectorSchema: { value: { type: 'string', required: true }, operator: { type: 'enum', values: ['equals', 'includes', 'regex', 'exists', 'in'], required: true } },
  }),
  definition({
    type: 'rule.extract', group: 'deterministic', label: 'Extract rule', shortLabel: 'Extract',
    description: 'Extrai caminhos declarados do contexto sem importar código.',
    what: 'Resolve apenas templates permitidos e preserva campos ausentes como null.',
    inputs: { paths: 'mapa de campo para expressão' },
    outputs: { valores: 'campos extraídos', ausentes: 'campos não encontrados' },
    costClass: 'free', riskClass: 'low', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'campo ausente fica null e é listado',
    example: { type: 'rule.extract', paths: { kind: '{{input.kind}}' } },
    inspectorSchema: { paths: { type: 'object', required: true } },
  }),
  definition({
    type: 'rule.lookup', group: 'deterministic', label: 'Lookup rule', shortLabel: 'Lookup',
    description: 'Consulta uma tabela estática com default explícito.',
    what: 'Mapeia uma chave observada sem rede, eval ou efeitos externos.',
    inputs: { key: 'chave ou expressão', table: 'objeto estático', default: 'fallback opcional' },
    outputs: { valor: 'valor encontrado ou default', found: 'booleano' },
    costClass: 'free', riskClass: 'low', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'default explícito ou null',
    example: { type: 'rule.lookup', key: '{{match.matched}}', table: { true: 'repair', false: 'inspect' } },
    inspectorSchema: { key: { type: 'string', required: true }, table: { type: 'object', required: true } },
  }),
  definition({
    type: 'context.compact', group: 'deterministic', label: 'Compact context', shortLabel: 'Compact',
    description: 'Aplica head/tail local com marcador de omissão.',
    what: 'Reduz texto localmente sem julgamento semântico remoto.',
    inputs: { text: 'texto ou expressão', maxChars: 'limite entre 256 e 50000' },
    outputs: { texto: 'texto original ou compacto', charsSaved: 'caracteres poupados' },
    costClass: 'free', riskClass: 'low', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'texto original quando não excede o limite',
    example: { type: 'context.compact', text: '{{input.text}}', maxChars: 4000 },
    inspectorSchema: { text: { type: 'string', required: true }, maxChars: { type: 'integer', optional: true } },
  }),
  definition({
    type: 'action.webhook', group: 'action', label: 'Webhook', shortLabel: 'HTTP',
    description: 'Envia JSON somente após orçamento e verificação aprovados.',
    what: 'Exige budget.guard e o ramo true explícito de jev.verify; false/default/review nunca autorizam efeito.',
    inputs: { url: 'URL', method: 'método HTTP', body: 'JSON' },
    outputs: { status: 'status HTTP', ok: 'booleano' },
    costClass: 'external', riskClass: 'high', sideEffects: 'external', remote: true, generator: false, cache: false,
    fallback: 'bloqueia URL insegura e registra efeito incerto para resume',
    example: { type: 'action.webhook', url: 'https://example.invalid/hook', body: { ok: true } },
    inspectorSchema: { url: { type: 'string', required: true }, body: { type: 'object', optional: true } },
  }),
  definition({
    type: 'action.log', group: 'action', label: 'Log', shortLabel: 'Log',
    description: 'Registra uma linha interpolada no resultado do flow.',
    what: 'Produz observabilidade local sem rede.',
    inputs: { texto: 'texto curto' },
    outputs: { linha: 'linha registrada' },
    costClass: 'free', riskClass: 'low', sideEffects: 'observe', remote: false, generator: false, cache: false,
    fallback: 'mensagem padrão do flow',
    example: { type: 'action.log', texto: 'flow concluído' },
    inspectorSchema: { texto: { type: 'string', optional: true } },
  }),
  definition({
    type: 'action.set', group: 'action', label: 'Set variables', shortLabel: 'Set',
    description: 'Atualiza variáveis locais com valores interpolados.',
    what: 'Escreve somente em vars do contexto atual.',
    inputs: { values: 'mapa de variáveis' },
    outputs: { valores: 'variáveis gravadas' },
    costClass: 'free', riskClass: 'low', sideEffects: 'write', remote: false, generator: false, cache: false,
    fallback: 'mapa vazio é rejeitado na validação',
    example: { type: 'action.set', values: { status: 'ready' } },
    inspectorSchema: { values: { type: 'object', required: true } },
  }),
  definition({
    type: 'det.skill', group: 'deterministic', label: 'Deterministic skill', shortLabel: 'Skill',
    description: 'Executa uma skill registrada deterministicamente sem LLM.',
    what: 'Resolve o registro local antes de qualquer fallback generativo.',
    inputs: { skill: 'id da skill determinística', input: 'objeto de entrada' },
    outputs: { result: 'resultado da skill', execution_mode: 'deterministic' },
    costClass: 'free', riskClass: 'low', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'erro explícito; skills generativas não são aceitas neste nó',
    example: { type: 'det.skill', skill: 'det-json-validator', input: { json: '{"ok":true}' } },
    inspectorSchema: { skill: { type: 'string', required: true }, input: { type: 'object', optional: true } },
  }),
  definition({
    type: 'context.prune', group: 'context', label: 'Jev output prune', shortLabel: 'Prune',
    description: 'Poda saídas textuais grandes usando o pruner fail-open.',
    what: 'Preserva formatos protegidos e devolve a entrada original em qualquer incerteza.',
    inputs: { messages: 'mensagens do contexto', options: 'política opcional' },
    outputs: { messages: 'mensagens preservadas/podadas', meta: 'receipt da poda' },
    costClass: 'jev-conditional', riskClass: 'medium', sideEffects: 'none', remote: true, generator: false, cache: true,
    fallback: 'saída original e meta fail-open',
    example: { type: 'context.prune', messages: [{ role: 'tool', content: 'resultado' }], options: { enabled: false } },
    inspectorSchema: { messages: { type: 'array', required: true }, options: { type: 'object', optional: true } },
  }),
  definition({
    type: 'budget.guard', group: 'control', label: 'Budget guard', shortLabel: 'Budget',
    description: 'Verifica orçamento antes de despachar o próximo nó.',
    what: 'Bloqueia quando steps, Jev ou tokens reservados excedem o teto.',
    inputs: { budget: 'reserva prevista', limits: 'limites opcionais' },
    outputs: { allowed: 'booleano', remaining: 'saldo do orçamento' },
    costClass: 'free', riskClass: 'high', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'bloqueio conservador com erro de orçamento',
    example: { type: 'budget.guard', budget: { steps: 1, jevCalls: 1, inputTokens: 100 } },
    inspectorSchema: { budget: { type: 'object', required: true }, limits: { type: 'object', optional: true } },
  }),
  definition({
    type: 'rules.find', group: 'judgment', label: 'Find rule', shortLabel: 'Rules',
    description: 'Acha a regra aplicável de um ruleset ingerido, com citação literal.',
    what: 'Padrão cookbook line-search: choice sobre IDs + noul de existência; o texto citado sai do arquivo indexado, nunca do modelo.',
    inputs: { ruleset: 'id do ruleset ingerido (pasta de política virou índice)', rules: 'alternativa inline [{id?,texto}] (máx 250)', pergunta: 'situação em linguagem natural' },
    outputs: { veredicto: 'aplicavel | parcial | sem_regra | conflito', regra: 'id da regra escolhida', citacao: 'texto e fonte LITERAIS da regra', existe: 'probabilidade de existir regra aplicável' },
    costClass: 'jev', riskClass: 'medium', sideEffects: 'none', remote: true, generator: false, cache: true,
    fallback: 'sem_regra/erro conservador; citação só existe se vier do arquivo',
    example: { type: 'rules.find', ruleset: 'politica-reembolso', pergunta: '{{input.pedido}}' },
    inspectorSchema: { ruleset: { type: 'string' }, rules: { type: 'array', optional: true }, pergunta: { type: 'string', required: true }, foundThreshold: { type: 'number', optional: true }, absentThreshold: { type: 'number', optional: true } },
  }),
  definition({
    type: 'jev.verify', group: 'judgment', label: 'Verify claim', shortLabel: 'Verify',
    description: 'Verifica uma alegação contra evidência fornecida.',
    what: 'Usa Jev sem buscar fatos externos e aplica gate conservador.',
    inputs: { claim: 'alegação', evidence: 'evidência textual', minSupport: 'limiar opcional' },
    outputs: { verification: 'veredito tipado', gate: 'resultado do gate' },
    costClass: 'jev', riskClass: 'medium', sideEffects: 'none', remote: true, generator: false, cache: false,
    fallback: 'não verificável/erro; nunca prova nem autorização',
    example: { type: 'jev.verify', claim: 'o teste passou', evidence: 'node --test: pass' },
    inspectorSchema: { claim: { type: 'string', required: true }, evidence: { type: 'string', required: true }, minSupport: { type: 'number', optional: true } },
  }),
  definition({
    type: 'metrics.emit', group: 'observability', label: 'Emit metrics', shortLabel: 'Metrics',
    description: 'Emite métricas compactas e redigidas do nó.',
    what: 'Aceita somente escalares e listas curtas; nunca transporta segredo, texto integral ou caminho absoluto.',
    inputs: { event: 'objeto compacto de métricas' },
    outputs: { receipt: 'métrica redigida', measurement: 'observed ou estimated' },
    costClass: 'free', riskClass: 'low', sideEffects: 'observe', remote: false, generator: false, cache: false,
    fallback: 'descarta campos proibidos e retorna receipt local',
    example: { type: 'metrics.emit', event: { name: 'node.completed', durationMs: 12, ok: true } },
    inspectorSchema: { event: { type: 'object', required: true } },
  }),
  definition({
    type: 'logic.subgraph', group: 'logic', label: 'Reasoning graph', shortLabel: 'Logic',
    description: 'Avalia um subgrafo lógico versionado sem efeitos externos.',
    what: 'Combina fatos, evidências e políticas determinísticas; Jev permanece um nó separado.',
    inputs: { graph: 'DSL JSON logic.graph/1', facts: 'fatos interpoláveis opcionais', evidence: 'evidências interpoláveis opcionais' },
    outputs: { conclusions: 'conclusões revisáveis', audit: 'trilha de inferência', unknown: 'itens sem prova suficiente', conflicts: 'conflitos' },
    costClass: 'free', riskClass: 'medium', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'estado unknown/review conservador; nunca autorização implícita',
    example: { type: 'logic.subgraph', graph: { version: 'logic.graph/1', facts: { shipped: { state: 'true' } }, rules: [{ id: 'r1', when: { fact: 'shipped', is: 'true' }, then: { conclusion: 'ready', state: 'true' } }] } },
    inspectorSchema: { graph: { type: 'object', required: true }, facts: { type: 'object', optional: true }, evidence: { type: 'object', optional: true } },
  }),
  definition({
    type: 'jev.rerank', group: 'judgment', label: 'Jev rerank', shortLabel: 'Rerank',
    description: 'Ranqueia candidatos por pertinência à pergunta (1 chamada batched, Noul binário por item).',
    what: 'Jev pontua cada item e o código ordena — seleção em vez de geração, o padrão rerank.',
    inputs: { items: 'array de candidatos (strings ou objetos, máx. 10)', question: 'critério de relevância' },
    outputs: { ranked: 'itens ordenados por score desc', top: 'melhor item', scores: 'noul por posição' },
    costClass: 'jev', riskClass: 'medium', sideEffects: 'none', remote: true, generator: false, cache: true,
    fallback: 'erro explícito se itens, pergunta ou algum Noul faltarem; máx. 10 itens por chamada',
    example: { type: 'jev.rerank', items: '{{input.candidatos}}', question: 'Qual candidato atende melhor a solicitação?' },
    inspectorSchema: { items: { type: 'array', required: true }, question: { type: 'string', required: true }, maxItems: { type: 'integer', optional: true } },
  }),
  definition({
    type: 'jev.classify', group: 'judgment', label: 'Jev classify', shortLabel: 'Classify',
    description: 'Classificador hierárquico em 1 chamada: categoria primária, secundária e concentração da distribuição Choice.',
    what: 'Seleção em vez de geração — o Jev escolhe da taxonomia declarada; o código consome o par tipado.',
    inputs: { texto: 'texto a classificar', categorias: 'categorias primárias (2-8)', subcategorias: 'opcionais (2-8)' },
    outputs: { categoria: 'primária escolhida', subcategoria: 'refinamento opcional', confianca: 'confidence do Choice 0..1 ou null; concentração, não correção factual', precisa_revisao:'categoria ausente ou distribuição incerta' },
    costClass: 'jev', riskClass: 'medium', sideEffects: 'none', remote: true, generator: false, cache: true,
    fallback: 'erro explícito se categorias ausentes; confiança baixa sinaliza revisão',
    example: { type: 'jev.classify', texto: '{{input.texto}}', categorias: '{{input.taxonomia}}', subcategorias: ['produto', 'cobranca'] },
    inspectorSchema: { texto: { type: 'string', required: true }, categorias: { type: 'array', required: true }, subcategorias: { type: 'array', optional: true } },
  }),
  definition({
    type: 'flow.ensemble', group: 'deterministic', label: 'Ensemble', shortLabel: 'Ensemble',
    description: 'Agrega N julgamentos (noul) numa decisão: média, maioria ou conservador.',
    what: 'O código agrega scores que já existem no contexto — juízes concordando viram sinal forte sem nova chamada.',
    inputs: { scores: 'array de números 0..1 (caminhos do contexto)', threshold: 'limiar de aprovação (0..1)', policy: 'media | maioria | conservador' },
    outputs: { approved: 'decisão agregada', score: 'nota agregada', votes: 'votos acima do limiar' },
    costClass: 'free', riskClass: 'low', sideEffects: 'none', remote: false, generator: false, cache: false,
    fallback: 'erro se nenhum score resolver; conservador reprova no menor score',
    example: { type: 'flow.ensemble', scores: ['{{j1.valores.relevancia}}', '{{j2.valores.relevancia}}'], threshold: 0.6, policy: 'maioria', next: 'decidir' },
    inspectorSchema: { scores: { type: 'array', required: true }, threshold: { type: 'number', optional: true }, policy: { type: 'enum', values: ['media', 'maioria', 'conservador'], optional: true } },
  })
]);

export const NODE_CATALOG = Object.freeze(Object.fromEntries(NODE_DEFINITIONS.map(node => [node.type, node])));
export const NODE_TYPES = new Set(Object.keys(NODE_CATALOG));
export const NODE_TYPE_ALIASES = Object.freeze({ 'logic.graph': 'logic.subgraph' });
const BY_TYPE = new Map(Object.entries(NODE_CATALOG));
const CAPABILITY_FIELDS = ['costClass', 'riskClass', 'sideEffects', 'remote', 'generator', 'cache'];

export function normalizeNodeType(type) {
  const raw = String(type || '');
  return NODE_TYPE_ALIASES[raw] || raw;
}

export function getNodeDefinition(type) {
  return BY_TYPE.get(normalizeNodeType(type)) || null;
}

export function listNodeDefinitions() {
  return Object.values(NODE_CATALOG).map(node => ({ ...node, inputs: { ...node.inputs }, outputs: { ...node.outputs }, inspectorSchema: { ...node.inspectorSchema } }));
}

export function validateNodeContract(type, node = {}) {
  const canonicalType = normalizeNodeType(type);
  const definitionForType = getNodeDefinition(canonicalType);
  if (!definitionForType) return [{ code: 'NODE_TYPE_UNKNOWN', message: `tipo de nó desconhecido: ${type}` }];
  const errors = [];
  const metadata = node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata) ? node.metadata : {};
  for (const field of CAPABILITY_FIELDS) {
    if (field in node && node[field] !== definitionForType[field]) errors.push({ code: 'NODE_CAPABILITY_OVERRIDE', field, message: `${type}.${field} é definido pelo catálogo` });
    if (field in metadata && metadata[field] !== definitionForType[field]) errors.push({ code: 'NODE_CAPABILITY_OVERRIDE', field: `metadata.${field}`, message: `${type}.${field} não pode ser reduzido pelo flow` });
  }
  if ('metadata' in node && (node.metadata == null || typeof node.metadata !== 'object' || Array.isArray(node.metadata))) {
    errors.push({ code: 'NODE_METADATA_INVALID', field: 'metadata', message: 'metadata deve ser objeto' });
  }
  if (canonicalType === 'det.skill' && typeof node.skill !== 'string') errors.push({ code: 'DET_SKILL_ID_INVALID', field: 'skill', message: 'det.skill exige skill string' });
  if (canonicalType === 'context.prune' && !Array.isArray(node.messages) && typeof node.messages !== 'string' && !node.messages) errors.push({ code: 'PRUNE_MESSAGES_INVALID', field: 'messages', message: 'context.prune exige messages' });
  if (canonicalType === 'budget.guard' && (!node.budget || typeof node.budget !== 'object' || Array.isArray(node.budget))) errors.push({ code: 'BUDGET_RESERVE_INVALID', field: 'budget', message: 'budget.guard exige budget objeto' });
  if (canonicalType === 'jev.verify') {
    if (typeof node.claim !== 'string' || !node.claim.trim()) errors.push({ code: 'VERIFY_CLAIM_INVALID', field: 'claim', message: 'jev.verify exige claim string' });
    if (typeof node.evidence !== 'string' || !node.evidence.trim()) errors.push({ code: 'VERIFY_EVIDENCE_INVALID', field: 'evidence', message: 'jev.verify exige evidence string' });
  }
  if (canonicalType === 'metrics.emit' && (!node.event || typeof node.event !== 'object' || Array.isArray(node.event))) errors.push({ code: 'METRICS_EVENT_INVALID', field: 'event', message: 'metrics.emit exige event objeto compacto' });
  if (canonicalType === 'rules.find') {
    if (typeof node.pergunta !== 'string' || !node.pergunta.trim()) errors.push({ code: 'RULES_PERGUNTA_INVALIDA', field: 'pergunta', message: 'rules.find exige pergunta string (a situação a julgar)' });
    const temRuleset = typeof node.ruleset === 'string' && node.ruleset.trim();
    const temInline = Array.isArray(node.rules) && node.rules.length > 0;
    if (!temRuleset && !temInline) errors.push({ code: 'RULES_FONTE_AUSENTE', field: 'ruleset', message: 'rules.find exige ruleset (id ingerido) ou rules inline' });
    if (temRuleset && temInline) errors.push({ code: 'RULES_FONTE_DUPLA', field: 'ruleset', message: 'informe ruleset OU rules, nunca ambos' });
    if (temInline) {
      if (node.rules.length > 250) errors.push({ code: 'RULES_LIMITE_INVALIDO', field: 'rules', message: 'rules aceita até 250 itens (limite do choice: 255 opções)' });
      for (const [i, r] of node.rules.entries()) {
        if (!r || typeof r !== 'object' || typeof r.texto !== 'string' || !r.texto.trim()) errors.push({ code: 'RULES_ITEM_INVALIDO', field: `rules[${i}]`, message: 'cada regra inline deve ser {id?, texto}' });
      }
    }
    for (const [campo, min, max] of [['foundThreshold', 0.5, 1], ['absentThreshold', 0, 0.5]]) {
      if (node[campo] != null && (!Number.isFinite(Number(node[campo])) || Number(node[campo]) < min || Number(node[campo]) > max)) {
        errors.push({ code: 'RULES_THRESHOLD_INVALIDO', field: campo, message: `${campo} deve ser número entre ${min} e ${max}` });
      }
    }
    if (Number.isFinite(Number(node.foundThreshold)) && Number.isFinite(Number(node.absentThreshold)) && Number(node.absentThreshold) >= Number(node.foundThreshold)) {
      errors.push({ code: 'RULES_THRESHOLD_INVALIDO', field: 'absentThreshold', message: 'absentThreshold deve ser menor que foundThreshold' });
    }
  }
  if (canonicalType === 'logic.subgraph' && (!node.graph || typeof node.graph !== 'object' || Array.isArray(node.graph))) errors.push({ code: 'LOGIC_GRAPH_INVALID', field: 'graph', message: 'logic.subgraph exige graph objeto JSON versionado' });
  return errors;
}
