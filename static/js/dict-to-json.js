const input = document.getElementById('input');
const dictEditor = LineEditor.init(input, { dark: false });
const jsonPanel = JsonPanel.init({
  textEl: document.getElementById('json-text'),
  helperSelector: '#json-viewer-helper .response-viewer-wrap',
  expandTitle: 'JSON',
  copyBtn: document.getElementById('copy-output'),
  expandBtn: document.getElementById('expand-json'),
  onChange: () => scheduleSyncFromJson(),
});
const errorEl = document.getElementById('error');

const DEBOUNCE_MS = 250;
let syncing = false;
let dictTimer = null;
let jsonTimer = null;

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function hideError() {
  errorEl.hidden = true;
}

async function apiConvert(text, direction) {
  const res = await fetch('/api/dict-to-json/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, direction }),
  });
  return res.json();
}

async function syncFromDict() {
  if (syncing) return;
  const text = input.value;

  syncing = true;
  try {
    if (!text.trim()) {
      jsonPanel.clear();
      hideError();
      return;
    }

    const data = await apiConvert(text, 'to_json');
    if (data.ok) {
      jsonPanel.setValue(data.result);
      hideError();
    } else {
      showError(data.error);
    }
  } catch {
    showError('请求失败，请确认服务已启动');
  } finally {
    syncing = false;
  }
}

async function syncFromJson() {
  if (syncing) return;
  const text = jsonPanel.getValue();

  syncing = true;
  try {
    if (!text.trim()) {
      input.value = '';
      dictEditor?.updateLines();
      hideError();
      return;
    }

    const data = await apiConvert(text, 'to_dict');
    if (data.ok) {
      input.value = data.result;
      dictEditor?.updateLines();
      hideError();
    } else {
      showError(data.error);
    }
  } catch {
    showError('请求失败，请确认服务已启动');
  } finally {
    syncing = false;
  }
}

function scheduleSyncFromDict() {
  clearTimeout(dictTimer);
  dictTimer = setTimeout(syncFromDict, DEBOUNCE_MS);
}

function scheduleSyncFromJson() {
  clearTimeout(jsonTimer);
  jsonTimer = setTimeout(syncFromJson, DEBOUNCE_MS);
}

function clearAll() {
  syncing = true;
  input.value = '';
  jsonPanel.clear();
  dictEditor?.updateLines();
  syncing = false;
  hideError();
}

function bindAutoSync(el, schedule) {
  el.addEventListener('input', schedule);
  el.addEventListener('paste', schedule);
}

bindAutoSync(input, scheduleSyncFromDict);
bindAutoSync(jsonPanel.textEl, scheduleSyncFromJson);

document.getElementById('clear-input').addEventListener('click', () => {
  clearAll();
  input.focus();
});

document.getElementById('clear-json').addEventListener('click', () => {
  clearAll();
  jsonPanel.textEl.focus();
});

document.getElementById('copy-input').addEventListener('click', () => {
  JsonPanel.copyWithFeedback(document.getElementById('copy-input'), input.value);
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    if (document.activeElement === jsonPanel.textEl) return;
    e.preventDefault();
    if (jsonPanel.getValue().trim()) {
      jsonPanel.jsonPreview?.setText(jsonPanel.getValue());
      jsonPanel.jsonPreview?.openSearch();
    }
  }
});

const backToTopBtn = document.getElementById('back-to-top');

function updateBackToTop() {
  if (!backToTopBtn) return;
  backToTopBtn.hidden = window.scrollY < 200;
}

backToTopBtn?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

window.addEventListener('scroll', updateBackToTop, { passive: true });
updateBackToTop();
