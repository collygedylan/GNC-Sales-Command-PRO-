/** Private conversation UI. All data and actions are re-authorized by the server. */
export function mountAuraQueryPanel({ panel, content, input, request, isAuthorized, speak, setBusy, openAction }) {
  let conversationId = null, revision = null, active = null, epoch = 0, destroyed = false;
  let historyCursor = null, listCursor = null, cancelling = Promise.resolve();
  const node = (tag, text, className = '') => {
    const value = document.createElement(tag);
    value.textContent = text ?? '';
    value.className = className;
    return value;
  };
  const toolbar = node('nav', '', 'aura-actions aura-chat-toolbar');
  toolbar.setAttribute('aria-label', 'Aura conversations');
  const title = node('span', 'New conversation', 'aura-chat-title');
  const timeline = node('div', '', 'aura-chat-history');
  timeline.setAttribute('role', 'log');
  timeline.setAttribute('aria-label', 'Aura conversation');
  timeline.setAttribute('aria-live', 'polite');
  const status = node('p', 'Ask about plants, assignments, work, sales, reports, or your messages.', 'aura-message');
  content.replaceChildren(status, timeline);
  panel.insertBefore(toolbar, content);
  const current = () => !destroyed && isAuthorized();
  const button = (label, handler, parent = toolbar) => {
    const value = node('button', label, 'aura-action');
    value.type = 'button';
    value.addEventListener('click', () => { if (current()) void handler(); });
    parent.append(value);
    return value;
  };
  function updateIdentity(response) {
    conversationId = response.conversationId || response.conversation?.id || conversationId;
    revision = response.revision ?? response.conversation?.revision ?? revision;
    title.textContent = response.title || response.conversation?.title || (conversationId ? 'Current conversation' : 'New conversation');
    deleteButton.disabled = !conversationId;
  }
  async function call(body, signal) {
    if (!current()) throw new Error('Sign in with Dylan’s active account.');
    const requestId = body.turnId || crypto.randomUUID();
    const response = await request(body, { signal, requestId });
    if (!current() || signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!response?.ok) throw new Error(response?.error?.message || response?.error || 'Aura could not complete that request.');
    return response;
  }
  function addMessage(role, text, parent = timeline) {
    const entry = node('article', '', `aura-message aura-chat-${role}`);
    entry.append(node('strong', role === 'user' ? 'You' : 'Aura'), node('p', String(text || '')));
    parent.append(entry);
    return entry;
  }
  function renderRows(action, parent) {
    const rows = Array.isArray(action.rows) ? action.rows.slice(0, 100) : [];
    if (action.title) parent.append(node('strong', action.title));
    const columns = (Array.isArray(action.columns) ? action.columns : Object.keys(rows[0] || {}))
      .map(value => typeof value === 'string' ? { key: value, label: value.replaceAll('_', ' ') } : value)
      .filter(value => value && typeof value.key === 'string').slice(0, 64);
    const priority = ['commonName', 'itemcode', 'contSize', 'locationCode', 'lotCode', 'ptravailable', 'ptronhand', 'assignedTo', 'ownerStatus', 'ownershipSource'];
    if (columns.some(column => column.key === 'ownerStatus')) columns.sort((a, b) =>
      (priority.includes(a.key) ? priority.indexOf(a.key) : 100) - (priority.includes(b.key) ? priority.indexOf(b.key) : 100));
    for (const row of rows) {
      const entry = node('dl', '', 'aura-message');
      const extra = node('dl', '');
      for (const [index, { key, label }] of columns.entries()) {
        const value = row[key];
        if (value == null) continue;
        const display = Array.isArray(value) ? value.slice(0, 25).map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).join('; ')
          : typeof value === 'object' ? JSON.stringify(value) : String(value);
        (index < 12 ? entry : extra).append(node('dt', label || key), node('dd', display.slice(0, 1600)));
      }
      if (extra.children.length) { const details = node('details', ''); details.append(node('summary', 'More record details'), extra); entry.append(details); }
      parent.append(entry);
    }
  }
  function renderActions(response, parent, historical = false) {
    for (const action of (response.actions || []).slice(0, 5)) {
      if (action.type === 'records') renderRows(action, parent);
      else if (action.type === 'inventory_result') renderRows({ rows: action.data?.rows }, parent);
      else if (action.type === 'choices' && !historical) {
        for (const [index, item] of (action.items || []).slice(0, 5).entries()) {
          button(`${index + 1}. ${item.label || [item.commonname, item.contsize, item.locationcode].filter(Boolean).join(' ') || item.id}`, () => submit(`option ${index + 1}`), parent).classList.add('aura-context-action');
        }
      } else if (['navigation', 'review'].includes(action.type) && !historical) {
        if (action.type === 'review') {
          parent.append(node('p', action.proposal?.summary || 'Review this proposal in the app before saving. Nothing has been saved.'));
          if (action.proposal?.text) parent.append(node('p', action.proposal.text));
        }
        button(action.type === 'review' ? 'Review in app' : 'Open in app', async () => {
          try {
            if (typeof openAction !== 'function') throw new Error('Open the relevant app screen to review this request.');
            await openAction(action);
          } catch (error) { if (current()) status.textContent = error.message; }
        }, parent);
      }
    }
    if (!historical && (response.hasMore || response.actions?.some(action => action.hasMore || action.data?.hasMore))) {
      button('Show more', () => submit('show more'), parent).classList.add('aura-context-action');
    }
  }
  function cancel() {
    const pending = active;
    epoch += 1;
    active = null;
    pending?.controller.abort();
    setBusy(false);
    if (pending?.turnId && pending.conversationId) {
      cancelling = call({ mode: 'cancel', conversationId: pending.conversationId, turnId: pending.turnId })
        .then(result => { if (conversationId === pending.conversationId) updateIdentity(result); })
        .catch(() => {});
    }
    return cancelling;
  }
  async function ensureConversation(signal) {
    if (!conversationId) updateIdentity(await call({ mode: 'create' }, signal));
  }
  async function submit(raw, source = 'typed', retry = null) {
    const text = String(raw || '').trim();
    if (!current() || !text) return;
    if (/^(?:stop|cancel(?: that)?|never\s?mind)$/i.test(text)) {
      await cancel();
      if (current()) status.textContent = 'Stopped. Nothing was saved.';
      return;
    }
    if (active) return;
    if (text.length > 2000) { status.textContent = 'Please keep your question under 2,000 characters.'; return; }
    await cancelling;
    if (!current()) return;
    const ticket = ++epoch;
    const controller = new AbortController();
    let submittedTurnId = null, submittedConversationId = null;
    active = { controller, conversationId, turnId: null };
    setBusy(true);
    for (const control of timeline.querySelectorAll('.aura-context-action')) control.disabled = true;
    status.textContent = 'Checking current data…';
    addMessage('user', text);
    try {
      await ensureConversation(controller.signal);
      if (!current() || ticket !== epoch) return;
      const turnId = retry?.conversationId === conversationId ? retry.turnId : crypto.randomUUID();
      submittedTurnId = turnId;
      submittedConversationId = conversationId;
      active = { controller, conversationId, turnId };
      const response = await call({ mode: 'command', text, source: source === 'voice' ? 'voice' : 'typed',
        turnId, conversationId, expectedRevision: revision, context: {} }, controller.signal);
      if (ticket !== epoch) return;
      updateIdentity(response);
      const entry = addMessage('assistant', response.reply);
      renderActions(response, entry);
      const checkedAt = response.source?.checkedAt || response.checkedAt?.at;
      status.textContent = checkedAt ? `Checked ${new Date(checkedAt).toLocaleString()}` : 'Ready for a follow-up.';
      input.value = '';
      if (response.speech) speak(String(response.speech).slice(0, 600));
      content.scrollTop = content.scrollHeight;
    } catch (error) {
      if (current() && ticket === epoch && !controller.signal.aborted) {
        status.textContent = error.message || 'Aura is temporarily unavailable.';
        input.value = text;
        button('Retry question', async () => {
          if (submittedConversationId && conversationId !== submittedConversationId) {
            status.textContent = 'Resume the original conversation to retry this question.';
            return;
          }
          // Refresh revision after conflicts without automatically repeating work.
          const retryEpoch = epoch;
          if (conversationId) { try { const refreshed = await call({ mode: 'read', conversationId, limit: 1 }); if (epoch !== retryEpoch) return; updateIdentity(refreshed); } catch {} }
          if (epoch !== retryEpoch) return;
          await submit(text, source, submittedTurnId ? { turnId: submittedTurnId, conversationId: submittedConversationId } : null);
        }, timeline);
      }
    } finally { if (ticket === epoch) { active = null; setBusy(false); } }
  }
  async function readHistory(id, cursor = null) {
    await cancel();
    const ticket = ++epoch;
    if (!cursor) {
      conversationId = id; revision = null;
      timeline.replaceChildren(); title.textContent = 'Selected conversation'; deleteButton.disabled = false;
    }
    status.textContent = 'Loading conversation…';
    try {
      const response = await call({ mode: 'read', conversationId: id, cursor, limit: 30 });
      if (ticket !== epoch) return;
      updateIdentity(response);
      if (!cursor) timeline.replaceChildren();
      const section = node('section', '');
      const turns = response.turns || [];
      for (const turn of turns) {
        if (turn.text || turn.userText || turn.user_text) addMessage('user', turn.text || turn.userText || turn.user_text, section);
        const answer = turn.response || {};
        if (answer.reply) { const message = addMessage('assistant', answer.reply, section); renderActions(answer, message, true); }
      }
      if (cursor) timeline.prepend(section); else timeline.append(section);
      historyCursor = response.nextCursor;
      for (const control of timeline.querySelectorAll('.aura-history-more')) control.remove();
      if (response.hasMore && historyCursor) button('Load older messages', eventlessLoadOlder, section).classList.add('aura-history-more');
      status.textContent = 'Conversation restored. Current questions will refresh live data.';
    } catch (error) { if (current() && ticket === epoch) status.textContent = error.message; }
  }
  async function eventlessLoadOlder() { if (conversationId && historyCursor) await readHistory(conversationId, historyCursor); }
  async function listChats(cursor = null) {
    await cancel();
    const ticket = ++epoch;
    status.textContent = 'Loading conversations…';
    try {
      const response = await call({ mode: 'list', cursor, limit: 30 });
      if (ticket !== epoch) return;
      if (!cursor) timeline.replaceChildren();
      const chats = response.conversations || response.rows || [];
      for (const chat of chats) button(chat.title || 'Untitled conversation', () => readHistory(chat.id || chat.conversationId), timeline);
      listCursor = response.nextCursor;
      for (const control of timeline.querySelectorAll('.aura-list-more')) control.remove();
      if (response.hasMore && listCursor) button('More conversations', () => listChats(listCursor), timeline).classList.add('aura-list-more');
      status.textContent = chats.length ? 'Choose a conversation to resume.' : 'No saved conversations yet.';
    } catch (error) { if (current() && ticket === epoch) status.textContent = error.message; }
  }
  button('New chat', async () => {
    await cancel();
    conversationId = null; revision = null;
    timeline.replaceChildren(); title.textContent = 'New conversation'; deleteButton.disabled = true;
    status.textContent = 'Ask a new question. Your other conversations are saved.';
  });
  button('Conversations', () => listChats());
  const deleteButton = button('Delete chat', async () => {
    if (!conversationId) return;
    const id = conversationId;
    const confirmation = node('div', '', 'aura-message');
    confirmation.append(node('p', 'Delete this conversation and its saved context?'));
    button('Delete permanently', async () => {
      await cancel();
      const ticket = ++epoch;
      try {
        await call({ mode: 'delete', conversationId: id });
        if (!current() || ticket !== epoch) return;
        if (conversationId === id) { conversationId = null; revision = null; title.textContent = 'New conversation'; }
        timeline.replaceChildren(); deleteButton.disabled = !conversationId;
        status.textContent = 'Conversation deleted.';
      } catch (error) { if (current()) status.textContent = error.message; }
    }, confirmation);
    button('Keep chat', () => confirmation.remove(), confirmation);
    timeline.append(confirmation);
  });
  deleteButton.disabled = true;
  button('Stop', () => cancel().then(() => { if (current()) status.textContent = 'Stopped. Nothing was saved.'; }));
  toolbar.append(title);
  return { submit, cancel, destroy() { void cancel(); destroyed = true; toolbar.remove(); timeline.replaceChildren(); } };
}
