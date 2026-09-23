// ============================================================================
// Jev Knowledge — tudo que o Jev Flow sabe sobre o Jev (TypeSafe System One),
// estruturado para DUPLA função: (1) máquina consome (validador confere as
// regras mecanicamente no jevlet.mjs); (2) LLM consome (digest compacto que
// alimenta o desenho de novos jevlets no forge.mjs).
//
// Fontes: documentação e cookbooks públicos do TypeSafe, além das regras
// tipadas implementadas neste projeto. Versão o conhecimento: quando a API mudar,
// KNOWLEDGE_VERSION sobe e os jevlets publicados são re-validados.
// ============================================================================

export const KNOWLEDGE_VERSION = '2026-09-21.3';

export const JEV_KNOWLEDGE = {
  version: KNOWLEDGE_VERSION,

  modelo: {
    o_que_e: 'System One da TypeSafe: recebe `state` + perguntas tipadas e devolve respostas tipadas com probabilidades calibradas. Não gera texto nem explica raciocínio — julga.',
    o_que_nao_e: 'Não é gerador (sem redação/código longo), não é cadeia de raciocínio (decisões atômicas de 1 passo), não é busca (só vê o state dado), não é prova (tipado ≠ verdadeiro — julgamento é sobre o state, não sobre o mundo).',
    contrato: {
      endpoint: 'POST https://api.typesafe.ai/v1/systemone',
      auth: 'Bearer TYPESAFE_API_KEY',
      request: '{ model, state, questions: { <id>: {type, instructions, criteria} } }',
      response: '{ model, answers: { <id>: ... }, usage: {input_tokens, output_tokens} }',
      erros: '401 chave / 422 payload / 429,529 retry com backoff',
      custo: 'US$0,042 por 1M tokens de entrada (saída não cobrada); versão jev-1.13.0 em 2026-09',
      limites: 'contexto 64k tokens por request (state+perguntas); 1.200 req/min; 250k tokens/s; apenas texto (sem imagem/áudio/vídeo); choice aceita até 255 opções',
      versao: 'produção com limiares calibrados DEVE pinar o id versionado (JEV_MODEL=jev-1.13.0): o alias jev-latest se move quando a TypeSafe solta versão nova e respostas mudam sem aviso',
    },
  },

  primitivas: {
    choice: {
      quando: 'Escolher 1 entre um conjunto definido. A distribuição compara opções competindo.',
      resposta: '{ choice, probabilities (soma 1), confidence }',
      regras: [
        'criteria = mapa opção -> descrição em situações concretas (nunca null quando a distinção importa)',
        'mínimo 2 opções; mundo aberto precisa de saída de escape (outro / nao_sei / nenhuma)',
        'o modelo não pode escolher valor omitido — cobertura de candidatos é responsabilidade sua',
      ],
    },
    noul: {
      quando: 'Probabilidade calibrada de uma afirmação ser verdadeira. Uma por rótulo quando vários podem valer.',
      resposta: '{ noul: 0..1 }',
      regras: [
        '0,5 significa "tanto faz" — não é intensidade média',
        'não existe confiança separada no noul; a calibração é a resposta',
        'pergunta binária única e completinha (sim/não fazem sentido sozinhos)',
      ],
    },
    score: {
      quando: 'Posição num grau ordenado. Vários scores comparáveis = ranking.',
      resposta: '{ score (fracionário), legend, probabilities, confidence }',
      regras: [
        'mínimo 2 níveis; cada nível descreve situação concreta e se sustenta sozinho',
        'score fracionário é útil (1,6 = entre os níveis 1 e 2) — não arredonde cedo',
        'para ranking, perguntas idênticas por item (comparabilidade)',
      ],
    },
  },

  confianca: {
    significado: 'Choice/Score: concentração da distribuição — NÃO é correção nem permissão para agir. Noul não tem.',
    uso: 'Limiar guia comportamento (aplicar decisão vs escalar), mas limiar é MEDIDO no seus dados (janus), nunca copiado — no Janus original o ótimo foi 0,67 num dataset e 0,37 noutro.',
    armadilhas: [
      'várias alternativas aceitáveis espalham probabilidade — confiança baixa não invalida escolha inofensiva',
      'ignore incerteza em ramo não usado (perguntas especulativas custam token igual)',
      'alias jev-latest movimenta versão: meça de novo quando resolver diferente (pinne versão em produção)',
    ],
  },

  estado: {
    regras: [
      'state com partes nomeadas (JSON), não sopa de string, quando há mais de um ingrediente',
      'referencie campos com crases nas instruções: `ticket.mensagem` — e o campo precisa existir no schema',
      'state carrega o suficiente para responder: texto-fonte, identidades, relações, políticas vigentes',
      'frescor: julgamento velho sobre estado mudado não vale — cheque antes de aplicar',
    ],
  },

  design_de_perguntas: {
    regras: [
      'uma pergunta = um julgamento estreito e coerente; divida dimensões independentes',
      'pergunta autorreferente e completinha: ids são para código, o modelo só lê instructions+criteria',
      'atómico não é literal: seleção de ação contextual é válida se for um julgamento',
      'perguntas independentes sobre o mesmo state vão JUNTAS numa chamada (paralelas, não se veem)',
      'fan-out especulativo: pergunte já o que os ramos precisariam — código consome o que aplicar',
      'segunda chamada só quando resposta anterior é necessária para montar novo state/opções',
    ],
  },

  // Como tratar "regra geral + exceções" — o padrão que o usuário fala e o
  // desenho tem que honrar sem virar critério ambíguo.
  excecoes: {
    regras: [
      '"sempre X, exceto quando Y" NÃO vira um critério só: a exceção vira ramo/caso explícito (else, case, revisão) ou regra marcada como exceção no ruleset',
      'no ruleset, a linha "Exceção:" / "Exceto:" é indexada com flag excecao — o estado vai marcado [EXCEÇÃO] e instructions declaram que exceção vence regra geral',
      'em choice, exceção é uma opção própria com descrição do que ela COBRE e do que NÃO cobre (fronteira clara, não borrar o critério geral)',
      'no flow, exceção detectada desvia ANTES da ação: flow.if em {{no.excecao}} == true → revisão/log, nunca segue reto para efeito',
      'exceções acumulam dívida: 3+ exceções sobre a mesma regra é sinal de reescrever a regra ou dividir em duas perguntas',
      'política escrita (documento) com exceções deve virar ruleset ingerido — nunca paráfrase no prompt',
    ],
  },

  composicao: {
    padroes: [
      'route-and-fill: choice seleciona handler + argumentos tipados',
      'select-not-generate: extrair/escolher entre candidatos em vez de gerar',
      'cascade: barato decide, caro confirma só quando incerto (escada Jev -> pequeno -> frontier)',
      'composite-scoring: pontue dimensões uma vez; pesos e limiares ficam no código',
      'verify-and-escalate: cheque afirmações contra evidência; incerto vai para humano/LLM',
      'line-search (cookbook semantic_find): documento com IDs por linha no state; choice acha a linha + noul diz SE há resposta; limiares 0.7/0.35; o texto citado sai do arquivo, não do modelo',
      'confidence-gated routing (padrão oficial): piso global de confiança 0.6; limiar por AÇÃO proporcional à consequência (ação arriscada exige > 0.85); faixa intermediária pede confirmação explícita; incerto/fora de escopo vai para humano',
      'hierarchical classification: uma choice por nível da taxonomia (filhos diretos como critérios); beam k=3 com média geométrica recupera erros precoces que greedy não recupera',
      'eval-harness (padrão Langfuse): Jev como juiz de execuções — perguntas atômicas com true/false EXPLÍCITOS (definição + exemplos includes), limiar próprio por pergunta (~0.7 noul), três caminhos (age / intermediário→humano / descarta), modelo PINADO porque o veredito depende do limiar; rerun sobrescreve o score anterior',
      'harness híbrido (padrão LangChain): o LLM raciocinha e gera; Jev decide nos entremeios (roteamento de modelo, guardrails de tool call, auto-mode) — cada decisão deixa de ser uma chamada de LLM cara',
    ],
    principio: 'Código é dono do workflow, dos limiares e dos efeitos colaterais; o Jev fornece senso comum programável. O LLM nunca julga a si mesmo; o modelo julga, o código aplica.',
  },

  // Limitações DOCUMENTADAS do modelo (docs.typesafe.ai/model-jaggedness/jev-1.13):
  // o designer de perguntas deve evitar — e o bench vigia o que usamos delas.
  limitacoes_conhecidas: [
    'leitura literal: o modelo responde à pergunta ESCRITA, não à intenção — negações duplas, condições implícitas e casos-limite saem caros; escreva instruções diretas',
    'matemática e contagem não são confiáveis: nunca peça para contar itens/caracteres nem interpolar magnitudes exatas entre níveis de score — conte em código',
    'datas e horas são lidas como texto, não quantidades: extraia por enumeração (choice de formatos conhecidos) e faça aritmética de datas em código',
    'indireção custa acurácia: "propriedade de propriedade" e hops múltiplos de raciocínio pioram; reformule direto',
    'context rot: distratores grandes no state derrubam acurácia; mande só o necessário',
    'state não é tratado como hostil por padrão: conteúdo adversarial pode mover a resposta — sanitize injeções antes de enviar',
    'critérios contraditórios (ex.: true->"não") pioram: critérios são extensão da instrução, alinhe os dois',
    'invariantes não são garantidos: noul 0.22 vs choice 0.01 na mesma pergunta; pergunta+negação podem somar 1.19 — NÃO porte limiares entre noul e choice (noul é absoluto, choice é relativo)',
    'não é gerador: chaining de choices para gerar texto é lento e ruim; use choice sobre candidatos extraídos deterministicamente',
  ],

  economia: {
    numeros: [
      'decisão Jev típica ~1k tokens de entrada ≈ US$0,00004, ~0,3s',
      '1M de decisões ≈ US$42 — o volume do Jev Flow deve ficar 2 ordens abaixo',
      'batch: N perguntas independentes numa chamada; cache sha256(state+pergunta) reutiliza sem culpa',
    ],
  },

  operacao: {
    regras: [
      'fail-open: Jev indisponível nunca derruba o fluxo — degrada para o caminho anterior',
      'custo visível: toda chamada loga usage (data/jev/usage.jsonl) e decisão (router-log.jsonl)',
      'dados sensíveis vão para API terceira — não mande segredo/PII no state',
      'PII: julgamento sobre texto do usuário requer o mesmo cuidado do guardrail (não-vazamento)',
    ],
  },
};

