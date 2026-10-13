chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['JALFIA_COLLECT_FRAMES', 'JALFIA_FRAME_REQUEST', 'JALFIA_LOCK_FRAMES'].includes(message?.type)) return false;
  (async () => {
    if (sender.id !== chrome.runtime.id || !sender.tab?.id || sender.frameId !== 0) throw new Error('Solo el panel principal puede coordinar los frames.');
    const tabId = sender.tab.id;
    if (message.type === 'JALFIA_LOCK_FRAMES') {
      const frames = await chrome.webNavigation.getAllFrames({ tabId }) || [];
      await Promise.allSettled(frames.filter(frame => frame.frameId > 0).map(frame => chrome.tabs.sendMessage(tabId, { type: 'JALFIA_FRAME_LOCK', locked: message.locked === true }, { frameId: frame.frameId, documentId: frame.documentId })));
      return { ok: true };
    }
    if (message.type === 'JALFIA_COLLECT_FRAMES') {
      const frames = (await chrome.webNavigation.getAllFrames({ tabId }) || []).filter(frame => frame.frameId !== 0 && frame.documentLifecycle !== 'cached' && frame.documentLifecycle !== 'prerender');
      const results = await Promise.allSettled(frames.map(async frame => {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'JALFIA_FRAME_SCAN' }, { frameId: frame.frameId, documentId: frame.documentId });
        if (!response?.ok) throw new Error('Frame no disponible');
        return { frameId: frame.frameId, documentId: frame.documentId, title: response.title || `Documento ${frame.frameId}`, fields: response.fields, memory: response.memory };
      }));
      return { ok: true, frames: results.filter(result => result.status === 'fulfilled').map(result => result.value), unavailable: results.filter(result => result.status === 'rejected').length };
    }
    if (!Number.isInteger(message.frameId) || message.frameId <= 0 || typeof message.documentId !== 'string' || !['options', 'fill', 'forget-memory'].includes(message.operation)) throw new Error('Solicitud de frame inválida.');
    const frame = await chrome.webNavigation.getFrame({ tabId, frameId: message.frameId });
    if (!frame || frame.documentId !== message.documentId) throw new Error('El iframe cambió o desapareció. Vuelve a analizar.');
    return await chrome.tabs.sendMessage(tabId, { type: 'JALFIA_FRAME_OPERATION', operation: message.operation, fieldId: message.fieldId, value: message.value }, { frameId: message.frameId, documentId: message.documentId });
  })().then(sendResponse, error => sendResponse({ ok: false, reason: error.message, error: error.message }));
  return true;
});
