// ============================================================================
// Project Import — traz um projeto do PC para o Jev Flow como um grafo
// didático e executável ("entenda este projeto de verdade").
//
// Escaneia a pasta (LEITURA apenas, limitada): stack detectada por marcadores
// (package.json, requirements.txt, Cargo.toml, go.mod, *.csproj, pom.xml),
// scripts do package.json, entradas de topo e candidatos a entry point.
// Desses fatos gera um FLOW CLARO: mapa do projeto → perguntas do usuário são
// classificadas (jev.classify) → roteadas para a fase certa com o comando certo.
//
// Segurança: caminho precisa existir e ser diretório; leitura rasa (nível de
// topo + package.json); nada é executado durante o scan.
// ============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { validateFlow } from './engine.mjs';

const MAX_ENTRIES = 40;
const MAX_SCRIPTS = 6;

function detectStack(dir) {
  const stack = [];
  if (existsSync(join(dir, 'package.json'))) stack.push('node');
  if (existsSync(join(dir, 'requirements.txt')) || existsSync(join(dir, 'pyproject.toml'))) stack.push('python');
  if (existsSync(join(dir, 'Cargo.toml'))) stack.push('rust');
  if (existsSync(join(dir, 'go.mod'))) stack.push('go');
  if (existsSync(join(dir, 'pom.xml')) || existsSync(join(dir, 'build.gradle'))) stack.push('java');
  if (existsSync(join(dir, 'composer.json'))) stack.push('php');
  if (existsSync(join(dir, 'Gemfile'))) stack.push('ruby');
  if (existsSync(join(dir, '*.csproj')) || existsSync(join(dir, '.sln'))) stack.push('dotnet');
  return stack.length ? stack : ['desconhecida'];
}

function topEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => !['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv'].includes(e.name))
      .slice(0, MAX_ENTRIES)
      .map(e => ({ nome: e.name, tipo: e.isDirectory() ? 'pasta' : 'arquivo' }));
  } catch { return []; }
}

function entryCandidates(dir) {
  const candidatos = ['src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts', 'index.js', 'index.ts', 'main.js', 'main.py', 'app.js', 'server.js', 'main.go', 'src/main.py'];
  return candidatos.filter(c => existsSync(join(dir, c))).slice(0, 4);
}

/** Escaneia o projeto (somente leitura) e devolve os fatos estruturados. */
export function scanProject(rawPath) {
  const dir = resolve(String(rawPath || '').trim());
  if (!existsSync(dir)) return { error: `caminho não existe: ${dir}` };
  let isDir = false;
  try { isDir = statSync(dir).isDirectory(); } catch { return { error: 'caminho inacessível' }; }
  if (!isDir) return { error: 'caminho não é um diretório' };

  const stack = detectStack(dir);
  const entries = topEntries(dir);
  let pacote = null;
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try { pacote = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { pacote = null; }
  }
  const scripts = pacote?.scripts ? Object.entries(pacote.scripts).slice(0, MAX_SCRIPTS).map(([cmd, linha]) => ({ cmd, linha: String(linha).slice(0, 140) })) : [];
  return {
    ok: true,
    nome: pacote?.name || basename(dir),
    stack,
    scripts,
    entryCandidates: entryCandidates(dir),
    entries,
    totalDeps: Object.keys(pacote?.dependencies || {}).length,
    totalDevDeps: Object.keys(pacote?.devDependencies || {}).length,
    caminho: dir,
  };
}

/**
 * Gera o flow "entenda este projeto" a partir do scan. Didático por desenho:
 * mapa → classificador JEV da pergunta → roteio para a fase com o comando.
 */
export function buildProjectUnderstandingFlow(scan) {
  if (!scan?.ok) return { error: scan?.error || 'scan falhou' };
  const areas = ['estrutura', ...scan.scripts.map(s => s.cmd).slice(0, 4), 'arquivos'];
  const nodes = {
    mapa: {
      type: 'rule.extract',
      paths: {
        projeto: `Projeto ${scan.nome}`,
        stack: `Stack: ${scan.stack.join(' + ')}`,
        dependencias: `${scan.totalDeps} deps · ${scan.totalDevDeps} devDeps`,
        entrada: scan.entryCandidates[0] || scan.entry || '—',
      },
      next: 'explicar-estrutura',
    },
    'explicar-estrutura': {
      type: 'action.log',
      texto: `Projeto ${scan.nome} (${scan.stack.join('+')}). Pastas/arquivos de topo: ${scan.entries.slice(0, 10).map(e => e.nome).join(', ')}.`,
      next: 'scripts',
    },
    scripts: {
      type: 'action.log',
      texto: scan.scripts.length
        ? `Comandos: ${scan.scripts.map(s => `npm run ${s.cmd} → ${s.linha}`).join(' | ')}`
        : 'Sem scripts npm declarados — projeto sem build ou de outra stack.',
      next: 'classificar-pergunta',
    },
    'classificar-pergunta': {
      type: 'jev.classify',
      texto: '{{input.pergunta}}',
      categorias: areas,
      next: 'rotear',
    },
    rotear: {
      type: 'flow.if',
      // A concentração do Choice sinaliza ambiguidade entre áreas, não acerto factual.
      when: '{{classificar-pergunta.precisa_revisao}} == false',
      then: 'responder',
      else: 'sem-certeza',
    },
    responder: {
      type: 'action.log',
      texto: 'Área sugerida: {{classificar-pergunta.categoria}}. Confira a fase correspondente no mapa do projeto.',
      next: null,
    },
    'sem-certeza': {
      type: 'action.log',
      texto: 'A pergunta ficou ambígua entre áreas do projeto — reformule citando estrutura, scripts ou arquivos.',
      next: null,
    },
  };
  const flow = {
    id: `projeto-${slug(scan.nome)}`.slice(0, 41),
    name: `Entenda: ${scan.nome}`,
    description: `Mapa didático e executável do projeto ${scan.nome} — stack ${scan.stack.join('+')}, ${scan.scripts.length} script(s). Pergunte (input.pergunta) e o JEV roteia para a fase certa. Fonte: ${scan.caminho}.`,
    input_schema: { pergunta: 'string — sua pergunta sobre o projeto' },
    limits: { maxSteps: 10, maxJevCalls: 2, maxInputTokens: 8000 },
    tags: ['projeto-importado', `stack:${scan.stack[0]}`],
    start: 'mapa',
    nodes,
  };
  const validacao = validateFlow(flow);
  return { flow, validacao, resumo: { nome: scan.nome, stack: scan.stack, scripts: scan.scripts, entries: scan.entries.length, entryCandidates: scan.entryCandidates } };
}

function slug(s) {
  return String(s || 'projeto').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'projeto';
}

/** Conveniência: escaneia E gera de uma vez, com validação obrigatória. */
export function importProjectAsFlow(rawPath, { install = false } = {}) {
  const scan = scanProject(rawPath);
  if (!scan.ok) return { error: scan.error };
  const r = buildProjectUnderstandingFlow(scan);
  if (r.error) return { error: r.error };
  if (!r.validacao.ok) return { error: `fluxo gerado inválido: ${r.validacao.errors[0]?.codigo}`, detalhes: r.validacao.errors.slice(0, 5) };
  if (install) {
    try {
      // saveFlow direto no catálogo do usuário
      return import('./engine.mjs').then(({ saveFlow }) => {
        saveFlow(r.flow);
        return { ok: true, instalado: true, ...r };
      });
    } catch (e) { return { error: e.message }; }
  }
  return { ok: true, ...r };
}
