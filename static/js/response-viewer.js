/** Response panel: line numbers, syntax highlight, JSON fold/unfold, in-area search, expand modal. */
const ResponseViewer = (() => {
  const EMPTY_PLACEHOLDER = '响应内容将显示在这里';
  const FOLD_CHARS = { '{': '}', '[': ']' };

  let expandModal = null;
  let expandModalViewer = null;
  let expandContentChangeHandler = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatContent(text) {
    const raw = text || '';
    const trimmed = raw.trim();
    if (!trimmed) return { text: '', isJson: false };

    try {
      const parsed = JSON.parse(trimmed);
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      return { text: raw, isJson: false };
    }
  }

  function findFoldRegions(text) {
    const regions = new Map();
    const stack = [];
    let inString = false;
    let escape = false;
    let line = 0;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\n') {
        line += 1;
        continue;
      }

      if (inString) {
        if (escape) escape = false;
        else if (c === '\\') escape = true;
        else if (c === '"') inString = false;
        continue;
      }

      if (c === '"') {
        inString = true;
        continue;
      }

      if (c === '{' || c === '[') {
        stack.push({ close: FOLD_CHARS[c], line });
      } else if (c === '}' || c === ']') {
        const open = stack.pop();
        if (open && open.close === c && open.line < line) {
          regions.set(open.line, line);
        }
      }
    }

    return regions;
  }

  function highlightJsonLine(line) {
    let out = '';
    let i = 0;

    while (i < line.length) {
      const ch = line[i];

      if (ch === '"') {
        let j = i + 1;
        while (j < line.length) {
          if (line[j] === '\\') j += 2;
          else if (line[j] === '"') { j += 1; break; }
          else j += 1;
        }
        const str = line.slice(i, j);
        const after = line.slice(j);
        const colonMatch = after.match(/^\s*:/);
        if (colonMatch) {
          out += `<span class="rv-key">${escapeHtml(str)}</span>`;
          out += escapeHtml(after.slice(0, colonMatch[0].length - 1));
          out += '<span class="rv-punct">:</span>';
          i = j + colonMatch[0].length;
          continue;
        }
        out += `<span class="rv-string">${escapeHtml(str)}</span>`;
        i = j;
        continue;
      }

      const numMatch = line.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (numMatch) {
        out += `<span class="rv-number">${escapeHtml(numMatch[0])}</span>`;
        i += numMatch[0].length;
        continue;
      }

      const wordMatch = line.slice(i).match(/^(true|false|null)/);
      if (wordMatch) {
        const cls = wordMatch[1] === 'null' ? 'rv-null' : 'rv-bool';
        out += `<span class="${cls}">${wordMatch[1]}</span>`;
        i += wordMatch[0].length;
        continue;
      }

      if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ',') {
        out += `<span class="rv-punct">${escapeHtml(ch)}</span>`;
        i += 1;
        continue;
      }

      out += escapeHtml(ch);
      i += 1;
    }

    return out;
  }

  function highlightSearchInLine(line, query, activeStart) {
    if (!query) return escapeHtml(line);

    const lower = line.toLowerCase();
    const q = query.toLowerCase();
    let out = '';
    let i = 0;

    while (i < line.length) {
      const idx = lower.indexOf(q, i);
      if (idx === -1) {
        out += escapeHtml(line.slice(i));
        break;
      }
      if (idx > i) out += escapeHtml(line.slice(i, idx));
      const matchText = line.slice(idx, idx + query.length);
      const cls = idx === activeStart ? 'rv-search-hit rv-search-active' : 'rv-search-hit';
      out += `<mark class="${cls}">${escapeHtml(matchText)}</mark>`;
      i = idx + query.length;
    }

    return out || ' ';
  }

  function renderLineCode(line, isJson, query, activeStart) {
    if (query) return highlightSearchInLine(line, query, activeStart);
    return isJson ? highlightJsonLine(line) : escapeHtml(line);
  }

  function findAllMatches(lineTexts, query) {
    if (!query) return [];
    const lowerQ = query.toLowerCase();
    const matches = [];

    lineTexts.forEach((line, lineIdx) => {
      const lower = line.toLowerCase();
      let i = 0;
      while (i < line.length) {
        const idx = lower.indexOf(lowerQ, i);
        if (idx === -1) break;
        matches.push({ line: lineIdx, start: idx });
        i = idx + query.length;
      }
    });

    return matches;
  }

  function showEmpty(emptyEl, scrollEl) {
    if (!emptyEl.textContent.trim()) emptyEl.textContent = EMPTY_PLACEHOLDER;
    emptyEl.hidden = false;
    scrollEl.hidden = true;
  }

  function showContent(emptyEl, scrollEl) {
    emptyEl.hidden = true;
    scrollEl.hidden = false;
  }

  function ensureExpandModal() {
    if (expandModal) return;

    expandModal = document.createElement('div');
    expandModal.className = 'rv-expand-modal';
    expandModal.hidden = true;
    expandModal.innerHTML = `
      <div class="rv-expand-backdrop" data-rv-expand-close></div>
      <div class="rv-expand-panel">
        <div class="rv-expand-header">
          <span class="rv-expand-title">放大查看</span>
          <div class="rv-expand-actions">
            <button type="button" class="rv-expand-action" id="rv-expand-copy" title="复制全部内容">复制</button>
            <button type="button" class="rv-expand-close" title="关闭 (Esc)" aria-label="关闭">×</button>
          </div>
        </div>
        <div class="rv-expand-replace-bar">
          <input type="text" class="rv-replace-input" id="rv-expand-find" placeholder="查找" aria-label="查找">
          <input type="text" class="rv-replace-input" id="rv-expand-replace-with" placeholder="替换为" aria-label="替换为">
          <button type="button" class="rv-expand-action" id="rv-expand-replace-one">替换</button>
          <button type="button" class="rv-expand-action" id="rv-expand-replace-all">全部替换</button>
        </div>
        <div class="rv-expand-body">
          <div class="response-viewer-wrap rv-expand-viewer"></div>
        </div>
      </div>
    `;
    document.body.appendChild(expandModal);

    const viewerWrap = expandModal.querySelector('.rv-expand-viewer');
    expandModal.querySelector('.rv-expand-panel').setAttribute('tabindex', '-1');
    expandModalViewer = create(viewerWrap, { expandable: false });

    expandModal.querySelector('.rv-expand-close').addEventListener('click', closeExpandModal);
    expandModal.querySelector('[data-rv-expand-close]').addEventListener('click', closeExpandModal);

    const expandCopyBtn = expandModal.querySelector('#rv-expand-copy');
    const expandFindInput = expandModal.querySelector('#rv-expand-find');
    const expandReplaceInput = expandModal.querySelector('#rv-expand-replace-with');
    const expandReplaceOneBtn = expandModal.querySelector('#rv-expand-replace-one');
    const expandReplaceAllBtn = expandModal.querySelector('#rv-expand-replace-all');

    expandCopyBtn.addEventListener('click', async () => {
      const text = expandModalViewer?.getText() || '';
      if (!text) return;
      const orig = expandCopyBtn.textContent;
      try {
        await navigator.clipboard.writeText(text);
        expandCopyBtn.textContent = '已复制';
      } catch {
        expandCopyBtn.textContent = '已复制';
      }
      setTimeout(() => { expandCopyBtn.textContent = orig; }, 1500);
    });

    function applyExpandReplace(replaceAll) {
      const find = expandFindInput.value;
      const replaceWith = expandReplaceInput.value;
      if (!find || !expandModalViewer) return;

      const text = expandModalViewer.getText();
      if (!text) return;

      let newText;
      if (replaceAll) {
        newText = text.split(find).join(replaceWith);
      } else {
        const idx = text.indexOf(find);
        if (idx === -1) return;
        newText = text.slice(0, idx) + replaceWith + text.slice(idx + find.length);
      }

      if (newText === text) return;

      expandModalViewer.setText(newText);
      if (expandContentChangeHandler) expandContentChangeHandler(newText);
    }

    expandReplaceOneBtn.addEventListener('click', () => applyExpandReplace(false));
    expandReplaceAllBtn.addEventListener('click', () => applyExpandReplace(true));

    expandFindInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        expandReplaceInput.focus();
      }
    });
    expandReplaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyExpandReplace(e.shiftKey);
      }
    });

    expandModal.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || expandModal.hidden) return;
      const modalSearch = expandModal.querySelector('.rv-search-bar');
      if (modalSearch && !modalSearch.hidden) return;
      e.preventDefault();
      closeExpandModal();
    });
  }

  function openExpandModal(text, title, onContentChange) {
    if (!text || !text.trim()) return;
    ensureExpandModal();
    expandContentChangeHandler = onContentChange || null;
    expandModal.querySelector('.rv-expand-title').textContent = title || '放大查看';
    expandModalViewer.setText(text);
    expandModal.hidden = false;
    document.body.classList.add('rv-expand-open');
    expandModal.querySelector('.rv-expand-panel').focus();
  }

  function closeExpandModal() {
    if (!expandModal || expandModal.hidden) return;
    expandModal.hidden = true;
    document.body.classList.remove('rv-expand-open');
    expandContentChangeHandler = null;
    if (expandModalViewer) expandModalViewer.clear();
  }

  function create(container, options = {}) {
    const expandable = options.expandable !== false;
    const enableReplace = options.replace === true;
    const expandTitle = options.title || '放大查看';
    const onChange = options.onChange;
    if (!container) throw new Error('ResponseViewer: missing container');

    if (!container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1');
    }

    let toolbar = container.querySelector('.rv-toolbar');
    if (expandable && !toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'rv-toolbar';
      toolbar.hidden = true;
      toolbar.innerHTML = `
        <button type="button" class="rv-expand-btn" title="放大查看" aria-label="放大查看">⛶ 放大</button>
      `;
      container.insertBefore(toolbar, container.firstChild);
    }
    const expandBtn = expandable ? toolbar?.querySelector('.rv-expand-btn') : null;

    let searchBar = container.querySelector('.rv-search-bar');
    if (!searchBar) {
      searchBar = document.createElement('div');
      searchBar.className = 'rv-search-bar';
      searchBar.hidden = true;
      const replaceHtml = enableReplace
        ? `
        <input type="text" class="rv-replace-with-input" placeholder="替换为" aria-label="替换为">
        <button type="button" class="rv-replace-btn" data-action="replace-one" title="替换当前匹配">替换</button>
        <button type="button" class="rv-replace-btn" data-action="replace-all" title="全部替换">全部替换</button>`
        : '';
      searchBar.innerHTML = `
        <input type="search" class="rv-search-input" placeholder="${enableReplace ? '查找' : '区域内搜索 (Enter ↓ / Shift+Enter ↑)'}" aria-label="查找">
        <span class="rv-search-meta" hidden>
          <span class="rv-search-count"></span>
        </span>
        <button type="button" class="rv-search-btn" data-dir="prev" title="上一个 (Shift+Enter)" disabled aria-label="上一个">↑</button>
        <button type="button" class="rv-search-btn" data-dir="next" title="下一个 (Enter)" disabled aria-label="下一个">↓</button>${replaceHtml}
        <button type="button" class="rv-search-close" title="关闭 (Esc)" aria-label="关闭搜索">×</button>
      `;
      const insertAfter = expandable && toolbar ? toolbar.nextSibling : container.firstChild;
      container.insertBefore(searchBar, insertAfter);
    }

    const searchInput = searchBar.querySelector('.rv-search-input');
    const searchCountEl = searchBar.querySelector('.rv-search-count');
    const searchMeta = searchBar.querySelector('.rv-search-meta');
    const searchPrevBtn = searchBar.querySelector('[data-dir="prev"]');
    const searchNextBtn = searchBar.querySelector('[data-dir="next"]');
    const searchCloseBtn = searchBar.querySelector('.rv-search-close');
    const replaceWithInput = searchBar.querySelector('.rv-replace-with-input');
    const replaceOneBtn = searchBar.querySelector('[data-action="replace-one"]');
    const replaceAllBtn = searchBar.querySelector('[data-action="replace-all"]');

    let root = container.querySelector('.response-viewer');
    if (!root) {
      root = document.createElement('div');
      root.className = 'response-viewer';
      container.appendChild(root);
    }

    let emptyEl = root.querySelector('.response-viewer-empty');
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'response-viewer-empty';
      root.insertBefore(emptyEl, root.firstChild);
    }
    emptyEl.textContent = emptyEl.textContent.trim() || EMPTY_PLACEHOLDER;

    let scrollEl = root.querySelector('.response-viewer-scroll');
    if (!scrollEl) {
      scrollEl = document.createElement('div');
      scrollEl.className = 'response-viewer-scroll';
      scrollEl.hidden = true;
      root.appendChild(scrollEl);
    }

    let linesEl = scrollEl.querySelector('.response-viewer-lines');
    if (!linesEl) {
      linesEl = document.createElement('div');
      linesEl.className = 'response-viewer-lines';
      scrollEl.appendChild(linesEl);
    }

    let collapsed = new Set();
    let foldRegions = new Map();
    let lineTexts = [];
    let isJson = false;
    let searchQuery = '';
    let allMatches = [];
    let activeMatchIndex = 0;
    let lastSourceText = '';

    function expandToShowLine(lineIdx) {
      collapsed.forEach(startLine => {
        const endLine = foldRegions.get(startLine);
        if (endLine != null && startLine < lineIdx && lineIdx <= endLine) {
          collapsed.delete(startLine);
        }
      });
    }

    function updateSearchMeta() {
      const hasQuery = searchQuery.length > 0;
      const total = allMatches.length;

      searchMeta.hidden = !hasQuery;
      searchPrevBtn.disabled = !hasQuery || total === 0;
      searchNextBtn.disabled = !hasQuery || total === 0;

      if (!hasQuery) {
        searchCountEl.textContent = '';
        return;
      }

      if (total === 0) {
        searchCountEl.textContent = '无匹配';
        return;
      }

      searchCountEl.textContent = `${activeMatchIndex + 1} / ${total}`;
    }

    function scrollToActiveMatch() {
      const match = allMatches[activeMatchIndex];
      if (!match) return;
      const lineEl = linesEl.querySelector(`.rv-line[data-line="${match.line}"]`);
      if (lineEl) lineEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function runSearch() {
      searchQuery = searchInput.value;
      allMatches = findAllMatches(lineTexts, searchQuery);
      if (allMatches.length > 0) {
        activeMatchIndex = 0;
        expandToShowLine(allMatches[0].line);
      } else {
        activeMatchIndex = 0;
      }
      updateSearchMeta();
      render();
      scrollToActiveMatch();
    }

    function getMatchOffset(match) {
      let offset = 0;
      for (let i = 0; i < match.line; i++) offset += lineTexts[i].length + 1;
      return offset + match.start;
    }

    function applyReplace(replaceAll) {
      const find = searchInput.value;
      if (!find) return;
      const replaceWith = replaceWithInput ? replaceWithInput.value : '';
      const text = lastSourceText;
      if (!text) return;

      let newText;
      if (replaceAll) {
        newText = text.split(find).join(replaceWith);
      } else if (allMatches.length && searchQuery === find) {
        const match = allMatches[activeMatchIndex];
        const offset = getMatchOffset(match);
        newText = text.slice(0, offset) + replaceWith + text.slice(offset + find.length);
      } else {
        const idx = text.indexOf(find);
        if (idx === -1) return;
        newText = text.slice(0, idx) + replaceWith + text.slice(idx + find.length);
      }

      if (newText === text) return;

      setText(newText);
      if (onChange) onChange(newText);
      if (searchInput.value) runSearch();
    }

    function clearSearch() {
      searchQuery = '';
      searchInput.value = '';
      if (replaceWithInput) replaceWithInput.value = '';
      allMatches = [];
      activeMatchIndex = 0;
      searchBar.hidden = true;
      updateSearchMeta();
      render();
    }

    function openSearch() {
      if (!lineTexts.length) return;
      searchBar.hidden = false;
      searchInput.focus();
      searchInput.select();
    }

    function goMatch(dir) {
      if (!allMatches.length) return;
      activeMatchIndex = (activeMatchIndex + dir + allMatches.length) % allMatches.length;
      expandToShowLine(allMatches[activeMatchIndex].line);
      updateSearchMeta();
      render();
      scrollToActiveMatch();
    }

    function openExpand() {
      if (!lastSourceText.trim()) return;
      openExpandModal(lastSourceText, expandTitle, (newText) => {
        setText(newText);
        if (onChange) onChange(newText);
      });
    }

    function render() {
      if (!lineTexts.length) {
        showEmpty(emptyEl, scrollEl);
        linesEl.innerHTML = '';
        searchBar.hidden = true;
        if (toolbar) toolbar.hidden = true;
        return;
      }

      showContent(emptyEl, scrollEl);
      if (toolbar) toolbar.hidden = false;
      if (searchQuery) searchBar.hidden = false;

      const hiddenLines = new Set();
      collapsed.forEach(startLine => {
        const endLine = foldRegions.get(startLine);
        if (endLine == null) return;
        for (let ln = startLine + 1; ln <= endLine; ln++) hiddenLines.add(ln);
      });

      const activeMatch = allMatches[activeMatchIndex];

      linesEl.innerHTML = lineTexts.map((line, idx) => {
        if (hiddenLines.has(idx)) return '';

        const canFold = foldRegions.has(idx);
        const isCollapsed = collapsed.has(idx);
        const foldBtn = canFold
          ? `<button type="button" class="rv-fold ${isCollapsed ? 'collapsed' : ''}" data-fold="${idx}" title="折叠/展开" aria-label="折叠/展开"></button>`
          : '<span class="rv-fold-spacer"></span>';

        const activeStart = activeMatch && activeMatch.line === idx ? activeMatch.start : -1;
        const isActiveLine = activeMatch && activeMatch.line === idx;
        const code = renderLineCode(line, isJson, searchQuery, activeStart);

        return `
          <div class="rv-line${isActiveLine ? ' rv-line-search-active' : ''}" data-line="${idx}">
            ${foldBtn}
            <span class="rv-ln">${idx + 1}</span>
            <span class="rv-code">${code || ' '}</span>
          </div>
        `;
      }).join('');

      linesEl.querySelectorAll('.rv-fold').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const ln = +btn.dataset.fold;
          if (collapsed.has(ln)) collapsed.delete(ln);
          else collapsed.add(ln);
          render();
        });
      });
    }

    function setText(text) {
      lastSourceText = text || '';
      const { text: formatted, isJson: json } = formatContent(lastSourceText);
      isJson = json;
      lineTexts = formatted.length > 0 ? formatted.split('\n') : [];
      foldRegions = json && formatted ? findFoldRegions(formatted) : new Map();
      collapsed = new Set();
      if (searchQuery) {
        allMatches = findAllMatches(lineTexts, searchQuery);
        if (allMatches.length > 0) {
          activeMatchIndex = Math.min(activeMatchIndex, allMatches.length - 1);
          expandToShowLine(allMatches[activeMatchIndex].line);
        } else {
          activeMatchIndex = 0;
        }
        updateSearchMeta();
      }
      render();
      if (searchQuery && allMatches.length) scrollToActiveMatch();
    }

    function clear() {
      lastSourceText = '';
      lineTexts = [];
      foldRegions = new Map();
      collapsed = new Set();
      clearSearch();
      render();
    }

    searchInput.addEventListener('input', runSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) goMatch(-1);
        else if (allMatches.length) goMatch(1);
        else runSearch();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        clearSearch();
      }
    });
    searchPrevBtn.addEventListener('click', () => goMatch(-1));
    searchNextBtn.addEventListener('click', () => goMatch(1));
    searchCloseBtn.addEventListener('click', clearSearch);

    if (replaceOneBtn) {
      replaceOneBtn.addEventListener('click', () => applyReplace(false));
    }
    if (replaceAllBtn) {
      replaceAllBtn.addEventListener('click', () => applyReplace(true));
    }
    if (replaceWithInput) {
      replaceWithInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyReplace(e.shiftKey);
        }
      });
    }

    if (expandBtn) {
      expandBtn.addEventListener('click', openExpand);
      container.addEventListener('dblclick', (e) => {
        if (e.target.closest('.rv-fold, .rv-search-bar, .rv-toolbar')) return;
        openExpand();
      });
    }

    container.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openSearch();
      }
    });

    container.addEventListener('mousedown', () => {
      container.focus({ preventScroll: true });
    });

    render();

    return { setText, clear, openSearch, clearSearch, openExpand, closeExpand: closeExpandModal, getText: () => lastSourceText };
  }

  return { create, closeExpandModal };
})();
