const curlInput = document.getElementById('curl-input');
const localCurl = document.getElementById('local-curl');
const responseBody = document.getElementById('response-body');
const responseMeta = document.getElementById('response-meta');
const portInput = document.getElementById('port');
const errorEl = document.getElementById('error');
const statusBadge = document.getElementById('status-badge');

let lastRequest = null;
let convertTimer = null;

const PORT_STORAGE_KEY = 'request-local-port';
const PORT_MAPPINGS_STORAGE_KEY = 'request-local-port-mappings';
const HISTORY_STORAGE_KEY = 'request-local-history';
const DEFAULT_PORT = 8000;
const HISTORY_MAX = 100;
const HISTORY_PAGE_SIZE = 20;
const BODY_STORAGE_MAX = 8000;

let history = [];
let historyPage = 1;
let portMappings = [];
let lastUsedPort = null;

const SAMPLE_CURL = `curl 'https://v8api.k0v.cn/api/datacenter/partno-info/public/?partno=09475656032&mfg=HARTING+Technology+Group' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'accept-language: zh-CN,zh;q=0.9,en;q=0.8,en-US;q=0.7' \\
  -H 'aes-code: 8e349d5a885efda86743899a2d6cb4a11781665220' \\
  -H 'authorization;' \\
  -H 'cache-control: no-cache' \\
  -b 'csrftoken=GNd07Dr7EwLQakGHhijucHjEXWwVXU5a; icgoo_sessonid=cgpdgifowh6ekvtnt1jzzu7t8bbj7puq' \\
  -H 'my-cookie: d0beaef4-4f7d-4467-a029-489af51426cd' \\
  -H 'origin: https://v8.k0v.cn' \\
  -H 'referer: https://v8.k0v.cn/' \\
  -H 'source: web' \\
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'`;

curlInput.value = SAMPLE_CURL;

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function hideError() {
  errorEl.hidden = true;
}

function setBadge(text, type) {
  statusBadge.textContent = text;
  statusBadge.className = `status-badge ${type}`;
  statusBadge.hidden = false;
}

function getPort() {
  return parseInt(portInput.value, 10) || DEFAULT_PORT;
}

function loadPort() {
  const saved = localStorage.getItem(PORT_STORAGE_KEY);
  if (!saved) return;
  const port = parseInt(saved, 10);
  if (port >= 1 && port <= 65535) {
    portInput.value = port;
  }
}

function savePort() {
  const port = parseInt(portInput.value, 10);
  if (port >= 1 && port <= 65535) {
    localStorage.setItem(PORT_STORAGE_KEY, String(port));
  }
}

function loadPortMappings() {
  try {
    const raw = localStorage.getItem(PORT_MAPPINGS_STORAGE_KEY);
    portMappings = raw ? JSON.parse(raw) : [];
    portMappings = portMappings.filter(m => m.domain && m.port);
  } catch {
    portMappings = [];
  }
  renderPortMappings();
}

function savePortMappings() {
  localStorage.setItem(PORT_MAPPINGS_STORAGE_KEY, JSON.stringify(portMappings));
}

