const responseViewer = ResponseViewer.create(document.getElementById('response-viewer'));
const responseMeta = document.getElementById('response-meta');
const errorEl = document.getElementById('error');
const statusBadge = document.getElementById('status-badge');
const useLocalCheckbox = document.getElementById('use-local');
const portInput = document.getElementById('port');
const portHint = document.getElementById('port-hint');
const fileResult = document.getElementById('file-result');
const fileResultName = document.getElementById('file-result-name');
const fileResultMeta = document.getElementById('file-result-meta');
const fileResultIcon = document.getElementById('file-result-icon');

let lastRequest = null;
let lastOriginalCurl = '';
let skipClearOriginalCurl = false;
let portMappings = [];
let lastUsedPort = null;
let lastBlob = null;
let lastFilename = '';
let lastContentType = '';
let lastBlobUrl = '';
let lastBodyBase64 = '';

const PORT_STORAGE_KEY = 'request-view-port';
const USE_LOCAL_KEY = 'request-view-use-local';
const PORT_MAPPINGS_STORAGE_KEY = 'request-local-port-mappings';
const DEFAULT_PORT = 8000;

const FILENAME_BY_TYPE = {
  'application/pdf': 'download.pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'download.xlsx',
  'application/vnd.ms-excel': 'download.xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'download.docx',
  'application/msword': 'download.doc',
  'application/zip': 'download.zip',
  'text/csv': 'download.csv',
};

const ICON_BY_TYPE = {
  pdf: '📕',
  spreadsheet: '📊',
  excel: '📊',
  word: '📘',
  zip: '🗜️',
  image: '🖼️',
  default: '📄',
};

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function hideError() {
  errorEl.hidden = true;
}

function setBadge(text, type) {
  if (type === 'loading') {
    statusBadge.innerHTML = '<span class="status-spinner" aria-hidden="true"></span><span>发送中...</span>';
    statusBadge.className = 'status-badge loading';
  } else {
    statusBadge.textContent = text;
    statusBadge.className = `status-badge ${type}`;
  }
  statusBadge.hidden = false;
}

function setSending(active) {
  RequestSendUI.setSending(active);
}

function getPort() {
  return parseInt(portInput.value, 10) || DEFAULT_PORT;
}

function loadPort() {
  const saved = localStorage.getItem(PORT_STORAGE_KEY);
  if (saved) {
    const port = parseInt(saved, 10);
    if (port >= 1 && port <= 65535) portInput.value = port;
  }
  useLocalCheckbox.checked = localStorage.getItem(USE_LOCAL_KEY) === '1';
  syncPortInputState();
}

function savePort() {
  const port = parseInt(portInput.value, 10);
  if (port >= 1 && port <= 65535) {
    localStorage.setItem(PORT_STORAGE_KEY, String(port));
  }
  localStorage.setItem(USE_LOCAL_KEY, useLocalCheckbox.checked ? '1' : '0');
}

function loadPortMappings() {
  try {
    const raw = localStorage.getItem(PORT_MAPPINGS_STORAGE_KEY);
    portMappings = raw ? JSON.parse(raw) : [];
    portMappings = portMappings.filter(m => m.domain && m.port);
  } catch {
    portMappings = [];
  }
}

function syncPortInputState() {
  portInput.disabled = !useLocalCheckbox.checked;
}

function updatePortHint(matchedDomain, usedPort) {
  if (!useLocalCheckbox.checked) {
    portHint.hidden = true;
    return;
  }
  if (matchedDomain && usedPort) {
    portHint.textContent = `${matchedDomain} → ${usedPort}`;
    portHint.hidden = false;
  } else if (usedPort && usedPort !== getPort()) {
    portHint.textContent = `使用端口 ${usedPort}`;
    portHint.hidden = false;
  } else {
    portHint.hidden = true;
  }
}

function applyPreviewRequest(request) {
  lastRequest = request;
  if (!skipClearOriginalCurl) lastOriginalCurl = '';
}

function buildRequestFromParsed(parsed) {
  return {
    url: parsed.url,
    method: parsed.method,
    headers: { ...parsed.headers },
    body: parsed.body,
    bodyMeta: parsed.bodyMeta,
  };
}

