import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Boxes,
  Camera,
  CheckCircle2,
  ClipboardList,
  Cloud,
  Grid3X3,
  Hammer,
  Handshake,
  Home,
  Image as ImageIcon,
  Leaf,
  Loader2,
  Menu,
  MessageCircle,
  Moon,
  RefreshCw,
  Rows3,
  Search,
  ShieldCheck,
  ShoppingBag,
  Store,
  Sun,
  Trash2,
  Truck,
  UserRound,
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

type ViewId = 'home' | 'request' | 'drive' | 'tasks' | 'docks' | 'comm' | 'bloom' | 'inventory' | 'managers' | 'sales' | 'building' | 'qc' | 'office' | 'production' | 'reports';
type TabId = 'request' | 'sales' | 'location' | 'recount' | 'av' | 'shear';
type UploadState = 'queued' | 'uploading' | 'retrying' | 'uploaded' | 'failed';
type DisplayMode = 'cards' | 'grid';
type ThemeMode = 'light' | 'dark';
type RequestColumnKey = 'item' | 'common' | 'loc' | 'lot' | 'size' | 'src' | 'pri' | 'qty' | 'hand' | 'review' | 'avail' | 'open' | 'rep' | 'customer';

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

const DISPLAY_KEY_PREFIX = 'gnc:v2:display-mode:';
const REQUEST_DISPLAY_KEY_PREFIX = 'gnc:v2:request-display:';
const REQUEST_COLUMNS_KEY_PREFIX = 'gnc:v2:request-columns:';
const THEME_KEY_PREFIX = 'gnc:v2:theme:';

const requestGridColumns: Array<{ key: RequestColumnKey; label: string; className?: string; render: (row: RequestRow) => string | number }> = [
  { key: 'item', label: 'Item', render: row => field(row, ['ITEMCODE', 'itemcode'], String(uniqueId(row) || '-')) },
  { key: 'common', label: 'Common Name', className: 'strong-cell', render: row => field(row, ['COMMONNAME', 'commonname'], 'Unnamed item') },
  { key: 'loc', label: 'Loc', render: row => field(row, ['LOCATIONCODE', 'locationcode'], '-') },
  { key: 'lot', label: 'Lot', render: row => field(row, ['LOTCODE', 'lotcode'], '-') },
  { key: 'size', label: 'Size', render: row => field(row, ['CONTSIZE', 'contsize'], '-') },
  { key: 'src', label: 'Src', render: row => field(row, ['SRC', 'src'], '-') },
  { key: 'pri', label: 'Pri', render: row => field(row, ['PRI', 'priority'], '-') },
  { key: 'qty', label: 'Qty', render: row => field(row, ['QTY', 'qty', 'REQ_QTY', 'req_qty'], '0') },
  { key: 'hand', label: 'Hand', render: row => numberField(row, ['ON_HAND', 'on_hand', 'HAND']) },
  { key: 'review', label: 'Rev', render: row => numberField(row, ['REVIEW', 'review', 'REV']) },
  { key: 'avail', label: 'Avail', render: row => numberField(row, ['AVAILABLE', 'available', 'AVAIL']) },
  { key: 'open', label: 'Open', render: row => numberField(row, ['OPEN_STOCK', 'open_stock', 'OPEN']) },
  { key: 'rep', label: 'Rep', render: row => field(row, ['REQUESTED_BY', 'requested_by', 'SALES_REP', 'sales_rep'], '-') },
  { key: 'customer', label: 'Customer', render: row => field(row, ['CUSTOMER', 'customer', 'CONSIGNEE', 'consignee'], '-') }
];

const defaultRequestColumnKeys = requestGridColumns.map(column => column.key);

function displayModeKey(session: Session | null) {
  return `${DISPLAY_KEY_PREFIX}${session?.username || 'demo'}`;
}

function legacyRequestDisplayKey(session: Session | null) {
  return `${REQUEST_DISPLAY_KEY_PREFIX}${session?.username || 'demo'}`;
}