/** Digest compacto para system-prompt do LLM desenhista (forge.mjs). */
export function designGuidelinesMarkdown() {
  const k = JEV_KNOWLEDGE;
  const linhas = (arr) => arr.map(r => `- ${r}`).join('\n');
  return `# Como desenhar jevlets (julgamentos Jev) — conhecimento ${k.version}

## O modelo
${k.modelo.o_que_e}
NÃO use para: ${k.modelo.o_que_nao_e}

## Primitivas (respostas que você vai receber)
- choice: ${k.primitivas.choice.quando}. Regras:
${linhas(k.primitivas.choice.regras)}
- noul: ${k.primitivas.noul.quando}. Regras:
${linhas(k.primitivas.noul.regras)}
- score: ${k.primitivas.score.quando}. Regras:
${linhas(k.primitivas.score.regras)}

## Confiança
${k.confianca.significado}. ${k.confianca.uso}

## Estado
${linhas(k.estado.regras)}

## Perguntas
${linhas(k.design_de_perguntas.regras)}

## Regras gerais e exceções
${linhas(k.excecoes.regras)}

## Limitações documentadas do modelo (evite desenhar contra elas)
${linhas(k.limitacoes_conhecidas)}

## Padrões oficiais de composição
${linhas(k.composicao.padroes.filter(p => p.includes('cookbook') || p.includes('oficial') || p.includes('taxonomia') || p.includes('Langfuse') || p.includes('LangChain')))}

## Princípio
${k.composicao.principio}`;
}
