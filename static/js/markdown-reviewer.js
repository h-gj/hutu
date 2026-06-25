const sourceEl = document.getElementById('md-source');
const previewEl = document.getElementById('md-preview');
const previewWrap = document.getElementById('md-preview-wrap');
const syncScrollCheckbox = document.getElementById('sync-scroll');
const shareBar = document.getElementById('md-share-bar');
const shareUrlInput = document.getElementById('md-share-url');
const shareStatusEl = document.getElementById('md-share-status');
const shareHintEl = document.getElementById('md-share-hint');
const shareMdBtn = document.getElementById('share-md');

const mdEditor = LineEditor.init(sourceEl, { dark: false });
const sourceEditorWrap = sourceEl.closest('.line-editor');

const DOC_ID_RE = /^[a-z0-9]{10,16}$/;
const DEBOUNCE_MS = 120;
const SAVE_DEBOUNCE_MS = 800;
let renderTimer = null;
let saveTimer = null;
let syncingScroll = false;
let docId = null;

function getDocIdFromUrl() {
  const id = new URLSearchParams(window.location.search).get('id');
  return id && DOC_ID_RE.test(id) ? id : null;
}

function buildShareUrl(id) {
  const url = new URL(window.location.href);
  url.search = `?id=${encodeURIComponent(id)}`;
  return url.toString();
}

function showShareBar(id) {
  if (!shareBar || !shareUrlInput) return;
  shareBar.hidden = false;
  shareUrlInput.value = buildShareUrl(id);
  if (shareHintEl) shareHintEl.hidden = true;
  if (shareMdBtn) shareMdBtn.textContent = '复制分享链接';
}

function hideShareUi() {
  if (shareBar) shareBar.hidden = true;
  if (shareHintEl) shareHintEl.hidden = false;
  if (shareMdBtn) shareMdBtn.textContent = '分享';
}

function setDocId(id) {
  docId = id;
  const shareUrl = buildShareUrl(id);
  history.replaceState(null, '', shareUrl);
  showShareBar(id);
}

function syncPreviewHeight() {
  if (!sourceEditorWrap || !previewWrap) return;
  previewWrap.style.minHeight = `${sourceEditorWrap.offsetHeight}px`;
}

if (sourceEditorWrap && typeof ResizeObserver !== 'undefined') {
  const heightObserver = new ResizeObserver(syncPreviewHeight);
  heightObserver.observe(sourceEditorWrap);
}

const SAMPLE = `# Markdown Reviewer

支持 **粗体**、*斜体*、行内代码 与 [链接](https://example.com)。

## 列表

- 无序列表项
- 另一项

1. 有序列表
2. 第二项

## 代码块

\`\`\`python
def hello():
    print("Hello, Markdown!")
\`\`\`

## 表格

| 列 A | 列 B |
| ---- | ---- |
| 1    | 2    |

> 引用块示例
`;

function updatePreview() {
  const text = sourceEl.value;
  if (!text.trim()) {
    previewEl.innerHTML = '<p class="md-preview-empty">预览将显示在这里</p>';
    return;
  }
  try {
    previewEl.innerHTML = MarkdownRender.render(text);
  } catch (err) {
    previewEl.innerHTML = `<p class="md-preview-empty">预览失败: ${MarkdownRender.escapeHtml(err.message)}</p>`;
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(updatePreview, DEBOUNCE_MS);
}

function scheduleSave() {
  if (!docId) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDoc, SAVE_DEBOUNCE_MS);
}

