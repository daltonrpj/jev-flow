// Jev Flow presentation language layer. Machine identifiers and Flow JSON stay
// in English; only copy that reaches the browser is translated here.

export const SUPPORTED_LOCALES = Object.freeze(['pt-BR', 'en', 'es']);
export const DEFAULT_LOCALE = 'pt-BR';

const PACKS = {
  'pt-BR': {
    language: 'Português (Brasil)',
    flow: 'Fluxo', reasoning: 'Raciocínio', execution: 'Execução', understand: 'Entender', data: 'Dados',
    live: 'Jev ao vivo', simulation: 'Simulação', connect: 'Conectar motor →', languageLabel: 'Idioma',
    create: '＋ Criar fluxo', import: '⇩ importar', export: '⇧ exportar', tools: 'ferramentas',
    capabilities: 'capacidades', operationalCatalog: 'CATÁLOGO OPERACIONAL', yourFlows: 'Seus fluxos em produção',
    intro: 'Construa fluxos operacionais e grafos de raciocínio executáveis. Capacidades locais fazem o que é exato; Jev avalia o que é incerto; evidência, orçamento e revisão continuam visíveis do início ao fim.',
    describe: '✦ Descrever', buildJson: '{ } Montar JSON', importMode: '⇩ Importar',
    createIntro: 'Descreva a regra em português — e as exceções junto ("…exceto quando…"). O Jev Flow entende o objetivo, escolhe as capacidades e monta uma primeira versão com as exceções como ramos explícitos, para você revisar antes de salvar.', naturalTitle: 'Descreva a regra e suas exceções em linguagem natural', naturalHint: 'Você não precisa conhecer JSON, IDs ou tipos de entrada. Escreva como fala: a regra geral, os casos especiais e o que fazer com dúvida. O Jev Flow infere a estrutura e explica cada decisão.',
    advanced: 'Ajustes avançados (opcional)', draw: '✦ Desenhar com o Jev Flow', translate: 'Traduzir para português',
    laya: 'Laya local', openjev: 'OpenJev compatível', typesafe: 'TypeSafe remoto', setup: 'Configurar', verify: 'Verificar ambiente',
    staticCopy: {},
  },
  en: {
    language: 'English', flow: 'Flow', reasoning: 'Reasoning', execution: 'Run', understand: 'Understand', data: 'Data',
    live: 'Jev live', simulation: 'Simulation', connect: 'Connect engine →', languageLabel: 'Language',
    create: '＋ Create flow', import: '⇩ import', export: '⇧ export', tools: 'tools',
    capabilities: 'capabilities', operationalCatalog: 'OPERATIONAL CATALOG', yourFlows: 'Your flows in production',
    intro: 'Build executable operational flows and reasoning graphs. Local capabilities handle what is exact; Jev evaluates uncertainty; evidence, budget and review stay visible end to end.',
    describe: '✦ Describe', buildJson: '{ } Build JSON', importMode: '⇩ Import',
    createIntro: 'Describe the rule in plain language — exceptions included ("…except when…"). Jev Flow understands the goal, chooses capabilities and builds a first version with exceptions as explicit branches for your review.', naturalTitle: 'Describe the rule and its exceptions in natural language', naturalHint: 'No JSON, IDs or input types needed. Write as you speak: the general rule, the special cases, and what to do when in doubt. Jev Flow infers the structure and explains each decision.',
    advanced: 'Advanced adjustments (optional)', draw: '✦ Design with Jev Flow', translate: 'Translate to Portuguese',
    laya: 'Local Laya', openjev: 'Compatible OpenJev', typesafe: 'Remote TypeSafe', setup: 'Configure', verify: 'Check environment',
    staticCopy: {
      'importar JSON': 'import JSON', 'Conecte uma pasta ou repositório': 'Connect a folder or repository',
      'Verificar ambiente': 'Check environment', 'Raciocínio': 'Reasoning',
      'atenção': 'attention', 'julgamento simulado': 'simulated judgment', 'execução real': 'live execution',
      'passos': 'steps', 'arestas': 'edges', 'Testar': 'Test', 'Salvar': 'Save',
      'Somente leitura': 'Read-only', 'Exemplo somente leitura': 'Read-only example', 'Duplicar para editar': 'Duplicate to edit',
      'Fluxo': 'Flow', 'Grafo de Raciocínio': 'Reasoning graph', 'Entender': 'Understand', 'Dados': 'Data',
      'Conexões': 'Connections', 'Fixtures reproduzíveis': 'Reproducible fixtures', 'Execução': 'Run',
      'operação concluída': 'operation complete', 'operação com falha': 'operation failed',
      'Modo de representação': 'Representation mode', 'Selecione qualquer bloco': 'Select any block',
      'Biblioteca de capacidades': 'Capability library', 'Capacidades': 'Capabilities', 'ferramentas': 'tools',
      '⇩ importar JSON': '⇩ import JSON', 'Descobrir padrões em um projeto': 'Discover patterns in a project',
      'Conecte uma pasta ou repositório e transforme padrões em candidatos revisáveis — nunca em decisões publicadas silenciosamente.': 'Connect a folder or repository and turn patterns into reviewable candidates — never silently published decisions.',
      'Tudo que o Jev Flow sabe orquestrar': 'Everything Jev Flow can orchestrate',
      'Cada bloco possui contrato, custo, risco, rede, cache, fallback e exemplo. Abra uma capacidade para ver exatamente o que entra e o que sai.': 'Every block has a contract, cost, risk, network, cache, fallback and example. Open a capability to see exactly what enters and leaves.',
      'filtre por nome, saúde ou agendamento': 'filter by name, health or schedule', 'Buscar flow, id ou descrição': 'Search flow, id or description',
      'agendados': 'scheduled', 'runs recentes': 'recent runs', 'julgamento Jev': 'Jev judgment',
      'Ainda não há execuções — o primeiro teste pode ser simulado.': 'No runs yet — the first test can be simulated.',
      'Nome sugerido': 'Suggested name', 'ID técnico': 'Technical ID', 'Campos de entrada conhecidos': 'Known input fields',
      'Exemplos reais de entrada': 'Real input examples', 'Flow JSON': 'Flow JSON', 'Arquivo ou JSON exportado': 'File or exported JSON',
      'fluxos': 'flows', 'Suas políticas indexadas': 'Your indexed policies', 'Indexar regras': 'Index rules',
      'ver regras': 'view rules', 'Nenhum fluxo ainda': 'No flow yet', 'Excluir flow': 'Delete flow',
      'Tudo salvo': 'All changes saved', 'Executar': 'Play', 'Reproduzir amostra': 'Play sample',
      'JULGAMENTO JEV': 'JEV JUDGMENT', 'ROTEADOR SWITCH': 'SWITCH ROUTE', 'CONDIÇÃO IF': 'IF CONDITION',
      'REGISTRAR LOG': 'WRITE LOG', 'mensagem protegida': 'guarded message',
      'condição tipada protegida': 'guarded typed condition', 'seletor tipado protegido': 'guarded typed selector',
      'REDE': 'NETWORK', 'rede': 'network', 'sim': 'yes', 'não': 'no', 'padrão': 'default',
      'SIMULAÇÃO': 'SIMULATION', 'caminho executado': 'executed path',
      'clique no ✎ editar · arraste nós · scroll zoom · arraste o fundo pan': 'click ✎ to edit · drag nodes · scroll to zoom · drag background to pan',
    },
  },
  es: {
    language: 'Español', flow: 'Flujo', reasoning: 'Razonamiento', execution: 'Ejecución', understand: 'Entender', data: 'Datos',
    live: 'Jev en vivo', simulation: 'Simulación', connect: 'Conectar motor →', languageLabel: 'Idioma',
    create: '＋ Crear flujo', import: '⇩ importar', export: '⇧ exportar', tools: 'herramientas',
    capabilities: 'capacidades', operationalCatalog: 'CATÁLOGO OPERATIVO', yourFlows: 'Tus flujos en producción',
    intro: 'Construye flujos operativos y grafos de razonamiento ejecutables. Las capacidades locales resuelven lo exacto; Jev evalúa la incertidumbre; la evidencia, el presupuesto y la revisión permanecen visibles.',
    describe: '✦ Describir', buildJson: '{ } Crear JSON', importMode: '⇩ Importar',
    createIntro: 'Describe la regla en lenguaje natural — con sus excepciones ("…excepto cuando…"). Jev Flow entiende el objetivo, elige las capacidades y crea una primera versión con las excepciones como ramas explícitas.', naturalTitle: 'Describe la regla y sus excepciones en lenguaje natural', naturalHint: 'No necesitas conocer JSON, IDs ni tipos de entrada. Escribe como hablas: la regla general, los casos especiales y qué hacer ante la duda. Jev Flow infiere la estructura y explica cada decisión.',
    advanced: 'Ajustes avanzados (opcional)', draw: '✦ Diseñar con Jev Flow', translate: 'Traducir al portugués',
    laya: 'Laya local', openjev: 'OpenJev compatible', typesafe: 'TypeSafe remoto', setup: 'Configurar', verify: 'Verificar entorno',
    staticCopy: {
      'importar JSON': 'importar JSON', 'Conecte uma pasta ou repositório': 'Conecta una carpeta o repositorio',
      'Verificar ambiente': 'Verificar entorno', 'Raciocínio': 'Razonamiento',
      'atenção': 'atención', 'julgamento simulado': 'juicio simulado', 'execução real': 'ejecución real',
      'passos': 'pasos', 'arestas': 'aristas', 'Testar': 'Probar', 'Salvar': 'Guardar',
      'Somente leitura': 'Solo lectura', 'Exemplo somente leitura': 'Ejemplo de solo lectura', 'Duplicar para editar': 'Duplicar para editar',
      'Fluxo': 'Flujo', 'Grafo de Raciocínio': 'Grafo de razonamiento', 'Entender': 'Entender', 'Dados': 'Datos',
      'Conexões': 'Conexiones', 'Fixtures reproduzíveis': 'Fixtures reproducibles', 'Execução': 'Ejecución',
      'operação concluída': 'operación completada', 'operação com falha': 'operación con error',
      'Modo de representação': 'Modo de representación', 'Selecione qualquer bloco': 'Selecciona cualquier bloque',
      'Biblioteca de capacidades': 'Biblioteca de capacidades', 'Capacidades': 'Capacidades', 'ferramentas': 'herramientas',
      '⇩ importar JSON': '⇩ importar JSON', 'Descobrir padrões em um projeto': 'Descubrir patrones en un proyecto',
      'Conecte uma pasta ou repositório e transforme padrões em candidatos revisáveis — nunca em decisões publicadas silenciosamente.': 'Conecta una carpeta o repositorio y convierte patrones en candidatos revisables — nunca en decisiones publicadas silenciosamente.',
      'Tudo que o Jev Flow sabe orquestrar': 'Todo lo que Jev Flow puede orquestar',
      'Cada bloco possui contrato, custo, risco, rede, cache, fallback e exemplo. Abra uma capacidade para ver exatamente o que entra e o que sai.': 'Cada bloque tiene contrato, coste, riesgo, red, caché, fallback y ejemplo. Abre una capacidad para ver exactamente qué entra y sale.',
      'filtre por nome, saúde ou agendamento': 'filtra por nombre, estado o programación', 'Buscar flow, id ou descrição': 'Buscar flujo, id o descripción',
      'agendados': 'programados', 'runs recentes': 'ejecuciones recientes', 'julgamento Jev': 'juicio Jev',
      'Ainda não há execuções — o primeiro teste pode ser simulado.': 'Aún no hay ejecuciones — la primera prueba puede simularse.',
      'Nome sugerido': 'Nombre sugerido', 'ID técnico': 'ID técnico', 'Campos de entrada conhecidos': 'Campos de entrada conocidos',
      'Exemplos reais de entrada': 'Ejemplos reales de entrada', 'Flow JSON': 'JSON del flujo', 'Arquivo ou JSON exportado': 'Archivo o JSON exportado',
      'fluxos': 'flujos', 'Suas políticas indexadas': 'Tus políticas indexadas', 'Indexar regras': 'Indexar reglas',
      'ver regras': 'ver reglas', 'Nenhum fluxo ainda': 'Ningún flujo aún', 'Excluir flow': 'Eliminar flujo',
    },
  },
};

export function normalizeLocale(value) {
  const raw = String(value || '').trim().replace('_', '-').toLowerCase();
  if (raw === 'pt' || raw === 'pt-br') return 'pt-BR';
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  if (raw === 'es' || raw.startsWith('es-')) return 'es';
  return DEFAULT_LOCALE;
}

export function getLocalePack(value) {
  const locale = normalizeLocale(value);
  return { locale, ...PACKS[locale] };
}

export function listLocales() {
  return SUPPORTED_LOCALES.map(locale => ({ locale, label: PACKS[locale].language }));
}
