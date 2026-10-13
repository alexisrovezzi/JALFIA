const form = document.getElementById('ai-settings');
const provider = document.getElementById('provider');
const baseUrl = document.getElementById('base-url');
const apiKey = document.getElementById('api-key');
const model = document.getElementById('model');
const status = document.getElementById('status');
let busy = false;
function config() { return { provider: provider.value, baseUrl: baseUrl.value, apiKey: apiKey.value, model: model.value }; }
function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
function updateProvider() {
  apiKey.required = provider.value === 'openai';
  baseUrl.readOnly = provider.value === 'openai';
  document.getElementById('url-hint').textContent = provider.value === 'openai'
    ? 'API oficial de OpenAI. Usa una clave de la plataforma API.' : 'Incluye el prefijo de API de tu servidor, por ejemplo /v1 o /api.';
}
async function run(type, text) {
  if (busy) return;
  busy = true;
  message(text);
  const controls = [...form.querySelectorAll('input, select, button')];
  controls.forEach(control => { control.disabled = true; });
  try {
    const response = await chrome.runtime.sendMessage({ type, config: config() });
    if (!response?.ok) throw new Error(response?.error || 'No se pudo completar la operación.');
    return response;
  } catch (error) { message(error.message, true); }
  finally { controls.forEach(control => { control.disabled = false; }); busy = false; }
}
provider.addEventListener('change', () => {
  // Evitar reutilizar una clave de otro proveedor por accidente.
  apiKey.value = ''; model.value = ''; document.getElementById('models').replaceChildren();
  baseUrl.value = provider.value === 'openai' ? 'https://api.openai.com/v1' : provider.value === 'local' ? 'http://localhost:8080/v1' : '';
  updateProvider(); message('Completa y guarda la configuración del proveedor elegido.');
});
document.getElementById('show-key').addEventListener('click', event => {
  const show = apiKey.type === 'password'; apiKey.type = show ? 'text' : 'password';
  event.target.textContent = show ? 'Ocultar' : 'Mostrar'; event.target.setAttribute('aria-pressed', String(show));
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const response = await run('JALFIA_AI_SAVE', 'Guardando…');
  if (response) message('Configuración guardada en esta extensión.');
});
document.getElementById('load-models').addEventListener('click', async () => {
  const response = await run('JALFIA_AI_MODELS', 'Cargando modelos…');
  if (!response) return;
  const list = document.getElementById('models'); list.replaceChildren();
  for (const id of response.models) { const option = document.createElement('option'); option.value = id; list.appendChild(option); }
  message(`${response.models.length} modelos disponibles. Selecciona uno en el campo Modelo.`);
});
document.getElementById('test').addEventListener('click', async () => {
  const response = await run('JALFIA_AI_TEST', 'Probando conexión y respuesta JSON…');
  if (response) message(`${response.message} Guarda la configuración si aún no lo hiciste.`);
});
chrome.runtime.sendMessage({ type: 'JALFIA_AI_GET' }).then(response => {
  if (!response?.ok) throw new Error(response?.error || 'No pude cargar la configuración.');
  if (response.config) {
    provider.value = response.config.provider; baseUrl.value = response.config.baseUrl;
    apiKey.value = response.config.apiKey; model.value = response.config.model;
  } else baseUrl.value = 'http://localhost:8080/v1';
  updateProvider();
}).catch(error => message(error.message, true));
