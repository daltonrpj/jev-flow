"use strict";

const SOURCE_COUNT = 388080;
const EXAMPLES = Object.freeze({
  "support-triage": "./examples/support-triage.flow.json",
  "spam-screening": "./examples/spam-screening.flow.json",
  "anomaly-review": "./examples/anomaly-review.flow.json",
  "refund-intake": "./examples/refund-intake.flow.json",
  "interactive-labs": "./examples/interactive-labs.flow.json"
});
const pt = Object.freeze({
  skip: "Pular para o conteúdo",
  announcement: "Código aberto · execução local · funcionamento inspecionável",
  navHow: "Como funciona", navExamples: "Exemplos", navModes: "Modos", navInstall: "Instalar",
  languageLabel: "Idioma", openApp: "Executar localmente",
  heroEyebrow: "Um estúdio para fluxos de IA tipada",
  heroTitle: "Deixe a IA julgar.<br><em>Deixe o código decidir.</em>",
  heroLead: "Combine julgamentos Choice, Noul e Score em fluxos que você consegue ler, testar e governar. Cada desvio é explícito. Cada execução mostra a origem das evidências.",
  heroStart: "Começar com uma instalação limpa", heroExplore: "Explorar a arquitetura",
  heroNote: "Este site estático é um guia. O Studio e as chamadas aos provedores rodam no aplicativo Node local.",
  heroFigure: "Diagrama ilustrativo do produto. A captura real do Studio aparece na seção seguinte.",
  studioEyebrow: "O STUDIO REAL", studioTitle: "Inspecione o fluxo, a entrada de teste e o resultado juntos.",
  studioLead: "Esta captura vem do aplicativo standalone. O exemplo visível usa uma fixture determinística; não é uma chamada remota ao Jev.",
  studioCaption: "Jev Flow Studio real · cenário sintético de suporte · prévia com fixture determinística · sem dados do usuário nem credenciais.",
  p1Title: "Tipado por padrão", p1Body: "As perguntas retornam valores Choice, Noul ou Score delimitados, em vez de instruções livres.",
  p2Title: "Política em código", p2Body: "O fluxo valida respostas, aplica limites e escolhe os caminhos. A saída do modelo é evidência, nunca autoridade.",
  p3Title: "Origem visível", p3Body: "Prévia, fixture, inferência local e chamadas remotas são identificadas separadamente, com erros e uso quando disponíveis.",
  architectureEyebrow: "O SISTEMA", architectureTitle: "Um julgamento pequeno dentro de um sistema maior e explícito.",
  architectureLead: "O JEV Flow separa interpretação incerta de política determinística. Você pode inspecionar os dois lados dessa fronteira.",
  architectureCaption: "Uma resposta tipada não executa uma ação por si só.",
  arch1Title: "Defina uma proposição", arch1Body: "Faça uma pergunta delimitada sobre o input. Noul informa a probabilidade de sim, Choice escolhe uma categoria e Score representa uma escala ordinal.",
  arch2Title: "Valide antes de rotear", arch2Body: "Checagens de schema e faixa rejeitam respostas ausentes ou malformadas. O fluxo aplica os limites e caminhos de revisão definidos por você.",
  arch3Title: "Inspecione a execução", arch3Body: "Veja a pergunta, resposta, caminho, origem do modelo ou fixture, latência e uso informado. Custo desconhecido continua desconhecido.",
  tourEyebrow: "DA IDEIA À EXECUÇÃO", tourTitle: "Quatro passos. Nenhuma passagem oculta.",
  tourLead: "Use fixtures para entender a lógica primeiro. Ative um provedor quando estiver pronto para medir um julgamento real.",
  tour1Title: "Escreva o estado", tour1Body: "Descreva os campos de entrada e a pergunta que o modelo pode julgar.",
  tour2Title: "Combine nós tipados", tour2Body: "Conecte julgamentos, validação, condições, logs e caminhos conservadores de revisão.",
  tour3Title: "Visualize com segurança", tour3Body: "Rode fixtures sintéticas. A prévia é determinística e nunca é apresentada como chamada real ao Jev.",
  tour4Title: "Execute e inspecione", tour4Body: "Selecione explicitamente um provedor configurado e compare as respostas tipadas com o caminho escolhido pelo código.",
  catalogEyebrow: "CATÁLOGO SOB DEMANDA", catalogTitle: "Uma biblioteca combinatória, gerada quando necessária.",
  catalogBody: "As entradas combinam padrões, domínios, variantes, limites, complexidade e foco. São configurações geradas, não arquivos de fluxo escritos um a um nem chamadas ao modelo testadas individualmente.",
  catalogLink: "Como funciona a certificação", catalogCardLabel: "CERTIFICAÇÃO STANDALONE",
  catalogPending: "Pendente", catalogPendingBody: "Execute a certificação isolada do catálogo antes de publicar uma contagem verificada.",
  catalogSourceLabel: "Referência do catálogo-fonte", catalogFingerprintLabel: "Fingerprint da build",
  catalogNotYet: "Não certificado aqui",
  catalogFine: "388.080 é o total gerado informado pelo catálogo-fonte. Este site só o apresenta como total verificado no standalone após uma certificação nova de fluxos válidos, chaves e IDs únicos e fingerprint da fonte.",
  examplesEyebrow: "ADAPTE AO SEU CASO", examplesTitle: "Comece com um exemplo. Edite cada regra.",
  examplesLead: "Estes exemplos genéricos usam entradas sintéticas. Eles não definem sua política de suporte, abuso, anomalias nem direito a reembolso.",
  exampleSelectLabel: "Escolha um exemplo", exSupport: "Triagem de suporte", exSpam: "Triagem de spam e abuso",
  exAnomaly: "Tratamento de anomalias", exRefund: "Entrada de reembolso", exLabs: "JEV Labs interativos",
  exampleSummaryLoading: "Carregue um exemplo para inspecionar a estrutura.",
  exampleFact1: "As respostas são tipadas e delimitadas.", exampleFact2: "Os caminhos pertencem ao código.", exampleFact3: "Casos desconhecidos vão para revisão.",
  editorKicker: "JSON EDITÁVEL", editorMode: "Rascunho local", jsonLabel: "Editor JSON do fluxo",
  editorHint: "Edite o JSON, inspecione sua estrutura ou baixe o rascunho. Esta página não chama modelos nem executa efeitos.",
  inspectButton: "Inspecionar estrutura", downloadButton: "Baixar JSON", openInApp: "Executar no Studio local",
  editorReady: "Selecione um exemplo para começar.",
  modesEyebrow: "LEIA O RÓTULO", modesTitle: "Cada execução identifica sua origem.",
  modesLead: "Uma prévia determinística pode demonstrar a lógica do fluxo. Só uma resposta observada de um provedor informa como ele respondeu.",
  modePreviewTag: "PRÉVIA", modePreviewTitle: "Fixture / determinístico", modePreviewBody: "Usa respostas sintéticas fornecidas. Não implica chamada ao modelo, latência do provedor ou custo remoto.",
  modeLocalTag: "LOCAL", modeLocalTitle: "Inferência compatível com Laya", modeLocalBody: "Executa apenas com adaptador e checkpoint locais compatíveis. O modelo selecionado e o estado da calibração devem estar visíveis.",
  modeLiveTag: "REMOTO", modeLiveTitle: "TypeSafe / Jev", modeLiveBody: "Uma execução real explícita usa sua credencial em runtime. Informa modelo, latência medida e uso do provedor quando retornados.",
  modeErrorTag: "INDISPONÍVEL", modeErrorTitle: "Desconhecido continua desconhecido", modeErrorBody: "Chaves ausentes, respostas malformadas, timeouts e falhas aparecem como erros. Nunca viram ação bem-sucedida.",
  installEyebrow: "EXECUTE VOCÊ MESMO", installTitle: "Sua máquina. Seu fluxo. Sua fronteira de decisão.",
  installBody: "O site é estático; o Studio roda deste repositório com Node. Comece sem credencial para explorar fixtures e prévias determinísticas. Adicione credencial somente para chamadas reais explícitas.",
  readInstall: "Ler guia de instalação", appGuide: "Endereço do Studio local", terminalTitle: "TERMINAL LOCAL",
  terminalNote: "O guia estático é público. O aplicativo local guarda dados fora deste checkout e não exige chave de provedor para prévias determinísticas.",
  localUrlLabel: "Depois de iniciar o aplicativo, abra a rota local do Studio:",
  videoEyebrow: "GUIA EM VÍDEO", videoTitle: "Veja um fluxo desde o primeiro input até o caminho final.",
  videoBody: "O roteiro em inglês está pronto. O vídeo final mostrará instalação local, julgamento tipado, prévia identificada como fixture, chamada real explícita e logs. A gravação e as legendas sincronizadas com Gemini TTS ainda estão pendentes.",
  videoPending: "O vídeo verificado ainda não foi incluído. O player aparece somente quando o arquivo estiver presente.",
  transcriptLink: "Ler o roteiro da narração ↗",
  videoFrameNote: "Gravação Gemini TTS pendente · arquivo esperado: site/media/jev-flow-walkthrough.webm",
  faqEyebrow: "BOAS PERGUNTAS", faqTitle: "O que um fluxo pode e não pode provar.",
  faq1Q: "A prévia chama o Jev?", faq1A: "Não. A prévia usa fixtures determinísticas e demonstra apenas como o fluxo trata as respostas fornecidas.",
  faq2Q: "Os 388.080 fluxos foram escritos manualmente?", faq2A: "Não. O catálogo-fonte combina seis dimensões sob demanda. A contagem do standalone só aparece como verificada após esta cópia passar por uma certificação nova de configurações válidas, IDs e chaves únicos.",
  faq3Q: "O modelo pode disparar reembolso ou webhook sozinho?", faq3A: "Não. A resposta tipada é evidência. Validação, políticas, revisão e autorização para efeitos pertencem ao código.",
  faq4Q: "O GitHub Pages executa o aplicativo?", faq4A: "Não. O Pages hospeda este guia e a mídia. Execute o aplicativo Node localmente na sua máquina.",
  footerLine: "Fluxos de código aberto com fronteiras explícitas para julgamentos.",
  footerDocs: "Documentação", footerApp: "Aplicativo local", footerMedia: "Estado da mídia", footerTrust: "Segurança e contribuições",
  footerRepository: "Repositório no GitHub"
});
const message = Object.freeze({
  en: {
    loading: "Loading example…", loaded: "Example loaded. Edit the JSON, then inspect or download it.",
    fetchError: "Could not load the example. Serve the site over HTTP and check the local examples directory.",
    parseError: "JSON error: ", shapeError: "Structure error: expected an object with id, start, and a nodes map.",
    startError: "Structure error: start must name a node in the nodes map.",
    checked: "JSON parses; {nodes} nodes, {questions} typed question(s), start: {start}. This checks basic structure only; use the Studio for engine validation and execution.",
    downloaded: "Draft downloaded locally. No model call or server write occurred.",
    summary: "{nodes} nodes · {questions} typed question(s) · synthetic example. Edit thresholds and review branches for your policy.",
    pending: "Pending", pendingBody: "Run the isolated catalog certificate before publishing a verified count.",
    verified: "Verified generated configurations", certified: "Certificate: {date}. Valid flows, unique keys/IDs, and source fingerprint matched.",
    fingerprintPending: "Not certified here",
    mediaReady: "Verified local video and captions are available. Playback is optional.",
    mediaPending: "The verified video asset is not included yet. The player appears only after the file is present."
  },
  "pt-BR": {
    loading: "Carregando exemplo…", loaded: "Exemplo carregado. Edite o JSON e depois inspecione ou baixe.",
    fetchError: "Não foi possível carregar o exemplo. Sirva o site por HTTP e confira a pasta local de exemplos.",
    parseError: "JSON inválido. Confira aspas, vírgulas e chaves.", shapeError: "Erro de estrutura: esperado objeto com id, start e mapa nodes.",
    startError: "Erro de estrutura: start precisa indicar um nó do mapa nodes.",
    checked: "O JSON é válido; {nodes} nós, {questions} pergunta(s) tipada(s), início: {start}. Esta checagem é apenas estrutural; use o Studio para validar e executar no motor.",
    downloaded: "Rascunho baixado localmente. Não houve chamada ao modelo nem gravação no servidor.",
    summary: "{nodes} nós · {questions} pergunta(s) tipada(s) · exemplo sintético. Adapte limites e caminhos de revisão à sua política.",
    pending: "Pendente", pendingBody: "Execute a certificação isolada do catálogo antes de publicar uma contagem verificada.",
    verified: "Configurações geradas verificadas", certified: "Certificação: {date}. Fluxos válidos, chaves/IDs únicos e fingerprint da fonte conferiram.",
    fingerprintPending: "Não certificado aqui",
    mediaReady: "Vídeo e legendas locais verificados estão disponíveis. A reprodução é opcional.",
    mediaPending: "O vídeo verificado ainda não foi incluído. O player aparece somente quando o arquivo estiver presente."
  }
});
const attributeCopy = Object.freeze({
  en: {
    heroImage: "Illustrative JEV Flow editor diagram showing Input, typed Jev judgment, a deterministic policy branch, and review outcome.",
    architectureImage: "Input state flows to a typed JEV judgment, schema validation, code-owned policy, then an explicit result and audit log.",
    videoPoster: "Illustrative outline of the planned JEV Flow walkthrough",
    videoLabel: "English JEV Flow walkthrough", brand: "JEV Flow home", nav: "Primary navigation", select: "Site language"
  },
  "pt-BR": {
    heroImage: "Diagrama ilustrativo do JEV Flow com entrada, julgamento tipado, caminho de política determinística e revisão.",
    architectureImage: "O estado de entrada passa pelo julgamento tipado, validação, política em código e resultado com log.",
    videoPoster: "Ilustração do guia em vídeo planejado para o JEV Flow",
    videoLabel: "Guia em vídeo do JEV Flow em inglês", brand: "Página inicial do JEV Flow", nav: "Navegação principal", select: "Idioma do site"
  }
});

