import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../supabase/functions/_shared/database.types';
import { useRevisionedSnapshot } from '../../../services/useRevisionedSnapshot';
import { TABLES, type Kind, type DirectoryRow, type DirectoryUser, saveDirectoryRecord, readDirectorySnapshot, readDirectoryProfile, removeDirectoryRecord, updateDirectoryBlock, removeDirectoryBlock, addDirectoryBlock, subscribeDirectoryRevision } from '../services/companyDirectory';
import { Plus, Search, Pencil, Trash2, LogOut, Loader2, X } from 'lucide-react';

const PRODUCTION_URL = 'https://kzrnyjsosryejjejliii.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_FpB561OcET7JsjWr2--kOA_9R68Kqxa';
let client: SupabaseClient<Database> | null = null;
function getClient() {
  if (!client) client = createClient<Database>(PRODUCTION_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'gnc-company-directory-native-auth' }
  });
  return client;
}

const metadata: Record<Kind, { title: string; table: typeof TABLES.contacts | typeof TABLES.beds | typeof TABLES.codes; columns: Array<{ key: string; label: string }>; fields: Array<{ key: string; label: string; type?: string; required?: boolean }> }> = {
  contacts: { title: 'Employee contacts', table: TABLES.contacts, columns: [
    { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' }, { key: 'extension', label: 'Extension' },
    { key: 'cell_number', label: 'Cell' }, { key: 'home_number', label: 'Home' }, { key: 'location', label: 'Location' }
  ], fields: [
    { key: 'name', label: 'Name', required: true }, { key: 'department', label: 'Department' }, { key: 'extension', label: 'Extension' },
    { key: 'cell_number', label: 'Cell number' }, { key: 'home_number', label: 'Home number' }, { key: 'location', label: 'Location', required: true }
  ] },
  blocks: { title: 'Block beds', table: TABLES.beds, columns: [
    { key: 'block_letter', label: 'Block' }, { key: 'bed_identifier', label: 'Bed' }, { key: 'capacity', label: 'Capacity' }
  ], fields: [
    { key: 'block_letter', label: 'Block', required: true }, { key: 'bed_identifier', label: 'Bed identifier', required: true },
    { key: 'capacity', label: 'Bed capacity', type: 'number', required: true }
  ] },
  codes: { title: 'Production plant & project codes', table: TABLES.codes, columns: [
    { key: 'code', label: 'Code' }, { key: 'description', label: 'Project / plant description' }, { key: 'department_reference', label: 'Department ID / name' }
  ], fields: [
    { key: 'code', label: 'Code', required: true }, { key: 'description', label: 'Project / plant description', required: true },
    { key: 'department_reference', label: 'Department ID / name' }
  ] }
};

function showValue(value: unknown) { return value == null || value === '' ? '—' : String(value); }
function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) return error.message;
  return 'Directory request failed. Please try again.';
}

