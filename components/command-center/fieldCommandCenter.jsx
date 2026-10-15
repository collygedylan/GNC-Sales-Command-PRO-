import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SWRConfig } from 'swr';
import { commandCenterDatabase } from '../../services/commandCenterDatabase';
import { renderIdentity } from '../../services/renderIdentity.mjs';
import { useRevisionedSnapshot } from '../../services/useRevisionedSnapshot';

const h = React.createElement;
const newId = () => globalThis.crypto?.randomUUID?.() || `alpha-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const safeText = value => String(value == null ? '' : value);
const errorText = error => safeText(error?.message || error || 'Request failed. Try again.');
const when = value => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString(); };
const records = value => Array.isArray(value) ? value.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
const isAccessDenial = error => ['401', '403', '42501'].includes(String(error?.status || ''))
  || ['401', '403', '42501'].includes(String(error?.code || ''));
const snapshotCachesByScope = new Map();
const COMMUNICATION_CHAT_SOURCES = ['ph_chat_conversations', 'ph_chat_participants', 'ph_chat_messages'];
const COMMUNICATION_CALENDAR_SOURCES = ['ph_department_calendar_events'];
const HR_COMMAND_SOURCES = ['core_employees', 'hr_job_codes', 'labor_timesheets', 'ph_department_calendar_events'];

function useAlphaSnapshot(deps, resource, params, revision, read) {
  const scope = String(deps.getCacheScope?.() || deps.cacheScope || `profile:${deps.profileId || ''}`);
  const key = deps.isAuthorized() ? JSON.stringify(['alpha-command-center', scope, resource, params]) : null;
  return useRevisionedSnapshot(key, String(revision ?? ''), async () => {
    try {
      if (!deps.isAuthorized()) throw Object.assign(new Error('Session changed.'), { status: 403 });
      const result = await read();
      if (!deps.isAuthorized()) throw Object.assign(new Error('Session changed.'), { status: 403 });
      if (result?.error) throw result.error;
      return result;
    } catch (error) {
      if (!deps.isAuthorized() || isAccessDenial(error)) snapshotCachesByScope.get(scope)?.clear();
      throw error;
    }
  }, { revalidateOnFocus: false, revalidateOnReconnect: true, shouldRetryOnError: false, dedupingInterval: 30000 });
}

function useAuthorizedSourceRevision(deps, surface, allowedSources) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const host = deps.host;
    if (!host || !deps.isAuthorized()) return;
    const allowed = new Set(allowedSources);
    const onRevision = event => {
      const detail = event?.detail;
      if (!deps.isAuthorized() || detail?.surface !== surface || !Array.isArray(detail.sources)) return;
      if (detail.sources.some(source => allowed.has(source))) setRevision(current => current + 1);
    };
    host.addEventListener('gnc-manager-source-revision', onRevision);
    return () => host.removeEventListener('gnc-manager-source-revision', onRevision);
  }, [deps, surface, allowedSources]);
  return revision;
}

class CommandCenterBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <section className="alpha-command-center" role="alert">
      <div className="alpha-panel alpha-empty-state">
        <h2>{this.props.mode === 'hr' ? 'HR & Labor could not display' : 'Communications could not display'}</h2>
        <p>Reopen this view or try again.</p>
        <button type="button" onClick={() => this.setState({ failed: false })}>Try again</button>
      </div>
    </section>;
    return this.props.children;
  }
}

function useAuthorizedApi(deps) {
  return useCallback(async (payload, signal) => {
    const read = async () => {
      if (!deps.isAuthorized()) throw new Error('Dylan’s verified session is required.');
      const result = await deps.callApi(payload, signal);
      if (!deps.isAuthorized()) throw new Error('Session changed.');
      if (!result?.ok) throw Object.assign(new Error(safeText(result?.error || result?.message || 'Request failed.')), { code: result?.code, status: result?.status });
      return result;
    };
    return read();
  }, [deps]);
}

function MessageFeed({ rows, onRetry }) {
  const parentRef = useRef(null);
  const previousCount = useRef(0);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 74, overscan: 8, getItemKey: index => { const row = rows[index]; return row ? renderIdentity(row, row.clientId || row.id) : `missing-message:${index}`; } });
  useEffect(() => {
    const viewport = parentRef.current;
    const wasAtBottom = viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 160;
    if (rows.length && (previousCount.current === 0 || wasAtBottom)) virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    previousCount.current = rows.length;
  }, [rows.length]);
  return <div className="alpha-feed" ref={parentRef} role="log" aria-label="Messages">
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map(item => {
        const row = rows[item.index];
        return <div key={item.key} ref={virtualizer.measureElement} data-index={item.index} style={{ position: 'absolute', left: 0, width: '100%', transform: `translateY(${item.start}px)` }}>
          <div className={`alpha-bubble ${row.senderUsername === 'dylan_collyge' || row.optimistic ? 'alpha-mine' : ''} ${row.failed ? 'alpha-failed' : ''}`}>
            <div>{safeText(row.body)}</div>
            <small>{safeText(row.senderDisplayName || row.senderUsername || '')} · {row.optimistic ? row.failed ? 'Failed' : 'Sending…' : when(row.createdAt)}</small>
            {row.failed && <button type="button" onClick={() => onRetry(row)}>Retry message</button>}
          </div>
        </div>;
      })}
    </div>
  </div>;
}

function usePrivateChatChannel(deps, conversationId, onMessage) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  useEffect(() => {
    if (!conversationId || !deps.isAuthorized() || !deps.client?.channel) return;
    let active = true;
    let channel = null;
    const join = async () => {
      // Private Presence and Broadcast are scoped to Dylan's verified account.
      const { data } = await deps.client.auth.getSession();
      if (!active || !deps.isAuthorized() || !data?.session?.access_token) return;
      await deps.client.realtime.setAuth(data.session.access_token);
      if (!active || !deps.isAuthorized()) return;
      channel = deps.client.channel(`alpha-chat:dylan_collyge:${conversationId}`, { config: { private: true, presence: { key: 'dylan_collyge' }, broadcast: { self: false } } });
      channel.on('broadcast', { event: 'typing' }, payload => onMessageRef.current?.('typing', payload.payload));
      channel.on('broadcast', { event: 'read' }, payload => onMessageRef.current?.('read', payload.payload));
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ph_chat_messages', filter: `conversation_id=eq.${conversationId}` }, () => onMessageRef.current?.('message'));
      channel.subscribe(status => { if (status === 'SUBSCRIBED' && active) channel.track({ username: 'dylan_collyge', at: new Date().toISOString() }).catch(() => {}); });
    };
    void join().catch(() => {});
    return () => { active = false; if (channel) void deps.client.removeChannel(channel); };
  }, [deps, conversationId]);
}

function Communications({ deps }) {
  const api = useAuthorizedApi(deps);
  const [tab, setTab] = useState('chat');
  const [conversationId, setConversationId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [draft, setDraft] = useState('');
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [typing, setTyping] = useState('');
  const [readAt, setReadAt] = useState('');
  const sendInFlight = useRef(new Set());
  const latestPage = useRef(0);
  const chatRevision = useAuthorizedSourceRevision(deps, 'communications-chat', COMMUNICATION_CHAT_SOURCES);
  const calendarRevision = useAuthorizedSourceRevision(deps, 'communications-calendar', COMMUNICATION_CALENDAR_SOURCES);
  const conversationSnapshot = useAlphaSnapshot(deps, 'alpha-chat-list', { limit: 50 }, chatRevision, () => api({ action: 'alpha_chat_list', limit: 50 }));
  const calendarSnapshot = useAlphaSnapshot(deps, 'alpha-calendar', { limit: 100 }, calendarRevision, () => api({ action: 'alpha_timeoff_list', limit: 100 }));
  const messageSnapshot = useAlphaSnapshot(deps, 'alpha-chat-page', { conversationId, cursor: null, limit: 100 }, chatRevision,
    () => api({ action: 'alpha_chat_page', conversationId, cursor: null, limit: 100 }));
  const conversations = records(conversationSnapshot.data?.rows);
  const calendar = records(calendarSnapshot.data?.rows);
  useEffect(() => {
    if (![conversationSnapshot.error, messageSnapshot.error, calendarSnapshot.error].some(isAccessDenial)) return;
    setConversationId(''); setRecipientName(''); setDraft(''); setRows([]); setCursor(null); setHasMore(false);
    setTyping(''); setReadAt('');
  }, [conversationSnapshot.error, messageSnapshot.error, calendarSnapshot.error]);
  useEffect(() => {
    const snapshotRows = records(messageSnapshot.data?.rows);
    if (!conversationId || !messageSnapshot.data) return;
    setRows(current => [...snapshotRows, ...current.filter(row => row.optimistic || (row.id && !snapshotRows.some(fresh => fresh.id === row.id)))]);
    setCursor(messageSnapshot.data.nextCursor || null);
    setHasMore(!!messageSnapshot.data.hasMore);
    setError('');
  }, [conversationId, messageSnapshot.data]);

  const loadPage = useCallback(async (nextCursor = null, append = false, signal) => {
    if (!conversationId) return;
    const ticket = ++latestPage.current;
    setBusy(true);
    try {
      const result = await api({ action: 'alpha_chat_page', conversationId, cursor: nextCursor, limit: 100 }, signal);
      if (ticket !== latestPage.current) return;
      const fetched = result.rows || [];
      setRows(current => append ? [...fetched.filter(row => !current.some(old => old.id === row.id)), ...current] : [...fetched, ...current.filter(row => row.optimistic)]);
      setCursor(result.nextCursor || null); setHasMore(!!result.hasMore); setError('');
    } catch (cause) { if (!signal?.aborted && ticket === latestPage.current) setError(errorText(cause)); }
    finally { if (ticket === latestPage.current) setBusy(false); }
  }, [api, conversationId]);
  useEffect(() => {
    if (!conversationId) { setRows([]); return; }
    const abort = new AbortController();
    void api({ action: 'alpha_chat_mark_read', conversationId }, abort.signal).then(result => { if (result.readAt) setReadAt(result.readAt); }).catch(() => {});
    return () => { abort.abort(); latestPage.current += 1; };
  }, [conversationId, api]);
  usePrivateChatChannel(deps, conversationId, (event, payload) => {
    if (event === 'message') {
      void messageSnapshot.mutate().catch(() => {});
      void conversationSnapshot.mutate().catch(() => {});
    }
    if (event === 'typing' && payload?.username && payload.username !== 'dylan_collyge') setTyping(`${payload.username} is typing…`);
    if (event === 'read' && payload?.readAt) setReadAt(payload.readAt);
  });
  const send = useCallback(async (body, clientId = newId()) => {
    const message = safeText(body).trim();
    if (!message || sendInFlight.current.has(clientId)) return;
    if (!conversationId && !recipientName.trim()) { setError('Choose a conversation or enter a recipient.'); return; }
    sendInFlight.current.add(clientId);
    const optimistic = { clientId, body: message, senderUsername: 'dylan_collyge', senderDisplayName: 'Dylan', createdAt: new Date().toISOString(), optimistic: true };
    setRows(current => current.some(row => row.clientId === clientId) ? current.map(row => row.clientId === clientId ? { ...row, failed: false } : row) : [...current, optimistic]);
    setDraft(''); setError('');
    try {
      const result = await api({ action: 'aura_chat_send', conversationId: conversationId || undefined, recipientName: conversationId ? undefined : recipientName.trim(), message, clientId });
      setRows(current => current.map(row => row.clientId === clientId ? { ...row, id: result.messageId, conversationId: result.conversationId, optimistic: false, failed: false } : row));
      if (!conversationId && result.conversationId) setConversationId(result.conversationId);
      void conversationSnapshot.mutate().catch(() => {});
      if (conversationId) void messageSnapshot.mutate().catch(() => {});
    } catch (cause) {
      setRows(current => current.map(row => row.clientId === clientId ? { ...row, failed: true, optimistic: true } : row));
      setError(errorText(cause));
    } finally { sendInFlight.current.delete(clientId); }
  }, [api, conversationId, recipientName, conversationSnapshot.mutate, messageSnapshot.mutate]);
  const selectConversation = conversation => {
    setConversationId(conversation.id); setRecipientName(conversation.participants?.find(person => person.username !== 'dylan_collyge')?.displayName || '');
    setDraft(''); setRows([]); setCursor(null); setHasMore(false); setTyping(''); setReadAt(''); setError('');
  };
  return <section className="alpha-command-center alpha-stack" aria-label="Communications">
    <div className="alpha-row alpha-row-between"><h2>Communications</h2><div className="alpha-row"><button className={tab === 'chat' ? 'alpha-active' : ''} onClick={() => setTab('chat')}>Chat</button><button className={tab === 'calendar' ? 'alpha-active' : ''} onClick={() => setTab('calendar')}>Calendar</button></div></div>
    {error && <div role="alert" className="alpha-error">{error}</div>}
    {tab === 'calendar' ? <div className="alpha-panel alpha-stack">{calendarSnapshot.error && <div role="alert">{errorText(calendarSnapshot.error)} <button type="button" onClick={() => void calendarSnapshot.mutate()}>Retry</button></div>}{calendarSnapshot.isLoading && <p role="status">Loading calendar…</p>}{calendar.length ? calendar.map(event => <article key={event.id}><strong>{safeText(event.title)}</strong><div className="alpha-muted">{when(event.startAt)} · {safeText(event.status === 'requested' ? 'Pending' : event.status)}</div></article>) : <p className="alpha-muted">No calendar items to show.</p>}</div> : <>
      <div className="alpha-panel alpha-stack"><div className="alpha-row alpha-row-between"><h3>Conversations</h3><button onClick={() => { setConversationId(''); setRows([]); setRecipientName(''); }}>New message</button></div>
        {conversationSnapshot.error && <div role="alert">{errorText(conversationSnapshot.error)} <button type="button" onClick={() => void conversationSnapshot.mutate()}>Retry conversations</button></div>}
        <div className="alpha-list">{conversations.length ? conversations.map(conversation => <button type="button" className={`alpha-conversation ${conversation.id === conversationId ? 'alpha-active' : ''}`} key={conversation.id} onClick={() => selectConversation(conversation)}><strong>{safeText(conversation.title || conversation.participants?.filter(person => person.username !== 'dylan_collyge').map(person => person.displayName).join(', ') || 'Conversation')}</strong><div className="alpha-muted">{safeText(conversation.lastMessagePreview || '')}</div></button>) : <p className="alpha-muted">{conversationSnapshot.isLoading ? 'Loading conversations…' : 'No conversations yet. Start one below.'}</p>}</div></div>
      <div className="alpha-panel alpha-stack"><div className="alpha-row alpha-row-between"><h3>{conversationId ? 'Messages' : 'New message'}</h3>{conversationId && <button type="button" onClick={() => void messageSnapshot.mutate()}>Refresh</button>}</div>
        {conversationId && messageSnapshot.error && <div role="alert">{errorText(messageSnapshot.error)} <button type="button" onClick={() => void messageSnapshot.mutate()}>Retry messages</button></div>}
        {conversationId && messageSnapshot.isLoading && !rows.length && <p role="status">Loading messages…</p>}
        {!conversationId && <label>Recipient name<input value={recipientName} onChange={event => setRecipientName(event.target.value)} placeholder="Exact employee name" autoComplete="off" /></label>}
        {conversationId && <><button type="button" disabled={!hasMore || busy} onClick={() => void loadPage(cursor, true)}>{busy ? 'Loading…' : hasMore ? 'Load older messages' : 'Start of conversation'}</button><MessageFeed rows={rows} onRetry={row => void send(row.body, row.clientId)} />{typing && <div className="alpha-status">{typing}</div>}{readAt && <div className="alpha-status">Read {when(readAt)}</div>}</>}
        {!conversationId && rows.length > 0 && <MessageFeed rows={rows} onRetry={row => void send(row.body, row.clientId)} />}
        <form className="alpha-row" onSubmit={event => { event.preventDefault(); void send(draft); }}><input className="alpha-grow" aria-label="Message" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a message" maxLength={4000}/><button className="alpha-primary" type="submit" disabled={!draft.trim()}>Send</button></form>
      </div>
    </>}
  </section>;
}

function mondayOf(date) {
  const result = new Date(date); result.setHours(12, 0, 0, 0); result.setDate(result.getDate() - ((result.getDay() + 6) % 7)); return result;
}
function localDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
const weekDates = week => Array.from({ length: 7 }, (_, day) => { const date = new Date(week); date.setDate(date.getDate() + day); return localDate(date); });

function EmployeeLaborCard({ employee, jobs, week, entries: rawEntries, onSave }) {
  employee = employee && typeof employee === 'object' ? employee : {};
  const jobRows = records(jobs);
  const entries = useMemo(() => records(rawEntries), [rawEntries]);
  const [localEntries, setLocalEntries] = useState([]);
  const localEntriesRef = useRef([]);
  const [state, setState] = useState('');
  const timers = useRef(new Map());
  const dates = useMemo(() => weekDates(week), [week]);
  useEffect(() => {
    const saved = entries.filter(row => row.employee_id === employee.id && dates.includes(row.work_date));
    const grouped = new Map();
    for (const row of saved) {
      const code = safeText(row.job_code);
      if (!grouped.has(code)) grouped.set(code, { key: code, job_code: code, hours: {}, persisted: true });
      grouped.get(code).hours[row.work_date] = safeText(row.hours);
    }
    for (const draft of localEntriesRef.current.filter(row => row.dirty || row.persisted === false)) grouped.set(draft.key, draft);
    localEntriesRef.current = [...grouped.values()];
    setLocalEntries(localEntriesRef.current);
  }, [employee.id, entries, dates]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); }, []);
  const edit = (key, field, value) => {
    setLocalEntries(current => {
      const updated = current.map(row => row.key === key ? field === 'job_code' ? { ...row, job_code: value, dirty: true } : { ...row, hours: { ...row.hours, [field]: value }, dirty: true } : row);
      localEntriesRef.current = updated;
      return updated;
    });
    if (field === 'job_code') return;
    const timerKey = `${key}:${field}`;
    clearTimeout(timers.current.get(timerKey));
    timers.current.set(timerKey, setTimeout(async () => {
      const row = localEntriesRef.current.find(item => item.key === key);
      if (!row?.job_code || !jobRows.some(job => job.job_code === row.job_code)) { setState('Select a job code before saving.'); return; }
      if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 24) { setState('Enter 0–24 hours.'); return; }
      setState('Saving…');
      try {
        await onSave({ employee_id: employee.id, work_date: field, job_code: row.job_code, hours: Number(value) });
        setLocalEntries(current => {
          const updated = current.map(item => item.key === key && String(item.hours?.[field] ?? '') === String(value)
            ? { ...item, persisted: true, dirty: false } : item);
          localEntriesRef.current = updated;
          return updated;
        });
        setState('Saved');
      }
      catch (error) { setState(errorText(error)); }
    }, 550));
  };
  return <article className="alpha-panel alpha-stack"><div className="alpha-row alpha-row-between"><div><h3>{safeText(employee.name)}</h3><span className="alpha-muted alpha-date">#{safeText(employee.emp_number)} · {safeText(employee.department)}</span></div><button type="button" onClick={() => setLocalEntries(current => {
      const updated = [...current, { key: newId(), job_code: '', hours: {}, persisted: false, dirty: true }];
      localEntriesRef.current = updated;
      return updated;
    })} disabled={!jobRows.length}>Add job code</button></div>
    {!jobRows.length && <p className="alpha-muted">No job codes are configured yet.</p>}
    {localEntries.map(row => <div className="alpha-entry" key={row.key}><label>Job code<select value={row.job_code} onChange={event => edit(row.key, 'job_code', event.target.value)} disabled={row.persisted}><option value="">Select job</option>{jobRows.map(job => <option key={job.job_code} value={job.job_code}>{job.job_code} · {safeText(job.description)}</option>)}</select></label><div className="alpha-week">{dates.map((date, index) => <div className="alpha-day" key={date}><label htmlFor={`${row.key}-${date}`}>{['M','T','W','T','F','S','S'][index]}</label><input id={`${row.key}-${date}`} type="number" min="0" max="24" step="0.25" inputMode="decimal" aria-label={`${date} hours for ${safeText(employee.name)}, ${row.job_code}`} value={row.hours?.[date] ?? ''} onChange={event => edit(row.key, date, event.target.value)}/></div>)}</div></div>)}
    {state && <div className={`alpha-status ${state === 'Saved' || state === 'Saving…' ? '' : 'alpha-error'}`} role="status">{state}</div>}
  </article>;
}

function HrHub({ deps }) {
  const api = useAuthorizedApi(deps);
  const [tab, setTab] = useState('labor');
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [requestOpen, setRequestOpen] = useState(false);
  const [request, setRequest] = useState({ title: '', start: '', end: '' });
  const [error, setError] = useState('');
  const dates = useMemo(() => weekDates(week), [week]);
  const hrRevision = useAuthorizedSourceRevision(deps, 'hr-command', HR_COMMAND_SOURCES);
  const employeeSnapshot = useAlphaSnapshot(deps, 'hr-employees', {}, hrRevision, () => commandCenterDatabase.employees(deps.client));
  const jobSnapshot = useAlphaSnapshot(deps, 'hr-job-codes', {}, hrRevision, () => commandCenterDatabase.jobCodes(deps.client));
  const timesheetSnapshot = useAlphaSnapshot(deps, 'hr-timesheets', { from: dates[0], through: dates[6] }, hrRevision,
    () => commandCenterDatabase.timesheets(deps.client, dates[0], dates[6]));
  const timeoffSnapshot = useAlphaSnapshot(deps, 'hr-timeoff', { limit: 100 }, hrRevision,
    () => api({ action: 'alpha_timeoff_list', limit: 100 }));
  const employees = records(employeeSnapshot.data?.data).filter(employee => employee.id != null);
  const jobs = records(jobSnapshot.data?.data).filter(job => job.job_code != null);
  const entries = records(timesheetSnapshot.data?.data);
  const timeoff = records(timeoffSnapshot.data?.rows);
  const loading = tab === 'labor' && [employeeSnapshot, jobSnapshot, timesheetSnapshot].some(snapshot => snapshot.isLoading);
  const save = async entry => {
    if (!deps.isAuthorized()) throw new Error('Session changed.');
    const result = await commandCenterDatabase.saveTimesheet(deps.client, entry, deps.profileId);
    if (result.error) throw result.error;
    if (!deps.isAuthorized()) throw new Error('Session changed.');
    void timesheetSnapshot.mutate().catch(() => {});
    // The card keeps unsaved edits locally. Changing weeks reloads authoritative rows.
  };
  const changeWeek = direction => setWeek(current => { const next = new Date(current); next.setDate(next.getDate() + 7 * direction); return next; });
  const submitRequest = async event => {
    event.preventDefault(); setError('');
    if (!request.title.trim() || !request.start || !request.end || request.end < request.start) { setError('Enter a title and valid dates.'); return; }
    try {
      const result = await api({ action: 'alpha_timeoff_request', clientId: newId(), title: request.title.trim(), startAt: new Date(`${request.start}T09:00:00`).toISOString(), endAt: new Date(`${request.end}T17:00:00`).toISOString() });
      void timeoffSnapshot.mutate(current => current ? { ...current, rows: [result.event, ...records(current.rows).filter(row => row.id !== result.event?.id)] } : current, { revalidate: false }).catch(() => {});
      void timeoffSnapshot.mutate().catch(() => {}); setRequestOpen(false); setRequest({ title: '', start: '', end: '' });
    } catch (cause) { setError(errorText(cause)); }
  };
  const updateRequest = async (eventId, status) => {
    try {
      const result = await api({ action: 'alpha_timeoff_approve', eventId, status });
      void timeoffSnapshot.mutate(current => current ? { ...current, rows: records(current.rows).map(event => event.id === eventId ? result.event : event) } : current, { revalidate: false }).catch(() => {});
      void timeoffSnapshot.mutate().catch(() => {}); setError('');
    }
    catch (cause) { setError(errorText(cause)); }
  };
  return <section className="alpha-command-center alpha-stack" aria-label="HR and Labor Command Center">
    <div className="alpha-row alpha-row-between"><h2>HR & Labor</h2><div className="alpha-row"><button className={tab === 'labor' ? 'alpha-active' : ''} onClick={() => setTab('labor')}>Weekly labor</button><button className={tab === 'timeoff' ? 'alpha-active' : ''} onClick={() => setTab('timeoff')}>Time off</button></div></div>
    {error && <div role="alert" className="alpha-error">{error}</div>}
    {tab === 'labor' && [employeeSnapshot, jobSnapshot, timesheetSnapshot].some(snapshot => snapshot.error) && <div role="alert">{errorText([employeeSnapshot, jobSnapshot, timesheetSnapshot].find(snapshot => snapshot.error)?.error)} <button type="button" onClick={() => void Promise.all([employeeSnapshot.mutate(), jobSnapshot.mutate(), timesheetSnapshot.mutate()])}>Retry labor</button></div>}
    {tab === 'timeoff' && timeoffSnapshot.error && <div role="alert">{errorText(timeoffSnapshot.error)} <button type="button" onClick={() => void timeoffSnapshot.mutate()}>Retry time off</button></div>}
    {tab === 'labor' ? <><div className="alpha-toolbar alpha-row alpha-row-between"><button onClick={() => changeWeek(-1)} aria-label="Previous week">‹</button><strong className="alpha-date">{dates[0]} – {dates[6]}</strong><button onClick={() => changeWeek(1)} aria-label="Next week">›</button></div>{loading && <p role="status">Loading labor…</p>}{!loading && !employees.length && <div className="alpha-panel alpha-empty-state" role="status"><h3>No employees found in this department.</h3><p>Awaiting roster import.</p></div>}{employees.map(employee => <EmployeeLaborCard key={`${employee.id}:${dates[0]}`} employee={employee} jobs={jobs} entries={entries} week={week} onSave={save}/>)}</> : <><div className="alpha-row alpha-row-between"><span className="alpha-muted">Requested time off appears as Pending.</span><button className="alpha-primary" onClick={() => setRequestOpen(true)}>Request time off</button></div><div className="alpha-stack">{timeoffSnapshot.isLoading && !timeoff.length && <p role="status">Loading time off…</p>}{!timeoff.length && <p className="alpha-panel alpha-muted">No time-off requests yet.</p>}{timeoff.map(event => <article className="alpha-panel alpha-row alpha-row-between" key={event.id}><div><strong>{safeText(event.title)}</strong><div className="alpha-muted alpha-date">{when(event.startAt)} – {when(event.endAt)}</div><div>{event.status === 'requested' ? 'Pending' : safeText(event.status)}</div></div>{event.status === 'requested' && <div className="alpha-row"><button onClick={() => void updateRequest(event.id, 'approved')}>Approve</button><button onClick={() => void updateRequest(event.id, 'denied')}>Deny</button></div>}{event.status === 'approved' && <button onClick={() => void updateRequest(event.id, 'cancelled')}>Cancel</button>}</article>)}</div></>}
    {requestOpen && <div className="alpha-dialog" role="presentation" onClick={event => { if (event.target === event.currentTarget) setRequestOpen(false); }}><form className="alpha-panel alpha-stack" role="dialog" aria-modal="true" aria-label="Request time off" onSubmit={submitRequest}><h3>Request time off</h3><label>Title<input value={request.title} onChange={event => setRequest(current => ({ ...current, title: event.target.value }))} required/></label><label>Start<input type="date" value={request.start} onChange={event => setRequest(current => ({ ...current, start: event.target.value }))} required/></label><label>End<input type="date" value={request.end} onChange={event => setRequest(current => ({ ...current, end: event.target.value }))} required/></label><div className="alpha-row"><button type="button" onClick={() => setRequestOpen(false)}>Cancel</button><button className="alpha-primary" type="submit">Send request</button></div></form></div>}
  </section>;
}

const mounted = new WeakMap();
export function mountCommandCenter(host, mode, deps) {
  if (!host || !deps?.isAuthorized?.() || !['communications','hr'].includes(mode)) return null;
  const previous = mounted.get(host);
  if (previous) return previous;
  host.dataset.preserveDom = 'true';
  const scope = String(deps.cacheScope || `profile:${deps.profileId || ''}`);
  for (const [cachedScope, cache] of snapshotCachesByScope) {
    if (cachedScope !== scope) { cache.clear(); snapshotCachesByScope.delete(cachedScope); }
  }
  let cache = snapshotCachesByScope.get(scope);
  if (!cache) { cache = new Map(); snapshotCachesByScope.set(scope, cache); }
  const root = createRoot(host);
  const scopedDeps = { ...deps, host };
  root.render(h(SWRConfig, { value: { provider: () => cache } },
    h(CommandCenterBoundary, { mode }, mode === 'communications' ? h(Communications, { deps: scopedDeps }) : h(HrHub, { deps: scopedDeps }))));
  const handle = { destroy() {
    root.unmount(); host.removeAttribute('data-preserve-dom'); mounted.delete(host);
    if (!deps.isAuthorized()) {
      const scope = String(deps.cacheScope || `profile:${deps.profileId || ''}`);
      snapshotCachesByScope.get(scope)?.clear(); snapshotCachesByScope.delete(scope);
    }
  } };
  mounted.set(host, handle);
  return handle;
}