function convertFromCurl(curl) {
  const text = curl.trim();
  if (!text) {
    lastOriginalCurl = '';
    lastRequest = null;
    lastUsedPort = null;
    updatePortHint(null, null);
    RequestPreview.clear();
    hideError();
    return false;
  }

  try {
    if (useLocalCheckbox.checked) {
      const data = CurlConvert.convertCurl(text, getPort(), portMappings);
      lastOriginalCurl = text;
      lastRequest = data.request;
      lastUsedPort = data.used_port;
      updatePortHint(data.matched_domain, data.used_port);
    } else {
      const parsed = CurlConvert.parseCurl(text);
      lastOriginalCurl = text;
      lastRequest = buildRequestFromParsed(parsed);
      lastUsedPort = null;
      updatePortHint(null, null);
    }
    skipClearOriginalCurl = true;
    RequestPreview.populate(lastRequest);
    skipClearOriginalCurl = false;
    hideError();
    return true;
  } catch (e) {
    lastOriginalCurl = text;
    lastRequest = null;
    lastUsedPort = null;
    updatePortHint(null, null);
    RequestPreview.clear();
    RequestPreview.setUrlBar(text);
    showError(e.message || '解析失败');
    return false;
  }
}

function reconvert() {
  if (lastOriginalCurl) convertFromCurl(lastOriginalCurl);
}