async function saveDoc() {
  if (!docId) return;
  try {
    const res = await fetch(`/api/markdown-doc/${encodeURIComponent(docId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: sourceEl.value }),
    });
    const data = await res.json();
    if (data.ok && shareStatusEl) {
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

function applySourceText(text) {
  sourceEl.value = text;
  mdEditor?.updateLines();
  updatePreview();
  syncPreviewHeight();
}

async function createShareDoc() {
  const res = await fetch('/api/markdown-doc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: sourceEl.value }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '创建分享失败');
  return data.id;
}

async function shareDocument(btn) {
  if (!sourceEl.value.trim()) {
    btn.textContent = '内容为空';
    setTimeout(() => { btn.textContent = docId ? '复制分享链接' : '分享'; }, 1500);
    return;
  }

  if (docId) {
    showShareBar(docId);
    await copyWithFeedback(btn, shareUrlInput?.value || buildShareUrl(docId));
    return;
  }

  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '生成中…';
  try {
    const id = await createShareDoc();
    setDocId(id);
    await copyWithFeedback(btn, shareUrlInput.value);
  } catch {
    btn.textContent = '分享失败';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } finally {
    btn.disabled = false;
  }
}
async function loadDocById(id) {
  try {
    const res = await fetch(`/api/markdown-doc/${encodeURIComponent(id)}`);
    const data = await res.json();
    if (!data.ok) {
      applySourceText(`# 加载失败\n\n${data.error || '文档不存在'}`);
      return;
    }
    setDocId(id);
    applySourceText(data.content || '');
  } catch {
    applySourceText('# 加载失败\n\n无法连接服务器');
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

sourceEl.addEventListener('input', () => {
  scheduleRender();
  scheduleSave();
});
sourceEl.addEventListener('paste', () => {
  setTimeout(() => {
    updatePreview();
    scheduleSave();
  }, 0);
});
sourceEl.addEventListener('scroll', () => {
  if (!syncScrollCheckbox.checked || syncingScroll) return;
  const max = sourceEl.scrollHeight - sourceEl.clientHeight;
  if (max <= 0) return;
  const ratio = sourceEl.scrollTop / max;
  syncingScroll = true;
  const previewMax = previewWrap.scrollHeight - previewWrap.clientHeight;
  previewWrap.scrollTop = ratio * previewMax;
  syncingScroll = false;
});

previewWrap.addEventListener('scroll', () => {
  if (!syncScrollCheckbox.checked || syncingScroll) return;
  const max = previewWrap.scrollHeight - previewWrap.clientHeight;
  if (max <= 0) return;
  const ratio = previewWrap.scrollTop / max;
  syncingScroll = true;
  const sourceMax = sourceEl.scrollHeight - sourceEl.clientHeight;
  sourceEl.scrollTop = ratio * sourceMax;
  syncingScroll = false;
});

document.getElementById('paste-md').addEventListener('click', async () => {
  const btn = document.getElementById('paste-md');
  btn.disabled = true;
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return;
    applySourceText(text);
    scheduleSave();
  } catch {
    /* ignore */
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('clear-md').addEventListener('click', () => {
  sourceEl.value = '';
  mdEditor?.updateLines();
  updatePreview();
  docId = null;
  hideShareUi();
  const cleanUrl = new URL(window.location.href);
  cleanUrl.search = '';
  history.replaceState(null, '', cleanUrl.toString());
  sourceEl.focus();
});

shareMdBtn?.addEventListener('click', () => shareDocument(shareMdBtn));

document.getElementById('copy-md').addEventListener('click', () => {
  copyWithFeedback(document.getElementById('copy-md'), sourceEl.value);
});

document.getElementById('copy-html').addEventListener('click', () => {
  const html = previewEl.innerHTML;
  if (!sourceEl.value.trim()) return;
  copyWithFeedback(document.getElementById('copy-html'), html);
});

document.getElementById('copy-share-url')?.addEventListener('click', () => {
  copyWithFeedback(document.getElementById('copy-share-url'), shareUrlInput?.value || '');
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

async function initContent() {
  const urlId = getDocIdFromUrl();
  if (urlId) {
    await loadDocById(urlId);
    return;
  }

  if (!sourceEl.value.trim()) {
    sourceEl.value = SAMPLE;
    mdEditor?.updateLines();
  }
  updatePreview();
  syncPreviewHeight();
}

initContent();
