import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ClipboardList,
  Cloud,
  Home,
  Loader2,
  Menu,
  MessageCircle,
  RefreshCw,
  Search,
  ShoppingBag,
  Trash2,
  Truck,
  UploadCloud,
  XCircle
} from 'lucide-react';
import {
  APP_VERSION,
  REQUEST_TABLE,
  RequestRow,
  Session,
  demoRows,
  fetchRequestRows,
  field,
  isArchived,
  isCompleted,
  login,
  numberField,
  patchRow,
  readStoredSession,
  requestTab,
  storeSession,
  uniqueId,
  uploadRequestPhoto
} from './services';

type ViewId = 'home' | 'request' | 'drive' | 'tasks' | 'docks' | 'comm' | 'bloom' | 'inventory' | 'managers';
type TabId = 'request' | 'sales' | 'location' | 'recount' | 'av' | 'shear';
type UploadState = 'queued' | 'uploading' | 'retrying' | 'uploaded' | 'failed';

const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'request', label: 'Request' },
  { id: 'sales', label: 'Sales Reps' },
  { id: 'location', label: 'Location Move' },
  { id: 'recount', label: 'Recount' },
  { id: 'av', label: 'AV Check' },
  { id: 'shear', label: 'Shear List' }
];

const navItems: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'drive', label: 'Drive', icon: Truck },
  { id: 'tasks', label: 'Tasks', icon: ClipboardList },
  { id: 'docks', label: 'Docks', icon: Truck },
  { id: 'request', label: 'Que', icon: ClipboardList },
  { id: 'comm', label: 'Comm', icon: MessageCircle },
  { id: 'bloom', label: 'Bloom', icon: ShoppingBag }
];

function useChunkedRows<T>(rows: T[], batch = 30) {
  const [count, setCount] = useState(batch);
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    setCount(Math.min(batch, rows.length));
    const pump = () => {
      if (cancelled) return;
      setCount(current => {
        const next = Math.min(current + batch, rows.length);
        if (next < rows.length) frame = window.requestAnimationFrame(pump);
        return next;
      });
    };
    if (rows.length > batch) frame = window.requestAnimationFrame(pump);
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [rows, batch]);
  return rows.slice(0, count);
}

