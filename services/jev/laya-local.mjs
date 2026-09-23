// ============================================================================
// Laya Local — o julgamento JEV rodando LOCALMENTE, determinístico e $0.
//
// O Laya (convaiinnovations/laya, Apache-2.0) é um modelo System One: state +
// perguntas tipadas (noul/choice/score) → respostas tipadas com probabilidades
// em UMA passada forward, sem gerar texto. O pacote pip fala O MESMO contrato
// do System One remoto da TypeSafe — então este módulo expõe um cliente com a
// MESMA interface do JevClient (`ask({state, questions})` → {model, answers,
// usage, ...}) e a fábrica `criarClienteJev` encadeia os dois:
//
//   hierarquia de custo da casa, agora com 3 degraus:
//     1. DETERMINÍSTICO ($0)      — evidência sozinha prova a decisão
//     2. LAYA LOCAL ($0, offline) — zona cinzenta, sem rede e sem chave
//     3. JEV REMOTO (~$0.00004)   — quando há TYPESAFE_API_KEY (calibrado RLCD)
//
// Modo via env LAYA_LOCAL:
//   'auto'   (padrão) — remoto primeiro (calibrado), Laya no fallback;
//                       sem chave, Laya direto
//   'prefer'          — Laya primeiro (operação 100% offline/$0), remoto cai
//                       para trás
//   'off'             — comportamento de antes: só remoto
//
// O binário Python é descoberto uma única vez (env LAYA_PYTHON sobrepõe) — o
// primeiro `python` do PATH pode ser um venv sem o laya instalado.
// ============================================================================

import { spawn } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JevClient, JEV_DATA_DIR, isJevConfigured } from './client.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BRIDGE_PATH = join(REPO_ROOT, 'scripts', 'laya_bridge.py');

export const LAYA_MODEL_PADRAO = process.env.LAYA_MODEL || 'convaiinnovations/laya-multilingual';
export const LAYA_METRIC_VERSION = 'top-label-ece-v1';
export const LAYA_CHECKPOINT_ALGORITHM = 'sha256-weights-config-tokenizer-v3';
export const LAYA_TIMEOUT_MS = Number(process.env.LAYA_TIMEOUT_MS || 20_000);
// Boot é a CARGA do modelo (segundos a dezenas de segundos em CPU) — não tem
// a ver com a latência de inferência; por isso timeout próprio.
export const LAYA_BOOT_TIMEOUT_MS = Number(process.env.LAYA_BOOT_TIMEOUT_MS || 120_000);

// Modelo ATIVO: env > registro do aprendizado por reforço (data/jev/
// laya-model.json, escrito pelo laya-aprender.mjs) > multilingual. Lido a cada
// chamada — o modelo promovido entra sem restart.
const REGISTRO_MODELO_PATH = join(JEV_DATA_DIR, 'laya-model.json');
export function resolverModeloLaya({ env = null, registro = null, existe = () => true } = {}) {
  if (env) return env;
  try {
    const ativo = typeof registro === 'string' ? JSON.parse(registro)?.ativo : registro?.ativo;
    if (ativo) {
      const caminho = join(REPO_ROOT, ativo);
      if (existe(caminho)) return caminho;
    }
  } catch { /* registro ilegível — cai para o padrão */ }
  return 'convaiinnovations/laya-multilingual';
}

export function modeloLayaPadrao() {
  let registro = null;
  try { registro = readFileSync(REGISTRO_MODELO_PATH, 'utf8'); } catch { /* ausente */ }
  return resolverModeloLaya({ env: process.env.LAYA_MODEL || null, registro, existe: existsSync });
}

const weightFile = /\.(?:safetensors|bin|pt|pth|gguf)$/i;
const behaviorFile = /^(?:rl_agent_config\.json|config\.json|tokenizer(?:_config)?\.json|special_tokens_map\.json|added_tokens\.json|vocab(?:\..+)?|merges\.txt|spiece\.model|sentencepiece(?:\.bpe)?\.model)$/i;
const fingerprintCache = new Map();

