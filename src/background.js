importScripts('ai.js');
importScripts('frames.js');
importScripts('memory.js');
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('JALFIA_')) return false;
  const supported = ['JALFIA_GET_UI_SETTINGS', 'JALFIA_SAVE_UI_SETTINGS', 'JALFIA_OPEN_AI_SETTINGS', 'JALFIA_AI_GET', 'JALFIA_AI_SAVE', 'JALFIA_AI_MODELS', 'JALFIA_AI_TEST', 'JALFIA_INTERPRET'];
  if (!supported.includes(message.type)) return false;
  (async () => {
    await storageReady;
    if (message.type.startsWith('JALFIA_AI_') && sender.url !== chrome.runtime.getURL('src/options.html')) throw new Error('Esta acción solo está disponible en los ajustes de la extensión.');
    if (message.type === 'JALFIA_GET_UI_SETTINGS') return chrome.storage.local.get('jalfiaSettings');
    if (message.type === 'JALFIA_SAVE_UI_SETTINGS') {
      const prefs = message.settings || {};
      await chrome.storage.local.set({ jalfiaSettings: { opacity: Math.min(1, Math.max(.55, Number(prefs.opacity) || .96)), darkMode: prefs.darkMode === true } });
      return { ok: true };
    }
    if (message.type === 'JALFIA_OPEN_AI_SETTINGS') { await chrome.runtime.openOptionsPage(); return { ok: true }; }
    if (message.type === 'JALFIA_INTERPRET') {
      const config = (await chrome.storage.local.get('jalfiaAI')).jalfiaAI;
      if (!config) throw new Error('Configura la IA desde Ajustes antes de interpretar el dictado.');
      return { ok: true, ...(await JalfiaAI.interpret(config, message.transcript, message.fields)) };
    }
    if (message.type === 'JALFIA_AI_GET') return { ok: true, config: (await chrome.storage.local.get('jalfiaAI')).jalfiaAI || null };
    if (message.type === 'JALFIA_AI_SAVE') {
      const config = JalfiaAI.normalizeConfig(message.config);
      await chrome.storage.local.set({ jalfiaAI: config }); return { ok: true };
    }
    if (message.type === 'JALFIA_AI_MODELS') return { ok: true, models: await JalfiaAI.listModels(message.config) };
    if (message.type === 'JALFIA_AI_TEST') return JalfiaAI.testConnection(message.config);
  })().then(sendResponse, error => sendResponse({ ok: false, error: error.message || 'No se pudo completar la operación.' }));
  return true;
});

function canRunOnTab(tab) {
  if (!tab.id || !tab.url) return false;

  try {
    const url = new URL(tab.url);
    return ['http:', 'https:', 'file:'].includes(url.protocol);
  } catch (error) {
    return false;
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!canRunOnTab(tab)) {
    console.info('JALFIA no puede ejecutarse en paginas internas del navegador.');
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'JALFIA_TOGGLE_PANEL' }, { frameId: 0 });
  } catch (error) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['src/content.js']
      });
      await chrome.tabs.sendMessage(tab.id, { type: 'JALFIA_TOGGLE_PANEL' }, { frameId: 0 });
    } catch (injectionError) {
      console.warn('JALFIA no pudo abrirse en esta pagina.', injectionError);
    }
  }
});
