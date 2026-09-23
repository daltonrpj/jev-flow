export async function executeDeterministicSkill(id, input = {}) {
  const skill = String(id || '').trim();
  const builtins = {
    'det-json-validator': async value => {
      const source = String(value?.json || '');
      try { return { valid: true, value: JSON.parse(source) }; }
      catch (error) { return { valid: false, error: String(error.message).slice(0, 200) }; }
    },
    'det-text-length': async value => ({ characters: String(value?.text || '').length }),
  };
  if (!Object.hasOwn(builtins, skill)) {
    const error = new Error(`deterministic skill is not installed: ${skill}`);
    error.code = 'DET_SKILL_NOT_INSTALLED';
    throw error;
  }
  return { execution_mode: 'deterministic', output: await builtins[skill](input) };
}

export async function pruneMessages(messages, options = {}) {
  const maxChars = Math.max(256, Math.min(100_000, Number(options.maxChars) || 12_000));
  let remaining = maxChars;
  let changed = false;
  const output = messages.map(message => {
    if (!message || typeof message !== 'object' || typeof message.content !== 'string') return message;
    if (message.content.length <= remaining) { remaining -= message.content.length; return message; }
    const content = remaining > 0 ? message.content.slice(0, remaining) : '';
    const omittedChars = message.content.length - content.length;
    remaining = 0; changed = true;
    return { ...message, content: `${content}\n[output shortened locally; ${omittedChars} characters omitted]` };
  });
  return { messages: output, meta: { applied: changed, failOpen: false, method: 'deterministic-character-budget',
    transportCalled: false, measurement: 'observed', maxChars } };
}