export function App() {
  const [session, setSession] = useState<Session | null>(() => readStoredSession());
  const [demoMode, setDemoMode] = useState(false);
  const [view, setView] = useState<ViewId>('home');
  const [activeTab, setActiveTab] = useState<TabId>('request');
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [detailRow, setDetailRow] = useState<RequestRow | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [undoRemove, setUndoRemove] = useState<RequestRow | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const syncShell = () => {
      const top = topRef.current?.getBoundingClientRect().height || 0;
      const bottom = navRef.current?.getBoundingClientRect().height || 0;
      document.documentElement.style.setProperty('--top-chrome-height', `${Math.ceil(top)}px`);
      document.documentElement.style.setProperty('--bottom-nav-height', `${Math.ceil(bottom)}px`);
    };
    syncShell();
    const observer = new ResizeObserver(syncShell);
    if (topRef.current) observer.observe(topRef.current);
    if (navRef.current) observer.observe(navRef.current);
    window.visualViewport?.addEventListener('resize', syncShell);
    window.addEventListener('orientationchange', syncShell);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener('resize', syncShell);
      window.removeEventListener('orientationchange', syncShell);
    };
  }, []);

  const reloadRows = async () => {
    if (demoMode) {
      setRows(demoRows());
      return;
    }
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      setRows(await fetchRequestRows(session));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load request rows');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reloadRows();
  }, [session, demoMode]);

  const openView = (next: ViewId) => {
    setView(next);
    setDetailRow(null);
    setSearch('');
    scrollerRef.current?.scrollTo({ top: 0 });
  };

  const title = detailRow ? 'Item Detail' : view === 'request' ? 'Que' : view === 'home' ? 'Home' : labelForView(view);
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(row => !isArchived(row) && !isCompleted(row))
      .filter(row => requestTab(row) === activeTab)
      .filter(row => {
        if (!q) return true;
        return [
          field(row, ['COMMONNAME', 'commonname']),
          field(row, ['LOCATIONCODE', 'locationcode']),
          field(row, ['LOTCODE', 'lotcode']),
          field(row, ['REQUESTED_BY', 'requested_by', 'SALES_REP', 'sales_rep']),
          field(row, ['CUSTOMER', 'customer', 'CONSIGNEE', 'consignee'])
        ].join(' ').toLowerCase().includes(q);
      });
  }, [rows, activeTab, search]);

  if (!session && !demoMode) {
    return <LoginScreen onLogin={next => { storeSession(next); setSession(next); }} onDemo={() => setDemoMode(true)} />;
  }

  return (
    <div className="app-shell">
      <div className="top-chrome" ref={topRef}>
        <div className="brand-strip">
          <div>
            <div className="brand-user">{session?.displayName || session?.username || 'demo_user'}</div>
            <div className="brand-subtitle">AG DATA SOLUTIONS</div>
          </div>
          <div className="status-cluster">
            <span className="version-pill">{APP_VERSION}</span>
            <span className="mode-pill">FIELD</span>
            <span className="auto-pill">AUTO</span>
            <span className="auto-count">AUTO {Math.min(rows.length, 7)}/7</span>
          </div>
        </div>
        <div className="search-row">
          <button className="back-button" type="button" aria-label="Back" onClick={() => detailRow ? setDetailRow(null) : openView('home')}>
            <ArrowLeft size={28} />
          </button>
          <div className="search-box">
            {view === 'request' && !detailRow ? <Search size={20} /> : null}
            <input
              value={detailRow ? title : search || ''}
              onChange={event => !detailRow && setSearch(event.target.value)}
              readOnly={Boolean(detailRow) || view !== 'request'}
              placeholder={view === 'request' ? 'Search requests...' : title}
            />
          </div>
        </div>
      </div>

      <main className="main-scroll" ref={scrollerRef}>
        {error ? <div className="banner error">{error}</div> : null}
        {toast ? (
          <Toast
            message={toast}
            action={undoRemove ? {
              label: 'Undo',
              onClick: () => {
                const row = undoRemove;
                setRows(current => current.map(item => uniqueId(item) === uniqueId(row) ? { ...item, REQ_ARCHIVED: false, REQ_ARCHIVED_AT: null } : item));
                if (!demoMode && session) {
                  void patchRow(session, REQUEST_TABLE, uniqueId(row), { REQ_ARCHIVED: false, REQ_ARCHIVED_AT: null });
                }
                setUndoRemove(null);
                setToast('Row restored.');
              }
            } : undefined}
            onClose={() => { setToast(''); setUndoRemove(null); }}
          />
        ) : null}
        {detailRow ? (
          <RequestDetail
            row={detailRow}
            session={session}
            demoMode={demoMode}
            onBack={() => { setDetailRow(null); scrollerRef.current?.scrollTo({ top: 0 }); }}
            onPatch={patch => {
              setRows(current => current.map(row => uniqueId(row) === uniqueId(detailRow) ? { ...row, ...patch } : row));
              setDetailRow(current => current ? { ...current, ...patch } : current);
            }}
            onToast={setToast}
            onRefresh={reloadRows}
          />
        ) : view === 'home' ? (
          <HomeView onOpen={openView} />
        ) : view === 'request' ? (
          <RequestView
            rows={filteredRows}
            allRows={rows}
            activeTab={activeTab}
            loading={loading}
            onTab={tab => { setActiveTab(tab); scrollerRef.current?.scrollTo({ top: 0 }); }}
            onOpen={row => { setDetailRow(row); scrollerRef.current?.scrollTo({ top: 0 }); }}
            onRemove={(row) => removeRow(row, session, demoMode, setRows, setToast, setUndoRemove)}
            onRefresh={reloadRows}
          />
        ) : (
          <ModulePlaceholder view={view} />
        )}
      </main>

      <div className="bottom-nav-wrap" ref={navRef}>
        <nav className="bottom-nav" aria-label="Primary">
          <button type="button" onClick={() => openView('inventory')} className="nav-item">
            <Menu size={28} /><span>Menu</span>
          </button>
          {navItems.slice(0, 1).map(item => <NavButton key={item.id} item={item} active={view === item.id} onOpen={openView} />)}
          {navItems.slice(1).map(item => <NavButton key={item.id} item={item} active={view === item.id} onOpen={openView} />)}
        </nav>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin, onDemo }: { onLogin: (session: Session) => void; onDemo: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await login(username.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">Ag Data Solutions</div>
        <h1>GNC Field App v2</h1>
        <input value={username} onChange={event => setUsername(event.target.value)} placeholder="Username" autoCapitalize="none" />
        <input value={password} onChange={event => setPassword(event.target.value)} placeholder="Password" type="password" />
        {error ? <div className="banner error">{error}</div> : null}
        <button className="primary-button" disabled={busy || !username || !password}>{busy ? 'Signing in...' : 'Sign In'}</button>
        <button className="ghost-button" type="button" onClick={onDemo}>Open demo data</button>
      </form>
    </div>
  );
}

