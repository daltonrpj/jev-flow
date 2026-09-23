const copyButton = document.getElementById('copy-setup');
const commands = document.getElementById('setup-commands');
copyButton?.addEventListener('click', async () => {
  if (!commands || !navigator.clipboard?.writeText) {
    copyButton.textContent = 'Select commands';
    return;
  }
  try {
    await navigator.clipboard.writeText(commands.textContent.trim());
    copyButton.textContent = 'Copied';
    window.setTimeout(() => { copyButton.textContent = 'Copy'; }, 2200);
  } catch {
    copyButton.textContent = 'Select commands';
  }
});
