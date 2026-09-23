const copyButton = document.getElementById('copy-setup');
const commands = document.getElementById('setup-commands');
const language = document.getElementById('site-language');
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
