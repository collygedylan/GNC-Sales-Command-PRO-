(function installStableViewDom(global) {
  'use strict';

  const keyAttributes = ['id', 'data-dom-id', 'data-request-uid', 'data-inventory-id', 'data-request-id', 'data-row-id', 'data-render-key'];
  const islandIds = new Set(['manager-assigned-items-root', 'production-field-counting-root', 'historical-requests-root']);

  /** @param {Node} node @returns {string} */
  function keyOf(node) {
    if (node.nodeType !== 1) return '';
    const element = /** @type {Element} */ (node);
    for (const attribute of keyAttributes) {
      const value = element.getAttribute(attribute);
      if (value) return `${attribute}:${value}`;
    }
    return '';
  }

  /** @param {Node} current @param {Node} next */
  function compatible(current, next) {
    return current.nodeType === next.nodeType && current.nodeName === next.nodeName
      && keyOf(current) === keyOf(next);
  }

  /** @param {Element} current @param {Element} next @param {Element | null} focused */
  function updateAttributes(current, next, focused) {
    const editing = current === focused;
    for (const attribute of Array.from(current.attributes)) {
      if (attribute.name === 'data-preserve-dom') continue;
      if (editing && ['value', 'checked', 'selected'].includes(attribute.name)) continue;
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(next.attributes)) {
      if (editing && ['value', 'checked', 'selected'].includes(attribute.name)) continue;
      if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    }
  }

  /** @param {Node} current @param {Node} next @param {Element | null} focused */
  function updateNode(current, next, focused) {
    if (current.isEqualNode(next)) return;
    if (current.nodeType !== 1) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    const element = /** @type {Element} */ (current);
    const incoming = /** @type {Element} */ (next);
    const island = element.hasAttribute('data-preserve-dom') || islandIds.has(element.id);
    const dirty = element === focused
      || ('defaultValue' in element && element.value !== element.defaultValue)
      || ('defaultChecked' in element && element.checked !== element.defaultChecked)
      || (element.tagName === 'SELECT' && Array.from(element.options).some(option => option.selected !== option.defaultSelected));
    const draft = dirty && 'value' in element ? element.value : undefined;
    const checked = dirty && 'checked' in element ? element.checked : undefined;
    const expanded = element.tagName === 'DETAILS' ? element.open : undefined;
    updateAttributes(element, incoming, focused);
    // React owns island children. A missing island is still removed by its parent.
    if (island) return;
    reconcileChildren(element, incoming, focused);
    if (!dirty && 'value' in element && 'value' in incoming && element.tagName !== 'INPUT') {
      element.value = incoming.value;
    }
    if (!dirty && element.tagName === 'INPUT' && element.getAttribute('type') !== 'file') {
      element.value = incoming.value;
      element.checked = incoming.checked;
    }
    if (draft !== undefined && element.getAttribute('type') !== 'file') element.value = draft;
    if (checked !== undefined) element.checked = checked;
    if (expanded !== undefined) element.open = expanded;
  }

  /** @param {Node} parent @param {Node} incoming @param {Element | null} focused */
  function reconcileChildren(parent, incoming, focused) {
    const keyed = new Map();
    for (const child of Array.from(parent.childNodes)) {
      const key = keyOf(child);
      if (key) keyed.set(key, keyed.has(key) ? null : child);
    }
    let cursor = parent.firstChild;
    const retained = new Set();
    for (const next of Array.from(incoming.childNodes)) {
      const key = keyOf(next);
      const keyedCandidate = key && keyed.get(key);
      const candidate = keyedCandidate && !retained.has(keyedCandidate) && compatible(keyedCandidate, next) ? keyedCandidate
        : cursor && !retained.has(cursor) && compatible(cursor, next) ? cursor : null;
      if (candidate) {
        updateNode(candidate, next, focused);
        if (candidate !== cursor) parent.insertBefore(candidate, cursor);
        retained.add(candidate);
        cursor = candidate.nextSibling;
      } else {
        parent.insertBefore(next, cursor);
        retained.add(next);
      }
    }
    for (const child of Array.from(parent.childNodes)) if (!retained.has(child)) parent.removeChild(child);
  }

  /** Preserve connected row identities during a background refresh.
   * @param {Element} container @param {Node} incoming
   * @returns {boolean}
   */
  function apply(container, incoming) {
    if (!container || !incoming || container === incoming) return false;
    const document = container.ownerDocument;
    const focused = document.activeElement && container.contains(document.activeElement) ? document.activeElement : null;
    const field = focused && 'value' in focused ? focused : null;
    const draft = field ? field.value : undefined;
    const selection = field && 'selectionStart' in field
      ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection } : null;
    reconcileChildren(container, incoming, focused);
    if (focused?.isConnected) {
      if (field && draft !== undefined) field.value = draft;
      if (document.activeElement !== focused && typeof focused.focus === 'function') focused.focus({ preventScroll: true });
      if (selection && selection.start !== null && typeof field.setSelectionRange === 'function') {
        field.setSelectionRange(selection.start, selection.end, selection.direction || 'none');
      }
    }
    return true;
  }

  Object.defineProperty(global, 'AgMetricStableViewDom', { configurable: true, value: Object.freeze({ apply }) });
})(window);