function HomeView({ onOpen }: { onOpen: (view: ViewId) => void }) {
  const modules: Array<{ view: ViewId; label: string; icon: typeof Home }> = [
    { view: 'request', label: 'Que Request', icon: ClipboardList },
    { view: 'drive', label: 'Drive Mode', icon: Truck },
    { view: 'tasks', label: 'Tasks', icon: ClipboardList },
    { view: 'docks', label: 'Docks', icon: Truck },
    { view: 'inventory', label: 'Inventory', icon: ShoppingBag },
    { view: 'managers', label: 'Managers', icon: Cloud },
    { view: 'comm', label: 'Communication', icon: MessageCircle },
    { view: 'bloom', label: 'Bloom', icon: ShoppingBag }
  ];
  return (
    <section className="home-grid">
      <div className="hero-panel">
        <div className="hero-mark">Ag Data Solutions</div>
        <span>v2 beta</span>
      </div>
      {modules.map(module => {
        const Icon = module.icon;
        return (
          <button className="module-tile" key={module.view} onClick={() => onOpen(module.view)}>
            <Icon size={34} />
            <span>{module.label}</span>
          </button>
        );
      })}
    </section>
  );
}

function RequestView(props: {
  rows: RequestRow[];
  allRows: RequestRow[];
  activeTab: TabId;
  loading: boolean;
  onTab: (tab: TabId) => void;
  onOpen: (row: RequestRow) => void;
  onRemove: (row: RequestRow) => void;
  onRefresh: () => void;
}) {
  const visibleRows = useChunkedRows(props.rows, 24);
  const counts = useMemo(() => {
    const map = new Map<TabId, number>();
    tabs.forEach(tab => map.set(tab.id, 0));
    props.allRows.filter(row => !isArchived(row) && !isCompleted(row)).forEach(row => {
      const tab = requestTab(row) as TabId;
      map.set(tab, (map.get(tab) || 0) + 1);
    });
    return map;
  }, [props.allRows]);
  return (
    <section className="request-flow">
      <div className="request-tabs" role="tablist">
        {tabs.map(tab => (
          <button className={`filter-tab ${props.activeTab === tab.id ? 'active' : ''}`} key={tab.id} onClick={() => props.onTab(tab.id)}>
            {tab.label}<span>{counts.get(tab.id) || 0}</span>
          </button>
        ))}
      </div>
      <div className="request-actions">
        <span>{tabLabel(props.activeTab)} Que</span>
        <button type="button" onClick={props.onRefresh}><RefreshCw size={18} /> Refresh</button>
      </div>
      {props.loading && !props.rows.length ? <div className="empty-state"><Loader2 className="spin" /> Loading rows...</div> : null}
      {!props.loading && !props.rows.length ? <div className="empty-state">No rows match this view.</div> : null}
      <div className="request-list">
        {visibleRows.map(row => (
          <RequestCard key={String(uniqueId(row))} row={row} onOpen={() => props.onOpen(row)} onRemove={() => props.onRemove(row)} />
        ))}
      </div>
    </section>
  );
}