const staticNodes = [...document.querySelectorAll("[data-i18n]")].map(el => ({el, key: el.dataset.i18n, en: el.textContent}));
const htmlNodes = [...document.querySelectorAll("[data-i18n-html]")].map(el => ({el, key: el.dataset.i18nHtml, en: el.innerHTML}));
const languageSelect = document.getElementById("language");
const exampleSelect = document.getElementById("example-select");
const editor = document.getElementById("example-json");
const result = document.getElementById("example-result");
const summary = document.getElementById("example-summary");
let locale = "en";
let exampleRevision = 0;
let resultState = {kind: "ready"};
let catalogCertificate = null;
let mediaReady = false;

function t(key) { return message[locale][key]; }
function interpolate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}
function readSavedLanguage() {
  const query = new URLSearchParams(location.search).get("lang");
  if (query === "en" || query === "pt-BR") return query;
  try {
    const stored = localStorage.getItem("jev-flow-site-language");
    if (stored === "en" || stored === "pt-BR") return stored;
  } catch {}
  return "en";
}
function setLanguage(next) {
  locale = next === "pt-BR" ? "pt-BR" : "en";
  document.documentElement.lang = locale;
  languageSelect.value = locale;
  for (const {el, key, en} of staticNodes) el.textContent = locale === "en" ? en : (pt[key] ?? en);
  for (const {el, key, en} of htmlNodes) el.innerHTML = locale === "en" ? en : (pt[key] ?? en);
  const attrs = attributeCopy[locale];
  document.querySelector(".brand").setAttribute("aria-label", attrs.brand);
  document.querySelector(".site-nav").setAttribute("aria-label", attrs.nav);
  languageSelect.setAttribute("aria-label", attrs.select);
  document.querySelector(".hero-figure img").alt = attrs.heroImage;
  document.querySelector(".architecture-frame img").alt = attrs.architectureImage;
  document.getElementById("video-poster").alt = attrs.videoPoster;
  document.getElementById("walkthrough-video").setAttribute("aria-label", attrs.videoLabel);
  document.title = locale === "en" ? "JEV Flow — typed judgment, clear control" : "JEV Flow — julgamento tipado, controle claro";
  renderExample();
  renderCatalog();
  renderMedia();
}
function setResult(kind, extra = {}) {
  resultState = {kind, ...extra};
  renderExample();
}
function renderExample() {
  const strings = message[locale];
  const state = resultState;
  let line = staticNodes.find(x => x.key === "editorReady")?.en ?? "";
  if (state.kind === "loading") line = strings.loading;
  if (state.kind === "loaded") line = strings.loaded;
  if (state.kind === "fetchError") line = strings.fetchError;
  if (state.kind === "parseError") line = locale === "en" ? strings.parseError + state.error : strings.parseError;
  if (state.kind === "shapeError") line = strings.shapeError;
  if (state.kind === "startError") line = strings.startError;
  if (state.kind === "checked") line = interpolate(strings.checked, state);
  if (state.kind === "downloaded") line = strings.downloaded;
  result.textContent = line;
  result.classList.toggle("is-error", ["fetchError", "parseError", "shapeError", "startError"].includes(state.kind));
  if (state.nodes !== undefined && state.questions !== undefined) {
    summary.textContent = interpolate(strings.summary, state);
  } else {
    const fallback = staticNodes.find(x => x.key === "exampleSummaryLoading");
    summary.textContent = locale === "pt-BR" ? pt.exampleSummaryLoading : fallback.en;
  }
}
function readStructure() {
  let parsed;
  try { parsed = JSON.parse(editor.value); }
  catch (error) { setResult("parseError", {error: error.message}); return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      typeof parsed.id !== "string" || !parsed.id.trim() ||
      typeof parsed.start !== "string" || !parsed.nodes || typeof parsed.nodes !== "object" ||
      Array.isArray(parsed.nodes)) {
    setResult("shapeError"); return null;
  }
  if (!Object.hasOwn(parsed.nodes, parsed.start)) { setResult("startError"); return null; }
  const nodes = Object.keys(parsed.nodes).length;
  const questions = Object.values(parsed.nodes).reduce((sum, node) =>
    sum + (node?.type === "jev.ask" && node.questions && typeof node.questions === "object" && !Array.isArray(node.questions)
      ? Object.keys(node.questions).length : 0), 0);
  return {parsed, nodes, questions, start: parsed.start};
}
async function loadExample(id) {
  if (!Object.hasOwn(EXAMPLES, id)) return;
  const revision = ++exampleRevision;
  document.getElementById("example-file").textContent = id + ".flow.json";
  editor.value = "";
  setResult("loading");
  try {
    const response = await fetch(EXAMPLES[id], {cache: "no-store"});
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    if (revision !== exampleRevision) return;
    editor.value = JSON.stringify(data, null, 2) + "\n";
    const structure = readStructure();
    if (structure) setResult("loaded", structure);
  } catch {
    if (revision === exampleRevision) setResult("fetchError");
  }
}
function renderCatalog() {
  const count = document.getElementById("catalog-count");
  const status = document.getElementById("catalog-status");
  const fingerprint = document.getElementById("catalog-fingerprint");
  if (!catalogCertificate) {
    count.textContent = t("pending");
    status.textContent = t("pendingBody");
    fingerprint.textContent = t("fingerprintPending");
    return;
  }
  count.textContent = new Intl.NumberFormat(locale).format(SOURCE_COUNT);
  count.setAttribute("aria-label", t("verified") + ": " + count.textContent);
  const date = new Intl.DateTimeFormat(locale, {year:"numeric",month:"short",day:"numeric",timeZone:"UTC"}).format(new Date(catalogCertificate.certifiedAt));
  status.textContent = interpolate(t("certified"), {date});
  fingerprint.textContent = catalogCertificate.sourceFingerprint.slice(0, 16) + "…";
  fingerprint.title = catalogCertificate.sourceFingerprint;
}
function certificateIsValid(c) {
  return c && c.scope === "standalone" && c.passed === true &&
    c.version === "jev-flow-catalog-v3" &&
    ["candidateCount", "validCount", "uniqueKeys", "uniqueIds"].every(key => c[key] === SOURCE_COUNT) &&
    typeof c.sourceFingerprint === "string" && /^[a-f0-9]{64}$/i.test(c.sourceFingerprint) &&
    typeof c.certifiedAt === "string" && !Number.isNaN(Date.parse(c.certifiedAt));
}
async function loadCertificate() {
  try {
    const response = await fetch("./catalog-certification.json", {cache:"no-store"});
    if (!response.ok) return;
    const candidate = await response.json();
    if (certificateIsValid(candidate)) catalogCertificate = candidate;
  } catch {}
  renderCatalog();
}
async function exists(path) {
  try { const response = await fetch(path, {method:"HEAD", cache:"no-store"}); return response.ok; }
  catch { return false; }
}
function renderMedia() {
  const video = document.getElementById("walkthrough-video");
  const poster = document.getElementById("video-poster");
  document.getElementById("video-status").textContent = t(mediaReady ? "mediaReady" : "mediaPending");
  video.hidden = !mediaReady;
  poster.hidden = mediaReady;
}
async function loadMedia() {
  const videoPath = "./media/jev-flow-walkthrough.webm";
  const captionsPath = "./media/jev-flow-walkthrough.vtt";
  const transcriptPath = "./media/jev-flow-walkthrough-transcript.md";
  const [hasVideo, hasCaptions, hasTranscript] = await Promise.all(
    [videoPath, captionsPath, transcriptPath].map(exists));
  mediaReady = hasVideo && hasCaptions && hasTranscript;
  const link = document.getElementById("transcript-link");
  link.hidden = !hasTranscript;
  if (mediaReady) {
    const source = document.createElement("source");
    source.src = videoPath;
    source.type = "video/webm";
    const track = document.createElement("track");
    track.kind = "captions";
    track.srclang = "en";
    track.label = "English captions";
    track.src = captionsPath;
    track.default = true;
    const player = document.getElementById("walkthrough-video");
    player.append(source, track);
    player.load();
  }
  renderMedia();
}

languageSelect.addEventListener("change", () => {
  setLanguage(languageSelect.value);
  try { localStorage.setItem("jev-flow-site-language", locale); } catch {}
});
exampleSelect.addEventListener("change", () => loadExample(exampleSelect.value));
document.getElementById("inspect-example").addEventListener("click", () => {
  const structure = readStructure();
  if (structure) setResult("checked", structure);
});
document.getElementById("download-example").addEventListener("click", () => {
  const structure = readStructure();
  if (!structure) return;
  const blob = new Blob([JSON.stringify(structure.parsed, null, 2) + "\n"], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exampleSelect.value + ".flow.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setResult("downloaded", structure);
});
setLanguage(readSavedLanguage());
loadExample(exampleSelect.value);
loadCertificate();
loadMedia();