function readDisplayMode(session: Session | null): DisplayMode {
  try {
    const stored = localStorage.getItem(displayModeKey(session)) || localStorage.getItem(legacyRequestDisplayKey(session));
    return stored === 'grid' ? 'grid' : 'cards';
  } catch {
    return 'cards';
  }
}

function storeDisplayMode(session: Session | null, mode: DisplayMode) {
  try {
    localStorage.setItem(displayModeKey(session), mode);
  } catch {
    // Display mode is a convenience setting; ignore private-mode storage failures.
  }
}

function themeModeKey(session: Session | null) {
  return `${THEME_KEY_PREFIX}${session?.username || 'demo'}`;
}

function readThemeMode(session: Session | null): ThemeMode {
  try {
    return localStorage.getItem(themeModeKey(session)) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function storeThemeMode(session: Session | null, mode: ThemeMode) {
  try {
    localStorage.setItem(themeModeKey(session), mode);
  } catch {
    // Theme is local-only; ignore private-mode storage failures.
  }
}

function requestColumnsKey(session: Session | null) {
  return `${REQUEST_COLUMNS_KEY_PREFIX}${session?.username || 'demo'}`;
}

function readRequestColumnKeys(session: Session | null): RequestColumnKey[] {
  try {
    const raw = localStorage.getItem(requestColumnsKey(session));
    if (!raw) return defaultRequestColumnKeys;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultRequestColumnKeys;
    const allowed = new Set(defaultRequestColumnKeys);
    const keys = parsed.filter((key): key is RequestColumnKey => typeof key === 'string' && allowed.has(key as RequestColumnKey));
    return keys.length ? keys : defaultRequestColumnKeys;
  } catch {
    return defaultRequestColumnKeys;
  }
}

function storeRequestColumnKeys(session: Session | null, keys: RequestColumnKey[]) {
  try {
    localStorage.setItem(requestColumnsKey(session), JSON.stringify(keys));
  } catch {
    // Column preferences are local convenience settings; ignore storage failures.
  }
}

function usePhoneViewport() {
  const [isPhone, setIsPhone] = useState(() => window.matchMedia?.('(max-width: 720px)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    const sync = () => setIsPhone(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  return isPhone;
}

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => readDisplayMode(readStoredSession()));
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode(readStoredSession()));
  const [requestColumnKeys, setRequestColumnKeys] = useState<RequestColumnKey[]>(() => readRequestColumnKeys(readStoredSession()));
  const isPhoneViewport = usePhoneViewport();
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

  useEffect(() => {
    setDisplayMode(readDisplayMode(session));
    setThemeMode(readThemeMode(session));
    setRequestColumnKeys(readRequestColumnKeys(session));
  }, [session?.username]);

  const updateDisplayMode = (mode: DisplayMode) => {
    setDisplayMode(mode);
    storeDisplayMode(session, mode);
  };

  const updateThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
    storeThemeMode(session, mode);
  };

  const updateRequestColumnKeys = (next: RequestColumnKey[]) => {
    const keys = next.length ? next : defaultRequestColumnKeys;
    setRequestColumnKeys(keys);
    storeRequestColumnKeys(session, keys);
  };

  const openView = (next: ViewId) => {
    setView(next);
    setDetailRow(null);
    setSearch('');
    scrollerRef.current?.scrollTo({ top: 0 });
  };

  const title = detailRow ? 'Item Detail' : view === 'request' ? 'Que' : view === 'home' ? 'Home' : labelForView(view);
  const activeShellView = detailRow ? 'detail' : view;
  const showTopSearch = Boolean(detailRow) || view !== 'home';
  const allowGrid = !isPhoneViewport;
  const effectiveDisplayMode = allowGrid ? displayMode : 'cards';
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
    <div className={`app-shell app-view-${activeShellView} theme-${themeMode} ${demoMode ? 'demo-shell' : ''}`}>
      <div className="top-chrome" ref={topRef}>
        <div className="brand-strip">
          <button className="app-back-button" type="button" aria-label="Back" onClick={() => detailRow ? setDetailRow(null) : openView('home')}>
            <ArrowLeft size={28} />
          </button>
          <div>
            <div className="brand-user">{session?.displayName || session?.username || 'demo_user'}</div>
            <div className="brand-subtitle">AG DATA SOLUTIONS</div>
          </div>
          {showTopSearch ? (
            <div className="app-search-box">
              {view === 'request' && !detailRow ? <Search size={20} /> : null}
              <input
                value={detailRow || view !== 'request' ? title : search}
                onChange={event => !detailRow && setSearch(event.target.value)}
                readOnly={Boolean(detailRow) || view !== 'request'}
                placeholder={view === 'request' ? 'Search requests...' : title}
              />
            </div>
          ) : null}
          <div className="status-cluster">
            {demoMode ? <span className="demo-pill">Demo Safe</span> : null}
            <span className="version-pill">{APP_VERSION}</span>
            <span className="auto-pill">AUTO</span>
            <span className="auto-count">AUTO {Math.min(rows.length, 7)}/7</span>
          </div>
        </div>
      </div>

      <main className={`main-scroll view-${detailRow ? 'detail' : view}`} ref={scrollerRef}>
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
            displayMode={effectiveDisplayMode}
            allowGrid={allowGrid}
            columnKeys={requestColumnKeys}
            loading={loading}
            onTab={tab => { setActiveTab(tab); scrollerRef.current?.scrollTo({ top: 0 }); }}
            onDisplayMode={updateDisplayMode}
            onOpen={row => { setDetailRow(row); scrollerRef.current?.scrollTo({ top: 0 }); }}
            onRemove={(row) => removeRow(row, session, demoMode, setRows, setToast, setUndoRemove)}
            onRefresh={reloadRows}
          />
        ) : (
          <ModuleWorkspace view={view} displayMode={effectiveDisplayMode} allowGrid={allowGrid} demoMode={demoMode} />
        )}
      </main>

      <div className="bottom-nav-wrap" ref={navRef}>
        <nav className="bottom-nav" aria-label="Primary">
          <button type="button" onClick={() => setMenuOpen(true)} className="nav-item">
            <Menu size={28} /><span>Menu</span>
          </button>
          {navItems.slice(0, 1).map(item => <NavButton key={item.id} item={item} active={view === item.id} onOpen={openView} />)}
          {navItems.slice(1).map(item => <NavButton key={item.id} item={item} active={view === item.id} onOpen={openView} />)}
        </nav>
      </div>
      {menuOpen ? (
        <div className="drawer-scrim" onClick={() => setMenuOpen(false)}>
          <aside className="side-drawer" aria-label="App menu" onClick={event => event.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <strong>{session?.displayName || session?.username || 'demo_user'}</strong>
                <span>AG DATA SOLUTIONS</span>
              </div>
              <button type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)}><XCircle size={24} /></button>
            </div>
            <div className="drawer-mode">
              <span>Mode</span>
              <strong>{demoMode ? 'DEMO' : 'FIELD'}</strong>
            </div>
            <div className="drawer-stat">
              <span>Shell</span>
              <strong>{APP_VERSION}</strong>
            </div>
            <div className="drawer-stat">
              <span>Data Source</span>
              <strong>{demoMode ? 'Sandbox' : 'Live'}</strong>
            </div>
            <div className="drawer-preference">
              <span>Theme</span>
              <div className="segmented-control icon-control">
                <button type="button" className={themeMode === 'light' ? 'active' : ''} onClick={() => updateThemeMode('light')}><Sun size={16} /> Light</button>
                <button type="button" className={themeMode === 'dark' ? 'active' : ''} onClick={() => updateThemeMode('dark')}><Moon size={16} /> Dark</button>
              </div>
            </div>
            <div className="drawer-stat">
              <span>Auto Sync</span>
              <strong>AUTO {Math.min(rows.length, 7)}/7</strong>
            </div>
            <div className="drawer-preference">
              <span>View Style</span>
              {allowGrid ? (
                <div className="segmented-control icon-control">
                  <button type="button" className={displayMode === 'cards' ? 'active' : ''} onClick={() => updateDisplayMode('cards')}><Rows3 size={16} /> Cards</button>
                  <button type="button" className={displayMode === 'grid' ? 'active' : ''} onClick={() => updateDisplayMode('grid')}><Grid3X3 size={16} /> Grid</button>
                </div>
              ) : (
                <strong>Cards on phone</strong>
              )}
            </div>
            {allowGrid ? (
              <details className="drawer-columns" open>
                <summary>Request Grid Columns</summary>
                <div className="drawer-column-list">
                  {requestGridColumns.map(column => (
                    <label className="drawer-column-option" key={column.key}>
                      <input
                        type="checkbox"
                        checked={requestColumnKeys.includes(column.key)}
                        onChange={event => {
                          const next = event.target.checked
                            ? [...requestColumnKeys, column.key]
                            : requestColumnKeys.filter(key => key !== column.key);
                          updateRequestColumnKeys(defaultRequestColumnKeys.filter(key => next.includes(key)));
                        }}
                      />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
              </details>
            ) : null}
          </aside>
        </div>
      ) : null}
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
        <button className="ghost-button" type="button" onClick={onDemo}>Open demo sandbox</button>
      </form>
    </div>
  );
}

