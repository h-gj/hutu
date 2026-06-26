const responseViewer = ResponseViewer.create(document.getElementById('response-viewer'));
const responseMeta = document.getElementById('response-meta');
const portInput = document.getElementById('port');
const errorEl = document.getElementById('error');
const statusBadge = document.getElementById('status-badge');

let lastRequest = null;
let lastOriginalCurl = '';
let lastResponse = null;

const PORT_STORAGE_KEY = 'request-local-port';
const PORT_MAPPINGS_STORAGE_KEY = 'request-local-port-mappings';
const SUBMITTER_NAME_KEY = 'request-local-submitter-name';
const HISTORY_STORAGE_KEY = 'request-local-history';
const DEFAULT_PORT = 8000;
const HISTORY_MAX = 100;
const HISTORY_PAGE_SIZE = 20;
const BODY_STORAGE_MAX = 8000;

let history = [];
let historyPage = 1;
let serverHistory = [];
let serverHistoryPage = 1;
let activePanelTab = 'history';
let pendingDevCurl = null;
let portMappings = [];
let lastUsedPort = null;
let skipClearOriginalCurl = false;

const shareBar = document.getElementById('rl-share-bar');
const shareUrlInput = document.getElementById('rl-share-url');
const shareStatusEl = document.getElementById('rl-share-status');
const shareHintEl = document.getElementById('rl-share-hint');
const shareRequestBtn = document.getElementById('share-request');

const SHARE_SAVE_DEBOUNCE_MS = 800;
let shareId = null;
let shareSaveTimer = null;
let isApplyingShare = false;
let isSharing = false;

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

function getLocalCurl() {
  if (!lastRequest) return '';
  return CurlConvert.buildCurlFromRequest(lastRequest);
}

function getRecordCurl() {
  return lastOriginalCurl || getLocalCurl();
}

function buildShareSnapshot() {
  const request = lastRequest || RequestPreview.buildRequest();
  const snapshot = {
    curl: getRecordCurl(),
    port: getPort(),
    portMappings: portMappings.map(m => ({ domain: m.domain, port: m.port })),
    request: request?.url ? request : null,
  };
  const response = buildResponseSnapshot();
  if (response) snapshot.response = response;
  return snapshot;
}

function buildResponseSnapshot() {
  if (!lastResponse) return null;
  const body = lastResponse.body || lastResponse.error || responseViewer.getText() || '';
  if (!body.trim() && lastResponse.status == null) return null;
  return {
    ok: Boolean(lastResponse.ok),
    status: lastResponse.status ?? null,
    elapsed_ms: lastResponse.elapsed_ms ?? null,
    body: body.slice(0, BODY_STORAGE_MAX),
    error: lastResponse.error || null,
  };
}

function applyResponseSnapshot(response) {
  if (!response || (!response.body && !response.error && response.status == null)) {
    lastResponse = null;
    statusBadge.hidden = true;
    responseMeta.textContent = '';
    responseViewer.clear();
    return;
  }

  lastResponse = { ...response };

  if (response.status != null) {
    const statusClass = response.ok && response.status >= 200 && response.status < 300 ? 'ok' : 'err';
    setBadge(String(response.status), statusClass);
    responseMeta.textContent = response.elapsed_ms != null ? `${response.elapsed_ms} ms` : '';
    responseViewer.setText(response.body || response.error || '');
    return;
  }

  statusBadge.hidden = true;
  responseMeta.textContent = '';
  responseViewer.setText(response.error || response.body || '');
}

function showShareBar(id) {
  if (!shareBar || !shareUrlInput) return null;
  const shareUrl = RequestShare.buildPageUrl(id);
  shareUrlInput.value = shareUrl;
  shareBar.removeAttribute('hidden');
  if (shareHintEl) shareHintEl.hidden = true;
  if (shareRequestBtn) shareRequestBtn.textContent = '复制分享链接';
  shareBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return shareUrl;
}

function hideShareUi() {
  if (shareBar) shareBar.setAttribute('hidden', '');
  if (shareHintEl) shareHintEl.hidden = false;
  if (shareRequestBtn) shareRequestBtn.textContent = '分享';
}

