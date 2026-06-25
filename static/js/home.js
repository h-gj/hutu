let catalog = { categories: [], tools: [] };
let activeCategory = 'all';
let pinnedIds = [];
let dragToolId = null;

async function loadCatalog() {
  pinnedIds = await ToolPins.init();
  const res = await fetch('/api/tools');
  catalog = await res.json();
  renderNav();
  renderCards();
}

function renderNav() {
  const nav = document.getElementById('site-nav');
  nav.innerHTML = catalog.categories.map(cat => `
    <button class="nav-item${cat.id === activeCategory ? ' active' : ''}"
            data-category="${cat.id}">${cat.name}</button>
  `).join('');

  nav.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.category;
      renderNav();
      renderCards();
    });
  });
}

function getFilteredToolIds() {
  return activeCategory === 'all'
    ? catalog.tools.map((t) => t.id)
    : catalog.tools.filter((t) => t.category === activeCategory).map((t) => t.id);
}

function getFilteredTools() {
  const tools = activeCategory === 'all'
    ? catalog.tools
    : catalog.tools.filter((t) => t.category === activeCategory);
  return ToolPins.sortTools(tools, pinnedIds, activeCategory);
}

function renderCards() {
  const grid = document.getElementById('card-grid');
  const tools = getFilteredTools();

  if (tools.length === 0) {
    grid.innerHTML = '<div class="empty-state">该分类下暂无工具，敬请期待</div>';
    return;
  }

  const catMap = Object.fromEntries(catalog.categories.map(c => [c.id, c.name]));

  grid.innerHTML = tools.map(tool => {
    const jumpTo = tool.jump_to || tool.url || '#';
    const external = /^https?:\/\//.test(jumpTo);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    const logo = tool.logo || tool.icon || '🔧';
    const title = tool.title || tool.name || '';
    const intro = tool.intro || tool.description || '';
    const pinned = ToolPins.isPinned(tool.id, pinnedIds);
    const pinLabel = pinned ? '取消置顶' : '置顶';
    return `
    <div class="tool-card-wrap${pinned ? ' is-pinned' : ''}" data-tool-id="${tool.id}">
      <button type="button" class="tool-card-drag" title="拖拽排序" aria-label="拖拽排序">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M9 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm10-14a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>
        </svg>
      </button>
      <button type="button" class="tool-card-pin${pinned ? ' pinned' : ''}"
              data-tool-id="${tool.id}" title="${pinLabel}" aria-label="${pinLabel}">
        <svg class="tool-card-pin-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M16 3v4l-2 2v8a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-8l-2-2V3h8zM9 3h6v3.5l2 2v7.5H7v-7.5l2-2V3z"/>
        </svg>
      </button>
      <a class="tool-card" href="${jumpTo}"${attrs}>
        <div class="tool-card-icon">${logo}</div>
        <div class="tool-card-name">${title}</div>
        <div class="tool-card-desc-wrap">
          <div class="tool-card-desc">${intro}</div>
          <div class="tool-card-desc-tooltip" role="tooltip">${intro}</div>
        </div>
        <span class="tool-card-tag">${catMap[tool.category] || tool.category}</span>
      </a>
    </div>`;
  }).join('');

  grid.querySelectorAll('.tool-card-pin').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const toolId = btn.dataset.toolId;
      pinnedIds = ToolPins.toggle(toolId, pinnedIds, activeCategory, getFilteredToolIds());
      renderCards();
    });
  });

  bindDragHandlers(grid);
  bindDescTooltips(grid);
}

function bindDescTooltips(grid) {
  grid.querySelectorAll('.tool-card-desc-wrap').forEach((wrap) => {
    const desc = wrap.querySelector('.tool-card-desc');
    if (!desc) return;
    if (desc.scrollHeight <= desc.clientHeight + 1) {
      wrap.classList.add('no-tooltip');
    }
  });
}

function getWrapOrder(grid) {
  return [...grid.querySelectorAll('.tool-card-wrap')].map((el) => el.dataset.toolId);
}

function bindDragHandlers(grid) {
  grid.querySelectorAll('.tool-card-wrap').forEach((wrap) => {
    const handle = wrap.querySelector('.tool-card-drag');
    if (!handle) return;

    handle.addEventListener('dragstart', (e) => {
      dragToolId = wrap.dataset.toolId;
      wrap.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragToolId);
      if (e.dataTransfer.setDragImage) {
        e.dataTransfer.setDragImage(wrap, 40, 40);
      }
    });

    handle.addEventListener('dragend', () => {
      wrap.classList.remove('is-dragging');
      grid.querySelectorAll('.tool-card-wrap').forEach((el) => el.classList.remove('is-drag-over'));
      dragToolId = null;
    });

    wrap.addEventListener('dragover', (e) => {
      if (!dragToolId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (wrap.dataset.toolId !== dragToolId) {
        wrap.classList.add('is-drag-over');
      }
    });

    wrap.addEventListener('dragleave', () => {
      wrap.classList.remove('is-drag-over');
    });

    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('is-drag-over');
      const fromId = e.dataTransfer.getData('text/plain') || dragToolId;
      if (!fromId || fromId === wrap.dataset.toolId) return;

      const wraps = [...grid.querySelectorAll('.tool-card-wrap')];
      const fromWrap = wraps.find((el) => el.dataset.toolId === fromId);
      if (!fromWrap) return;

      const fromIdx = wraps.indexOf(fromWrap);
      const pinnedCountBefore = wraps.filter((el) => pinnedIds.includes(el.dataset.toolId)).length;

      const toIdx = wraps.indexOf(wrap);
      if (fromIdx < toIdx) {
        wrap.after(fromWrap);
      } else {
        wrap.before(fromWrap);
      }

      const newOrder = getWrapOrder(grid);
      pinnedIds = ToolPins.reconcileAfterDrag(
        newOrder,
        pinnedIds,
        activeCategory,
        fromId,
        pinnedCountBefore,
      );
      renderCards();
    });

    handle.setAttribute('draggable', 'true');
  });
}

loadCatalog();
