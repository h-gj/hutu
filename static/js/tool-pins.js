/** Per-browser tool layout: pin state + card order (localStorage, keyed by fingerprint). */
const ToolPins = (() => {
  const PINNED_PREFIX = 'hutu_pinned_';
  const ORDER_PREFIX = 'hutu_tool_order_';
  let browserId = null;

  async function hashString(str) {
    if (window.crypto && crypto.subtle) {
      const data = new TextEncoder().encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 16);
    }
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function collectFingerprintParts() {
    return [
      navigator.userAgent,
      navigator.language,
      navigator.languages ? navigator.languages.join(',') : '',
      screen.width,
      screen.height,
      screen.colorDepth,
      window.devicePixelRatio || 1,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || '',
      navigator.platform || '',
      navigator.maxTouchPoints || 0,
    ].join('|');
  }

  async function getBrowserId() {
    if (browserId) return browserId;
    browserId = await hashString(collectFingerprintParts());
    return browserId;
  }

  function pinnedKey() {
    return `${PINNED_PREFIX}${browserId}`;
  }

  function orderKey() {
    return `${ORDER_PREFIX}${browserId}`;
  }

  function readPinnedIds() {
    try {
      const raw = localStorage.getItem(pinnedKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  function writePinnedIds(ids) {
    localStorage.setItem(pinnedKey(), JSON.stringify(ids));
  }

  function readOrders() {
    try {
      const raw = localStorage.getItem(orderKey());
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeOrders(orders) {
    localStorage.setItem(orderKey(), JSON.stringify(orders));
  }

  function setUnpinnedOrder(category, ids) {
    const orders = readOrders();
    orders[category] = ids;
    writeOrders(orders);
  }

  async function init() {
    await getBrowserId();
    return readPinnedIds();
  }

  function isPinned(toolId, pinnedIds) {
    return pinnedIds.includes(toolId);
  }

  function toggle(toolId, pinnedIds, category, toolIdsInCategory) {
    let nextPinned;
    if (pinnedIds.includes(toolId)) {
      nextPinned = pinnedIds.filter((id) => id !== toolId);
      const orders = readOrders();
      const unpinned = (orders[category] || []).filter((id) => id !== toolId && toolIdsInCategory.includes(id));
      for (const id of toolIdsInCategory) {
        if (!nextPinned.includes(id) && !unpinned.includes(id)) unpinned.push(id);
      }
      orders[category] = unpinned;
      writeOrders(orders);
    } else {
      nextPinned = [...pinnedIds, toolId];
    }
    writePinnedIds(nextPinned);
    return nextPinned;
  }

  function sortTools(tools, pinnedIds, category) {
    const ids = tools.map((t) => t.id);
    const orders = readOrders();
    const unpinnedSaved = (orders[category] || []).filter(
      (id) => ids.includes(id) && !pinnedIds.includes(id),
    );
    const unpinned = [];
    for (const id of unpinnedSaved) {
      if (!unpinned.includes(id)) unpinned.push(id);
    }
    for (const id of ids) {
      if (!pinnedIds.includes(id) && !unpinned.includes(id)) unpinned.push(id);
    }
    const pinned = pinnedIds.filter((id) => ids.includes(id));
    const toolMap = Object.fromEntries(tools.map((t) => [t.id, t]));
    return [...pinned, ...unpinned].map((id) => toolMap[id]).filter(Boolean);
  }

  function reconcileAfterDrag(fullOrder, pinnedIds, category, fromId, pinnedCountBefore) {
    const wasPinned = pinnedIds.includes(fromId);
    const newIdx = fullOrder.indexOf(fromId);

    let nextPinned = pinnedIds.filter((id) => id !== fromId || wasPinned);
    if (!wasPinned && newIdx < pinnedCountBefore) {
      nextPinned.push(fromId);
    } else if (wasPinned && newIdx >= pinnedCountBefore - 1) {
      nextPinned = nextPinned.filter((id) => id !== fromId);
    } else if (wasPinned) {
      nextPinned.push(fromId);
    }

    nextPinned = fullOrder.filter((id) => nextPinned.includes(id));
    const unpinned = fullOrder.filter((id) => !nextPinned.includes(id));
    writePinnedIds(nextPinned);
    setUnpinnedOrder(category, unpinned);
    return nextPinned;
  }

  return {
    init,
    isPinned,
    toggle,
    sortTools,
    reconcileAfterDrag,
  };
})();