function revokeBlobUrl() {
  if (lastBlobUrl) {
    URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = '';
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function guessFilename(contentType) {
  const ct = (contentType || '').toLowerCase();
  if (FILENAME_BY_TYPE[ct]) return FILENAME_BY_TYPE[ct];
  return 'download.bin';
}

function pickFileIcon(contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('pdf')) return ICON_BY_TYPE.pdf;
  if (ct.includes('spreadsheet') || ct.includes('excel')) return ICON_BY_TYPE.spreadsheet;
  if (ct.includes('word')) return ICON_BY_TYPE.word;
  if (ct.includes('zip')) return ICON_BY_TYPE.zip;
  if (ct.startsWith('image/')) return ICON_BY_TYPE.image;
  return ICON_BY_TYPE.default;
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function canOpenInBrowser(contentType) {
  const ct = (contentType || '').toLowerCase();
  return ct.includes('pdf')
    || ct.startsWith('image/')
    || ct.startsWith('text/')
    || ct.includes('json')
    || ct.includes('html');
}

async function openFileWithSystem(base64, filename) {
  const res = await fetch('/api/request-view/open-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: base64, filename }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '无法用系统应用打开文件');
  return data.path;
}

async function openFileAuto(blob, contentType, base64, filename) {
  if (canOpenInBrowser(contentType)) {
    return openBlob(blob, contentType);
  }
  await openFileWithSystem(base64, filename);
  return true;
}

function downloadBlob(blob, filename) {
  revokeBlobUrl();
  lastBlobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = lastBlobUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openBlob(blob, contentType) {
  if (!canOpenInBrowser(contentType)) return false;
  revokeBlobUrl();
  lastBlobUrl = URL.createObjectURL(blob);
  const opened = window.open(lastBlobUrl, '_blank');
  if (!opened) return false;
  setTimeout(() => {
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = '';
  }, 120000);
  return true;
}

function showFileResult(filename, size, contentType) {
  fileResult.hidden = false;
  fileResultIcon.textContent = pickFileIcon(contentType);
  fileResultName.textContent = filename;
  fileResultMeta.textContent = `${contentType || '未知类型'} · ${formatSize(size)}`;
  document.getElementById('response-viewer').hidden = true;
}

function hideFileResult() {
  fileResult.hidden = true;
  document.getElementById('response-viewer').hidden = false;
}

async function handleBinaryResponse(data) {
  const bytes = base64ToUint8Array(data.body);
  const blob = new Blob([bytes], { type: data.content_type || 'application/octet-stream' });
  const filename = data.filename || guessFilename(data.content_type);

  lastBlob = blob;
  lastFilename = filename;
  lastContentType = data.content_type || blob.type;
  lastBodyBase64 = data.body;

  downloadBlob(blob, filename);

  let opened = false;
  try {
    opened = await openFileAuto(blob, lastContentType, data.body, filename);
    if (opened) hideError();
  } catch (e) {
    showError(e.message || '文件已下载，但无法用系统应用打开');
  }

  showFileResult(filename, blob.size, lastContentType);
  responseViewer.clear();
}

function handleTextResponse(data) {
  hideFileResult();
  responseViewer.setText(data.body || '');
}

async function sendRequest() {
  lastRequest = RequestPreview.buildRequest();

  if (!lastRequest?.url) {
    showError('请先粘贴 curl 或输入请求 URL');
    return;
  }

  setSending(true);
  setBadge('', 'loading');
  responseViewer.clear();
  hideFileResult();
  responseMeta.textContent = '';
  hideError();

  const signal = RequestSendUI.createSignal();

  try {
    const res = await fetch('/api/request-local/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: lastRequest, prefer_binary: true }),
      signal,
    });
    const data = await res.json();

    if (!data.ok) {
      setBadge('失败', 'err');
      showError(data.error || '请求失败');
      if (data.body_encoding === 'base64' && data.body) {
        await handleBinaryResponse(data);
      } else {
        responseViewer.setText(data.error || data.body || '');
      }
      return;
    }

    const statusClass = data.status >= 200 && data.status < 300 ? 'ok' : 'err';
    setBadge(String(data.status), statusClass);
    responseMeta.textContent = `${data.elapsed_ms} ms`;

    if (data.body_encoding === 'base64' && data.body) {
      await handleBinaryResponse(data);
    } else {
      handleTextResponse(data);
      hideError();
    }
  } catch (err) {
    if (RequestSendUI.isAbortError(err)) {
      setBadge('已取消', 'err');
      showError('请求已取消');
      return;
    }
    setBadge('失败', 'err');
    showError('发送请求失败');
  } finally {
    RequestSendUI.clearAbort();
    setSending(false);
  }
}

document.getElementById('open-file-btn').addEventListener('click', async () => {
  if (!lastBlob || !lastBodyBase64) return;
  try {
    const opened = await openFileAuto(lastBlob, lastContentType, lastBodyBase64, lastFilename);
    if (!opened) showError('无法在浏览器中打开该文件');
    else hideError();
  } catch (e) {
    showError(e.message || '打开失败');
  }
});

document.getElementById('download-file-btn').addEventListener('click', () => {
  if (!lastBlob || !lastFilename) return;
  downloadBlob(lastBlob, lastFilename);
  hideError();
});

document.getElementById('send-btn').addEventListener('click', sendRequest);

document.getElementById('paste-send-btn').addEventListener('click', async () => {
  const btn = document.getElementById('paste-send-btn');
  btn.disabled = true;
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      showError('剪贴板为空');
      return;
    }
    if (!convertFromCurl(text.trim())) return;
    await sendRequest();
  } catch (err) {
    if (err?.name === 'NotAllowedError') {
      showError('无法读取剪贴板，请允许浏览器权限或手动粘贴');
    } else {
      showError('读取剪贴板失败');
    }
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('clear-preview').addEventListener('click', () => {
  lastOriginalCurl = '';
  lastRequest = null;
  lastBlob = null;
  lastFilename = '';
  lastBodyBase64 = '';
  revokeBlobUrl();
  RequestPreview.clear();
  responseViewer.clear();
  hideFileResult();
  responseMeta.textContent = '';
  statusBadge.hidden = true;
  hideError();
  document.getElementById('preview-url').focus();
});

useLocalCheckbox.addEventListener('change', () => {
  syncPortInputState();
  savePort();
  reconvert();
});

portInput.addEventListener('change', () => {
  savePort();
  reconvert();
});

loadPortMappings();
loadPort();

RequestSendUI.init();

RequestPreview.init({
  onChange: (request) => applyPreviewRequest(request),
  onPasteCurl: (curl) => convertFromCurl(curl),
});

RequestPreview.restoreFromStorage();