function RequestCard({ row, onOpen, onRemove }: { row: RequestRow; onOpen: () => void; onRemove: () => void }) {
  return (
    <article className="request-card" onClick={onOpen}>
      <div className="card-main">
        <div>
          <h2>{field(row, ['COMMONNAME', 'commonname'], 'Unnamed item')}</h2>
          <a>{field(row, ['LOCATIONCODE', 'locationcode'], '-')}</a>
          <p>{field(row, ['REQUESTED_BY', 'requested_by', 'SALES_REP', 'sales_rep'], 'No rep')}</p>
          <p>{field(row, ['CUSTOMER', 'customer', 'CONSIGNEE', 'consignee'], 'No customer')}</p>
        </div>
        <div className="card-side">
          <span className="color-chip">{field(row, ['COLOR', 'color', 'DESIGCUST', 'desigcust'], '')}</span>
          <strong>{field(row, ['CONTSIZE', 'contsize'], '')}</strong>
          <span>{field(row, ['SRC', 'src'], '')}</span>
          <div className="photo-box">No Photo</div>
        </div>
      </div>
      <div className="chip-grid">
        <Chip tone="warning" label="Pending" />
        <Chip label={`Reserve: ${field(row, ['RESERVE', 'reserve'], 'NO')}`} />
        <Chip tone="purple" label={`Qty: ${field(row, ['QTY', 'qty', 'REQ_QTY', 'req_qty'], '0')}`} />
        <Chip tone="blue" label={`Loc: ${field(row, ['LOCATIONCODE', 'locationcode'], '-')}`} />
        <Chip label={`Lot: ${field(row, ['LOTCODE', 'lotcode'], '-')}`} />
        <Chip tone="orange" label={`Pri: ${field(row, ['PRI', 'priority'], '-')}`} />
        <Chip tone="green" label={`On hand - ${numberField(row, ['ON_HAND', 'on_hand', 'HAND'])}`} />
        <Chip tone="blue" label={`Review - ${numberField(row, ['REVIEW', 'review', 'REV'])}`} />
        <Chip tone="blue" label={`Available - ${numberField(row, ['AVAILABLE', 'available', 'AVAIL'])}`} />
        <Chip tone="purple" label={`Open stock - ${numberField(row, ['OPEN_STOCK', 'open_stock', 'OPEN'])}`} />
      </div>
      <button className="remove-row-button" type="button" onClick={event => { event.stopPropagation(); onRemove(); }}>
        <Trash2 size={18} /> Remove
      </button>
    </article>
  );
}