function renderPortMappings() {
  const tbody = document.getElementById('mapping-tbody');
  const empty = document.getElementById('mapping-empty');
  const table = document.getElementById('mapping-table');

  if (portMappings.length === 0) {
    tbody.innerHTML = '';
    empty.hidden = false;
    table.hidden = true;
    return;
  }

  empty.hidden = true;
  table.hidden = false;
  tbody.innerHTML = portMappings.map((m, i) => `
    <tr>
      <td>
        <input type="text" class="mapping-input" data-idx="${i}" data-field="domain"
               value="${escapeHtml(m.domain)}" spellcheck="false" title="点击修改域名">
      </td>
      <td>
        <input type="number" class="mapping-input mapping-port-input" data-idx="${i}" data-field="port"
               value="${m.port}" min="1" max="65535" title="点击修改端口">
      </td>
      <td><button type="button" class="mapping-del" data-del-map="${i}">删除</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.mapping-input').forEach(input => {
    input.addEventListener('change', () => updateMappingField(input));
  });

  tbody.querySelectorAll('[data-del-map]').forEach(btn => {
    btn.addEventListener('click', () => {
      portMappings.splice(+btn.dataset.delMap, 1);
      savePortMappings();
      renderPortMappings();
      convert();
    });
  });
}

function normalizeDomain(raw) {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
}

function updateMappingField(input) {
  const idx = +input.dataset.idx;
  const field = input.dataset.field;
  const item = portMappings[idx];
  if (!item) return;

  if (field === 'domain') {
    const domain = normalizeDomain(input.value);
    if (!domain) {
      input.value = item.domain;
      showError('域名不能为空');
      return;
    }
    const dup = portMappings.findIndex((m, i) => i !== idx && m.domain === domain);
    if (dup >= 0) {
      input.value = item.domain;
      showError('域名已存在');
      return;
    }
    item.domain = domain;
    input.value = domain;
  } else {
    const port = parseInt(input.value, 10);
    if (port < 1 || port > 65535) {
      input.value = item.port;
      showError('端口范围 1-65535');
      return;
    }
    item.port = port;
  }

  savePortMappings();
  hideError();
  convert();
}

function addPortMapping() {
  const domainInput = document.getElementById('map-domain');
  const portMapInput = document.getElementById('map-port');
  const domain = normalizeDomain(domainInput.value);
  const port = parseInt(portMapInput.value, 10);

  if (!domain) {
    showError('请输入域名');
    return;
  }
  if (port < 1 || port > 65535) {
    showError('端口范围 1-65535');
    return;
  }

  const existing = portMappings.findIndex(m => m.domain === domain);
  if (existing >= 0) {
    portMappings[existing].port = port;
  } else {
    portMappings.push({ domain, port });
  }

  savePortMappings();
  renderPortMappings();
  domainInput.value = '';
  hideError();
  convert();
}

function convert() {
  const curl = curlInput.value.trim();
  if (!curl) {
    localCurl.value = '';
    lastRequest = null;
    lastUsedPort = null;
    updatePortHint(null, null);
    hideError();
    return false;
  }

  try {
    const data = CurlConvert.convertCurl(curl, getPort(), portMappings);
    localCurl.value = data.local_curl;
    lastRequest = data.request;
    lastUsedPort = data.used_port;
    updatePortHint(data.matched_domain, data.used_port);
    hideError();
    return true;
  } catch (e) {
    localCurl.value = '';
    lastRequest = null;
    lastUsedPort = null;
    updatePortHint(null, null);
    showError(e.message || '转换失败');
    return false;
  }
}

function updatePortHint(matchedDomain, usedPort) {
  const hint = document.getElementById('port-hint');
  if (matchedDomain && usedPort) {
    hint.textContent = `${matchedDomain} → ${usedPort}`;
    hint.hidden = false;
  } else if (usedPort && usedPort !== getPort()) {
    hint.textContent = `使用端口 ${usedPort}`;
    hint.hidden = false;
  } else {
    hint.hidden = true;
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    history = raw ? JSON.parse(raw) : [];
    if (history.length > HISTORY_MAX) {
      history.length = HISTORY_MAX;
      saveHistory();
    }
  } catch {
    history = [];
  }
  historyPage = 1;
  renderHistory();
}

function saveHistory() {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function formatTime(ts) {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function addHistory(entry) {
  history.unshift(entry);
  if (history.length > HISTORY_MAX) {
    history.length = HISTORY_MAX;
  }
  historyPage = 1;
  saveHistory();
  renderHistory();
}

function getHistoryPageData() {
  const total = history.length;
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  if (historyPage > totalPages) historyPage = totalPages;
  if (historyPage < 1) historyPage = 1;
  const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
  return {
    items: history.slice(start, start + HISTORY_PAGE_SIZE),
    total,
    totalPages,
    page: historyPage,
  };
}

function renderHistory() {
  const tbody = document.getElementById('history-tbody');
  const empty = document.getElementById('history-empty');
  const table = document.getElementById('history-table');
  const pagination = document.getElementById('history-pagination');
  const pageInfo = document.getElementById('history-page-info');
  const prevBtn = document.getElementById('history-prev');
  const nextBtn = document.getElementById('history-next');

  if (history.length === 0) {
    tbody.innerHTML = '';
    empty.hidden = false;
    table.hidden = true;
    pagination.hidden = true;
    return;
  }

  const { items, total, totalPages, page } = getHistoryPageData();

  empty.hidden = true;
  table.hidden = false;
  pagination.hidden = false;
  pageInfo.textContent = `共 ${total} 条，第 ${page}/${totalPages} 页（每页 ${HISTORY_PAGE_SIZE} 条，最多保存 ${HISTORY_MAX} 条）`;
  prevBtn.disabled = page <= 1;
  nextBtn.disabled = page >= totalPages;

  tbody.innerHTML = items.map(item => {
    const statusClass = item.success && item.status >= 200 && item.status < 300 ? 'ok' : 'err';
    const statusText = item.status ?? (item.error ? '失败' : '-');
    const elapsed = item.elapsed_ms != null ? `${item.elapsed_ms} ms` : '-';
    return `
      <tr>
        <td>${formatTime(item.time)}</td>
        <td>${item.method || 'GET'}</td>
        <td class="history-url" title="${escapeHtml(item.url || '')}">${escapeHtml(item.url || '-')}</td>
        <td><span class="history-status ${statusClass}">${statusText}</span></td>
        <td>${elapsed}</td>
        <td class="history-actions">
          <button type="button" class="history-btn" data-view="${item.id}">查看</button>
          <button type="button" class="history-btn" data-replay="${item.id}">重发</button>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => viewHistory(+btn.dataset.view));
  });
  tbody.querySelectorAll('[data-replay]').forEach(btn => {
    btn.addEventListener('click', () => replayHistory(+btn.dataset.replay));
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function findHistory(id) {
  return history.find(h => h.id === id);
}

async function viewHistory(id) {
  const item = findHistory(id);
  if (!item) return;

  curlInput.value = item.originalCurl || '';
  portInput.value = item.port || DEFAULT_PORT;
  savePort();
  localCurl.value = item.localCurl || '';
  lastRequest = item.request || null;

  if (item.success && item.status != null) {
    const statusClass = item.status >= 200 && item.status < 300 ? 'ok' : 'err';
    setBadge(String(item.status), statusClass);
    responseMeta.textContent = item.elapsed_ms != null ? `${item.elapsed_ms} ms` : '';
    responseBody.value = item.body || '';
  } else {
    statusBadge.hidden = true;
    responseMeta.textContent = '';
    responseBody.value = item.error || item.body || '';
  }

  if (!lastRequest && item.originalCurl) {
    await convert();
  }
  hideError();
}

async function replayHistory(id) {
  await viewHistory(id);
  await sendRequest();
}

function recordSendResult(curl, data) {
  const body = data.body || data.error || '';
  addHistory({
    id: Date.now(),
    time: Date.now(),
    port: lastUsedPort || getPort(),
    method: lastRequest?.method || 'GET',
    url: lastRequest?.url || '',
    originalCurl: curl,
    localCurl: localCurl.value,
    request: lastRequest ? { ...lastRequest } : null,
    status: data.status ?? null,
    elapsed_ms: data.elapsed_ms ?? null,
    body: body.slice(0, BODY_STORAGE_MAX),
    error: data.ok ? null : (data.error || null),
    success: data.ok && data.status != null,
  });
}

async function sendRequest() {
  const curl = curlInput.value.trim();
  if (!curl) {
    showError('请先粘贴 curl 命令');
    return;
  }

  if (!lastRequest && !convert()) return;

  setBadge('发送中...', 'loading');
  responseBody.value = '';
  responseMeta.textContent = '';
  hideError();

  try {
    const res = await fetch('/api/request-local/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: lastRequest }),
    });
    const data = await res.json();

    if (!data.ok) {
      setBadge('失败', 'err');
      showError(data.error || '请求失败');
      responseBody.value = data.error || '';
      recordSendResult(curl, data);
      return;
    }

    const statusClass = data.status >= 200 && data.status < 300 ? 'ok' : 'err';
    setBadge(`${data.status}`, statusClass);
    responseMeta.textContent = `${data.elapsed_ms} ms`;
    responseBody.value = data.body || '';
    hideError();
    recordSendResult(curl, data);
  } catch {
    setBadge('失败', 'err');
    showError('发送请求失败');
    recordSendResult(curl, { ok: false, error: '发送请求失败' });
  }
}

async function pasteAndSend() {
  const btn = document.getElementById('paste-send-btn');
  btn.disabled = true;

  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      showError('剪贴板为空');
      return;
    }
    curlInput.value = text.trim();
    const converted = await convert();
    if (!converted) return;
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
}

