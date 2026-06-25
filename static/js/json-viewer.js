const errorEl = document.getElementById('error');
const viewerWrap = document.getElementById('json-viewer-wrap');
const shareBar = document.getElementById('json-share-bar');
const shareUrlInput = document.getElementById('json-share-url');
const shareStatusEl = document.getElementById('json-share-status');
const shareHintEl = document.getElementById('json-share-hint');
const shareJsonBtn = document.getElementById('share-json');

const SAVE_DEBOUNCE_MS = 800;
let docId = null;
let saveTimer = null;

const jsonViewer = ResponseViewer.create(viewerWrap, {
  title: 'JSON',
  expandable: false,
  replace: true,
  onChange: () => {
    validateJson();
    scheduleSave();
  },
});

function showShareBar(id) {
  if (!shareBar || !shareUrlInput) return;
  shareBar.hidden = false;
  shareUrlInput.value = DocShare.buildPageUrl(id);
  if (shareHintEl) shareHintEl.hidden = true;
  if (shareJsonBtn) shareJsonBtn.textContent = '复制分享链接';
}

function hideShareUi() {
  if (shareBar) shareBar.hidden = true;
  if (shareHintEl) shareHintEl.hidden = false;
  if (shareJsonBtn) shareJsonBtn.textContent = '分享';
}

function setDocId(id) {
  docId = id;
  DocShare.setPageUrl(id);
  showShareBar(id);
}

function scheduleSave() {
  if (!docId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDoc, SAVE_DEBOUNCE_MS);
}

async function saveDoc() {
  if (!docId) return;
  try {
    await DocShare.save(docId, jsonViewer.getText());
    if (shareStatusEl) {
      shareStatusEl.hidden = false;
      clearTimeout(saveDoc._hideTimer);
      saveDoc._hideTimer = setTimeout(() => {
        shareStatusEl.hidden = true;
      }, 2000);
    }
  } catch {
    /* ignore */
  }
}

async function copyWithFeedback(btn, text) {
  if (!text) return;
  const orig = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = '已复制';
  } catch {
    btn.textContent = '已复制';
  }
  setTimeout(() => { btn.textContent = orig; }, 1500);
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

function hideError() {
  errorEl.hidden = true;
}

function tryFormatJson(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return { ok: true, text: '' };
  try {
    return { ok: true, text: JSON.stringify(JSON.parse(trimmed), null, 2) };
  } catch (e) {
    return { ok: false, error: `JSON 解析失败: ${e.message}` };
  }
}

function validateJson() {
  const text = jsonViewer.getText();
  if (!text.trim()) {
    hideError();
    return true;
  }
  const result = tryFormatJson(text);
  if (!result.ok) {
    showError(result.error);
    return false;
  }
  hideError();
  return true;
}

function applyJson(text) {
  const result = tryFormatJson(text);
  if (!result.ok) {
    showError(result.error);
    return false;
  }
  jsonViewer.setText(result.text);
  hideError();
  scheduleSave();
  return true;
}

async function shareDocument() {
  const text = jsonViewer.getText();
  if (!text.trim()) {
    shareJsonBtn.textContent = '内容为空';
    setTimeout(() => {
      shareJsonBtn.textContent = docId ? '复制分享链接' : '分享';
    }, 1500);
    return;
  }

  if (docId) {
    showShareBar(docId);
    await copyWithFeedback(shareJsonBtn, shareUrlInput?.value || DocShare.buildPageUrl(docId));
    return;
  }

  const orig = shareJsonBtn.textContent;
  shareJsonBtn.disabled = true;
  shareJsonBtn.textContent = '生成中…';
  try {
    const id = await DocShare.create(text);
    setDocId(id);
    await copyWithFeedback(shareJsonBtn, shareUrlInput.value);
  } catch {
    shareJsonBtn.textContent = '分享失败';
    setTimeout(() => { shareJsonBtn.textContent = orig; }, 1500);
  } finally {
    shareJsonBtn.disabled = false;
  }
}

async function loadSharedDoc(id) {
  try {
    const content = await DocShare.load(id);
    setDocId(id);
    jsonViewer.setText(content);
    validateJson();
  } catch (err) {
    jsonViewer.setText(`// 加载失败: ${err.message || '文档不存在'}`);
    showError(err.message || '加载失败');
  }
}

document.getElementById('format-json').addEventListener('click', () => {
  applyJson(jsonViewer.getText());
});

document.getElementById('clear-json').addEventListener('click', () => {
  jsonViewer.clear();
  docId = null;
  hideShareUi();
  DocShare.clearPageUrl();
  hideError();
  viewerWrap.focus();
});

document.getElementById('copy-json').addEventListener('click', () => {
  copyWithFeedback(document.getElementById('copy-json'), jsonViewer.getText());
});

shareJsonBtn?.addEventListener('click', () => shareDocument());

document.getElementById('copy-share-url')?.addEventListener('click', () => {
  copyWithFeedback(document.getElementById('copy-share-url'), shareUrlInput?.value || '');
});

document.getElementById('paste-json').addEventListener('click', async () => {
  const btn = document.getElementById('paste-json');
  btn.disabled = true;
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      showError('剪贴板为空');
      return;
    }
    applyJson(text);
    viewerWrap.focus();
  } catch (err) {
    if (err?.name === 'NotAllowedError') {
      showError('无法读取剪贴板，请允许浏览器权限');
    } else {
      showError('读取剪贴板失败');
    }
  } finally {
    btn.disabled = false;
  }
});

viewerWrap.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') || '';
  if (!text.trim()) return;
  e.preventDefault();
  applyJson(text);
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

const urlId = DocShare.parseIdFromUrl();
if (urlId) {
  loadSharedDoc(urlId);
}
