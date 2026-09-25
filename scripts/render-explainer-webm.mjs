import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEECH_MODELS } from './generate-walkthrough-tts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_LIMIT = 90 * 1024 * 1024;
const ASSETS = Object.freeze({
  'studio-flow': 'jev-flow-explainer-studio-flow-en.png',
  'studio-input': 'jev-flow-explainer-studio-input-en.png',
  'studio-result': 'studio-screenshot.png',
  compendium: 'compendium-screenshot.png',
  arena: 'arena-screenshot.png',
  cart: 'carrinho-screenshot.png',
  labs: 'labs-screenshot.png',
  chess: 'chess-screenshot.png',
});
const VIDEO_SCENES = Object.freeze({
  studio: 'studio.webm',
  compendium: 'compendium.webm',
  arena: 'arena.webm',
  games: 'games.webm',
  chess: 'chess.webm',
  cart: 'cart.webm',
});

export function resolveClipPaths(clipsDir) {
  return clipsDir
    ? Object.fromEntries(Object.entries(VIDEO_SCENES).map(([key, name]) => [key, resolve(clipsDir, name)]))
    : {};
}

export function parseArguments(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return null;
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--input', '--audio-dir', '--output', '--clips-dir'].includes(key) || !args[index + 1] || options[key]) {
      throw new Error('Usage: node scripts/render-explainer-webm.mjs --input dialogue.json --audio-dir audio --output media/explainer.webm [--clips-dir clips]');
    }
    options[key] = resolve(args[index + 1]);
  }
  if (!options['--input'] || !options['--audio-dir'] || !options['--output']) {
    throw new Error('Usage: node scripts/render-explainer-webm.mjs --input dialogue.json --audio-dir audio --output media/explainer.webm [--clips-dir clips]');
  }
  if (extname(options['--output']).toLowerCase() !== '.webm') throw new Error('Video output must use a .webm extension.');
  const output = options['--output'];
  return { input: options['--input'], audioDir: options['--audio-dir'], output,
    clipsDir: options['--clips-dir'] || null,
    captions: output.replace(/\.webm$/iu, '.vtt'), poster: output.replace(/\.webm$/iu, '-poster.png') };
}

export function readWavDuration(wav) {
  const bytes = Buffer.isBuffer(wav) ? wav : Buffer.from(wav);
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Narration audio must be a PCM WAV file.');
  }
  let offset = 12, format = null, dataBytes = null;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > bytes.length) throw new Error('Narration WAV chunk is truncated.');
    if (kind === 'fmt ' && size >= 16) format = {
      encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
      rate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8),
    };
    if (kind === 'data') dataBytes = size;
    offset = start + size + (size % 2);
  }
  if (!format || format.encoding !== 1 || format.channels !== 1 || format.rate !== 24_000 || format.byteRate !== 48_000 || !dataBytes) {
    throw new Error('Narration WAV must be mono 24 kHz 16-bit PCM.');
  }
  return dataBytes / format.byteRate;
}

function readEbmlVint(bytes, offset, identifier = false) {
  if (offset < 0 || offset >= bytes.length) throw new Error('The WebM container is truncated.');
  const first = bytes[offset];
  let marker = 0x80, length = 1;
  while (length <= 8 && !(first & marker)) { marker >>= 1; length++; }
  if (length > 8 || offset + length > bytes.length) throw new Error('The WebM container has an invalid EBML integer.');
  let value = BigInt(identifier ? first : first & (marker - 1));
  for (let index = 1; index < length; index++) value = (value << 8n) | BigInt(bytes[offset + index]);
  return { length, value, unknown: !identifier && value === (1n << BigInt(7 * length)) - 1n };
}

function readEbmlElement(bytes, offset) {
  const id = readEbmlVint(bytes, offset, true);
  const size = readEbmlVint(bytes, offset + id.length);
  const payload = offset + id.length + size.length;
  const valueSize = size.unknown ? null : Number(size.value);
  if (!Number.isSafeInteger(payload) || (valueSize !== null && payload + valueSize > bytes.length)) {
    throw new Error('The WebM container has a truncated EBML element.');
  }
  return { id: Number(id.value), start: offset, idLength: id.length, sizeLength: size.length,
    payload, size: valueSize, unknown: size.unknown };
}

function encodeEbmlSize(value, length) {
  const encodedValue = BigInt(value);
  const marker = 1n << BigInt(7 * length);
  if (encodedValue < 0n || encodedValue >= marker - 1n) throw new Error('The WebM metadata size is too large to index.');
  let remaining = marker | encodedValue;
  const bytes = Buffer.alloc(length);
  for (let index = length - 1; index >= 0; index--) { bytes[index] = Number(remaining & 0xffn); remaining >>= 8n; }
  return bytes;
}

function webmInfo(bytes) {
  if (!Buffer.isBuffer(bytes) || readEbmlElement(bytes, 0).id !== 0x1a45dfa3) {
    throw new Error('The rendered file is not a WebM container.');
  }
  const header = readEbmlElement(bytes, 0);
  const segment = readEbmlElement(bytes, header.payload + header.size);
  if (segment.id !== 0x18538067 || !segment.unknown) throw new Error('The rendered WebM has an unsupported Segment size.');
  let offset = segment.payload;
  while (offset < bytes.length) {
    const element = readEbmlElement(bytes, offset);
    if (element.id === 0x1549a966) return { segment, info: element };
    if (element.unknown || element.size === null) break;
    offset = element.payload + element.size;
  }
  throw new Error('The rendered WebM is missing its Info element.');
}

