/** Lightweight Markdown → HTML for local preview (no external deps). */
const MarkdownRender = (() => {
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
  }

  function renderInline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safeUrl = escapeAttr(url.trim());
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    return out;
  }

  function renderTableRow(line, tag) {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    const inner = cells.map(c => `<${tag}>${renderInline(c.trim())}</${tag}>`).join('');
    return `<tr>${inner}</tr>`;
  }

  function isTableSep(line) {
    return /^\|?[\s:-]+\|[\s|:-]+$/.test(line.trim());
  }

  function renderBlocks(src) {
    const lines = (src || '').replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.trim() === '') {
        i += 1;
        continue;
      }

      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        const lang = fence[1] || '';
        const code = [];
        i += 1;
        while (i < lines.length && !lines[i].startsWith('```')) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1;
        const cls = lang ? ` class="language-${escapeAttr(lang)}"` : '';
        html.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }

      if (/^(-{3,}|_{3,}|\*{3,})\s*$/.test(line.trim())) {
        html.push('<hr>');
        i += 1;
        continue;
      }

      if (line.trim().startsWith('>')) {
        const quote = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quote.push(lines[i].replace(/^>\s?/, ''));
          i += 1;
        }
        html.push(`<blockquote><p>${renderInline(quote.join('\n'))}</p></blockquote>`);
        continue;
      }

      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const header = renderTableRow(line, 'th');
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|')) {
          rows.push(renderTableRow(lines[i], 'td'));
          i += 1;
        }
        html.push(`<table><thead>${header}</thead><tbody>${rows.join('')}</tbody></table>`);
        continue;
      }

      if (/^[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
          items.push(`<li>${renderInline(lines[i].replace(/^[-*+]\s+/, ''))}</li>`);
          i += 1;
        }
        html.push(`<ul>${items.join('')}</ul>`);
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          items.push(`<li>${renderInline(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
          i += 1;
        }
        html.push(`<ol>${items.join('')}</ol>`);
        continue;
      }

      const para = [];
      while (i < lines.length && lines[i].trim() !== '') {
        para.push(lines[i]);
        i += 1;
      }
      html.push(`<p>${renderInline(para.join('\n'))}</p>`);
    }

    return html.join('\n');
  }

  function render(src) {
    const trimmed = (src || '').trim();
    if (!trimmed) return '';
    return renderBlocks(trimmed);
  }

  return { render, escapeHtml };
})();