function RequestDetail(props: {
  row: RequestRow;
  session: Session | null;
  demoMode: boolean;
  onBack: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onToast: (message: string) => void;
  onRefresh: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    qty: field(props.row, ['QTY', 'qty', 'REQ_QTY', 'req_qty'], '0'),
    reserve: field(props.row, ['RESERVE', 'reserve'], 'NO'),
    rowNote: field(props.row, ['ROW_NOTE', 'row_note', 'REQ_NOTE', 'req_note']),
    spec: field(props.row, ['REQ_SPEC', 'req_spec', 'SPEC', 'spec']),
    caliper: field(props.row, ['REQ_CALIPER', 'req_caliper', 'CALIPER', 'caliper']),
    locMatch: field(props.row, ['LOC_MATCH', 'loc_match', 'REQ_MATCH', 'req_match']),
    avNote: field(props.row, ['AV_NOTE', 'av_note']),
    pickNote: field(props.row, ['PICK_NOTE', 'pick_note', 'REQ_PICK_NOTE', 'req_pick_note'])
  }));
  const [busy, setBusy] = useState(false);
  const [uploads, setUploads] = useState<Array<{ id: string; file: File; preview: string; state: UploadState; error?: string; url?: string }>>([]);
  const pendingUpload = uploads.some(upload => upload.state === 'queued' || upload.state === 'uploading' || upload.state === 'retrying');
  const failedUpload = uploads.some(upload => upload.state === 'failed');
  const rowId = uniqueId(props.row);

  const update = (key: keyof typeof draft, value: string) => setDraft(current => ({ ...current, [key]: value }));

  const save = async (complete = false) => {
    if (pendingUpload || failedUpload) {
      props.onToast(failedUpload ? 'Retry or remove failed photos before marking done.' : 'Photo upload still in progress.');
      return;
    }
    const patch = {
      REQ_QTY: draft.qty,
      RESERVE: draft.reserve,
      ROW_NOTE: draft.rowNote,
      REQ_SPEC: draft.spec,
      REQ_CALIPER: draft.caliper,
      LOC_MATCH: draft.locMatch,
      AV_NOTE: draft.avNote,
      PICK_NOTE: draft.pickNote,
      ...(complete ? { REQ_STATUS: 'Complete', DATE_COMPLETED: new Date().toISOString() } : {})
    };
    setBusy(true);
    try {
      if (!props.demoMode && props.session) await patchRow(props.session, REQUEST_TABLE, rowId, patch);
      props.onPatch(patch);
      props.onToast(complete ? 'Request row completed.' : 'Request row saved.');
      if (complete) props.onBack();
    } catch (err) {
      props.onToast(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    Array.from(files).forEach(file => {
      const id = `${file.name}-${Date.now()}`;
      const next = { id, file, preview: URL.createObjectURL(file), state: 'queued' as UploadState };
      setUploads(current => [next, ...current]);
      void runUpload(next);
    });
  };

  const runUpload = async (upload: { id: string; file: File; preview: string }) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      setUploads(current => current.map(item => item.id === upload.id ? { ...item, state: attempt === 1 ? 'uploading' : 'retrying', error: undefined } : item));
      try {
        if (props.demoMode || !props.session) {
          await delay(600);
          setUploads(current => current.map(item => item.id === upload.id ? { ...item, state: 'uploaded', url: upload.preview } : item));
          return;
        }
        const result = await uploadRequestPhoto(props.session, upload.file, rowId);
        await patchRow(props.session, REQUEST_TABLE, rowId, { REQ_PHOTO_LINK: result.publicUrl, REQ_PHOTO_NAME: upload.file.name });
        props.onPatch({ REQ_PHOTO_LINK: result.publicUrl, REQ_PHOTO_NAME: upload.file.name });
        setUploads(current => current.map(item => item.id === upload.id ? { ...item, state: 'uploaded', url: result.publicUrl } : item));
        return;
      } catch (err) {
        if (attempt === 3) {
          setUploads(current => current.map(item => item.id === upload.id ? { ...item, state: 'failed', error: err instanceof Error ? err.message : 'Upload failed' } : item));
        } else {
          await delay(700 * attempt);
        }
      }
    }
  };

  return (
    <section className="detail-flow">
      <button className="inline-back" type="button" onClick={props.onBack}><ArrowLeft size={22} /> Back to Request</button>
      <div className="detail-card">
        <div className="detail-head">
          <div>
            <h1>{field(props.row, ['COMMONNAME', 'commonname'], 'Unnamed item')}</h1>
            <a>{field(props.row, ['LOCATIONCODE', 'locationcode'], '-')}</a>
          </div>
          <div className="photo-box large">No Photo</div>
        </div>
        <div className="field-grid">
          <ReadOnlyField label="PRI" value={field(props.row, ['PRI', 'priority'], '-')} />
          <ReadOnlyField label="On Hand" value={String(numberField(props.row, ['ON_HAND', 'on_hand', 'HAND']))} />
          <ReadOnlyField label="Review" value={String(numberField(props.row, ['REVIEW', 'review', 'REV']))} />
          <ReadOnlyField label="Available" value={String(numberField(props.row, ['AVAILABLE', 'available', 'AVAIL']))} />
          <ReadOnlyField label="Open Stock" value={String(numberField(props.row, ['OPEN_STOCK', 'open_stock', 'OPEN']))} />
          <label><span>Qty</span><input value={draft.qty} inputMode="numeric" onChange={event => update('qty', event.target.value)} /></label>
          <label><span>Reserve</span><select value={draft.reserve} onChange={event => update('reserve', event.target.value)}><option>NO</option><option>YES</option></select></label>
          <ReadOnlyField label="Sales Rep" value={field(props.row, ['REQUESTED_BY', 'requested_by', 'SALES_REP', 'sales_rep'], '-')} />
          <ReadOnlyField label="Customer / Consignee" value={field(props.row, ['CUSTOMER', 'customer', 'CONSIGNEE', 'consignee'], 'N/A')} />
          <label className="wide"><span>Row Note</span><textarea value={draft.rowNote} onChange={event => update('rowNote', event.target.value)} /></label>
          <label><span>Required Spec</span><input value={draft.spec} placeholder="e.g. 24-30 inch" onChange={event => update('spec', event.target.value)} /></label>
          <label><span>Required Caliper</span><input value={draft.caliper} placeholder="N/A" onChange={event => update('caliper', event.target.value)} /></label>
        </div>
        <label className="photo-button">
          <Camera size={24} />
          Take Request Photo
          <input type="file" accept="image/*" capture="environment" multiple onChange={event => onFiles(event.target.files)} />
        </label>
        <UploadStrip uploads={uploads} onRetry={upload => void runUpload(upload)} onRemove={id => setUploads(current => current.filter(item => item.id !== id))} />
        <div className="av-options">
          <strong>AV Options</strong>
          <span>{field(props.row, ['ITEMCODE', 'itemcode'], '-') } | {field(props.row, ['ROWS', 'rows'], '1 row')}</span>
        </div>
        <div className="field-grid">
          <label><span>Loc Match %</span><input value={draft.locMatch} inputMode="decimal" placeholder="e.g. 95" onChange={event => update('locMatch', event.target.value)} /></label>
          <label className="wide"><span>AV Note</span><textarea value={draft.avNote} onChange={event => update('avNote', event.target.value)} /></label>
          <label className="wide"><span>Pick Note</span><textarea value={draft.pickNote} onChange={event => update('pickNote', event.target.value)} /></label>
        </div>
        <div className="detail-actions">
          <button className="ghost-button" disabled={busy} onClick={() => void save(false)}>Save</button>
          <button className="primary-button" disabled={busy || pendingUpload || failedUpload} onClick={() => void save(true)}>
            <CheckCircle2 size={20} /> Complete Row
          </button>
        </div>
      </div>
    </section>
  );
}