function HomeView({ onOpen }: { onOpen: (view: ViewId) => void }) {
  const modules: Array<{ view: ViewId; label: string; icon: typeof Home }> = [
    { view: 'drive', label: 'Drive Mode', icon: Truck },
    { view: 'docks', label: 'Docks', icon: Truck },
    { view: 'tasks', label: 'AV', icon: BookOpen },
    { view: 'comm', label: 'Communication', icon: MessageCircle },
    { view: 'sales', label: 'Sales', icon: Handshake },
    { view: 'managers', label: 'Managers', icon: Cloud },
    { view: 'building', label: 'Building', icon: Hammer },
    { view: 'qc', label: 'QC', icon: ShieldCheck },
    { view: 'office', label: 'Office', icon: Store },
    { view: 'inventory', label: 'Inventory', icon: ShoppingBag },
    { view: 'production', label: 'Production', icon: Leaf },
    { view: 'reports', label: 'Reports', icon: BarChart3 }
  ];
  return (
    <section className="home-dashboard">
      <div className="module-label">App Modules</div>
      <div className="home-grid">
        {modules.map(module => {
          const Icon = module.icon;
          return (
            <button className="module-tile" key={module.view} onClick={() => onOpen(module.view)}>
              <Icon size={34} />
              <span>{module.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function RequestView(props: {
  rows: RequestRow[];
  allRows: RequestRow[];
  activeTab: TabId;
  displayMode: DisplayMode;
  allowGrid: boolean;
  columnKeys: RequestColumnKey[];
  loading: boolean;
  onTab: (tab: TabId) => void;
  onDisplayMode: (mode: DisplayMode) => void;
  onOpen: (row: RequestRow) => void;
  onRemove: (row: RequestRow) => void;
  onRefresh: () => void;
}) {
  const visibleRows = useChunkedRows(props.rows, props.displayMode === 'grid' ? 80 : 24);
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
      <div className="filter-rail">
        <div className="request-tabs" role="tablist">
          {tabs.map(tab => (
            <button className={`filter-tab ${props.activeTab === tab.id ? 'active' : ''}`} key={tab.id} onClick={() => props.onTab(tab.id)}>
              {tab.label}<span>{counts.get(tab.id) || 0}</span>
            </button>
          ))}
        </div>
        <div className="request-actions">
          <span>{tabLabel(props.activeTab)} Que</span>
          <div className="request-action-buttons">
            {props.allowGrid ? (
              <div className="segmented-control small" aria-label="Request display mode">
                <button type="button" className={props.displayMode === 'cards' ? 'active' : ''} onClick={() => props.onDisplayMode('cards')}><Rows3 size={16} /> Cards</button>
                <button type="button" className={props.displayMode === 'grid' ? 'active' : ''} onClick={() => props.onDisplayMode('grid')}><Grid3X3 size={16} /> Grid</button>
              </div>
            ) : null}
            <button type="button" onClick={props.onRefresh}><RefreshCw size={18} /> Refresh</button>
          </div>
        </div>
      </div>
      {props.loading && !props.rows.length ? <div className="empty-state"><Loader2 className="spin" /> Loading rows...</div> : null}
      {!props.loading && !props.rows.length ? <div className="empty-state">No rows match this view.</div> : null}
      {props.displayMode === 'grid' ? (
        <RequestGrid rows={visibleRows} columnKeys={props.columnKeys} onOpen={props.onOpen} onRemove={props.onRemove} />
      ) : (
        <div className="request-list">
          {visibleRows.map(row => (
            <RequestCard key={String(uniqueId(row))} row={row} onOpen={() => props.onOpen(row)} onRemove={() => props.onRemove(row)} />
          ))}
        </div>
      )}
    </section>
  );
}

function RequestGrid({ rows, columnKeys, onOpen, onRemove }: { rows: RequestRow[]; columnKeys: RequestColumnKey[]; onOpen: (row: RequestRow) => void; onRemove: (row: RequestRow) => void }) {
  const columns = requestGridColumns.filter(column => columnKeys.includes(column.key));
  return (
    <div className="request-grid-wrap" role="region" aria-label="Request rows grid">
      <table className="request-grid-table">
        <thead>
          <tr>
            {columns.map(column => <th key={column.key}>{column.label}</th>)}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={String(uniqueId(row))} onDoubleClick={() => onOpen(row)}>
              {columns.map(column => <td className={column.className} key={column.key}>{column.render(row)}</td>)}
              <td>
                <div className="grid-row-actions">
                  <button type="button" onClick={() => onOpen(row)}>Open</button>
                  <button type="button" className="danger" onClick={() => onRemove(row)}>Remove</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
          <ModernPhoto row={row} />
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
          <ModernPhoto row={props.row} large />
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

type ModulePreviewRow = {
  title: string;
  meta: string;
  owner: string;
  status: string;
  quantity: string;
  tone: 'green' | 'blue' | 'purple' | 'orange' | 'warning';
};

function ModuleWorkspace({ view, displayMode, allowGrid, demoMode }: { view: ViewId; displayMode: DisplayMode; allowGrid: boolean; demoMode: boolean }) {
  const rows = modulePreviewRows(view);
  const isGrid = allowGrid && displayMode === 'grid';
  return (
    <section className="module-workspace">
      <div className="module-workspace-head">
        <div>
          <span>{demoMode ? 'Sandbox Workflow' : 'Field Workflow'}</span>
          <h1>{labelForView(view)}</h1>
        </div>
        <div className="workspace-mode-pill">{isGrid ? <Grid3X3 size={16} /> : <Rows3 size={16} />}{isGrid ? 'Grid' : 'Cards'}</div>
      </div>
      {isGrid ? (
        <div className="module-grid-wrap">
          <table className="module-grid-table">
            <thead>
              <tr><th>Work Item</th><th>Location</th><th>Owner</th><th>Status</th><th>Qty</th></tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.title}>
                  <td>{row.title}</td>
                  <td>{row.meta}</td>
                  <td>{row.owner}</td>
                  <td><Chip tone={row.tone} label={row.status} /></td>
                  <td>{row.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="module-card-list">
          {rows.map(row => (
            <article className="module-preview-card" key={row.title}>
              <div className="module-preview-icon"><Boxes size={24} /></div>
              <div>
                <h2>{row.title}</h2>
                <p>{row.meta}</p>
                <span><UserRound size={15} /> {row.owner}</span>
              </div>
              <div className="module-preview-side">
                <Chip tone={row.tone} label={row.status} />
                <strong>{row.quantity}</strong>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ModernPhoto({ row, large = false }: { row: RequestRow; large?: boolean }) {
  const url = field(row, ['REQ_PHOTO_LINK', 'req_photo_link', 'PHOTO_URL', 'photo_url', 'IMAGE_URL', 'image_url']);
  const name = field(row, ['COMMONNAME', 'commonname'], 'Item');
  return (
    <div className={`media-frame ${large ? 'large' : ''}`}>
      {url ? (
        <img src={url} alt="" loading="lazy" />
      ) : (
        <div className="media-placeholder">
          <ImageIcon size={large ? 34 : 26} />
          <span>{mediaInitials(name)}</span>
        </div>
      )}
    </div>
  );
}

function mediaInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'AG';
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
  return ({
    home: 'Home',
    request: 'Que',
    drive: 'Drive',
    tasks: 'Tasks',
    docks: 'Docks',
    comm: 'Communication',
    bloom: 'Bloom',
    inventory: 'Inventory',
    managers: 'Managers',
    sales: 'Sales',
    building: 'Building',
    qc: 'QC',
    office: 'Office',
    production: 'Production',
    reports: 'Reports'
  } as Record<ViewId, string>)[view];
}

function modulePreviewRows(view: ViewId): ModulePreviewRow[] {
  const base: Record<ViewId, ModulePreviewRow[]> = {
    home: [],
    request: [],
    drive: [
      { title: 'Stop 60 - Dothan Nurseries', meta: 'Dock 34 | AL route', owner: 'Toby Brown', status: 'Open Stop', quantity: '27 rows', tone: 'blue' },
      { title: 'Acoma Crape Myrtle', meta: 'H.03.000 | Lot 27.F1', owner: 'Kayla Knepp', status: 'Pull Ready', quantity: '94', tone: 'green' },
      { title: 'Green Sargent Juniper', meta: 'C.05.000 | Lot 27.F1', owner: 'Brian Hatfield', status: 'Review', quantity: '48', tone: 'warning' }
    ],
    tasks: [
      { title: 'AV Blanks - Block A', meta: 'Current Season | #3 and #5', owner: 'Dylan Collyge', status: 'Active', quantity: '45 items', tone: 'green' },
      { title: 'Photo, spec, and PRI check', meta: 'Big Blue Liriope | E.07.000', owner: 'Kayla Knepp', status: 'Open', quantity: '939', tone: 'blue' },
      { title: 'Hold risk review', meta: 'Compact Andorra Juniper | K.03.000', owner: 'JD Jones', status: 'Hold', quantity: '235', tone: 'warning' }
    ],
    docks: [
      { title: 'Dock 34', meta: 'Checker / inspector pending', owner: 'Tracey Tapscott', status: 'Loading', quantity: '85 items', tone: 'blue' },
      { title: 'Drop Off', meta: 'Retail transfer queue', owner: 'Megan Kelly', status: 'Queued', quantity: '18 rows', tone: 'purple' },
      { title: 'Mistake Review', meta: 'Customer and lot mismatch', owner: 'Mitch Kaiser', status: 'Needs Review', quantity: '1', tone: 'warning' }
    ],
    comm: [
      { title: 'kayla_knepp', meta: 'Screenshot please, text it to my phone', owner: '2 members', status: 'New', quantity: 'Jul 2', tone: 'blue' },
      { title: 'tony_bono', meta: 'Will get shortly.', owner: '2 members', status: 'Open', quantity: 'Jun 15', tone: 'green' },
      { title: 'test_test', meta: 'Hey', owner: '4 members', status: 'Read', quantity: 'May 30', tone: 'purple' }
    ],
    bloom: [
      { title: 'Bloom Picker Orders', meta: 'Retail and house picks', owner: 'Office', status: 'Ready', quantity: '12 orders', tone: 'green' },
      { title: 'Photo Match Review', meta: 'Rows missing request images', owner: 'AV Team', status: 'Review', quantity: '6 rows', tone: 'warning' },
      { title: 'No Photos', meta: 'Available plants without images', owner: 'Field', status: 'Open', quantity: '34', tone: 'blue' }
    ],
    inventory: [
      { title: 'Crop Roll', meta: 'Blocks A through F', owner: 'Inventory Office', status: 'Current', quantity: '674 rows', tone: 'green' },
      { title: 'PO Management', meta: 'HL PO 27F1', owner: 'Managers', status: 'Built', quantity: '234 rows', tone: 'blue' },
      { title: 'Weather & Hold Risk', meta: 'Heat sensitive rows', owner: 'Grower Team', status: 'Watch', quantity: '9', tone: 'warning' }
    ],
    managers: [
      { title: 'Approval', meta: 'Shear and NCR approvals', owner: 'Dylan Collyge', status: 'Active', quantity: '2 queues', tone: 'green' },
      { title: 'Shortage / Cancel', meta: 'Dylan only', owner: 'Managers', status: 'Clean', quantity: '0 net', tone: 'blue' },
      { title: 'Labor Hours', meta: 'Daily field check', owner: 'Mitch Kaiser', status: 'Due', quantity: 'Today', tone: 'warning' }
    ],
    sales: [
      { title: 'Season Sales Notes', meta: 'Lavender and blue color runs', owner: 'Sales Team', status: 'Open', quantity: '31 notes', tone: 'purple' },
      { title: 'Customer Holds', meta: 'Oakland Garden Center', owner: 'Annette Hancock', status: 'Hold', quantity: '14', tone: 'warning' },
      { title: 'Rep Follow Up', meta: 'Coastal Landscape', owner: 'Wes Lugas', status: 'Today', quantity: '8 rows', tone: 'green' }
    ],
    building: [
      { title: 'Cart Bay', meta: 'Door hardware and signage', owner: 'Building', status: 'Open', quantity: '3 tasks', tone: 'blue' },
      { title: 'Dock Extension', meta: 'South staging lane', owner: 'Managers', status: 'Review', quantity: '1', tone: 'warning' },
      { title: 'Office Repair', meta: 'Inventory printer station', owner: 'Office', status: 'Ready', quantity: '2 tasks', tone: 'green' }
    ],
    qc: [
      { title: 'NCR Approvals', meta: 'Quality review', owner: 'QC', status: 'Review', quantity: '7', tone: 'warning' },
      { title: 'Photo Standards', meta: 'Request image check', owner: 'Kayla Knepp', status: 'Open', quantity: '12', tone: 'blue' },
      { title: 'Spec Confirmed', meta: 'Container size verification', owner: 'Grower Team', status: 'Passed', quantity: '45', tone: 'green' }
    ],
    office: [
      { title: 'Inventory Office', meta: 'Location move review', owner: 'Office', status: 'Open', quantity: '22 rows', tone: 'blue' },
      { title: 'Reports Queue', meta: 'Daily exports', owner: 'Dylan Collyge', status: 'Ready', quantity: '5', tone: 'green' },
      { title: 'Customer Cards', meta: 'Consignee cleanup', owner: 'Megan Kelly', status: 'Review', quantity: '18', tone: 'warning' }
    ],
    production: [
      { title: 'Block Clearing', meta: 'A and C blocks', owner: 'Production', status: 'Active', quantity: '96 rows', tone: 'green' },
      { title: 'Crop Roll Review', meta: 'Pot count variance', owner: 'Grower Team', status: 'Review', quantity: '11', tone: 'warning' },
      { title: 'Weather Hold', meta: 'Heat forecast', owner: 'Managers', status: 'Watch', quantity: '3 blocks', tone: 'orange' }
    ],
    reports: [
      { title: 'Daily Request Summary', meta: 'Auto 5/7 sync', owner: 'Dylan Collyge', status: 'Ready', quantity: 'Today', tone: 'green' },
      { title: 'Open Stock Audit', meta: 'High variance items', owner: 'Inventory', status: 'Open', quantity: '27 rows', tone: 'blue' },
      { title: 'Completion History', meta: 'Photo/spec updates', owner: 'Field', status: 'Export', quantity: 'CSV', tone: 'purple' }
    ]
  };
  return base[view] || [];
}

function tabLabel(tab: TabId) {
  return tabs.find(item => item.id === tab)?.label || 'Request';
}

function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}