function setShareId(id) {
  shareId = id;
  const shareUrl = showShareBar(id);
  try {
    RequestShare.setPageUrl(id);
  } catch {
    /* ignore URL update errors */
  }
  return shareUrl;
}

function scheduleShareSave() {
  if (!shareId || isApplyingShare) return;
  clearTimeout(shareSaveTimer);
  shareSaveTimer = setTimeout(saveShareSnapshot, SHARE_SAVE_DEBOUNCE_MS);
}

async function saveShareSnapshot() {
  if (!shareId || isApplyingShare) return;
  try {
    await RequestShare.save(shareId, buildShareSnapshot());
    if (shareStatusEl) {
      shareStatusEl.hidden = false;
      clearTimeout(saveShareSnapshot._hideTimer);
      saveShareSnapshot._hideTimer = setTimeout(() => {
        shareStatusEl.hidden = true;
      }, 2000);
    }
  } catch {
    /* ignore */
  }
}

async function copyWithFeedback(btn, text) {
  if (!btn) return;
  const copyText = text || shareUrlInput?.value || (shareId ? RequestShare.buildPageUrl(shareId) : '');
  if (!copyText) return;
  const orig = btn.textContent;
  try {
    await navigator.clipboard.writeText(copyText);
  } catch {
    /* fallback below */
  }
  btn.textContent = '已复制';
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

function hasShareableContent() {
  const snapshot = buildShareSnapshot();
  return Boolean(snapshot.curl?.trim() || snapshot.request?.url?.trim());
}

async function shareDocument() {
  if (isSharing) return;

  if (!hasShareableContent()) {
    shareRequestBtn.textContent = '内容为空';
    setTimeout(() => {
      shareRequestBtn.textContent = shareId ? '复制分享链接' : '分享';
    }, 1500);
    return;
  }

  if (shareId) {
    const shareUrl = showShareBar(shareId) || RequestShare.buildPageUrl(shareId);
    await copyWithFeedback(shareRequestBtn, shareUrl);
    return;
  }

  const orig = shareRequestBtn.textContent;
  isSharing = true;
  shareRequestBtn.disabled = true;
  shareRequestBtn.textContent = '生成中…';
  try {
    const id = await RequestShare.create(buildShareSnapshot());
    const shareUrl = setShareId(id) || RequestShare.buildPageUrl(id);
    if (shareStatusEl) {
      shareStatusEl.hidden = false;
      shareStatusEl.textContent = '已生成分享链接';
    }
    await copyWithFeedback(shareRequestBtn, shareUrl);
  } catch {
    shareRequestBtn.textContent = '分享失败';
    setTimeout(() => { shareRequestBtn.textContent = orig; }, 1500);
  } finally {
    isSharing = false;
    shareRequestBtn.disabled = false;
  }
}

function applyShareSnapshot(data, { persistLocal = false } = {}) {
  isApplyingShare = true;
  try {
    if (data.port >= 1 && data.port <= 65535) {
      portInput.value = data.port;
      if (persistLocal) savePort();
    }
    if (Array.isArray(data.portMappings)) {
      portMappings = data.portMappings.filter(m => m?.domain && m?.port);
      renderPortMappings();
      if (persistLocal) savePortMappings();
    }
    if (data.request?.url) {
      lastOriginalCurl = data.curl || '';
      lastRequest = data.request;
      skipClearOriginalCurl = true;
      RequestPreview.populate(lastRequest);
      skipClearOriginalCurl = false;
      if (lastOriginalCurl) {
        try {
          const converted = CurlConvert.convertCurl(lastOriginalCurl, getPort(), portMappings);
          lastUsedPort = converted.used_port;
          updatePortHint(converted.matched_domain, converted.used_port);
        } catch {
          lastUsedPort = getPort();
          updatePortHint(null, lastUsedPort);
        }
      } else {
        lastUsedPort = getPort();
        updatePortHint(null, lastUsedPort);
      }
    } else if (data.curl?.trim()) {
      convertFromCurl(data.curl);
    }
    applyResponseSnapshot(data.response);
    hideError();
  } finally {
    isApplyingShare = false;
  }
}

async function loadSharedSnapshot(id) {
  try {
    const content = await RequestShare.load(id);
    applyShareSnapshot(content);
    setShareId(id);
  } catch (err) {
    showError(err.message || '加载分享失败');
    RequestShare.clearPageUrl();
    convertFromCurl(SAMPLE_CURL);
  }
}

async function generateApiDoc() {
  const request = lastRequest || RequestPreview.buildRequest();
  if (!request?.url?.trim()) {
    showError('请先配置请求 URL');
    return;
  }

  const response = lastResponse ? { ...lastResponse } : {
    status: null,
    elapsed_ms: null,
    body: responseViewer.getText() || '',
  };

  if (!response.body && responseViewer.getText()) {
    response.body = responseViewer.getText();
  }

  const markdown = ApiDocGenerator.generate(request, response, {
    originalCurl: getRecordCurl(),
    localCurl: getLocalCurl(),
  });

  const btn = document.getElementById('gen-api-doc-btn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/markdown-doc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: markdown }),
    });
    const data = await res.json();
    if (!data.ok) {
      showError(data.error || '创建文档失败');
      return;
    }
    hideError();
    window.open(data.url, '_blank');
  } catch {
    showError('创建文档失败');
  } finally {
    btn.disabled = false;
  }
}

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
      reconvert();
      scheduleShareSave();
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
  reconvert();
  scheduleShareSave();
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
  reconvert();
  scheduleShareSave();
}

