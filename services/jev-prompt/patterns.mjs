// ============================================================================
// Catálogo de Padrões de Prompt — Vanderbilt (Jules White et al., 2023,
// "A Prompt Pattern Catalog to Enhance Prompt Engineering with ChatGPT",
// arXiv 2302.11382). 16 padrões em 5 intenções; cada um com template PT-BR
// que o compositor instancia de forma determinística.
// ============================================================================
export const PATTERNS = [
  { id: 'persona', nome: 'Persona Pattern', intencao: 'melhorar_saida', quando: 'tarefa técnica que se beneficia de especialista', template: 'Aja como {persona} com {anos} anos de experiência prática em {dominio}. Mantenha o rigor e os vícios de linguagem da área.' },
  { id: 'question_refinement', nome: 'Question Refinement', intencao: 'melhorar_saida', quando: 'objetivo curto, ambíguo ou mal formulado', template: 'Antes de responder, reformule o pedido abaixo em uma versão mais precisa e completa. Pergunte se aceito a reformulação antes de prosseguir.' },
  { id: 'cognitive_verifier', nome: 'Cognitive Verifier', intencao: 'melhorar_saida', quando: 'resposta com risco de erro caro', template: 'Divida a tarefa em 3–5 subquestões, responda cada uma e, ao final, verifique a consistência das respostas entre si antes de entregar a conclusão.' },
  { id: 'audience_persona', nome: 'Audience Persona', intencao: 'melhorar_saida', quando: 'público específico com vocabulário próprio', template: 'Escreva para {publico}: use o vocabulário e as preocupações desse público; evite jargão externo à área dele.' },
  { id: 'flipped_interaction', nome: 'Flipped Interaction', intencao: 'melhorar_saida', quando: 'falta informação essencial para começar', template: 'Faça até 3 perguntas essenciais ANTES de executar. Só prossiga quando tiver as respostas.' },
  { id: 'output_automater', nome: 'Output Automater', intencao: 'simplificar_saida', quando: 'saída vai ser processada por código/ferramenta', template: 'Ao final, gere o artefato executável correspondente (script/comando/arquivo pronto) que aplica ou persiste a resposta.' },
  { id: 'template', nome: 'Template Pattern', intencao: 'simplificar_saida', quando: 'formato de saída fixo exigido', template: 'Responda EXATAMENTE no formato:\n{formato}\nPreencha todos os campos; campo sem valor vira "—". Nada fora do formato.' },
  { id: 'visualization_variable', nome: 'Visualization Variable', intencao: 'simplificar_saida', quando: 'comparação/estrutura ficaria melhor visualizada', template: 'Apresente também uma visualização em texto (tabela, árvore ou diagrama de blocos em ASCII) do resultado principal.' },
  { id: 'refusal_breaker', nome: 'Refusal Breaker', intencao: 'simplificar_saida', quando: 'modelo costuma recusar por excesso de cautela', template: 'Se não puder concluir a tarefa como pedida, explique o obstáculo específico e proponha a versão mais próxima que você PODE entregar.' },
  { id: 'meta_language', nome: 'Meta Language Creation', intencao: 'semantica_entrada', quando: 'domínio com notação própria', template: 'Nesta conversa, «X => Y» significa "X implica Y"; «!Z» significa "Z é obrigatório". Use esta notação em tudo.' },
  { id: 'prompt_reification', nome: 'Prompt Reification', intencao: 'melhorar_prompt', quando: 'o pedido é abstrato e precisa de forma concreta', template: 'Primeiro, converta o pedido abaixo em um plano concreto passo a passo com entregáveis verificáveis; depois execute o plano.' },
  { id: 'recipe', nome: 'Recipe Pattern', intencao: 'melhorar_prompt', quando: 'sequência de passos com dependências', template: 'Forneça os ingredientes (pré-requisitos) em ordem; depois a receita passo a passo; ao final, como verificar que deu certo.' },
  { id: 'context_control', nome: 'Context Control', intencao: 'controle_interacao', quando: 'contexto longo com partes irrelevantes', template: 'Considere APENAS: {contexto_incluso}. Ignore qualquer informação fora desse escopo, mesmo que apareça na conversa.' },
  { id: 'ask_for_input', nome: 'Ask for Input', intencao: 'controle_interacao', quando: 'trabalho iterativo com humano no loop', template: 'Após cada etapa, pare e espere meu OK antes de continuar. Se algo ambíguo aparecer, pergunte.' },
  { id: 'alternative_approaches', nome: 'Alternative Approaches', intencao: 'controle_interacao', quando: 'decisão de caminho importa', template: 'Apresente 2–3 abordagens alternativas com prós/contras antes de escolher uma; declare qual escolheu e por quê.' },
  { id: 'infinite_generation', nome: 'Infinite Generation', intencao: 'controle_interacao', quando: 'volume grande gerado em partes', template: 'Continue gerando de onde parou quando eu disser "continuar", sem repetir nem resumir o já entregue.' },
];
export const PATTERN_BY_ID = Object.fromEntries(PATTERNS.map(p => [p.id, p]));
export const PADRAO_VERSION = 'vanderbilt-2023/16';

/** Heurística determinística de candidatos (offline e pré-filtro do Jev). */
export function candidatosHeuristicos(objetivo = '', dominio = '') {
  const t = (objetivo + ' ' + dominio).toLowerCase();
  const picks = new Set(['question_refinement', 'template']);
  if (/cod|code|script|api|json|regex|sql|refator|refactor|test/.test(t)) picks.add('output_automater');
  if (/anal|audit|verific|review|revis|risco|risk|jurídic|juridic|legal|financ/.test(t)) { picks.add('cognitive_verifier'); picks.add('persona'); }
  if (/explica|explain|teach|beginner|ensin|leigo|apostila|aula|tutorial/.test(t)) picks.add('audience_persona');
  if (/sem informação|não sei|unknown|decidir|decide|escolher|choose|plano|plan|estratégia|estrategia|strategy/.test(t)) { picks.add('flipped_interaction'); picks.add('alternative_approaches'); }
  if (/passo a passo|step.by.step|pipeline|processo|process|workflow|implanta|deploy/.test(t)) picks.add('recipe');
  if (/resum|summari|compact|sintetiz|synthesi/.test(t)) picks.add('context_control');
  if (/criativ|creative|nome|name|campanha|campaign|copy|roteiro/.test(t)) picks.add('alternative_approaches');
  return [...picks].slice(0, 8);
}