export function readWebmDuration(bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const { info } = webmInfo(data);
  let offset = info.payload;
  const end = info.payload + info.size;
  let scale = 1_000_000;
  while (offset < end) {
    const child = readEbmlElement(data, offset);
    if (child.id === 0x2ad7b1 && child.size > 0 && child.size <= 8) {
      let value = 0n;
      for (let index = 0; index < child.size; index++) value = (value << 8n) | BigInt(data[child.payload + index]);
      if (value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) scale = Number(value);
    }
    if (child.id === 0x4489 && child.size === 8) return data.readDoubleBE(child.payload) * scale / 1e9;
    if (child.unknown || child.size === null) break;
    offset = child.payload + child.size;
  }
  return null;
}

export function indexWebmDuration(bytes, durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86_400) {
    throw new Error('WebM duration must be a positive, finite value below 24 hours.');
  }
  const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const { info } = webmInfo(source);
  let offset = info.payload;
  const end = info.payload + info.size;
  let scale = 1_000_000;
  let duration = null;
  while (offset < end) {
    const child = readEbmlElement(source, offset);
    if (child.id === 0x2ad7b1 && child.size > 0 && child.size <= 8) {
      let value = 0n;
      for (let index = 0; index < child.size; index++) value = (value << 8n) | BigInt(source[child.payload + index]);
      if (value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) scale = Number(value);
    }
    if (child.id === 0x4489) duration = child;
    if (child.unknown || child.size === null) break;
    offset = child.payload + child.size;
  }
  const ticks = durationSeconds * 1e9 / scale;
  if (!Number.isFinite(ticks)) throw new Error('WebM duration could not be represented.');
  if (duration) {
    if (duration.size !== 8) throw new Error('The WebM Duration element has an unsupported float size.');
    const output = Buffer.from(source);
    output.writeDoubleBE(ticks, duration.payload);
    return output;
  }
  const durationNode = Buffer.alloc(11);
  durationNode.set([0x44, 0x89, 0x88], 0);
  durationNode.writeDoubleBE(ticks, 3);
  const output = Buffer.concat([source.subarray(0, info.payload + info.size), durationNode, source.subarray(info.payload + info.size)]);
  encodeEbmlSize(info.size + durationNode.length, info.sizeLength).copy(output, info.start + info.idLength);
  return output;
}

export function validateProduction(dialogue, manifest, wavs) {
  if (!dialogue || !Array.isArray(dialogue.turns) || !dialogue.turns.length || !Array.isArray(manifest?.turns)) {
    throw new Error('Dialogue JSON and audio manifest are required.');
  }
  if (!SPEECH_MODELS.includes(manifest.model) || manifest.audio?.sample_rate_hz !== 24_000 || manifest.audio?.channels !== 1 || manifest.audio?.bits_per_sample !== 16) {
    throw new Error('Audio manifest does not identify a supported Gemini TTS WAV output.');
  }
  if (manifest.turns.length !== dialogue.turns.length || wavs.length !== dialogue.turns.length) {
    throw new Error('Every dialogue turn must have exactly one WAV.');
  }
  const durations = [];
  dialogue.turns.forEach((turn, index) => {
    const audio = manifest.turns[index];
    const expected = index % 2 === 0 ? { speaker: 'Alex', voice: 'Charon' } : { speaker: 'Maya', voice: 'Kore' };
    if (turn?.speaker !== expected.speaker || turn?.voice !== expected.voice) {
      throw new Error(`Dialogue must alternate Alex/Charon and Maya/Kore at turn ${index + 1}.`);
    }
    if (!turn || typeof turn.text !== 'string' || !turn.text.trim() || typeof turn.scene !== 'string' ||
        audio?.turn !== index + 1 || audio.voice !== turn.voice || audio.speaker !== turn.speaker ||
        audio.file !== `turn-${String(index + 1).padStart(3, '0')}.wav`) {
      throw new Error(`Dialogue/audio manifest mismatch at turn ${index + 1}.`);
    }
    durations.push(readWavDuration(wavs[index]));
  });
  return durations;
}

