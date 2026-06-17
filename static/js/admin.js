let catalog = { categories: [], tools: [] };
let editingToolIndex = -1;

const flash = document.getElementById('flash');
const categoryTbody = document.getElementById('category-tbody');
const toolTbody = document.getElementById('tool-tbody');
const toolModal = document.getElementById('tool-modal');

async function checkAuth() {
  const res = await fetch('/api/admin/me');
  if (!res.ok) {
    window.location.href = '/admin/login';
    return false;
  }
  const data = await res.json();
  if (data.username) {
    document.getElementById('nav-user').textContent = data.username;
  }
  return true;
}

function showFlash(msg, type = 'success') {
  flash.textContent = msg;
  flash.className = `flash ${type}`;
  flash.hidden = false;
  setTimeout(() => { flash.hidden = true; }, 3000);
}

function slugify(text) {
  return text.trim().toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tool';
}

function editableCategories() {
  return catalog.categories.filter(c => c.id !== 'all');
}

function catName(id) {
  const c = catalog.categories.find(x => x.id === id);
  return c ? c.name : id;
}

async function loadCatalog() {
  const res = await fetch('/api/tools');
  catalog = await res.json();
  renderCategories();
  renderTools();
}

function renderCategories() {
  categoryTbody.innerHTML = editableCategories().map((cat, i) => `
    <tr>
      <td>
        <input class="cat-input" data-field="id" data-idx="${i}" value="${cat.id}">
      </td>
      <td>
        <input class="cat-input" data-field="name" data-idx="${i}" value="${cat.name}">
      </td>
      <td>
        <button type="button" class="btn-danger" data-del-cat="${i}">删除</button>
      </td>
    </tr>
  `).join('');

  categoryTbody.querySelectorAll('.cat-input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = +input.dataset.idx;
      const cats = editableCategories();
      const field = input.dataset.field;
      const oldId = cats[idx].id;
      cats[idx][field] = input.value.trim();

      if (field === 'id' && oldId !== cats[idx].id) {
        catalog.tools.forEach(t => {
          if (t.category === oldId) t.category = cats[idx].id;
        });
      }
      renderTools();
    });
  });

  categoryTbody.querySelectorAll('[data-del-cat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.delCat;
      const cats = editableCategories();
      const cat = cats[idx];
      const inUse = catalog.tools.some(t => t.category === cat.id);
      if (inUse) {
        showFlash(`分类「${cat.name}」下还有工具，无法删除`, 'error');
        return;
      }
      catalog.categories = catalog.categories.filter(c => c.id !== cat.id);
      renderCategories();
      renderTools();
    });
  });
}

function renderTools() {
  toolTbody.innerHTML = catalog.tools.map((tool, i) => `
    <tr>
      <td><div class="cell-logo">${tool.logo || '🔧'}</div></td>
      <td>${tool.title}</td>
      <td class="cell-truncate">${tool.intro || ''}</td>
      <td class="cell-truncate">${tool.jump_to}</td>
      <td>${catName(tool.category)}</td>
      <td class="cell-actions">
        <button type="button" class="btn-edit" data-edit-tool="${i}">编辑</button>
        <button type="button" class="btn-danger" data-del-tool="${i}">删除</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6" style="text-align:center;color:#999">暂无工具</td></tr>';

  toolTbody.querySelectorAll('[data-edit-tool]').forEach(btn => {
    btn.addEventListener('click', () => openToolModal(+btn.dataset.editTool));
  });

  toolTbody.querySelectorAll('[data-del-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      catalog.tools.splice(+btn.dataset.delTool, 1);
      renderTools();
    });
  });
}

function populateCategorySelect(selected) {
  const select = document.getElementById('tool-category');
  select.innerHTML = editableCategories().map(c =>
    `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${c.name}</option>`
  ).join('');
}

function openToolModal(index = -1) {
  editingToolIndex = index;
  const isNew = index < 0;
  document.getElementById('modal-title').textContent = isNew ? '添加工具' : '编辑工具';

  const tool = isNew
    ? { id: '', logo: '🔧', title: '', intro: '', jump_to: '', category: editableCategories()[0]?.id || 'dev' }
    : { ...catalog.tools[index] };

  document.getElementById('tool-id').value = tool.id;
  document.getElementById('tool-logo').value = tool.logo || '';
  document.getElementById('logo-preview').textContent = tool.logo || '🔧';
  document.getElementById('tool-title').value = tool.title || '';
  document.getElementById('tool-intro').value = tool.intro || '';
  document.getElementById('tool-jump').value = tool.jump_to || '';
  populateCategorySelect(tool.category);
  toolModal.hidden = false;
}

function closeToolModal() {
  toolModal.hidden = true;
  editingToolIndex = -1;
}

function saveToolFromModal() {
  const title = document.getElementById('tool-title').value.trim();
  const jumpTo = document.getElementById('tool-jump').value.trim();
  if (!title || !jumpTo) {
    showFlash('标题和跳转地址不能为空', 'error');
    return;
  }

  const tool = {
    id: document.getElementById('tool-id').value || slugify(title),
    logo: document.getElementById('tool-logo').value.trim() || '🔧',
    title,
    intro: document.getElementById('tool-intro').value.trim(),
    jump_to: jumpTo,
    category: document.getElementById('tool-category').value,
  };

  if (editingToolIndex < 0) {
    const dup = catalog.tools.some(t => t.id === tool.id);
    if (dup) tool.id = `${tool.id}-${Date.now()}`;
    catalog.tools.push(tool);
  } else {
    catalog.tools[editingToolIndex] = tool;
  }

  closeToolModal();
  renderTools();
}

async function saveAll() {
  const cats = editableCategories();
  for (const c of cats) {
    if (!c.id || !c.name) {
      showFlash('分类 ID 和名称不能为空', 'error');
      return;
    }
  }

  try {
    const res = await fetch('/api/admin/catalog', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(catalog),
    });
    if (res.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    const data = await res.json();
    if (data.ok) {
      showFlash('保存成功');
      await loadCatalog();
    } else {
      showFlash(data.error || '保存失败', 'error');
    }
  } catch {
    showFlash('请求失败，请确认服务已启动', 'error');
  }
}

document.getElementById('add-category').addEventListener('click', () => {
  const id = `cat-${Date.now()}`;
  catalog.categories.push({ id, name: '新分类' });
  renderCategories();
  renderTools();
});

document.getElementById('add-tool').addEventListener('click', () => openToolModal());

document.getElementById('tool-logo').addEventListener('input', (e) => {
  document.getElementById('logo-preview').textContent = e.target.value || '🔧';
});

document.getElementById('modal-close').addEventListener('click', closeToolModal);
document.getElementById('modal-cancel').addEventListener('click', closeToolModal);
document.getElementById('modal-save').addEventListener('click', saveToolFromModal);
document.getElementById('save-all').addEventListener('click', saveAll);

toolModal.addEventListener('click', (e) => {
  if (e.target === toolModal) closeToolModal();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

checkAuth().then(ok => { if (ok) loadCatalog(); });

