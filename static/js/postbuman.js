const responseViewer = ResponseViewer.create(document.getElementById('response-viewer'));
const responseMeta = document.getElementById('response-meta');
const errorEl = document.getElementById('error');
const statusBadge = document.getElementById('status-badge');

let lastRequest = null;
let lastOriginalCurl = '';
let lastResponse = null;
let skipClearOriginalCurl = false;

const shareBar = document.getElementById('pb-share-bar');
const shareUrlInput = document.getElementById('pb-share-url');
const shareStatusEl = document.getElementById('pb-share-status');
const shareHintEl = document.getElementById('pb-share-hint');
const shareRequestBtn = document.getElementById('share-request');

const SHARE_SAVE_DEBOUNCE_MS = 800;
let shareId = null;
let shareSaveTimer = null;
let isApplyingShare = false;
let isSharing = false;

const HISTORY_STORAGE_KEY = 'postbuman-history';
const HISTORY_MAX = 100;
const HISTORY_PAGE_SIZE = 20;
const BODY_STORAGE_MAX = 8000;

let history = [];
let historyPage = 1;

const SAMPLE_CURL = `curl 'https://v8api.k0v.cn/api/datacenter/partno-info/public/?partno=09475656032&mfg=HARTING+Technology+Group' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'`;

function getRecordCurl() {
  if (lastOriginalCurl) return lastOriginalCurl;
  if (!lastRequest) return '';
  return CurlConvert.buildCurlFromRequest(lastRequest);
}

function buildShareSnapshot() {
  const request = lastRequest || RequestPreview.buildRequest();
  const snapshot = {
    curl: getRecordCurl(),
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

function applyShareSnapshot(data) {
  isApplyingShare = true;
  try {
    if (data.request?.url) {
      lastOriginalCurl = data.curl || '';
      lastRequest = data.request;
      skipClearOriginalCurl = true;
      RequestPreview.populate(lastRequest);
      skipClearOriginalCurl = false;
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
    if (!RequestPreview.restoreFromStorage()) {
      convertFromCurl(SAMPLE_CURL);
    }
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

function applyPreviewRequest(request) {
  lastRequest = request;
  if (!skipClearOriginalCurl) lastOriginalCurl = '';
  scheduleShareSave();
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
    RequestPreview.clear();
    hideError();
    return false;
  }

  try {
    const parsed = CurlConvert.parseCurl(text);
    lastOriginalCurl = text;
    lastRequest = buildRequestFromParsed(parsed);
    skipClearOriginalCurl = true;
    RequestPreview.populate(lastRequest);
    skipClearOriginalCurl = false;
    hideError();
    scheduleShareSave();
    return true;
  } catch (e) {
    lastOriginalCurl = text;
    lastRequest = null;
    RequestPreview.clear();
    RequestPreview.setUrlBar(text);
    showError(e.message || '解析失败');
    return false;
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
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

function findHistory(id) {
  return history.find(h => h.id === id);
}

function renderHistory() {
  const tbody = document.getElementById('history-tbody');
  const empty = document.getElementById('history-empty');
  const table = document.getElementById('history-table');
  const pagination = document.getElementById('history-pagination');
  const pageInfo = document.getElementById('history-page-info');
  const prevBtn = document.getElementById('history-prev');
  const nextBtn = document.getElementById('history-next');

  const { items, total, totalPages, page } = getHistoryPageData();

  if (total === 0) {
    tbody.innerHTML = '';
    empty.hidden = false;
    table.hidden = true;
    pagination.hidden = true;
    return;
  }

  empty.hidden = true;
  table.hidden = false;
  pagination.hidden = false;
  pageInfo.textContent = `共 ${total} 条，第 ${page}/${totalPages} 页（每页 ${HISTORY_PAGE_SIZE} 条）`;
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

function viewHistory(id) {
  const item = findHistory(id);
  if (!item) return;

  lastOriginalCurl = item.originalCurl || '';
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
  viewHistory(id);
  await sendRequest();
}

function recordSendResult(data) {
  const body = data.body || data.error || '';
  addHistory({
    id: Date.now(),
    time: Date.now(),
    method: lastRequest?.method || 'GET',
    url: lastRequest?.url || '',
    originalCurl: getRecordCurl(),
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
}

document.getElementById('send-btn').addEventListener('click', sendRequest);
document.getElementById('paste-send-btn').addEventListener('click', pasteAndSend);
shareRequestBtn?.addEventListener('click', () => shareDocument());
document.getElementById('copy-share-url')?.addEventListener('click', () => {
  copyWithFeedback(document.getElementById('copy-share-url'), shareUrlInput?.value || '');
});

document.getElementById('clear-preview').addEventListener('click', () => {
  lastOriginalCurl = '';
  lastRequest = null;
  lastResponse = null;
  RequestPreview.clear();
  responseViewer.clear();
  responseMeta.textContent = '';
  statusBadge.hidden = true;
  hideError();
  scheduleShareSave();
  document.getElementById('preview-url').focus();
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

loadHistory();

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