function applyPreviewRequest(request) {
  lastRequest = request;
  if (!skipClearOriginalCurl) lastOriginalCurl = '';
  scheduleShareSave();
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
    const data = CurlConvert.convertCurl(text, getPort(), portMappings);
    lastOriginalCurl = text;
    lastRequest = data.request;
    lastUsedPort = data.used_port;
    updatePortHint(data.matched_domain, data.used_port);
    skipClearOriginalCurl = true;
    RequestPreview.populate(lastRequest);
    skipClearOriginalCurl = false;
    hideError();
    scheduleShareSave();
    return true;
  } catch (e) {
    lastOriginalCurl = text;
    lastRequest = null;
    lastUsedPort = null;
    updatePortHint(null, null);
    RequestPreview.clear();
    RequestPreview.setUrlBar(text);
    showError(e.message || '转换失败');
    return false;
  }
}

function reconvert() {
  if (lastOriginalCurl) {
    convertFromCurl(lastOriginalCurl);
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
  if (activePanelTab === 'history') {
    historyPage = 1;
    renderHistory();
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
}

async function loadServerHistory() {
  try {
    const res = await fetch('/api/request-local/dev-submissions');
    const data = await res.json();
    serverHistory = data.ok ? (data.items || []) : [];
  } catch {
    serverHistory = [];
  }
  if (activePanelTab === 'feedback') {
    serverHistoryPage = 1;
    renderHistory();
  }
}

function switchPanelTab(panel) {
  activePanelTab = panel;
  document.querySelectorAll('.section-panel-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panel);
  });
  document.getElementById('clear-history').hidden = panel !== 'history';
  document.getElementById('panel-desc').textContent = panel === 'history'
    ? '本地发送记录'
    : '提交给开发的 curl 记录';
  if (panel === 'history') {
    historyPage = 1;
    renderHistory();
  } else {
    loadServerHistory();
  }
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
  if (activePanelTab === 'history') renderHistory();
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

function getServerHistoryPageData() {
  const total = serverHistory.length;
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  if (serverHistoryPage > totalPages) serverHistoryPage = totalPages;
  if (serverHistoryPage < 1) serverHistoryPage = 1;
  const start = (serverHistoryPage - 1) * HISTORY_PAGE_SIZE;
  return {
    items: serverHistory.slice(start, start + HISTORY_PAGE_SIZE),
    total,
    totalPages,
    page: serverHistoryPage,
  };
}

function renderHistoryHead() {
  const thead = document.getElementById('history-thead');
  if (activePanelTab === 'history') {
    thead.innerHTML = `
      <tr>
        <th width="150">时间</th>
        <th width="60">方法</th>
        <th>URL</th>
        <th width="70">状态</th>
        <th width="70">耗时</th>
        <th width="120">操作</th>
      </tr>`;
  } else {
    thead.innerHTML = `
      <tr>
        <th width="150">时间</th>
        <th width="80">提交人</th>
        <th width="60">方法</th>
        <th>URL</th>
        <th width="120">操作</th>
      </tr>`;
  }
}

function renderHistory() {
  renderHistoryHead();
  const tbody = document.getElementById('history-tbody');
  const empty = document.getElementById('history-empty');
  const table = document.getElementById('history-table');
  const pagination = document.getElementById('history-pagination');
  const pageInfo = document.getElementById('history-page-info');
  const prevBtn = document.getElementById('history-prev');
  const nextBtn = document.getElementById('history-next');

  const isLocal = activePanelTab === 'history';
  const pageData = isLocal ? getHistoryPageData() : getServerHistoryPageData();
  const { items, total, totalPages, page } = pageData;

  if (total === 0) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = isLocal ? '暂无本地发送记录' : '暂无测试提交';
    table.hidden = true;
    pagination.hidden = true;
    return;
  }

  empty.hidden = true;
  table.hidden = false;
  pagination.hidden = false;

  const maxLabel = isLocal ? `最多保存 ${HISTORY_MAX} 条` : `服务器最多 ${HISTORY_MAX} 条`;
  pageInfo.textContent = `共 ${total} 条，第 ${page}/${totalPages} 页（每页 ${HISTORY_PAGE_SIZE} 条，${maxLabel}）`;
  prevBtn.disabled = page <= 1;
  nextBtn.disabled = page >= totalPages;

  if (isLocal) {
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
            <button type="button" class="history-btn" data-view-local="${item.id}">查看</button>
            <button type="button" class="history-btn" data-replay-local="${item.id}">重发</button>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-view-local]').forEach(btn => {
      btn.addEventListener('click', () => viewHistory(+btn.dataset.viewLocal));
    });
    tbody.querySelectorAll('[data-replay-local]').forEach(btn => {
      btn.addEventListener('click', () => replayHistory(+btn.dataset.replayLocal));
    });
  } else {
    tbody.innerHTML = items.map(item => `
      <tr>
        <td>${formatTime(item.time)}</td>
        <td>${escapeHtml(item.submitter || '未知')}</td>
        <td>${item.method || 'GET'}</td>
        <td class="history-url" title="${escapeHtml(item.url || '')}">${escapeHtml(item.url || '-')}</td>
        <td class="history-actions">
          <button type="button" class="history-btn" data-view-server="${item.id}">查看</button>
          <button type="button" class="history-btn" data-replay-server="${item.id}">本地重发</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('[data-view-server]').forEach(btn => {
      btn.addEventListener('click', () => viewServerSubmission(+btn.dataset.viewServer));
    });
    tbody.querySelectorAll('[data-replay-server]').forEach(btn => {
      btn.addEventListener('click', () => replayServerSubmission(+btn.dataset.replayServer));
    });
  }
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

  lastOriginalCurl = item.originalCurl || '';
  portInput.value = item.port || DEFAULT_PORT;
  savePort();
  lastRequest = item.request || null;

  if (item.success && item.status != null) {
    const statusClass = item.status >= 200 && item.status < 300 ? 'ok' : 'err';
    setBadge(String(item.status), statusClass);
    responseMeta.textContent = item.elapsed_ms != null ? `${item.elapsed_ms} ms` : '';
    responseViewer.setText(item.body || '');
    lastResponse = {
      ok: true,
      status: item.status,
      elapsed_ms: item.elapsed_ms,
      body: item.body || '',
    };
  } else {
    statusBadge.hidden = true;
    responseMeta.textContent = '';
    responseViewer.setText(item.error || item.body || '');
    lastResponse = {
      ok: false,
      status: item.status ?? null,
      elapsed_ms: item.elapsed_ms ?? null,
      body: item.body || item.error || '',
      error: item.error || null,
    };
  }

  if (!lastRequest && lastOriginalCurl) {
    convertFromCurl(lastOriginalCurl);
  } else if (lastRequest) {
    RequestPreview.populate(lastRequest);
  }
  hideError();
}

async function replayHistory(id) {
  await viewHistory(id);
  await sendRequest();
}

function findServerSubmission(id) {
  return serverHistory.find(h => h.id === id);
}

function viewServerSubmission(id) {
  const item = findServerSubmission(id);
  if (!item) return;

  lastOriginalCurl = item.curl || '';
  statusBadge.hidden = true;
  responseMeta.textContent = '';
  responseViewer.clear();
  lastRequest = null;
  convertFromCurl(lastOriginalCurl);
  hideError();
}

async function replayServerSubmission(id) {
  viewServerSubmission(id);
  await sendRequest();
}

function recordSendResult(data) {
  const body = data.body || data.error || '';
  addHistory({
    id: Date.now(),
    time: Date.now(),
    port: lastUsedPort || getPort(),
    method: lastRequest?.method || 'GET',
    url: lastRequest?.url || '',
    originalCurl: getRecordCurl(),
    localCurl: getLocalCurl(),
    request: lastRequest ? { ...lastRequest } : null,
    status: data.status ?? null,
    elapsed_ms: data.elapsed_ms ?? null,
    body: body.slice(0, BODY_STORAGE_MAX),
    error: data.ok ? null : (data.error || null),
    success: data.ok && data.status != null,
  });
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
  responseMeta.textContent = '';
  hideError();

  const signal = RequestSendUI.createSignal();

  try {
    const res = await fetch('/api/request-local/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: lastRequest }),
      signal,
    });
    const data = await res.json();

    if (!data.ok) {
      setBadge('失败', 'err');
      showError(data.error || '请求失败');
      responseViewer.setText(data.error || '');
      lastResponse = {
        ok: false,
        status: data.status ?? null,
        elapsed_ms: data.elapsed_ms ?? null,
        body: data.body || data.error || '',
        error: data.error || null,
      };
      recordSendResult(data);
      return;
    }

    const statusClass = data.status >= 200 && data.status < 300 ? 'ok' : 'err';
    setBadge(`${data.status}`, statusClass);
    responseMeta.textContent = `${data.elapsed_ms} ms`;
    responseViewer.setText(data.body || '');
    lastResponse = {
      ok: true,
      status: data.status,
      elapsed_ms: data.elapsed_ms,
      body: data.body || '',
    };
    hideError();
    recordSendResult(data);
  } catch (err) {
    if (RequestSendUI.isAbortError(err)) {
      setBadge('已取消', 'err');
      showError('请求已取消');
      return;
    }
    setBadge('失败', 'err');
    showError('发送请求失败');
    lastResponse = { ok: false, status: null, elapsed_ms: null, body: '', error: '发送请求失败' };
    recordSendResult({ ok: false, error: '发送请求失败' });
  } finally {
    RequestSendUI.clearAbort();
    setSending(false);
    scheduleShareSave();
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
    const converted = convertFromCurl(text.trim());
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

function getSubmitterName() {
  return localStorage.getItem(SUBMITTER_NAME_KEY) || '';
}

function saveSubmitterName(name) {
  localStorage.setItem(SUBMITTER_NAME_KEY, name.trim());
}

const nameModal = document.getElementById('name-modal');
const nameModalError = document.getElementById('name-modal-error');
const submitterNameInput = document.getElementById('submitter-name');

function openNameModal() {
  submitterNameInput.value = getSubmitterName();
  nameModalError.hidden = true;
  nameModal.hidden = false;
  submitterNameInput.focus();
}

function closeNameModal() {
  nameModal.hidden = true;
  pendingDevCurl = null;
  nameModalError.hidden = true;
}

async function doSubmitDev(curlText, submitterName) {
  convertFromCurl(curlText);

  const res = await fetch('/api/request-local/submit-dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ curl: curlText, submitter: submitterName }),
  });
  const data = await res.json();

  if (!data.ok) {
    showError(data.error || '提交失败');
    return false;
  }

  hideError();
  setBadge('已提交', 'ok');
  await loadServerHistory();
  switchPanelTab('feedback');
  return true;
}

async function pasteAndSubmitDev() {
  const btn = document.getElementById('paste-submit-dev-btn');
  btn.disabled = true;

  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      showError('剪贴板为空');
      return;
    }

    const name = getSubmitterName();
    if (!name) {
      pendingDevCurl = text.trim();
      btn.disabled = false;
      openNameModal();
      return;
    }

    await doSubmitDev(text.trim(), name);
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

async function confirmNameAndSubmit() {
  const name = submitterNameInput.value.trim();
  if (!name) {
    nameModalError.textContent = '请输入姓名';
    nameModalError.hidden = false;
    return;
  }

  saveSubmitterName(name);
  nameModal.hidden = true;
  nameModalError.hidden = true;

  if (!pendingDevCurl) return;

  const curl = pendingDevCurl;
  pendingDevCurl = null;
  const btn = document.getElementById('paste-submit-dev-btn');
  btn.disabled = true;
  try {
    await doSubmitDev(curl, name);
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('name-modal-confirm').addEventListener('click', confirmNameAndSubmit);
document.getElementById('name-modal-close').addEventListener('click', closeNameModal);
document.getElementById('name-modal-cancel').addEventListener('click', closeNameModal);
nameModal.addEventListener('click', (e) => {
  if (e.target === nameModal) closeNameModal();
});
submitterNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmNameAndSubmit();
});

document.getElementById('send-btn').addEventListener('click', sendRequest);
document.getElementById('paste-send-btn').addEventListener('click', pasteAndSend);
document.getElementById('paste-submit-dev-btn').addEventListener('click', pasteAndSubmitDev);
document.getElementById('gen-api-doc-btn').addEventListener('click', generateApiDoc);
shareRequestBtn?.addEventListener('click', () => shareDocument());
document.getElementById('copy-share-url')?.addEventListener('click', () => {
  copyWithFeedback(document.getElementById('copy-share-url'), shareUrlInput?.value || '');
});

document.querySelectorAll('.section-panel-tab').forEach(btn => {
  btn.addEventListener('click', () => switchPanelTab(btn.dataset.panel));
});
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

portInput.addEventListener('input', () => {
  savePort();
  scheduleShareSave();
});
portInput.addEventListener('change', () => {
  savePort();
  reconvert();
  scheduleShareSave();
});

document.getElementById('clear-preview').addEventListener('click', () => {
  lastOriginalCurl = '';
  lastRequest = null;
  lastResponse = null;
  lastUsedPort = null;
  updatePortHint(null, null);
  RequestPreview.clear();
  responseViewer.clear();
  responseMeta.textContent = '';
  statusBadge.hidden = true;
  hideError();
  scheduleShareSave();
  document.getElementById('preview-url').focus();
});

document.getElementById('clear-history').addEventListener('click', () => {
  if (activePanelTab !== 'history' || history.length === 0) return;
  if (!confirm('确定清空所有本地发送历史？')) return;
  history = [];
  historyPage = 1;
  saveHistory();
  renderHistory();
});

document.getElementById('history-prev').addEventListener('click', () => {
  if (activePanelTab === 'history') {
    if (historyPage > 1) {
      historyPage -= 1;
      renderHistory();
    }
  } else if (serverHistoryPage > 1) {
    serverHistoryPage -= 1;
    renderHistory();
  }
});

document.getElementById('history-next').addEventListener('click', () => {
  if (activePanelTab === 'history') {
    const totalPages = Math.ceil(history.length / HISTORY_PAGE_SIZE);
    if (historyPage < totalPages) {
      historyPage += 1;
      renderHistory();
    }
  } else {
    const totalPages = Math.ceil(serverHistory.length / HISTORY_PAGE_SIZE);
    if (serverHistoryPage < totalPages) {
      serverHistoryPage += 1;
      renderHistory();
    }
  }
});

loadPort();
loadPortMappings();
loadHistory();
loadServerHistory();

RequestSendUI.init();

RequestPreview.init({
  onChange: (request) => applyPreviewRequest(request),
  onPasteCurl: (curl) => convertFromCurl(curl),
});

const urlShareId = RequestShare.parseIdFromUrl();
if (urlShareId) {
  loadSharedSnapshot(urlShareId);
} else if (!RequestPreview.restoreFromStorage()) {
  convertFromCurl(SAMPLE_CURL);
}