/** Hash weight bytes and the behavior config, independent of a directory rename. */
export function fingerprintLayaCheckpoint(modelPath) {
  try {
    const root = realpathSync(resolve(String(modelPath || '')));
    if (!statSync(root).isDirectory()) return null;
    const behaviorConfig = join(root, 'rl_agent_config.json');
    if (!statSync(behaviorConfig).isFile()) return null;
    const config = JSON.parse(readFileSync(behaviorConfig, 'utf8'));
    if (typeof config?.encoder !== 'string' || !config.encoder) return null;
    const encoderRoot = join(root, 'encoder');
    const tokenizerRoot = join(root, 'tokenizer');
    if (!statSync(join(root, 'model.safetensors')).isFile()
        || !statSync(join(encoderRoot, 'config.json')).isFile()
        || !statSync(tokenizerRoot).isDirectory()) return null;
    const files = [];
    const visit = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile() && (weightFile.test(entry.name) || behaviorFile.test(entry.name)
            || path.startsWith(encoderRoot + sep) || path.startsWith(tokenizerRoot + sep))) files.push(path);
      }
    };
    visit(root);
    if (!files.some(path => path.startsWith(tokenizerRoot + sep) && behaviorFile.test(path.split(sep).at(-1))))
      return null;
    files.sort((a, b) => {
      const left = relative(root, a).split(sep).join('/');
      const right = relative(root, b).split(sep).join('/');
      return left < right ? -1 : left > right ? 1 : 0;
    });
    const signature = files.map(path => {
      const info = statSync(path);
      return `${relative(root, path)}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    }).join('|');
    const cached = fingerprintCache.get(root);
    if (cached?.signature === signature) return cached.sha256;
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
    for (const path of files) {
      hash.update(relative(root, path).split(sep).join('/'), 'utf8');
      hash.update(Buffer.from([0]));
      const fd = openSync(path, 'r');
      try {
        let count;
        while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0)
          hash.update(buffer.subarray(0, count));
      } finally { closeSync(fd); }
      hash.update(Buffer.from([0]));
    }
    const sha256 = hash.digest('hex');
    fingerprintCache.set(root, { signature, sha256 });
    return sha256;
  } catch { return null; }
}

export function modoLaya() {
  const m = String(process.env.LAYA_LOCAL || 'auto').toLowerCase();
  return ['auto', 'prefer', 'off'].includes(m) ? m : 'auto';
}

// --- Descoberta do Python com laya instalado (cacheada) ---------------------
let pythonCacheado; // undefined = ainda não descobriu; null = não há

function spawnQuiet(cmd, args, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    let filho;
    try {
      filho = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return resolve(null);
    }
    let stdout = '';
    filho.stdout?.on('data', (d) => { stdout += d; });
    const timer = setTimeout(() => { try { filho.kill(); } catch {} resolve(null); }, timeoutMs);
    filho.on('error', () => { clearTimeout(timer); resolve(null); });
    filho.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? stdout : null); });
  });
}

async function temLaya(cmd, args) {
  const out = await spawnQuiet(cmd, [...args, '-c', 'import laya'], { timeoutMs: 8000 });
  return out !== null;
}

async function instalarViaLauncherPy() {
  // `py -3` pode apontar para um Python 3.x sem o laya — o launcher lista
  // TODOS os instalados com -0p; testar cada um até achar o com laya.
  if (process.platform !== 'win32') return [];
  const listagem = await spawnQuiet('py', ['-0p'], { timeoutMs: 6000 });
  if (!listagem) return [];
  const caminhos = [...listagem.matchAll(/([A-Za-z]:\\[^\r\n]*python\.exe)/gi)].map((m) => m[1]);
  return [...new Set(caminhos)].map((cmd) => ({ cmd, args: [] }));
}

async function candidatosPython() {
  const diretos = [
    ...(process.env.LAYA_PYTHON ? [{ cmd: process.env.LAYA_PYTHON, args: [] }] : []),
    { cmd: 'python', args: [] },
    { cmd: 'python3', args: [] },
    { cmd: 'py', args: process.platform === 'win32' ? ['-3'] : [] },
  ];
  return [...diretos, ...(await instalarViaLauncherPy())];
}

export async function pythonComLaya() {
  if (pythonCacheado !== undefined) return pythonCacheado;
  for (const cand of await candidatosPython()) {
    if (await temLaya(cand.cmd, cand.args)) {
      pythonCacheado = cand;
      return pythonCacheado;
    }
  }
  pythonCacheado = null;
  return null;
}

export function isLayaDisponivelSync() {
  return modoLaya() !== 'off' && existsSync(BRIDGE_PATH);
}

/** Estado seguro para onboarding: não executa inferência nem instala nada. */
export function statusLayaLocal() {
  const modo = modoLaya();
  const modelo = modeloLayaPadrao();
  const calibracao = statusCalibracaoLaya({ model: modelo });
  return {
    modo,
    modelo,
    ponte: existsSync(BRIDGE_PATH),
    python_configurado: Boolean(process.env.LAYA_PYTHON),
    disponivel: modo !== 'off' && existsSync(BRIDGE_PATH),
    estado: modo === 'off' ? 'off' : (existsSync(BRIDGE_PATH)
      ? calibracao.noulVerificado ? 'validated-noul-only'
        : calibracao.registroCalibracao ? 'record-present-quality-unverified' : 'discovered-un-calibrated'
      : 'unavailable'),
    ...calibracao,
  };
}

/** Descoberta explícita para o botão de diagnóstico do onboarding. */
export async function descobrirLaya() {
  const python = await pythonComLaya();
  const status = statusLayaLocal();
  return { ...status, python: python?.cmd || null,
    disponivel: Boolean(python && isLayaDisponivelSync()),
    estado: python && isLayaDisponivelSync() ? status.estado : 'unavailable' };
}

/** Aquece o sidecar somente quando o usuário pede; nunca instala dependências. */
export async function aquecerLaya({ timeoutMs = LAYA_BOOT_TIMEOUT_MS } = {}) {
  if (modoLaya() === 'off') throw new Error('LAYA_LOCAL está desligado');
  const sidecar = sidecarLaya({ model: modeloLayaPadrao(), bootTimeoutMs: timeoutMs });
  await sidecar.boot();
  return { ...await descobrirLaya(), aquecido: true };
}

// --- Calibration records are advisory until weight identity and validation pass.
const CALIBRACAO_PATH = join(JEV_DATA_DIR, 'laya-calibration.json');
let calibracaoCache;

export function carregarCalibracao({ force = false } = {}) {
  if (calibracaoCache === undefined || force) {
    try {
      calibracaoCache = existsSync(CALIBRACAO_PATH) && process.env.LAYA_NO_CALIBRACAO !== '1'
        ? JSON.parse(readFileSync(CALIBRACAO_PATH, 'utf8'))
        : null;
    } catch {
      calibracaoCache = null;
    }
  }
  return calibracaoCache;
}

function validHoldout(holdout) {
  return Number.isInteger(holdout?.n) && holdout.n >= 20
    && ['ece_antes', 'ece_depois', 'acuracia_antes', 'acuracia_depois']
      .every(key => Number.isFinite(holdout[key]) && holdout[key] >= 0 && holdout[key] <= 1)
    && holdout.ece_depois <= holdout.ece_antes + 1e-9
    && holdout.acuracia_depois + 1e-9 >= holdout.acuracia_antes;
}

/** A record alone never licenses a temperature or indecision threshold. */
export function avaliarCalibracaoLaya(cal, { model = modeloLayaPadrao(), fingerprint = fingerprintLayaCheckpoint } = {}) {
  const denied = reason => ({ recordPresent: Boolean(cal), noulVerified: false,
    reason, permittedOverrides: null });
  if (!cal) return denied('record-missing');
  if (cal.metric_version !== LAYA_METRIC_VERSION) return denied('metric-version-missing-or-unsupported');
  if (cal.checkpoint?.algorithm !== LAYA_CHECKPOINT_ALGORITHM
      || !/^[a-f0-9]{64}$/i.test(String(cal.checkpoint?.sha256 || '')))
    return denied('checkpoint-identity-missing');
  const activeHash = fingerprint(model);
  if (!activeHash || activeHash.toLowerCase() !== cal.checkpoint.sha256.toLowerCase())
    return denied('checkpoint-identity-unverified');
  if (!validHoldout(cal.validacao?.real) || !validHoldout(cal.validacao?.sintetico_holdout))
    return denied('validation-missing-or-degrading');
  const noul = cal.temperaturas?.noul;
  if (!Number.isFinite(noul) || noul <= 0 || noul > 100)
    return denied('temperature-invalid');
  // Score/Choice need their own type-specific holdout, which this record lacks.
  return { recordPresent: true, noulVerified: true, reason: 'validated-noul-only',
    permittedOverrides: { noul } };
}

export function statusCalibracaoLaya({ model = modeloLayaPadrao(), fingerprint = fingerprintLayaCheckpoint } = {}) {
  const cal = carregarCalibracao();
  const decision = avaliarCalibracaoLaya(cal, { model, fingerprint });
  if (!cal) return { calibrado: false, noulVerificado: false, registroCalibracao: false,
    qualidadeVerificada: false, motivoCalibracao: decision.reason,
    temperaturasPermitidas: decision.permittedOverrides };
  return {
    calibrado: false,
    noulVerificado: decision.noulVerified,
    registroCalibracao: true,
    qualidadeVerificada: false,
    motivoCalibracao: decision.reason,
    temperaturasPermitidas: decision.permittedOverrides,
    metric_version: cal.metric_version || null,
    checkpoint: cal.checkpoint || null,
    medidoEm: cal.medidoEm,
    temperaturas: cal.temperaturas,
    por_pergunta: cal.por_pergunta,
    validacao: cal.validacao,
  };
}

/** Marca respostas de perguntas medidas com _calibracao {limiar, indeciso}. */
export function marcarIndecisao(resposta, cal = carregarCalibracao(),
  { model = modeloLayaPadrao(), fingerprint = fingerprintLayaCheckpoint } = {}) {
  if (!avaliarCalibracaoLaya(cal, { model, fingerprint }).noulVerified) return resposta;
  const porPergunta = cal?.por_pergunta || {};
  for (const [id, a] of Object.entries(resposta?.answers || {})) {
    const medido = porPergunta[id];
    const p = Number(a?.noul);
    if (!medido || !Number.isFinite(p)) continue;
    a._calibracao = {
      limiar: medido.limiar,
      indeciso: p > 1 - medido.limiar && p < medido.limiar,
      abstem: Boolean(medido.abstem),
      medidoEm: cal.medidoEm,
    };
  }
  return resposta;
}

function temIndeciso(resposta) {
  return Object.values(resposta?.answers || {}).some((a) => a?._calibracao?.indeciso === true);
}

/** Testes: injeta/anula a calibração sem tocar o arquivo. */
export function definirCalibracaoLaya(cal) {
  calibracaoCache = cal;
}

// --- Transporte: um processo por pergunta (fallback; sem daemon) ------------
export function askLaya({ state, questions }, { python = null, timeoutMs = LAYA_TIMEOUT_MS, model = modeloLayaPadrao() } = {}) {
  return new Promise(async (resolve, reject) => {
    const py = python || (await pythonComLaya());
    if (!py) return reject(new Error('nenhum Python com o pacote laya instalado (pip install laya; defina LAYA_PYTHON se ficar fora do PATH)'));
    if (!existsSync(BRIDGE_PATH)) return reject(new Error(`ponte ausente: ${BRIDGE_PATH}`));

    let filho;
    try {
      filho = spawn(py.cmd, [...py.args, BRIDGE_PATH, '--model', model], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(err);
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { filho.kill(); } catch {}
      reject(new Error(`Laya timeout após ${timeoutMs}ms`));
    }, timeoutMs);

    filho.stdout.on('data', (d) => { stdout += d; });
    filho.stderr.on('data', (d) => { stderr += d; });
    filho.on('error', (err) => { clearTimeout(timer); reject(err); });
    filho.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`laya_bridge saiu ${code}: ${(stderr || stdout).trim().slice(0, 300)}`));
      }
      try {
        const parsed = JSON.parse(stdout.trim().split('\n').pop());
        if (!parsed?.answers) return reject(new Error('resposta do laya sem answers'));
        resolve(parsed);
      } catch (err) {
        reject(new Error(`laya_bridge retornou algo não-JSON: ${String(stdout).slice(0, 120)}`));
      }
    });

    try {
      filho.stdin.write(JSON.stringify({ state, questions }));
      filho.stdin.end();
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

// --- Sidecar persistente: carrega o modelo UMA vez, atende por linha ---------
// A inferência depois de quente é de centenas de ms; carregar o modelo a cada
// gate custaria ~15s. Um processo vive enquanto o Jev Flow vive; se morrer, o
// próximo ask o ressuscita. Pedidos são serializados (1 em voo) — inferência
// local é rápida e o gate não precisa de paralelismo.
class LayaSidecar {
  constructor({ python = null, model = modeloLayaPadrao(), bootTimeoutMs = LAYA_BOOT_TIMEOUT_MS } = {}) {
    this.python = python;          // resolvido na 1ª utilização
    this.model = model;
    this.bootTimeoutMs = bootTimeoutMs;
    this.filho = null;
    this.fila = Promise.resolve();
    this.seq = 0;
    this.pendentes = new Map();    // id -> {resolve, reject, timer}
  }

  vivo() {
    return this.filho !== null && this.filho.exitCode === null && !this.filho.killed;
  }

  encerrar() {
    for (const { reject, timer } of this.pendentes.values()) {
      clearTimeout(timer);
      reject(new Error('sidecar do Laya reiniciado'));
    }
    this.pendentes.clear();
    if (this.filho) {
      try { this.filho.kill(); } catch {}
      this.filho = null;
    }
  }

  async boot() {
    if (this.vivo()) return;
    this.encerrar();
    const py = this.python || (this.python = await pythonComLaya());
    if (!py) throw new Error('nenhum Python com o pacote laya instalado (pip install laya; defina LAYA_PYTHON se ficar fora do PATH)');
    if (!existsSync(BRIDGE_PATH)) throw new Error(`ponte ausente: ${BRIDGE_PATH}`);

    this.filho = spawn(py.cmd, [...py.args, BRIDGE_PATH, '--serve', '--model', this.model], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.filho.stdout.setEncoding('utf8');
    this.filho.stderr.setEncoding('utf8');
    let stderr = '';
    this.filho.stderr.on('data', (d) => { stderr += d; if (stderr.length > 8000) stderr = stderr.slice(-4000); });
    this.filho.on('exit', () => { this.filho = null; });

    // espera a linha {"ready": true} — modelo carregado e pronto
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.encerrar();
        reject(new Error(`sidecar do Laya não ficou pronto em ${this.bootTimeoutMs}ms`));
      }, this.bootTimeoutMs);
      const onLine = (linha) => {
        try {
          if (JSON.parse(linha)?.ready === true) {
            this.filho.stdout.removeListener('data', onData);
            clearTimeout(timer);
            this.#ligarDespacho();
            resolve();
          }
        } catch { /* linha parcial/ruído */ }
      };
      let buffer = '';
      const onData = (d) => {
        buffer += d;
        const linhas = buffer.split('\n');
        buffer = linhas.pop();
        for (const l of linhas) onLine(l);
      };
      this.filho.stdout.on('data', onData);
      this.filho.on('error', (err) => { clearTimeout(timer); reject(err); });
      this.filho.on('exit', (code) => { clearTimeout(timer); reject(new Error(`sidecar saiu durante o boot (${code}): ${stderr.slice(-300)}`)); });
    });
  }

  #ligarDespacho() {
    let buffer = '';
    this.filho.stdout.on('data', (d) => {
      buffer += d;
      const linhas = buffer.split('\n');
      buffer = linhas.pop();
      for (const l of linhas) {
        if (!l.trim()) continue;
        try {
          const msg = JSON.parse(l);
          const p = this.pendentes.get(msg.id);
          if (p) {
            this.pendentes.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.error) p.reject(new Error(msg.error));
            else p.resolve(msg);
          }
        } catch { /* ruído */ }
      }
    });
  }

  // Serializa: um ask por vez, na ordem de chegada.
  ask({ state, questions }, { timeoutMs = LAYA_TIMEOUT_MS } = {}) {
    const corrida = this.fila.then(() => this.#pedir({ state, questions }, timeoutMs));
    this.fila = corrida.catch(() => {}); // a fila nunca trava por falha alheia
    return corrida;
  }

  async #pedir({ state, questions }, timeoutMs) {
    await this.boot();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendentes.delete(id);
        this.encerrar(); // estado do pipe é incerto após timeout — reiniciar limpo
        reject(new Error(`Laya timeout após ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendentes.set(id, { resolve, reject, timer });
      try {
        this.filho.stdin.write(JSON.stringify({ id, state, questions }) + '\n');
      } catch (err) {
        this.pendentes.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }
}

let SIDECAR = null;
export function sidecarLaya(opts = {}) {
  // modelo mudou (promoção do aprendizado por reforço) → reinicia com o novo
  if (SIDECAR && opts.model && SIDECAR.model !== opts.model) {
    SIDECAR.encerrar();
    SIDECAR = null;
  }
  if (!SIDECAR) SIDECAR = new LayaSidecar(opts);
  return SIDECAR;
}


export function encerrarSidecarLaya() {
  if (SIDECAR) {
    SIDECAR.encerrar();
    SIDECAR = null;
  }
}

// --- Cliente local com a MESMA interface do JevClient ------------------------
export class LayaClient {
  constructor({ model = modeloLayaPadrao(), timeoutMs = LAYA_TIMEOUT_MS, layaImpl = null } = {}) {
    this.model = model;
    this.timeoutMs = Number(timeoutMs) || LAYA_TIMEOUT_MS;
    // layaImpl injetável para testes; na produção, sidecar persistente (modelo
    // carregado uma vez) com fallback one-shot (spawn por pergunta) — se até
    // ele falhar, vale o erro do sidecar, que é o primário.
    this.askImpl = layaImpl || ((args, opts) => {
      const sidecar = sidecarLaya({ model: this.model });
      return sidecar.ask(args, opts).catch((errSidecar) =>
        askLaya(args, { ...opts, model: this.model, timeoutMs: this.timeoutMs }).catch(() => {
          throw errSidecar;
        }),
      );
    });
    this.local = true;
  }
  get configured() {
    // O Python com o laya é confirmado de fato no primeiro ask (descoberta
    // assíncrona); aqui vale a intenção do modo — o chamador já trata falha.
    return isLayaDisponivelSync();
  }
  async ask({ state, questions } = {}) {
    if (!questions || typeof questions !== 'object' || Object.keys(questions).length === 0) {
      throw new Error('questions é obrigatório (mapa id -> pergunta)');
    }
    const started = Date.now();
    const data = await this.askImpl(
      { state, questions },
      { timeoutMs: this.timeoutMs, model: this.model },
    );
    return {
      ...marcarIndecisao(data, carregarCalibracao(), { model: this.model }),
      latencyMs: Date.now() - started,
      costEstimateUsd: 0, // local, offline: o degrau 2 da hierarquia é grátis
      fonte: 'laya-local',
    };
  }
}

// --- Fábrica: a cadeia completa remoto ⇄ local ------------------------------
// `primario` é injetável para testes (um cliente remoto falso, sem rede).
// Retorna null quando NENHUM degrau está disponível — o chamador degrada com
// honestidade (mesmo contrato de antes: `disponivel:false` + default).
export function criarClienteJev({ timeoutMs = 4000, layaTimeoutMs = LAYA_TIMEOUT_MS, primario = null, layaImpl = null } = {}) {
  const modo = modoLaya();
  if (modo === 'off') {
    return isJevConfigured() ? (primario || new JevClient({ timeoutMs })) : null;
  }
  const remoto = primario || (isJevConfigured() ? new JevClient({ timeoutMs }) : null);
  const local = new LayaClient({ timeoutMs: layaTimeoutMs, layaImpl });

  if (modo === 'prefer') {
    return {
      configured: true,
      local: true,
      async ask(args) {
        try {
          const respostaLocal = await local.ask(args);
          // juiz local indeciso numa pergunta medida → escala para o remoto
          if (temIndeciso(respostaLocal) && remoto) {
            const r = await remoto.ask(args);
            return { ...r, escaladoDe: 'laya-local-indeciso' };
          }
          return respostaLocal;
        } catch (errLocal) {
          if (remoto) return remoto.ask(args);
          throw errLocal;
        }
      },
    };
  }
  // 'auto': remoto calibrado primeiro; Laya cobre falha/ausência de chave.
  if (remoto) {
    return {
      configured: true,
      local: false,
      async ask(args) {
        try {
          return await remoto.ask(args);
        } catch (errRemoto) {
          try {
            return await local.ask(args);
          } catch {
            throw errRemoto; // a falha que importa reportar é a do primário
          }
        }
      },
    };
  }
  return local;
}

export { isJevConfigured };
