// Solo estructura y estrategias verificadas; nunca valores, opciones ni transcripciones.
(function () {
  let queue = Promise.resolve();
  const strategies = new Set(['click-state', 'select-option', 'input-events', 'contenteditable-events']);
  function sanitize(raw) {
    const url = new URL(raw.origin);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('Origen de memoria inválido.');
    const text = value => typeof value === 'string' ? value.slice(0, 200) : '';
    const identity = { origin: url.origin, path: text(raw.path).replace(/\b\d{3,}\b/g, ':id').replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, ':id'), context: text(raw.context), route: text(raw.route) };
    const fields = (raw.fields || []).slice(0, 200).map(field => ({
      key: text(field.key), label: text(field.label), kind: text(field.kind), name: text(field.name), nativeId: text(field.nativeId),
      rules: Object.fromEntries(['required', 'minlength', 'maxlength', 'min', 'max', 'step', 'pattern', 'inputmode'].filter(key => field.rules?.[key] !== undefined).map(key => [key, typeof field.rules[key] === 'boolean' ? field.rules[key] : text(field.rules[key])]))
    }));
    return { key: JSON.stringify(identity), identity, fields };
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['JALFIA_MEMORY_SYNC', 'JALFIA_MEMORY_SUCCESS', 'JALFIA_MEMORY_FORGET'].includes(message?.type)) return false;
    const work = async () => {
      if (sender.id !== chrome.runtime.id || !sender.url) throw new Error('Solicitud de memoria inválida.');
      const snapshot = sanitize(message.snapshot);
      if (new URL(sender.url).origin !== snapshot.identity.origin) throw new Error('La pantalla no pertenece a este documento.');
      const stored = (await chrome.storage.local.get('jalfiaMemory')).jalfiaMemory || {};
      const previous = stored[snapshot.key];
      if (message.type === 'JALFIA_MEMORY_FORGET') {
        delete stored[snapshot.key]; await chrome.storage.local.set({ jalfiaMemory: stored }); return { ok: true };
      }
      const previousFields = previous?.fields || [];
      const fields = snapshot.fields.map(field => {
        const matches = previousFields.filter(item => item.key === field.key && item.kind === field.kind);
        return { ...field, ...(matches.length === 1 && snapshot.fields.filter(item => item.key === field.key).length === 1 ? { strategy: matches[0].strategy, successes: matches[0].successes || 0 } : {}) };
      });
      if (message.type === 'JALFIA_MEMORY_SUCCESS' && strategies.has(message.strategy)) {
        const matches = fields.filter(field => field.key === message.fieldKey);
        if (matches.length === 1) { matches[0].strategy = message.strategy; matches[0].successes = (matches[0].successes || 0) + 1; }
      }
      stored[snapshot.key] = { identity: snapshot.identity, fields, updatedAt: Date.now() };
      const entries = Object.entries(stored).filter(([, screen]) => screen.updatedAt > Date.now() - 90 * 86400000).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, 200);
      await chrome.storage.local.set({ jalfiaMemory: Object.fromEntries(entries) });
      return { ok: true, known: Boolean(previous), key: snapshot.key, fields, updatedAt: stored[snapshot.key].updatedAt };
    };
    const job = queue.then(work);
    queue = job.catch(() => {});
    job.then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