function timestamp(seconds) {
  const ms = Math.round(seconds * 1000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export function captionChunks(text, limit = 66) {
  const words = String(text).trim().split(/\s+/u);
  const chunks = [];
  let lines = [];
  let line = '';
  const flushLine = () => { if (line) lines.push(line); line = ''; };
  const flushChunk = () => { flushLine(); if (lines.length) chunks.push(lines); lines = []; };
  for (const word of words) {
    if (word.length > limit) throw new Error('A caption word exceeds the safe display width.');
    if (line && `${line} ${word}`.length > limit) {
      flushLine();
      if (lines.length === 2) flushChunk();
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  flushChunk();
  return chunks;
}

export function wrapCaption(text, limit = 66) { return captionChunks(text, limit).flat(); }

export function formatWebVtt(turns, cues) {
  if (!Array.isArray(turns) || !Array.isArray(cues) || turns.length !== cues.length) throw new Error('Caption cues must match the dialogue turns.');
  let cueNumber = 0;
  const blocks = [];
  turns.forEach((turn, index) => {
    const cue = cues[index];
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start) throw new Error(`Invalid caption timing at turn ${index + 1}.`);
    const chunks = captionChunks(turn.text);
    const weights = chunks.map(lines => lines.join(' ').length);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let elapsedWeight = 0;
    chunks.forEach((lines, chunkIndex) => {
      const start = cue.start + (cue.end - cue.start) * elapsedWeight / totalWeight;
      elapsedWeight += weights[chunkIndex];
      const end = cue.start + (cue.end - cue.start) * elapsedWeight / totalWeight;
      cueNumber++;
      blocks.push(`${cueNumber}\n${timestamp(start)} --> ${timestamp(end)}\n${lines.join('\n')}`);
    });
  });
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

const PLAYER_HTML = String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#07111d}canvas{display:block;width:100vw;height:100vh}
</style><canvas width="1920" height="1080" aria-label="Jev Flow deterministic AI explainer"></canvas><script>
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d',{alpha:false});
const W=1920,H=1080,colors={bg:'#07111d',panel:'#0d1a28',line:'#203449',text:'#eff6ff',muted:'#9cb1c3',cyan:'#42d8cb',violet:'#9f8bff',green:'#6be39b',amber:'#ffc66d',red:'#fb8888'};
const images={},videos={};let language='en',state={turn:null,index:0,elapsed:0,progress:0,duration:1,captionVisible:false,captionChunks:[]};
const pt={
'DETERMINISTIC AI · TYPED JUDGMENTS':'IA DETERMINÍSTICA · JULGAMENTOS TIPADOS',
'A better boundary for AI':'Um limite melhor para a IA','Let models judge.':'Deixe o modelo avaliar.','Let code decide what happens next.':'Deixe o código decidir o próximo passo.','A workflow stays inspectable at every step.':'Um fluxo que pode ser inspecionado em cada etapa.',
'Uncertainty stays visible':'A incerteza continua visível','Workflows you can inspect, test, and explain':'Fluxos que você pode inspecionar, testar e explicar','The workflow owns the rules':'O fluxo controla as regras','EXPLICIT INPUT  →  VALIDATED JUDGMENT  →  CODE-OWNED ROUTE':'ENTRADA EXPLÍCITA → JULGAMENTO VALIDADO → ROTA CONTROLADA PELO CÓDIGO','Same validated state + same code policy = the same workflow route.':'Mesmo estado validado e mesma política de código resultam na mesma rota.','A model response is evidence—not a guarantee.':'A resposta do modelo é evidência, não garantia.','Confidence, source, and unknowns remain explicit.':'Confiança, origem e incertezas ficam explícitas.','Retries, budgets, branching, and effects stay under application control.':'Retentativas, limites, desvios e efeitos ficam sob controle da aplicação.',
'JEV FLOW':'JEV FLOW','SYSTEM ONE · BOUNDED COMMON-SENSE JUDGMENTS':'SYSTEM ONE · JULGAMENTOS DELIMITADOS','Jev returns typed judgments':'O Jev retorna julgamentos tipados','Question':'Pergunta','one bounded task':'uma tarefa delimitada','typed answer + probabilities':'resposta tipada + probabilidades','Validator':'Validador','schema + confidence policy':'esquema + política de confiança','Route':'Rota','code-owned':'controlada pelo código','Select among named options':'Escolhe entre opções nomeadas','Estimate whether a condition holds':'Estima se uma condição é verdadeira','Place a case on an ordered scale':'Posiciona um caso em uma escala ordenada','The answer can be wrong, incomplete, or uncertain. It never authorizes an external action.':'A resposta pode estar errada, incompleta ou incerta. Ela nunca autoriza uma ação externa.',
'Optional local inference adapter':'Adaptador opcional de inferência local','LOCAL MODEL · USER-OWNED INSTALLATION':'MODELO LOCAL · INSTALAÇÃO DA EQUIPE','Python + compatible checkpoint':'Python + checkpoint compatível','The project does not bundle or silently download model weights.':'O projeto não inclui nem baixa pesos de modelo sem aviso.','Local execution changes deployment trade-offs; it does not make a model certain.':'A execução local muda as escolhas de implantação; não torna o modelo infalível.',
'A live provider is an explicit choice':'O provedor ao vivo é uma escolha explícita','Report only measurements the provider returned':'Mostre apenas medidas retornadas pelo provedor','LIVE MODE · EXPLICIT CONFIGURATION':'MODO AO VIVO · CONFIGURAÇÃO EXPLÍCITA','SOURCE · MODEL · LATENCY · USAGE · COST':'ORIGEM · MODELO · LATÊNCIA · USO · CUSTO','provider + model + key':'provedor + modelo + chave','one measured request':'uma chamada medida','returned source + usage':'origem e uso retornados','No key? No call. Unknown usage? Keep it unknown.':'Sem chave, não há chamada. Uso desconhecido continua desconhecido.','A local fixture preview must remain labeled as a simulation.':'Uma prévia com fixture local deve ser identificada como simulação.',
'THE STUDIO':'O ESTÚDIO','A visual flow, with every branch visible.':'Um fluxo visual, com todos os desvios visíveis.','EDIT THE INPUT':'EDITE A ENTRADA','A synthetic support request and fixed typed answers.':'Solicitação de suporte fictícia e respostas tipadas fixas.','FIXTURE PREVIEW':'PRÉVIA COM FIXTURE','No provider call. The input is not sent to Jev.':'Sem chamada ao provedor. A entrada não é enviada ao Jev.','REPLAYABLE ROUTE':'ROTA REPRODUZÍVEL','judge → route → billing_gate → standard':'judge → route → billing_gate → standard','STEP-BY-STEP TRACE':'RASTREAMENTO ETAPA A ETAPA','Inspect the output beside each node.':'Inspecione a saída ao lado de cada nó.','JEV FLOW COMPENDIUM':'COMPENDIUM JEV FLOW','388,080 generated configurations—not model calls.':'388.080 configurações geradas — não chamadas de modelo.','BATTLE ARENA':'ARENA DE BATALHA','A fair comparison needs two real, configured responses.':'Uma comparação justa exige duas respostas reais e configuradas.','LOCAL LABS':'LABS LOCAIS','Chess and game rules run in local code.':'As regras do xadrez e dos jogos rodam em código local.','SELF-DRIVING SIMULATION':'SIMULADOR AUTÔNOMO','The simulator creates obstacle state and sensor features.':'O simulador cria os obstáculos e os dados dos sensores.','NO CAMERA PIPELINE':'SEM SISTEMA DE CÂMERA','Image perception needs a separate vision model.':'A percepção de imagem exige um modelo de visão separado.',
'CAPTURED LIVE RUN':'EXECUÇÃO AO VIVO GRAVADA','SYNTHETIC FIXTURE · NO PROVIDER CALL':'FIXTURE SINTÉTICA · SEM CHAMADA AO PROVEDOR','GENERATED CATALOG · ON-DEMAND CONFIGURATIONS':'CATÁLOGO GERADO · CONFIGURAÇÕES SOB DEMANDA','LOCAL GAME RULES · NO MODEL CALL':'REGRAS LOCAIS DO JOGO · SEM CHAMADA AO MODELO','LEGAL-MOVE VALIDATION · LOCAL RULES':'VALIDAÇÃO DE LANCES LEGAIS · REGRAS LOCAIS','STRUCTURED SIMULATOR STATE · NO CAMERA VISION':'ESTADO ESTRUTURADO DO SIMULADOR · SEM VISÃO POR CÂMERA',
'Same request · Jev typed judgment · LLM text response':'Mesma solicitação · julgamento tipado do Jev · resposta textual do LLM'
};
function localize(value){return language==='pt-BR'?(pt[value]||value):value}
function rounded(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.5;ctx.stroke();}}
function text(s,x,y,size,color,weight='500',font='Segoe UI,Arial,sans-serif'){ctx.font=weight+' '+size+'px '+font;ctx.fillStyle=color;ctx.fillText(localize(s),x,y);}
function wrap(s,max,fontSize,weight='600'){ctx.font=weight+' '+fontSize+'px Segoe UI,Arial,sans-serif';const out=[];let line='';for(const word of s.split(/\s+/)){const next=line?line+' '+word:word;if(ctx.measureText(next).width>max&&line){out.push(line);line=word}else line=next}if(line)out.push(line);return out}
function label(s,x,y,color=colors.cyan){ctx.fillStyle=color;ctx.font='700 14px ui-monospace,Consolas,monospace';ctx.fillText(localize(s).toUpperCase(),x,y)}
function panel(x,y,w,h,title,kicker,accent=colors.cyan){rounded(x,y,w,h,18,colors.panel,colors.line);label(kicker,x+24,y+31,accent);text(title,x+24,y+76,24,colors.text,'650');}
function node(x,y,w,h,title,sub,accent=colors.cyan){rounded(x,y,w,h,14,'#102235',accent);ctx.fillStyle=accent;ctx.fillRect(x,y,5,h);text(title,x+24,y+36,19,colors.text,'650');text(sub,x+24,y+65,14,colors.muted,'500','ui-monospace,Consolas,monospace');}
function arrow(x1,y1,x2,y2,color=colors.cyan){ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();const a=Math.atan2(y2-y1,x2-x1);ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-13*Math.cos(a-.45),y2-13*Math.sin(a-.45));ctx.lineTo(x2-13*Math.cos(a+.45),y2-13*Math.sin(a+.45));ctx.closePath();ctx.fillStyle=color;ctx.fill()}
function grid(){ctx.fillStyle=colors.bg;ctx.fillRect(0,0,W,H);ctx.strokeStyle='#102133';ctx.lineWidth=1;for(let x=0;x<W;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}for(let y=0;y<H;y+=48){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}const gradient=ctx.createRadialGradient(W*.6,H*.35,20,W*.6,H*.35,900);gradient.addColorStop(0,'#11243a99');gradient.addColorStop(1,'#07111d00');ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H)}
function drawHeader(turn){rounded(36,28,W-72,50,12,'#0b1724','#1d3044');text('JEV FLOW',58,60,17,colors.text,'750');text('DETERMINISTIC AI · TYPED JUDGMENTS',178,60,13,colors.muted,'600','ui-monospace,Consolas,monospace');text(String(state.index+1).padStart(2,'0')+' / '+String(turns.length).padStart(2,'0'),W-120,60,13,colors.cyan,'700','ui-monospace,Consolas,monospace')}
let turns=[];
function drawDiagram(scene,t){
  const anim=Math.min(1,t/1.2),glow=.5+.5*Math.sin(t*3);
  const clip=videos[scene];
  if(clip){
    ctx.fillStyle=colors.bg;ctx.fillRect(0,0,W,H);ctx.save();ctx.beginPath();ctx.roundRect(32,24,W-64,H-48,20);ctx.clip();
    if(clip.readyState>=2)ctx.drawImage(clip,32,24,W-64,H-48);else{ctx.fillStyle='#0d1a28';ctx.fillRect(32,24,W-64,H-48)}ctx.restore();
    const sceneCopy={studio:['THE STUDIO','SYNTHETIC FIXTURE · NO PROVIDER CALL'],compendium:['COMPENDIUM','GENERATED CATALOG · ON-DEMAND CONFIGURATIONS'],arena:['BATTLE ARENA','CAPTURED LIVE RUN'],games:['GAMES','LOCAL GAME RULES · NO MODEL CALL'],chess:['CHESS LAB','LEGAL-MOVE VALIDATION · LOCAL RULES'],cart:['SELF-DRIVING SIM','STRUCTURED SIMULATOR STATE · NO CAMERA VISION']}[scene];
    if(sceneCopy){rounded(55,38,575,76,12,'#06111de8','#284259');label('JEV FLOW · '+sceneCopy[0],75,65,colors.cyan);text(sceneCopy[1],75,94,13,colors.text,'650','ui-monospace,Consolas,monospace')}
    return;
  }
  if(scene==='opening'){
    label('A better boundary for AI',108,196,colors.violet);text('Let models judge.',105,322,70,colors.text,'720');text('Let code decide what happens next.',108,408,38,colors.cyan,'620');
    rounded(112,520,760,176,20,'#0f2031','#25435b');node(145,557,210,104,'Typed input','validated JSON',colors.cyan);arrow(372,609,468,609,colors.violet);node(492,557,340,104,'Jev judgment','structured evidence',colors.violet);
    text('A workflow stays inspectable at every step.',112,767,22,colors.muted,'500');
  }else if(['deterministic','uncertainty','architecture','workflow','observability','closing'].includes(scene)){
    const title=scene==='uncertainty'?'Uncertainty stays visible':scene==='closing'?'Workflows you can inspect, test, and explain':scene==='observability'?'Keep every decision observable':'The workflow owns the rules';
    panel(90,145,1740,670,title,'EXPLICIT INPUT  →  VALIDATED JUDGMENT  →  CODE-OWNED ROUTE',scene==='uncertainty'?colors.amber:colors.cyan);
    node(145,286,300,122,'Application state','known facts + user input',colors.cyan);arrow(468,347,610,347,colors.violet);
    node(636,286,342,122,'Typed model answer','choice · noul · score',colors.violet);arrow(1000,347,1140,347,colors.green);
    node(1165,286,280,122,'Policy gate','schema + threshold',colors.green);arrow(1468,347,1580,347,colors.cyan);
    node(1605,286,178,122,'Branch','code',colors.cyan);
    rounded(150,516,1600,172,18,'#0a1622','#1b3045');
    text(scene==='uncertainty'?'A model response is evidence—not a guarantee.':'Same validated state + same code policy = the same workflow route.',190,574,25,colors.text,'600');
    text(scene==='uncertainty'?'Confidence, source, and unknowns remain explicit.':'Retries, budgets, branching, and effects stay under application control.',190,628,19,colors.muted,'500');
    if(scene==='closing'){text('Jev Flow',1480,735,38,colors.violet,'750')}
  }else if(['jev','typed-judgments','policy-boundary','model-roles'].includes(scene)){
    const title=scene==='model-roles'?'Give each model one clear job':scene==='policy-boundary'?'Evidence enters. Code controls effects.':'Jev returns typed judgments';
    panel(92,145,1736,668,title,'SYSTEM ONE · BOUNDED COMMON-SENSE JUDGMENTS',colors.violet);
    node(140,290,300,124,'Question','one bounded task',colors.violet);arrow(458,352,570,352);
    node(598,290,336,124,'Jev','typed answer + probabilities',colors.cyan);arrow(952,352,1064,352,colors.green);
    node(1090,290,330,124,'Validator','schema + confidence policy',colors.green);arrow(1438,352,1546,352,colors.amber);
    node(1570,290,205,124,'Route','code-owned',colors.amber);
    const items=[['Choice','Select among named options'],['Noul','Estimate whether a condition holds'],['Score','Place a case on an ordered scale']];
    items.forEach((item,i)=>{const x=148+i*534;rounded(x,500,490,138,14,'#101e2e','#293d52');label(item[0],x+20,532,[colors.cyan,colors.violet,colors.green][i]);text(item[1],x+20,579,17,colors.text,'520')});
    text('The answer can be wrong, incomplete, or uncertain. It never authorizes an external action.',148,710,18,colors.muted,'500');
  }else if(scene==='laya'){
    panel(92,145,1736,668,'Optional local inference adapter','LOCAL MODEL · USER-OWNED INSTALLATION',colors.green);
    node(152,300,330,146,'Jev Flow','typed workflow + validation',colors.cyan);arrow(500,373,700,373,colors.green);
    node(730,300,390,146,'Laya adapter','Python + compatible checkpoint',colors.green);arrow(1140,373,1320,373,colors.violet);
    node(1350,300,380,146,'Local model','hardware + latency trade-offs',colors.violet);
    text('The project does not bundle or silently download model weights.',152,560,24,colors.text,'600');text('Local execution changes deployment trade-offs; it does not make a model certain.',152,615,18,colors.muted,'500');
  }else if(scene==='live-setup'||scene==='honest-metrics'){
    panel(92,145,1736,668,scene==='live-setup'?'A live provider is an explicit choice':'Report only measurements the provider returned',scene==='live-setup'?'LIVE MODE · EXPLICIT CONFIGURATION':'SOURCE · MODEL · LATENCY · USAGE · COST',colors.amber);
    node(155,300,350,140,'1 · Configure','provider + model + key',colors.amber);arrow(525,370,710,370,colors.cyan);
    node(740,300,350,140,'2 · Run live','one measured request',colors.cyan);arrow(1110,370,1290,370,colors.green);
    node(1320,300,420,140,'3 · Inspect','returned source + usage',colors.green);
    rounded(155,520,1585,150,16,'#151d26','#4b4230');text('No key? No call. Unknown usage? Keep it unknown.',190,578,24,colors.text,'620');text('A local fixture preview must remain labeled as a simulation.',190,624,18,colors.muted,'500');
  }else{
    const left=scene==='studio-graph'?'studio-flow':scene==='studio-input'||scene==='fixture-provenance'?'studio-input':scene==='studio-route'||scene==='studio-trace'?'studio-result':scene;
    const img=images[left];
    if(scene==='labs'&&images.labs&&images.chess){
      rounded(35,120,1850,688,18,'#07111d','#26394e');
      ctx.drawImage(images.labs,60,145,880,495);ctx.drawImage(images.chess,980,145,880,495);
    }else if(img){ctx.drawImage(img,0,0,W,H);}
    else{panel(100,150,1720,660,'Jev Flow','TYPED AI WORKFLOWS',colors.cyan)}
    const captions={
      'studio-graph':['THE STUDIO','A visual flow, with every branch visible.'],
      'studio-input':['EDIT THE INPUT','A synthetic support request and fixed typed answers.'],
      'fixture-provenance':['FIXTURE PREVIEW','No provider call. The input is not sent to Jev.'],
      'studio-route':['REPLAYABLE ROUTE','judge → route → billing_gate → standard'],
      'studio-trace':['STEP-BY-STEP TRACE','Inspect the output beside each node.'],
      compendium:['JEV FLOW COMPENDIUM','388,080 generated configurations—not model calls.'],
      arena:['BATTLE ARENA','A fair comparison needs two real, configured responses.'],
      labs:['LOCAL LABS','Chess and game rules run in local code.'],
      'cart-data':['SELF-DRIVING SIMULATION','The simulator creates obstacle state and sensor features.'],
      'cart-no-vision':['NO CAMERA PIPELINE','No OpenCV here. Image perception needs a separate vision model.'],
    }[scene]||['JEV FLOW','Inspect the data, route, source, and limits.'];
    rounded(76,100,W-152,102,15,'#08111dee','#294057');label(captions[0],104,139,colors.cyan);text(captions[1],104,174,22,colors.text,'600');
    if(scene==='cart-data'||scene==='cart-no-vision'){
      rounded(1160,710,650,92,13,'#091522ee',scene==='cart-no-vision'?colors.amber:colors.cyan);
      text(scene==='cart-data'?'ego lane + speed  ·  obstacle lane + distance + type':'Structured simulator values  ·  no camera pixels',1186,765,18,scene==='cart-no-vision'?colors.amber:colors.cyan,'650','ui-monospace,Consolas,monospace');
    }
  }
}
function drawCaption(turn){
  if(!state.captionVisible)return;
  const box={x:78,y:864,w:1764,h:154};rounded(box.x,box.y,box.w,box.h,16,'#050a12ed','#283a4e');
  const color=turn.speaker==='Alex'?colors.cyan:colors.violet;
  const chunks=state.captionChunks[state.index]||[wrap(turn.text,box.w-52,24,'600').slice(0,2)];
  const charPosition=state.progress*Math.max(1,turn.text.length);let used=0;let chosen=chunks[chunks.length-1]||[];
  for(const lines of chunks){used+=lines.join(' ').length;if(charPosition<=used){chosen=lines;break}}
  chosen.forEach((line,i)=>text(line,box.x+26,box.y+75+i*34,24,colors.text,'600'));
  rounded(box.x,box.y+box.h-8,box.w*state.progress,4,2,color);
}
function frame(){if(!state.turn)return;grid();drawHeader(state.turn);drawDiagram(state.turn.scene,state.elapsed);drawCaption(state.turn);requestAnimationFrame(frame)}
function fitImage(image){return image}
window.startProduction=async function(payload){
  language=payload.language==='pt-BR'?'pt-BR':'en';document.documentElement.lang=language;
  turns=payload.turns;
  state.captionChunks=payload.captionChunks;
  for(const [key,url] of Object.entries(payload.assets)){const image=new Image();image.src=url;await image.decode();images[key]=fitImage(image)}
  await Promise.all(Object.entries(payload.clips||{}).map(async([key,url])=>{const video=document.createElement('video');video.muted=true;video.playsInline=true;video.loop=true;video.preload='auto';video.src=url;await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('A live application clip could not be decoded.'))});videos[key]=video}));
  state.turn=turns[0];state.index=0;state.elapsed=0;state.progress=0;drawDiagram(state.turn.scene,0);drawHeader(state.turn);drawCaption(state.turn);
  const poster=canvas.toDataURL('image/png').split(',')[1];
  const audioContext=new AudioContext({sampleRate:24000,latencyHint:'playback'});await audioContext.resume();
  const destination=audioContext.createMediaStreamDestination();const stream=canvas.captureStream(30);
  destination.stream.getAudioTracks().forEach(track=>stream.addTrack(track));
  const mime=MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')?'video/webm;codecs=vp9,opus':'video/webm;codecs=vp8,opus';
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3200000,audioBitsPerSecond:160000});
  const chunks=[];recorder.ondataavailable=event=>{if(event.data&&event.data.size)chunks.push(event.data)};
  const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=event=>reject(event.error||new Error('MediaRecorder failed'))});
  const gaps=0.18,cues=[],epoch=audioContext.currentTime;recorder.start(1000);requestAnimationFrame(frame);await new Promise(resolve=>setTimeout(resolve,500));
  for(let index=0;index<turns.length;index++){
    const turn=turns[index];state.turn=turn;state.index=index;state.elapsed=0;state.progress=0;state.captionVisible=true;
    const video=videos[turn.scene];if(video){if(index===0||turns[index-1]?.scene!==turn.scene)video.currentTime=0;await video.play()}else Object.values(videos).forEach(item=>item.pause());
    const response=await fetch(payload.audio[index]);if(!response.ok)throw new Error('Narration WAV could not be read.');
    const buffer=await audioContext.decodeAudioData(await response.arrayBuffer());
    const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(destination);
    const scheduled=audioContext.currentTime+0.08;const start=scheduled-epoch;cues.push({start,end:start+buffer.duration});source.start(scheduled);
    state.duration=buffer.duration;const started=performance.now();while((performance.now()-started)/1000<buffer.duration){state.elapsed=(performance.now()-started)/1000;state.progress=Math.min(1,state.elapsed/buffer.duration);await new Promise(requestAnimationFrame)}source.disconnect();state.captionVisible=false;await new Promise(resolve=>setTimeout(resolve,gaps*1000));
  }
  Object.values(videos).forEach(item=>item.pause());await new Promise(resolve=>setTimeout(resolve,250));recorder.stop();await stopped;
  const blob=new Blob(chunks,{type:mime});const saved=await fetch('/artifact',{method:'POST',headers:{'content-type':'video/webm'},body:blob});
  if(!saved.ok)throw new Error('The WebM could not be saved to the selected output.');
  const bytes=Number(saved.headers.get('content-length')||blob.size);
  await audioContext.close();stream.getTracks().forEach(track=>track.stop());
  return {mime,bytes,cues,poster};
};
</script></html>`;

function assetType(path) { return path.endsWith('.png') ? 'image/png' : 'audio/wav'; }

async function createPreviewServer({ wavs, assetPaths, clipPaths, output }) {
  const audio = new Map(wavs.map((wav, index) => [`/audio/turn-${String(index + 1).padStart(3, '0')}.wav`, wav]));
  const files = new Map(Object.entries(assetPaths).map(([key, path]) => [`/asset/${key}.png`, path]));
  const clips = new Map(Object.entries(clipPaths || {}).map(([key, path]) => [`/clip/${key}.webm`, path]));
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(PLAYER_HTML);
    }
    if (request.method === 'GET' && audio.has(url.pathname)) {
      response.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' });
      return response.end(audio.get(url.pathname));
    }
    if (request.method === 'GET' && files.has(url.pathname)) {
      try { const image = await readFile(files.get(url.pathname)); response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); return response.end(image); }
      catch { response.writeHead(404); return response.end(); }
    }
    if (request.method === 'GET' && clips.has(url.pathname)) {
      try {
        const video = await readFile(clips.get(url.pathname));
        const range = request.headers.range;
        if (range) {
          const match = /^bytes=(\d+)-(\d*)$/u.exec(range);
          if (!match) { response.writeHead(416, { 'content-range': `bytes */${video.length}` }); return response.end(); }
          const start = Number(match[1]); const end = match[2] ? Math.min(Number(match[2]), video.length - 1) : video.length - 1;
          if (start >= video.length || end < start) { response.writeHead(416, { 'content-range': `bytes */${video.length}` }); return response.end(); }
          const chunk = video.subarray(start, end + 1);
          response.writeHead(206, { 'content-type': 'video/webm', 'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${video.length}`, 'content-length': String(chunk.length), 'cache-control': 'no-store' });
          return response.end(chunk);
        }
        response.writeHead(200, { 'content-type': 'video/webm', 'accept-ranges': 'bytes',
          'content-length': String(video.length), 'cache-control': 'no-store' });
        return response.end(video);
      } catch { response.writeHead(404); return response.end(); }
    }
    if (request.method === 'POST' && url.pathname === '/artifact') {
      const chunks = []; let length = 0;
      for await (const chunk of request) { length += chunk.length; if (length > OUTPUT_LIMIT) { response.writeHead(413); response.end(); return; } chunks.push(chunk); }
      const webm = Buffer.concat(chunks);
      if (webm.length < 100_000 || webm.subarray(0, 4).toString('hex') !== '1a45dfa3') { response.writeHead(422); response.end(); return; }
      try { await writeFile(output, webm, { flag: 'wx' }); response.writeHead(201, { 'content-length': String(webm.length) }); response.end(); }
      catch { response.writeHead(409); response.end(); }
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolveListen, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

async function ensureAbsent(paths) {
  for (const path of paths) {
    try { await access(path); throw new Error('Output files already exist; choose new file names.'); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

export async function renderExplainer({ input, audioDir, output, clipsDir = null, browserType }) {
  const dialogue = JSON.parse(await readFile(input, 'utf8'));
  const audioManifest = JSON.parse(await readFile(resolve(audioDir, 'manifest.json'), 'utf8'));
  const wavs = await Promise.all(audioManifest.turns.map(item => readFile(resolve(audioDir, item.file))));
  const durations = validateProduction(dialogue, audioManifest, wavs);
  const out = resolve(output);
  const captions = out.replace(/\.webm$/iu, '.vtt');
  const poster = out.replace(/\.webm$/iu, '-poster.png');
  await ensureAbsent([out, captions, poster]);
  const assetPaths = Object.fromEntries(Object.entries(ASSETS).map(([key, name]) => [key, resolve(ROOT, 'media', name)]));
  await Promise.all(Object.values(assetPaths).map(async path => { const info = await stat(path); if (!info.isFile()) throw new Error('A required English application capture is missing.'); }));
  const clipPaths = resolveClipPaths(clipsDir);
  await Promise.all(Object.values(clipPaths).map(async path => { const info = await stat(path); if (!info.isFile() || info.size < 100_000) throw new Error('A required dynamic application clip is missing or incomplete.'); }));
  await mkdir(dirname(out), { recursive: true });
  const { server, url } = await createPreviewServer({ wavs, assetPaths, clipPaths, output: out });
  let browser;
  try {
    if (!browserType) {
      try { browserType = (await import('playwright')).chromium; }
      catch { throw new Error('Video rendering needs Playwright installed in the Node environment.'); }
    }
    browser = await browserType.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => { throw error; });
    const localOrigin = new URL(url).origin;
    await page.route('**/*', route => new URL(route.request().url()).origin === localOrigin ? route.continue() : route.abort());
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const turns = dialogue.turns.map(({ speaker, text, scene }) => ({ speaker, text, scene }));
    const assets = Object.fromEntries(Object.keys(ASSETS).map(key => [key, `${url}asset/${key}.png`]));
    const clips = Object.fromEntries(Object.keys(clipPaths).map(key => [key, `${url}clip/${key}.webm`]));
    const audio = wavs.map((_, index) => `${url}audio/turn-${String(index + 1).padStart(3, '0')}.wav`);
    const captionLines = dialogue.turns.map(turn => captionChunks(turn.text));
    const result = await page.evaluate(({ turns, assets, clips, audio, captionChunks, language }) => window.startProduction({ turns, assets, clips, audio, captionChunks, language }),
      { turns, assets, clips, audio, captionChunks: captionLines, language: dialogue.locale || 'en' });
    if (!result || !Number.isFinite(result.bytes) || result.bytes < 100_000 || !Array.isArray(result.cues) || result.cues.length !== dialogue.turns.length) {
      throw new Error('The browser did not produce a complete narrated video.');
    }
    await writeFile(captions, formatWebVtt(dialogue.turns, result.cues), { flag: 'wx' });
    await writeFile(poster, Buffer.from(result.poster, 'base64'), { flag: 'wx' });
    const measuredDuration = result.cues.at(-1)?.end || (durations.reduce((sum, value) => sum + value, 0) + dialogue.turns.length * 0.18 + 0.75);
    const video = indexWebmDuration(await readFile(out), measuredDuration);
    await writeFile(out, video);
    return { bytes: video.length, sha256: createHash('sha256').update(video).digest('hex'), durationSeconds: readWebmDuration(video),
      mime: result.mime, turns: dialogue.turns.length, language: dialogue.locale || 'en', captions, poster };
  } catch (error) {
    // Keep an incomplete video from looking like a finished deliverable.
    const { rm } = await import('node:fs/promises');
    await Promise.all([out, captions, poster].map(path => rm(path, { force: true }).catch(() => {})));
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolveClose => server.close(resolveClose));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (!options) process.stdout.write('Render a two-speaker, English Gemini TTS WebM with burned-in captions.\nUsage: node scripts/render-explainer-webm.mjs --input dialogue.json --audio-dir audio --output media/explainer.webm\n');
    else {
      const result = await renderExplainer(options);
      process.stdout.write(JSON.stringify(result) + '\n');
    }
  } catch (error) {
    process.stderr.write(`${error?.message || 'Video rendering failed.'}\n`);
    process.exitCode = 1;
  }
}
