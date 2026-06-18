/** Response panel: line numbers, syntax highlight, JSON fold/unfold. */
const ResponseViewer = (() => {
  const EMPTY_PLACEHOLDER = '响应内容将显示在这里';
  const FOLD_CHARS = { '{': '}', '[': ']' };

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

  function showEmpty(emptyEl, scrollEl) {
    if (!emptyEl.textContent.trim()) emptyEl.textContent = EMPTY_PLACEHOLDER;
    emptyEl.hidden = false;
    scrollEl.hidden = true;
  }

  function showContent(emptyEl, scrollEl) {
    emptyEl.hidden = true;
    scrollEl.hidden = false;
  }

  function create(container) {
    if (!container) throw new Error('ResponseViewer: missing container');

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

    function render() {
      if (!lineTexts.length) {
        showEmpty(emptyEl, scrollEl);
        linesEl.innerHTML = '';
        return;
      }

      showContent(emptyEl, scrollEl);

      const hiddenLines = new Set();
      collapsed.forEach(startLine => {
        const endLine = foldRegions.get(startLine);
        if (endLine == null) return;
        for (let ln = startLine + 1; ln <= endLine; ln++) hiddenLines.add(ln);
      });

      linesEl.innerHTML = lineTexts.map((line, idx) => {
        if (hiddenLines.has(idx)) return '';

        const canFold = foldRegions.has(idx);
        const isCollapsed = collapsed.has(idx);
        const foldBtn = canFold
          ? `<button type="button" class="rv-fold ${isCollapsed ? 'collapsed' : ''}" data-fold="${idx}" title="折叠/展开" aria-label="折叠/展开"></button>`
          : '<span class="rv-fold-spacer"></span>';

        const code = isJson ? highlightJsonLine(line) : escapeHtml(line);

        return `
          <div class="rv-line" data-line="${idx}">
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
      const { text: formatted, isJson: json } = formatContent(text);
      isJson = json;
      lineTexts = formatted.length > 0 ? formatted.split('\n') : [];
      foldRegions = json && formatted ? findFoldRegions(formatted) : new Map();
      collapsed = new Set();
      render();
    }

    function clear() {
      lineTexts = [];
      foldRegions = new Map();
      collapsed = new Set();
      render();
    }

    render();

    return { setText, clear };
  }

  return { create };
})();