function UploadStrip({ uploads, onRetry, onRemove }: {
  uploads: Array<{ id: string; file: File; preview: string; state: UploadState; error?: string; url?: string }>;
  onRetry: (upload: { id: string; file: File; preview: string }) => void;
  onRemove: (id: string) => void;
}) {
  if (!uploads.length) return null;
  return (
    <div className="upload-strip">
      <h3>Request Photos</h3>
      {uploads.map(upload => (
        <div className="upload-row" key={upload.id}>
          <img src={upload.preview} alt="" />
          <div>
            <strong>{upload.file.name}</strong>
            <span className={`upload-state ${upload.state}`}>{upload.state}</span>
            {upload.error ? <small>{upload.error}</small> : null}
          </div>
          {upload.state === 'failed' ? <button type="button" onClick={() => onRetry(upload)}>Retry</button> : null}
          <button type="button" onClick={() => onRemove(upload.id)}><XCircle size={20} /></button>
        </div>
      ))}
    </div>
  );
}

function removeRow(
  row: RequestRow,
  session: Session | null,
  demoMode: boolean,
  setRows: (updater: (rows: RequestRow[]) => RequestRow[]) => void,
  setToast: (message: string) => void,
  setUndoRemove: (row: RequestRow) => void
) {
  const id = uniqueId(row);
  setRows(current => current.map(item => uniqueId(item) === id ? { ...item, REQ_ARCHIVED: true } : item));
  setUndoRemove(row);
  setToast('Row removed.');
  if (!demoMode && session) {
    patchRow(session, REQUEST_TABLE, id, { REQ_ARCHIVED: true, REQ_ARCHIVED_AT: new Date().toISOString() }).catch(err => setToast(err instanceof Error ? err.message : 'Remove failed'));
  }
}

function NavButton({ item, active, onOpen }: { item: { id: ViewId; label: string; icon: typeof Home }; active: boolean; onOpen: (view: ViewId) => void }) {
  const Icon = item.icon;
  return <button type="button" onClick={() => onOpen(item.id)} className={`nav-item ${active ? 'active' : ''}`}><Icon size={28} /><span>{item.label}</span></button>;
}

function ModulePlaceholder({ view }: { view: ViewId }) {
  return (
    <section className="placeholder">
      <h1>{labelForView(view)}</h1>
      <p>This `/v2` beta is focused on the iPhone Safari Que Request flow first. Continue using the live root app for this module until it is rebuilt.</p>
    </section>
  );
}

function Chip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'green' | 'blue' | 'purple' | 'orange' | 'warning' }) {
  return <span className={`chip ${tone}`}>{label}</span>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <div className="readonly-field"><span>{label}</span><strong>{value}</strong></div>;
}

function Toast({ message, action, onClose }: { message: string; action?: { label: string; onClick: () => void }; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 4500);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  return <div className="toast"><span>{message}</span>{action ? <button type="button" onClick={action.onClick}>{action.label}</button> : null}</div>;
}

function labelForView(view: ViewId) {
  return ({ home: 'Home', request: 'Que', drive: 'Drive', tasks: 'Tasks', docks: 'Docks', comm: 'Communication', bloom: 'Bloom', inventory: 'Inventory', managers: 'Managers' } as Record<ViewId, string>)[view];
}

function tabLabel(tab: TabId) {
  return tabs.find(item => item.id === tab)?.label || 'Request';
}

function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}