export function CompanyDirectory() {
  const [user, setUser] = useState<DirectoryUser | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [kind, setKind] = useState<Kind>('contacts');
  const [revision, setRevision] = useState(0);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const [blockDrafts, setBlockDrafts] = useState<Record<string, string>>({});
  const authGeneration = useRef(0);
  const authSessionId = useRef<string | null>(null);
  const [page, setPage] = useState(0);
  const snapshot = useRevisionedSnapshot(user ? `company-directory:${user.id}:${sessionGeneration}` : null, String(revision),
    () => readDirectorySnapshot(getClient(), user!.id), { revalidateOnFocus: true, dedupingInterval: 1000 });
  const rows = snapshot.data?.rows[kind] || [];
  const blocks = (snapshot.data?.blocks || []).map(block => ({ ...block, name: blockDrafts[block.letter] ?? block.name }));
  const loading = snapshot.isLoading;
  const reload = () => snapshot.mutate().catch(reason => setError(errorText(reason)));
  useEffect(() => { if (snapshot.error) setError(errorText(snapshot.error)); }, [snapshot.error]);
  useEffect(() => { if (!user) return; return subscribeDirectoryRevision(getClient(), user.id, () => setRevision(value => value + 1)); }, [user?.id]);
  useEffect(() => { setPage(0); }, [kind]);
  const [query, setQuery] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<DirectoryRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [reviewOnly, setReviewOnly] = useState(false);

  const bootstrap = async (active: SupabaseClient<Database>) => {
    const expectedGeneration = authGeneration.current;
    const { data: auth } = await active.auth.getSession();
    const authUser = auth.session?.user;
    if (!authUser) return;
    const { data, error: profileError } = await readDirectoryProfile(active, authUser.id);
    if (profileError) throw profileError;
    const { data: verifiedAuth } = await active.auth.getSession();
    if (expectedGeneration !== authGeneration.current || verifiedAuth.session?.user.id !== authUser.id) return;
    if (!data || data.username !== 'dylan_collyge' || data.disabled_at || (data.locked_until && new Date(data.locked_until) > new Date()) || data.must_change_password) {
      setUser(null); setBlockDrafts({}); setEditing(null); setFormOpen(false); setForm({});
      await active.auth.signOut({ scope: 'local' });
      throw new Error('This directory is available only to Dylan’s active account.');
    }
    authSessionId.current = authUser.id;
    setUser(data);
  };

  useEffect(() => {
    const active = getClient();
    let mounted = true;
    void bootstrap(active).catch(reason => { if (mounted) setError(errorText(reason)); });
    const { data } = active.auth.onAuthStateChange((_event, session) => {
      const nextSessionId = session?.user.id || null;
      authGeneration.current += 1;
      if (authSessionId.current !== nextSessionId) {
        authSessionId.current = nextSessionId;
        setUser(null); setBlockDrafts({}); setEditing(null); setFormOpen(false); setForm({}); setPassword('');
        setSessionGeneration(value => value + 1);
      }
      if (!session) return;
      window.setTimeout(() => { if (mounted) void bootstrap(active).catch(reason => setError(errorText(reason))); }, 0);
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return rows;
    return rows.filter(row => Object.values(row).some(value => String(value ?? '').toLocaleLowerCase().includes(needle)));
  }, [query, rows]);
  const filterField = kind === 'contacts' ? 'location' : kind === 'blocks' ? 'block_letter' : 'department_reference';
  const filterLabel = kind === 'contacts' ? 'location' : kind === 'blocks' ? 'block' : 'department';
  const filterOptions = useMemo(() => [...new Set(rows.map(row => String(row[filterField] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [filterField, rows]);
  const filteredRows = useMemo(() => visibleRows.filter(row => (!reviewOnly || row.needs_review === true) && (!filterValue || String(row[filterField] ?? '') === filterValue)), [filterField, filterValue, reviewOnly, visibleRows]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (!PRODUCTION_URL || !PUBLISHABLE_KEY || new URL(PRODUCTION_URL).hostname.split('.')[0] !== 'kzrnyjsosryejjejliii') throw new Error('Production directory authentication is not configured for this build.');
      const normalized = username.trim().toLowerCase().replace(/\s+/g, '_');
      if (normalized !== 'dylan_collyge') throw new Error('This directory is available only to Dylan’s active account.');
      const { error: authError } = await getClient().auth.signInWithPassword({ email: `${normalized}@greenleafnursery.com`, password });
      if (authError) throw authError;
      await bootstrap(getClient()); setPassword('');
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };

  const openForm = (row: DirectoryRow | null) => {
    setEditing(row);
    setFormOpen(true);
    const fields = metadata[kind].fields;
    const next: Record<string, string> = {};
    fields.forEach(field => { next[field.key] = row?.[field.key] == null ? '' : String(row[field.key]); });
    setForm(next); setError('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    const table = metadata[kind].table;
    const values: Record<string, unknown> = {};
    for (const field of metadata[kind].fields) {
      const value = (form[field.key] || '').trim();
      if (field.required && !value) { setError(`${field.label} is required.`); setBusy(false); return; }
      values[field.key] = field.type === 'number' ? Number(value) : value || null;
    }
    if (kind === 'blocks') {
      const letter = String(values.block_letter).toUpperCase();
      if (!/^[A-L]$/.test(letter)) { setError('Block must be a letter from A through L.'); setBusy(false); return; }
      values.block_letter = letter;
      values.bed_identifier = String(values.bed_identifier).toUpperCase();
      if (!Number.isFinite(Number(values.capacity)) || Number(values.capacity) <= 0) { setError('Bed capacity must be a positive number.'); setBusy(false); return; }
    }
    try {
      const active = getClient();
      const result = await saveDirectoryRecord(active, kind, values, editing?.id);
      if (result.error) throw result.error;
      setEditing(null); setFormOpen(false); await reload();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };

  const remove = async (row: DirectoryRow) => {
    if (!window.confirm(`Delete “${showValue(row.name ?? row.bed_identifier ?? row.code)}”? This cannot be undone.`)) return;
    setBusy(true); setError('');
    try {
      const result = await removeDirectoryRecord(getClient(), kind, row.id);
      if (result.error) throw result.error;
      if (!result.data) throw new Error('The row was not deleted. It may already have been removed or access may have changed.');
      await reload();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };

  const saveBlockName = async (letter: string, value: string) => {
    try {
      const result = await updateDirectoryBlock(getClient(), letter, value);
      if (result.error) { setError(errorText(result.error)); return; }
      setError('');
      const current = snapshot.data;
      if (current) await snapshot.mutate({ ...current, blocks: current.blocks.map(item => item.letter === letter ? { ...item, name: value } : item) }, { revalidate: false });
      setBlockDrafts(drafts => {
        if (drafts[letter] !== value) return drafts;
        const next = { ...drafts }; delete next[letter]; return next;
      });
      void reload();
    } catch (reason) { setError(errorText(reason)); }
  };

  if (!user) return (
    <section className="company-directory-auth">
      <div><span className="company-directory-kicker">Restricted manager module</span><h2>Company Directory</h2><p>Sign in with Dylan’s company account to access production reference data.</p></div>
      <form onSubmit={signIn}>
        <label>Username<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        {error && <p className="company-directory-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in to directory'}</button>
      </form>
    </section>
  );

  const columns = metadata[kind].columns;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filteredRows.length / 50) - 1));
  const visiblePage = filteredRows.slice(currentPage * 50, currentPage * 50 + 50);
  return (
    <section className="company-directory">
      <header className="company-directory-head">
        <div><span className="company-directory-kicker">Production reference data · Dylan</span><h2>Company Directory</h2><p>Signed in as {user.display_name || user.username}</p></div>
        <button type="button" className="company-directory-signout" onClick={() => void getClient().auth.signOut({ scope: 'local' })}><LogOut size={16} /> Sign out</button>
      </header>
      <div className="company-directory-toolbar">
        <select aria-label="Directory category" value={kind} onChange={event => { setKind(event.target.value as Kind); setQuery(''); setFilterValue(''); setPage(0); }}>
          <option value="contacts">Employee contacts</option><option value="blocks">Blocks & beds</option><option value="codes">Production codes</option>
        </select>
        <select aria-label={`Filter by ${filterLabel}`} value={filterValue} onChange={event => { setFilterValue(event.target.value); setPage(0); }}>
          <option value="">All {filterLabel}s</option>{filterOptions.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
        <label className="company-directory-search"><Search size={17} /><input aria-label="Search directory" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Search all fields…" /></label>
        <label className="company-directory-review-filter"><input type="checkbox" checked={reviewOnly} onChange={event => { setReviewOnly(event.target.checked); setPage(0); }} /> Needs review</label>
        <button type="button" className="ghost-button" onClick={() => void reload()} disabled={loading || busy}><Loader2 className={loading ? 'spin' : ''} size={16} /> Refresh</button>
        <button type="button" className="primary-button" onClick={() => openForm(null)}><Plus size={17} /> Add {kind === 'blocks' ? 'bed row' : 'record'}</button>
      </div>
      {kind === 'blocks' && <><div className="company-directory-totals">{blocks.map(block => {
        const values = rows.filter(row => row.block_letter === block.letter);
        const total = values.reduce((sum, row) => sum + Number(row.capacity || 0), 0);
        return <div key={String(block.letter)}><strong>{showValue(block.name)}</strong><span>{values.length} beds · {total.toLocaleString()} total</span>
          <label className="company-directory-block-name">Block label<input aria-label={`Name for block ${block.letter}`} value={String(block.name || '')} onChange={event => setBlockDrafts(current => ({ ...current, [block.letter]: event.target.value }))} onBlur={event => { const value = event.currentTarget.value.trim(); if (!value) { setError('Block label is required.'); return; } void saveBlockName(block.letter, value); }} /></label>
          <button type="button" className="company-directory-block-delete" onClick={() => { if (window.confirm(`Delete Block ${block.letter} and all ${values.length} bed rows? This cannot be undone.`)) void removeDirectoryBlock(getClient(), block.letter).then(result => { if (result.error) setError(errorText(result.error)); else if (!result.data) setError('The block was not deleted. It may already have been removed or access may have changed.'); else { setError(''); void reload(); } }); }}>Delete block</button>
        </div>;
      })}<button type="button" className="company-directory-add-block" onClick={() => { const letter = 'ABCDEFGHIJKL'.split('').find(value => !blocks.some(block => block.letter === value)); if (!letter) { setError('All blocks A through L already exist.'); return; } void addDirectoryBlock(getClient(), letter).then(result => { if (result.error) setError(errorText(result.error)); else { setError(''); void reload(); } }); }}>＋ Add block</button></div></>}
      {error && <div className="company-directory-error" role="alert">{error}</div>}
      <div className="company-directory-table-wrap">
        <table><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}<th>Actions</th></tr></thead>
          <tbody>{loading && !snapshot.data ? <tr><td colSpan={columns.length + 1}><Loader2 className="spin" size={18} /> Loading directory…</td></tr>
            : filteredRows.length ? visiblePage.map(row => <tr key={String(row.id || row.letter)} className={row.needs_review === true ? 'needs-review' : ''}>{columns.map(column => <td key={column.key}>{showValue(row[column.key])}{column.key === 'name' && row.needs_review === true && <small className="company-directory-review-badge">Review</small>}</td>)}<td className="company-directory-actions">
              <button type="button" aria-label={`Edit ${showValue(row.name ?? row.bed_identifier ?? row.code)}`} onClick={() => openForm(row)}><Pencil size={15} /></button>
              <button type="button" aria-label={`Delete ${showValue(row.name ?? row.bed_identifier ?? row.code)}`} onClick={() => void remove(row)}><Trash2 size={15} /></button>
            </td></tr>) : <tr><td colSpan={columns.length + 1}>No matching records.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="company-directory-count">{filteredRows.length} record{filteredRows.length === 1 ? '' : 's'} <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button> Page {currentPage + 1} of {Math.max(1, Math.ceil(filteredRows.length / 50))} <button disabled={(currentPage + 1) * 50 >= filteredRows.length} onClick={() => setPage(currentPage + 1)}>Next</button></div>
      {formOpen && <div className="company-directory-modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setFormOpen(false); }}>
        <form className="company-directory-modal" onSubmit={save} aria-label={editing?.id ? `Edit ${metadata[kind].title}` : `Add ${metadata[kind].title}`}>
          <header><div><span className="company-directory-kicker">{editing?.id ? 'Edit record' : 'New record'}</span><h3>{metadata[kind].title}</h3></div><button type="button" aria-label="Close" onClick={() => setFormOpen(false)}><X size={20} /></button></header>
          <div className="company-directory-fields">{metadata[kind].fields.map(field => <label key={field.key}>{field.label}
            {kind === 'blocks' && field.key === 'block_letter' ? <select required value={form[field.key] || ''} onChange={event => setForm(current => ({ ...current, [field.key]: event.target.value }))}><option value="">Choose block</option>{'ABCDEFGHIJKL'.split('').map(letter => <option key={letter} value={letter}>Block {letter}</option>)}</select>
              : <input required={field.required} type={field.type || 'text'} min={field.type === 'number' ? '0.01' : undefined} step={field.type === 'number' ? '0.01' : undefined} value={form[field.key] || ''} onChange={event => setForm(current => ({ ...current, [field.key]: event.target.value }))} />}
          </label>)}</div>
          {error && <p className="company-directory-error" role="alert">{error}</p>}
          <footer><button type="button" className="ghost-button" onClick={() => setFormOpen(false)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save record'}</button></footer>
        </form>
      </div>}
    </section>
  );
}