document.getElementById('convert-btn').addEventListener('click', convert);
document.getElementById('send-btn').addEventListener('click', sendRequest);
document.getElementById('paste-send-btn').addEventListener('click', pasteAndSend);
document.getElementById('add-mapping').addEventListener('click', addPortMapping);

const mappingModal = document.getElementById('mapping-modal');

function openMappingModal() {
  mappingModal.hidden = false;
  renderPortMappings();
}

function closeMappingModal() {
  mappingModal.hidden = true;
}

document.getElementById('open-mapping-btn').addEventListener('click', openMappingModal);
document.getElementById('mapping-modal-close').addEventListener('click', closeMappingModal);
document.getElementById('mapping-modal-done').addEventListener('click', closeMappingModal);
mappingModal.addEventListener('click', (e) => {
  if (e.target === mappingModal) closeMappingModal();
});

document.getElementById('map-domain').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addPortMapping();
});
document.getElementById('map-port').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addPortMapping();
});

curlInput.addEventListener('input', () => {
  clearTimeout(convertTimer);
  convertTimer = setTimeout(convert, 400);
});

portInput.addEventListener('input', savePort);
portInput.addEventListener('change', () => {
  savePort();
  convert();
});

document.getElementById('clear-input').addEventListener('click', () => {
  curlInput.value = '';
  localCurl.value = '';
  responseBody.value = '';
  responseMeta.textContent = '';
  statusBadge.hidden = true;
  lastRequest = null;
  hideError();
  curlInput.focus();
});

document.getElementById('copy-local').addEventListener('click', async () => {
  if (!localCurl.value) return;
  const btn = document.getElementById('copy-local');
  try {
    await navigator.clipboard.writeText(localCurl.value);
    btn.textContent = '已复制';
  } catch {
    localCurl.select();
    document.execCommand('copy');
    btn.textContent = '已复制';
  }
  setTimeout(() => { btn.textContent = '复制'; }, 1500);
});

document.getElementById('clear-history').addEventListener('click', () => {
  if (history.length === 0) return;
  if (!confirm('确定清空所有发送历史？')) return;
  history = [];
  historyPage = 1;
  saveHistory();
  renderHistory();
});

document.getElementById('history-prev').addEventListener('click', () => {
  if (historyPage > 1) {
    historyPage -= 1;
    renderHistory();
  }
});

document.getElementById('history-next').addEventListener('click', () => {
  const totalPages = Math.ceil(history.length / HISTORY_PAGE_SIZE);
  if (historyPage < totalPages) {
    historyPage += 1;
    renderHistory();
  }
});

loadPort();
loadPortMappings();
loadHistory();
convert();
