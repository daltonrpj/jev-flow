const copyButton = document.getElementById('copy-setup');
const commands = document.getElementById('setup-commands');
const language = document.getElementById('site-language');
const tourLanguage = document.getElementById('tour-language');
const tourVideo = document.getElementById('product-tour-video');
const tourSource = document.getElementById('product-tour-source');
const tourCaptions = document.getElementById('tour-captions');
const tourTranscript = document.getElementById('tour-transcript');
const copyMessages = {
  en: { copied: 'Copied', select: 'Select commands', copy: 'Copy' },
  'pt-BR': { copied: 'Copiado', select: 'Selecione os comandos', copy: 'Copiar' },
  es: { copied: 'Copiado', select: 'Seleccione los comandos', copy: 'Copiar' },
  fr: { copied: 'Copié', select: 'Sélectionnez les commandes', copy: 'Copier' },
  de: { copied: 'Kopiert', select: 'Befehle auswählen', copy: 'Kopieren' },
};
const copyLabels = copyMessages[document.documentElement.lang] || copyMessages.en;
if (language) {
  language.value = document.documentElement.lang || 'en';
  language.addEventListener('change', () => {
    if (!Object.hasOwn(copyMessages, language.value)) return;
    const root = new URL(document.documentElement.dataset.siteRoot || './', location.href);
    const route = language.value === 'en' ? './' : `./${language.value}/`;
    const destination = new URL(route, root);
    destination.hash = location.hash;
    location.assign(destination.href);
  });
}
if (tourLanguage && tourVideo && tourSource) {
  const siteRoot = new URL(document.documentElement.dataset.siteRoot || './', location.href);
  const setTourLanguage = value => {
    const locale = value === 'pt-BR' ? 'pt-BR' : 'en';
    const base = `media/jev-flow-product-tour-${locale}`;
    tourVideo.pause();
    tourSource.src = new URL(`${base}.webm`, siteRoot).href;
    tourVideo.poster = new URL(`${base}-poster.png`, siteRoot).href;
    tourCaptions.href = new URL(`${base}.vtt`, siteRoot).href;
    tourTranscript.href = new URL(`${base}-transcript.md`, siteRoot).href;
    tourVideo.load();
  };
  tourLanguage.value = document.documentElement.lang === 'pt-BR' ? 'pt-BR' : 'en';
  tourLanguage.addEventListener('change', () => setTourLanguage(tourLanguage.value));
  setTourLanguage(tourLanguage.value);
}
copyButton?.addEventListener('click', async () => {
  if (!commands || !navigator.clipboard?.writeText) {
    copyButton.textContent = copyLabels.select;
    return;
  }
  try {
    await navigator.clipboard.writeText(commands.textContent.trim());
    copyButton.textContent = copyLabels.copied;
    window.setTimeout(() => { copyButton.textContent = copyLabels.copy; }, 2200);
  } catch {
    copyButton.textContent = copyLabels.select;
  }
});
