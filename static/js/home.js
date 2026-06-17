let catalog = { categories: [], tools: [] };
let activeCategory = 'all';

async function loadCatalog() {
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

function renderCards() {
  const grid = document.getElementById('card-grid');
  const tools = activeCategory === 'all'
    ? catalog.tools
    : catalog.tools.filter(t => t.category === activeCategory);

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
    return `
    <a class="tool-card" href="${jumpTo}"${attrs}>
      <div class="tool-card-icon">${logo}</div>
      <div class="tool-card-name">${title}</div>
      <div class="tool-card-desc">${intro}</div>
      <span class="tool-card-tag">${catMap[tool.category] || tool.category}</span>
    </a>`;
  }).join('');
}

loadCatalog();
