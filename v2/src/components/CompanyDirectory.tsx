import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Plus, Search, Pencil, Trash2, LogOut, Loader2, X } from 'lucide-react';

const PRODUCTION_URL = 'https://kzrnyjsosryejjejliii.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_FpB561OcET7JsjWr2--kOA_9R68Kqxa';
const TABLES = {
  contacts: 'ph_company_directory_contacts',
  blocks: 'ph_company_directory_blocks',
  beds: 'ph_company_directory_beds',
  codes: 'ph_company_directory_codes'
} as const;

type Kind = 'contacts' | 'blocks' | 'codes';
type DirectoryRow = Record<string, unknown> & { id?: string; letter?: string };
type DirectoryUser = { id: string; username: string; display_name: string | null; disabled_at: string | null; locked_until: string | null; must_change_password: boolean };

let client: SupabaseClient | null = null;
function getClient() {
  if (!client) client = createClient(PRODUCTION_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'gnc-company-directory-native-auth' }
  });
  return client;
}

const metadata: Record<Kind, { title: string; table: string; columns: Array<{ key: string; label: string }>; fields: Array<{ key: string; label: string; type?: string; required?: boolean }> }> = {
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
  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [blocks, setBlocks] = useState<DirectoryRow[]>([]);
  const [query, setQuery] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<DirectoryRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [reviewOnly, setReviewOnly] = useState(false);

  const bootstrap = async (active: SupabaseClient) => {
    const { data: auth } = await active.auth.getSession();
    const authUser = auth.session?.user;
    if (!authUser) return;
    const { data, error: profileError } = await active.from('profiles')
      .select('id,username,display_name,disabled_at,locked_until,must_change_password').eq('id', authUser.id).maybeSingle();
    if (profileError) throw profileError;
    if (!data || data.username !== 'dylan_collyge' || data.disabled_at || (data.locked_until && new Date(data.locked_until) > new Date()) || data.must_change_password) {
      await active.auth.signOut({ scope: 'local' });
      throw new Error('This directory is available only to Dylan’s active account.');
    }
    setUser(data as DirectoryUser);
  };

  useEffect(() => {
    const active = getClient();
    let mounted = true;
    void bootstrap(active).catch(reason => { if (mounted) setError(errorText(reason)); });
    const { data } = active.auth.onAuthStateChange((_event, session) => {
      if (!session) { setUser(null); setRows([]); setBlocks([]); return; }
      window.setTimeout(() => { if (mounted) void bootstrap(active).catch(reason => setError(errorText(reason))); }, 0);
    });
    return () => { mounted = false; data.subscription.unsubscribe(); };
  }, []);

  const reload = async () => {
    if (!user) return;
    setLoading(true); setError('');
    const active = getClient();
    try {
      const table = metadata[kind].table;
      const [result, blockResult] = await Promise.all([
        active.from(table).select('*').order(kind === 'blocks' ? 'block_letter' : kind === 'contacts' ? 'name' : 'code').limit(2500),
        kind === 'blocks' ? active.from(TABLES.blocks).select('letter,name').order('letter') : Promise.resolve({ data: [], error: null })
      ]);
      if (result.error) throw result.error;
      if (blockResult.error) throw blockResult.error;
      setRows((result.data || []) as DirectoryRow[]);
      setBlocks((blockResult.data || []) as DirectoryRow[]);
    } catch (reason) { setError(errorText(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, [kind, user]);

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
      const result = editing?.id
        ? await active.from(table).update(values).eq('id', editing.id).select('*').single()
        : await active.from(table).insert(values).select('*').single();
      if (result.error) throw result.error;
      setEditing(null); setFormOpen(false); await reload();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };

  const remove = async (row: DirectoryRow) => {
    if (!window.confirm(`Delete “${showValue(row.name ?? row.bed_identifier ?? row.code)}”? This cannot be undone.`)) return;
    setBusy(true); setError('');
    try {
      const result = await getClient().from(metadata[kind].table).delete().eq('id', row.id).select('id').maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('The row was not deleted. It may already have been removed or access may have changed.');
      await reload();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
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
  return (
    <section className="company-directory">
      <header className="company-directory-head">
        <div><span className="company-directory-kicker">Production reference data · Dylan</span><h2>Company Directory</h2><p>Signed in as {user.display_name || user.username}</p></div>
        <button type="button" className="company-directory-signout" onClick={() => void getClient().auth.signOut({ scope: 'local' })}><LogOut size={16} /> Sign out</button>
      </header>
      <div className="company-directory-toolbar">
        <select aria-label="Directory category" value={kind} onChange={event => { setKind(event.target.value as Kind); setQuery(''); setFilterValue(''); }}>
          <option value="contacts">Employee contacts</option><option value="blocks">Blocks & beds</option><option value="codes">Production codes</option>
        </select>
        <select aria-label={`Filter by ${filterLabel}`} value={filterValue} onChange={event => setFilterValue(event.target.value)}>
          <option value="">All {filterLabel}s</option>{filterOptions.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
        <label className="company-directory-search"><Search size={17} /><input aria-label="Search directory" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search all fields…" /></label>
        <label className="company-directory-review-filter"><input type="checkbox" checked={reviewOnly} onChange={event => setReviewOnly(event.target.checked)} /> Needs review</label>
        <button type="button" className="ghost-button" onClick={() => void reload()} disabled={loading || busy}><Loader2 className={loading ? 'spin' : ''} size={16} /> Refresh</button>
        <button type="button" className="primary-button" onClick={() => openForm(null)}><Plus size={17} /> Add {kind === 'blocks' ? 'bed row' : 'record'}</button>
      </div>
      {kind === 'blocks' && <><div className="company-directory-totals">{blocks.map(block => {
        const values = rows.filter(row => row.block_letter === block.letter);
        const total = values.reduce((sum, row) => sum + Number(row.capacity || 0), 0);
        return <div key={String(block.letter)}><strong>{showValue(block.name)}</strong><span>{values.length} beds · {total.toLocaleString()} total</span>
          <label className="company-directory-block-name">Block label<input aria-label={`Name for block ${block.letter}`} value={String(block.name || '')} onChange={event => setBlocks(current => current.map(item => item.letter === block.letter ? { ...item, name: event.target.value } : item))} onBlur={event => { const value = event.currentTarget.value.trim(); if (!value) { setError('Block label is required.'); return; } void getClient().from(TABLES.blocks).update({ name: value }).eq('letter', block.letter).then(result => { if (result.error) setError(errorText(result.error)); else { setError(''); setBlocks(current => current.map(item => item.letter === block.letter ? { ...item, name: value } : item)); } }); }} /></label>
          <button type="button" className="company-directory-block-delete" onClick={() => { if (window.confirm(`Delete Block ${block.letter} and all ${values.length} bed rows? This cannot be undone.`)) void getClient().from(TABLES.blocks).delete().eq('letter', block.letter).select('letter').maybeSingle().then(result => { if (result.error) setError(errorText(result.error)); else if (!result.data) setError('The block was not deleted. It may already have been removed or access may have changed.'); else { setError(''); setBlocks(current => current.filter(item => item.letter !== block.letter)); setRows(current => current.filter(item => item.block_letter !== block.letter)); } }); }}>Delete block</button>
        </div>;
      })}<button type="button" className="company-directory-add-block" onClick={() => { const letter = 'ABCDEFGHIJKL'.split('').find(value => !blocks.some(block => block.letter === value)); if (!letter) { setError('All blocks A through L already exist.'); return; } void getClient().from(TABLES.blocks).insert({ letter, name: `Block ${letter}` }).select('letter,name').single().then(result => { if (result.error) setError(errorText(result.error)); else { setError(''); setBlocks(current => [...current, result.data].sort((a,b) => String(a.letter).localeCompare(String(b.letter)))); } }); }}>＋ Add block</button></div></>}
      {error && <div className="company-directory-error" role="alert">{error}</div>}
      <div className="company-directory-table-wrap">
        <table><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}<th>Actions</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={columns.length + 1}><Loader2 className="spin" size={18} /> Loading directory…</td></tr>
            : filteredRows.length ? filteredRows.map(row => <tr key={String(row.id || row.letter)} className={row.needs_review === true ? 'needs-review' : ''}>{columns.map(column => <td key={column.key}>{showValue(row[column.key])}{column.key === 'name' && row.needs_review === true && <small className="company-directory-review-badge">Review</small>}</td>)}<td className="company-directory-actions">
              <button type="button" aria-label={`Edit ${showValue(row.name ?? row.bed_identifier ?? row.code)}`} onClick={() => openForm(row)}><Pencil size={15} /></button>
              <button type="button" aria-label={`Delete ${showValue(row.name ?? row.bed_identifier ?? row.code)}`} onClick={() => void remove(row)}><Trash2 size={15} /></button>
            </td></tr>) : <tr><td colSpan={columns.length + 1}>No matching records.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="company-directory-count">{filteredRows.length} record{filteredRows.length === 1 ? '' : 's'}</div>
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
