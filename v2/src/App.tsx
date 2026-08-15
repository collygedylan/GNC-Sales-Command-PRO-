import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Boxes,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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
  Save,
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
  demoAvOptions,
  demoRows,
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
import type { AvOptionRow } from './types';

type ViewId = 'home' | 'request' | 'drive' | 'tasks' | 'docks' | 'comm' | 'bloom' | 'inventory' | 'managers' | 'sales' | 'building' | 'qc' | 'office' | 'production' | 'reports';
type TabId = 'request' | 'sales' | 'location' | 'recount' | 'av' | 'shear';
type UploadState = 'queued' | 'uploading' | 'retrying' | 'uploaded' | 'failed';
type DisplayMode = 'cards' | 'grid';
type ThemeMode = 'light' | 'dark';
type RequestColumnKey = 'item' | 'common' | 'loc' | 'lot' | 'size' | 'src' | 'pri' | 'qty' | 'hand' | 'review' | 'avail' | 'open' | 'rep' | 'customer';
type ModuleFilter = { id: string; label: string };
type MessageThread = {
  id: string;
  title: string;
  preview: string;
  date: string;
  members: string;
  unread?: boolean;
  messages: Array<{ from: string; body: string; time: string }>;
};

const SANDBOX_ONLY = true;

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

function useChunkedRows<T>(rows: T[], batch = 30, maximum = 96) {
  const [count, setCount] = useState(batch);
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    const target = Math.min(rows.length, maximum);
    setCount(Math.min(batch, target));
    const pump = () => {
      if (cancelled) return;
      setCount(current => {
        const next = Math.min(current + batch, target);
        if (next < target) frame = window.requestAnimationFrame(pump);
        return next;
      });
    };
    if (target > batch) frame = window.requestAnimationFrame(pump);
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [rows, batch, maximum]);
  return rows.slice(0, count);
}

export function App() {
  const [session, setSession] = useState<Session | null>(() => readStoredSession());
  const [demoMode, setDemoMode] = useState(SANDBOX_ONLY);
  const [view, setView] = useState<ViewId>('home');
  const [activeTab, setActiveTab] = useState<TabId>('request');
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [detailRow, setDetailRow] = useState<RequestRow | null>(null);
  const [moduleDetail, setModuleDetail] = useState<{ view: ViewId; row: ModulePreviewRow } | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [undoRemove, setUndoRemove] = useState<RequestRow | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(() => readDisplayMode(readStoredSession()));
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode(readStoredSession()));
  const [requestColumnKeys, setRequestColumnKeys] = useState<RequestColumnKey[]>(() => readRequestColumnKeys(readStoredSession()));
  const [moduleFilters, setModuleFilters] = useState<Partial<Record<ViewId, string>>>({});
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
    if (SANDBOX_ONLY || demoMode) {
      setRows(demoRows());
      setError('');
      return;
    }
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      setRows(demoRows());
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
    setModuleDetail(null);
    setSearch('');
    scrollerRef.current?.scrollTo({ top: 0 });
  };

  const title = detailRow ? 'Item Detail' : moduleDetail ? moduleDetail.row.title : view === 'request' ? 'Que' : view === 'home' ? 'Home' : labelForView(view);
  const activeShellView = detailRow ? 'detail' : moduleDetail ? 'module-detail' : view;
  const showTopSearch = Boolean(detailRow || moduleDetail) || view !== 'home';
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
          <button className="app-back-button" type="button" aria-label="Back" onClick={() => detailRow ? setDetailRow(null) : moduleDetail ? setModuleDetail(null) : openView('home')}>
            <ArrowLeft size={28} />
          </button>
          <div>
            <div className="brand-user">{session?.displayName || session?.username || 'demo_user'}</div>
            <div className="brand-subtitle">AG DATA SOLUTIONS</div>
          </div>
          {showTopSearch ? (
            <div className="app-search-box">
              {view === 'request' && !detailRow && !moduleDetail ? <Search size={20} /> : null}
              <input
                value={detailRow || moduleDetail || view !== 'request' ? title : search}
                onChange={event => !detailRow && !moduleDetail && setSearch(event.target.value)}
                readOnly={Boolean(detailRow || moduleDetail) || view !== 'request'}
                placeholder={view === 'request' ? 'Search requests...' : title}
              />
            </div>
          ) : null}
          <div className="status-cluster">
            {SANDBOX_ONLY || demoMode ? <span className="demo-pill">Test Data</span> : null}
            <span className="version-pill">{APP_VERSION}</span>
            <span className="auto-count">AUTO {Math.min(rows.length, 7)}/7</span>
          </div>
        </div>
      </div>

      <main className={`main-scroll view-${detailRow ? 'detail' : moduleDetail ? 'module-detail' : view}`} ref={scrollerRef}>
        {error ? <div className="banner error">{error}</div> : null}
        {toast ? (
          <Toast
            message={toast}
            action={undoRemove ? {
              label: 'Undo',
              onClick: () => {
                const row = undoRemove;
                setRows(current => current.map(item => uniqueId(item) === uniqueId(row) ? { ...item, REQ_ARCHIVED: false, REQ_ARCHIVED_AT: null } : item));
                if (!SANDBOX_ONLY && !demoMode && session) {
                  void patchRow(session, REQUEST_TABLE, uniqueId(row), { REQ_ARCHIVED: false, REQ_ARCHIVED_AT: null });
                }
                setUndoRemove(null);
                setToast('Row restored.');
              }
            } : undefined}
            onClose={() => { setToast(''); setUndoRemove(null); }}
          />
        ) : null}
        {moduleDetail ? (
          <ModuleDetail
            view={moduleDetail.view}
            row={moduleDetail.row}
            demoMode={SANDBOX_ONLY || demoMode}
            onBack={() => { setModuleDetail(null); scrollerRef.current?.scrollTo({ top: 0 }); }}
            onToast={setToast}
          />
        ) : detailRow ? (
          <RequestDetail
            row={detailRow}
            session={session}
            demoMode={SANDBOX_ONLY || demoMode}
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
            columnKeys={requestColumnKeys}
            loading={loading}
            onTab={tab => { setActiveTab(tab); scrollerRef.current?.scrollTo({ top: 0 }); }}
            onOpen={row => { setDetailRow(row); scrollerRef.current?.scrollTo({ top: 0 }); }}
            onRemove={(row) => removeRow(row, session, SANDBOX_ONLY || demoMode, setRows, setToast, setUndoRemove)}
            onRefresh={reloadRows}
          />
        ) : view === 'comm' ? (
          <CommunicationView demoMode={SANDBOX_ONLY || demoMode} />
        ) : (
          <ModuleWorkspace
            view={view}
            displayMode={effectiveDisplayMode}
            allowGrid={allowGrid}
            demoMode={SANDBOX_ONLY || demoMode}
            activeFilter={moduleFilters[view] || 'all'}
            onFilterChange={filter => setModuleFilters(current => ({ ...current, [view]: filter }))}
            onOpen={row => { setModuleDetail({ view, row }); scrollerRef.current?.scrollTo({ top: 0 }); }}
          />
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
              <strong>{SANDBOX_ONLY || demoMode ? 'TEST' : 'FIELD'}</strong>
            </div>
            <div className="drawer-stat">
              <span>Shell</span>
              <strong>{APP_VERSION}</strong>
            </div>
            <div className="drawer-stat">
              <span>Data Source</span>
              <strong>Live-shaped Fixtures</strong>
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
  columnKeys: RequestColumnKey[];
  loading: boolean;
  onTab: (tab: TabId) => void;
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
        <div className="filter-dropdown-row">
          <label className="filter-select">
            <span>Que View</span>
            <select value={props.activeTab} onChange={event => props.onTab(event.target.value as TabId)}>
              {tabs.map(tab => (
                <option key={tab.id} value={tab.id}>{tab.label} ({counts.get(tab.id) || 0})</option>
              ))}
            </select>
            <ChevronDown size={18} />
          </label>
          <div className="request-actions">
            <span>{tabLabel(props.activeTab)} Que</span>
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
      {props.rows.length > visibleRows.length ? (
        <p className="render-limit-note">
          Showing the first {visibleRows.length.toLocaleString()} of {props.rows.length.toLocaleString()} matching rows. Refine the search or filter to narrow the list.
        </p>
      ) : null}
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
    <article className="request-card live-row-card" onClick={onOpen}>
      <div className="card-main">
        <div className="card-copy">
          <h2>{field(row, ['COMMONNAME', 'commonname'], 'Unnamed item')}</h2>
          <a>{field(row, ['LOCATIONCODE', 'locationcode'], '-')}</a>
          <div className="card-meta-line">
            {field(row, ['ITEMCODE', 'itemcode'], '-')} | Lot {field(row, ['LOTCODE', 'lotcode'], '-')} | {field(row, ['CONTSIZE', 'contsize'], '-')}
          </div>
          <p>{field(row, ['REQUESTED_BY', 'requested_by', 'SALES_REP', 'sales_rep'], 'No rep')}</p>
          <p>{field(row, ['CUSTOMER', 'customer', 'CONSIGNEE', 'consignee'], 'No customer')}</p>
        </div>
        <div className="card-side">
          <span className="color-chip">{field(row, ['COLOR', 'color', 'DESIGCUST', 'desigcust'], '')}</span>
          <strong>{field(row, ['CONTSIZE', 'contsize'], '')}</strong>
          <span>{field(row, ['SRC', 'src'], '')}</span>
          <ModernPhoto row={row} />
          <em>Open <ChevronRight size={15} /></em>
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
  const [showAdvanced, setShowAdvanced] = useState(() => (
    typeof window === 'undefined' ? true : !(window.matchMedia?.('(max-width: 720px)').matches ?? false)
  ));
  const [selectedYear, setSelectedYear] = useState(27);
  const [selectedAvRowId, setSelectedAvRowId] = useState('');
  const avRows = useMemo(
    () => demoAvOptions(field(props.row, ['ITEMCODE', 'itemcode'], ''), selectedYear),
    [props.row, selectedYear]
  );
  const selectedAvRow = useMemo(
    () => avRows.find(row => String(row.unique_id ?? '') === selectedAvRowId) ?? null,
    [avRows, selectedAvRowId]
  );
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
      AV_OPTION_UNIQUE_ID: selectedAvRowId || null,
      AV_SELECTED_LOCATION: selectedAvRow ? avValue(selectedAvRow, 'LOCATIONCODE', 'locationcode') : null,
      ...(complete ? { REQ_STATUS: 'Complete', DATE_COMPLETED: new Date().toISOString() } : {})
    };
    setBusy(true);
    try {
      if (!props.demoMode && props.session) await patchRow(props.session, REQUEST_TABLE, rowId, patch);
      props.onPatch(patch);
      props.onToast(complete ? 'Request row committed.' : 'Request row saved.');
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
        <div className="field-grid detail-primary-grid">
          <ReadOnlyField label="PRI" value={field(props.row, ['PRI', 'priority'], '-')} />
          <ReadOnlyField label="On Hand" value={String(numberField(props.row, ['ON_HAND', 'on_hand', 'HAND']))} />
          <ReadOnlyField label="Available" value={String(numberField(props.row, ['AVAILABLE', 'available', 'AVAIL']))} />
          <label><span>Qty</span><input value={draft.qty} inputMode="numeric" onChange={event => update('qty', event.target.value)} /></label>
          <label><span>Reserve</span><select value={draft.reserve} onChange={event => update('reserve', event.target.value)}><option>NO</option><option>YES</option></select></label>
          <ReadOnlyField label="Sales Rep" value={field(props.row, ['REQUESTED_BY', 'requested_by', 'SALES_REP', 'sales_rep'], '-')} />
          <ReadOnlyField label="Customer / Consignee" value={field(props.row, ['CUSTOMER', 'customer', 'CONSIGNEE', 'consignee'], 'N/A')} />
          <label className="wide"><span>Row Note</span><textarea value={draft.rowNote} onChange={event => update('rowNote', event.target.value)} /></label>
        </div>
        <label className="photo-button">
          <Camera size={24} />
          Take Request Photo
          <input type="file" accept="image/*" capture="environment" multiple onChange={event => onFiles(event.target.files)} />
        </label>
        <UploadStrip uploads={uploads} onRetry={upload => void runUpload(upload)} onRemove={id => setUploads(current => current.filter(item => item.id !== id))} />
        <details className="detail-advanced" open={showAdvanced} onToggle={event => setShowAdvanced(event.currentTarget.open)}>
          <summary>
            <span>Advanced fields</span>
            <ChevronDown size={18} />
          </summary>
          <div className="advanced-body">
            <div className="field-grid detail-secondary-grid">
              <ReadOnlyField label="Review" value={String(numberField(props.row, ['REVIEW', 'review', 'REV']))} />
              <ReadOnlyField label="Open Stock" value={String(numberField(props.row, ['OPEN_STOCK', 'open_stock', 'OPEN']))} />
              <label><span>Required Spec</span><input value={draft.spec} placeholder="e.g. 24-30 inch" onChange={event => update('spec', event.target.value)} /></label>
              <label><span>Required Caliper</span><input value={draft.caliper} placeholder="N/A" onChange={event => update('caliper', event.target.value)} /></label>
            </div>
            <details className="av-options-panel">
              <summary>
                <span><strong>AV Options</strong><small>{field(props.row, ['ITEMCODE', 'itemcode'], '-')} | {avRows.length} rows</small></span>
                <ChevronDown size={18} />
              </summary>
              <div className="av-options-body">
                <label className="av-year-select">
                  <span>Season / Sales Year</span>
                  <select value={selectedYear} onChange={event => { setSelectedYear(Number(event.target.value)); setSelectedAvRowId(''); }}>
                    {[27, 26, 25, 24, 28, 29, 30].map(year => <option key={year} value={year}>Sales year {year}</option>)}
                  </select>
                </label>
                <div className="av-option-list" role="listbox" aria-label="Available inventory rows">
                  {avRows.map(row => {
                    const id = String(row.unique_id ?? '');
                    const selected = id === selectedAvRowId;
                    return (
                      <button
                        className={`av-option-row${selected ? ' selected' : ''}`}
                        key={id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => setSelectedAvRowId(selected ? '' : id)}
                      >
                        <span className="av-option-location">{avValue(row, 'LOCATIONCODE', 'locationcode')}</span>
                        <span>Year {avValue(row, 'SALESYEAR', 'salesyear')}</span>
                        <span>Block {avValue(row, 'BLOCKALPHA', 'blockalpha')}{avValue(row, 'BLOCKNUMBER', 'blocknumber')}</span>
                        <strong>{avValue(row, 'AVAILABLE', 'available')} available</strong>
                      </button>
                    );
                  })}
                </div>
              </div>
            </details>
            <div className="field-grid detail-secondary-grid">
              <label><span>Loc Match %</span><input value={draft.locMatch} inputMode="decimal" placeholder="e.g. 95" onChange={event => update('locMatch', event.target.value)} /></label>
              <label><span>AV Note</span><textarea value={draft.avNote} onChange={event => update('avNote', event.target.value)} /></label>
              <label className="wide"><span>Pick Note</span><textarea value={draft.pickNote} onChange={event => update('pickNote', event.target.value)} /></label>
            </div>
          </div>
        </details>
        <div className="detail-actions">
          <button className="ghost-button" disabled={busy} onClick={() => void save(false)}>Save</button>
          <button className="primary-button" disabled={busy || pendingUpload || failedUpload} onClick={() => void save(true)}>
            <CheckCircle2 size={20} /> Commit
          </button>
        </div>
      </div>
    </section>
  );
}

function avValue(row: AvOptionRow, upper: string, lower: string) {
  const value = row[upper] ?? row[lower];
  return value === undefined || value === null || value === '' ? '-' : String(value);
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
  filter?: string;
  detail?: {
    fields?: Array<{ label: string; value: string }>;
    notes?: string[];
    history?: Array<{ label: string; value: string }>;
    actions?: string[];
  };
};

function ModuleWorkspace({
  view,
  displayMode,
  allowGrid,
  demoMode,
  activeFilter,
  onFilterChange,
  onOpen
}: {
  view: ViewId;
  displayMode: DisplayMode;
  allowGrid: boolean;
  demoMode: boolean;
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  onOpen: (row: ModulePreviewRow) => void;
}) {
  const rows = modulePreviewRows(view);
  const isGrid = allowGrid && displayMode === 'grid';
  const filters = moduleFilterOptions(rows);
  const visibleRows = activeFilter === 'all'
    ? rows
    : rows.filter(row => rowFilterId(row) === activeFilter);
  return (
    <section className="module-workspace">
      <div className="module-workspace-head">
        <div>
          <span>{demoMode ? 'Sandbox Workflow' : 'Field Workflow'}</span>
          <h1>{labelForView(view)}</h1>
        </div>
      </div>
      <div className="filter-rail module-filter-rail">
        <label className="filter-select compact">
          <span>Filter</span>
          <select value={activeFilter} onChange={event => onFilterChange(event.target.value)}>
            {filters.map(filter => <option key={filter.id} value={filter.id}>{filter.label}</option>)}
          </select>
          <ChevronDown size={18} />
        </label>
      </div>
      {isGrid ? (
        <div className="module-grid-wrap">
          <table className="module-grid-table">
            <thead>
              <tr><th>Work Item</th><th>Location</th><th>Owner</th><th>Status</th><th>Qty</th><th>Open</th></tr>
            </thead>
            <tbody>
              {visibleRows.map(row => (
                <tr key={row.title} className="module-grid-row" onDoubleClick={() => onOpen(row)}>
                  <td>{row.title}</td>
                  <td>{row.meta}</td>
                  <td>{row.owner}</td>
                  <td><Chip tone={row.tone} label={row.status} /></td>
                  <td>{row.quantity}</td>
                  <td><button type="button" className="grid-open-button" onClick={() => onOpen(row)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="module-card-list">
          {visibleRows.map(row => (
            <button type="button" className="module-preview-card live-row-card" key={row.title} onClick={() => onOpen(row)}>
              <div className="module-preview-icon">{moduleIcon(view, 24)}</div>
              <div>
                <h2>{row.title}</h2>
                <p>{row.meta}</p>
                <span><UserRound size={15} /> {row.owner}</span>
              </div>
              <div className="module-preview-side">
                <Chip tone={row.tone} label={row.status} />
                <strong>{row.quantity}</strong>
                <em>Open <ChevronRight size={16} /></em>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

type DetailTabId =
  | 'summary' | 'edits' | 'customer' | 'notes' | 'inquiry' | 'location'
  | 'items' | 'assignment' | 'photos' | 'history' | 'stops' | 'team'
  | 'mistakes' | 'modules' | 'approval' | 'shortage' | 'materials'
  | 'findings' | 'queue' | 'reports' | 'columns' | 'blocks' | 'moves'
  | 'po' | 'recounts' | 'availability' | 'crop-roll' | 'stock';

type DetailTabDefinition = { id: DetailTabId; label: string };

function detailTabsForView(view: ViewId): DetailTabDefinition[] {
  switch (view) {
    case 'drive':
      return [
        { id: 'summary', label: 'Item Details' },
        { id: 'edits', label: 'Inventory Edits' },
        { id: 'customer', label: 'Customer / Consignee' },
        { id: 'notes', label: 'Notes & Actions' },
        { id: 'inquiry', label: 'Item Inquiry' },
        { id: 'location', label: 'Location' },
      ];
    case 'tasks':
      return [
        { id: 'summary', label: 'Task' },
        { id: 'items', label: 'Items' },
        { id: 'assignment', label: 'Assignment' },
        { id: 'notes', label: 'Notes' },
      ];
    case 'docks':
      return [
        { id: 'summary', label: 'Dock Status' },
        { id: 'stops', label: 'Stops' },
        { id: 'team', label: 'Team' },
        { id: 'mistakes', label: 'Mistakes' },
      ];
    case 'inventory':
      return [
        { id: 'summary', label: 'Inventory' },
        { id: 'moves', label: 'Moves' },
        { id: 'po', label: 'PO Management' },
        { id: 'recounts', label: 'Recounts' },
        { id: 'inquiry', label: 'Item Inquiry' },
      ];
    case 'managers':
      return [
        { id: 'modules', label: 'Modules' },
        { id: 'approval', label: 'Approval' },
        { id: 'shortage', label: 'Shortage / Cancel' },
        { id: 'history', label: 'History' },
      ];
    case 'bloom':
      return [
        { id: 'stock', label: 'Stock' },
        { id: 'photos', label: 'Photos' },
        { id: 'inquiry', label: 'Item Inquiry' },
        { id: 'notes', label: 'Notes' },
      ];
    case 'sales':
      return [
        { id: 'customer', label: 'Customer' },
        { id: 'availability', label: 'Availability' },
        { id: 'notes', label: 'Sales Notes' },
        { id: 'history', label: 'History' },
      ];
    case 'building':
      return [
        { id: 'summary', label: 'Work Order' },
        { id: 'materials', label: 'Materials' },
        { id: 'assignment', label: 'Assignment' },
        { id: 'history', label: 'History' },
      ];
    case 'qc':
      return [
        { id: 'summary', label: 'Check' },
        { id: 'photos', label: 'Photos' },
        { id: 'findings', label: 'Findings' },
        { id: 'history', label: 'History' },
      ];
    case 'office':
      return [
        { id: 'queue', label: 'Queue' },
        { id: 'customer', label: 'Customers' },
        { id: 'reports', label: 'Reports' },
        { id: 'notes', label: 'Notes' },
      ];
    case 'production':
      return [
        { id: 'crop-roll', label: 'Crop Roll' },
        { id: 'blocks', label: 'Blocks' },
        { id: 'notes', label: 'Notes' },
        { id: 'history', label: 'History' },
      ];
    case 'reports':
      return [
        { id: 'reports', label: 'Report' },
        { id: 'columns', label: 'Columns' },
        { id: 'history', label: 'History' },
      ];
    default:
      return [
        { id: 'summary', label: 'Summary' },
        { id: 'notes', label: 'Notes & Actions' },
        { id: 'history', label: 'History' },
      ];
  }
}

function ModuleDetail({ view, row, demoMode, onBack, onToast }: {
  view: ViewId;
  row: ModulePreviewRow;
  demoMode: boolean;
  onBack: () => void;
  onToast: (message: string) => void;
}) {
  const details = useMemo(() => liveShapedDetailFor(view, row), [view, row]);
  const [status, setStatus] = useState(row.status);
  const [quantity, setQuantity] = useState(row.quantity);
  const [note, setNote] = useState(details.notes[0] || '');
  const [decision, setDecision] = useState(details.actions[0] || 'Review');
  const tabs = useMemo(() => detailTabsForView(view), [view]);
  const [activeTab, setActiveTab] = useState<DetailTabId>(tabs[0].id);

  useEffect(() => {
    setActiveTab(tabs[0].id);
    setStatus(row.status);
    setQuantity(row.quantity);
    setNote(details.notes[0] || '');
    setDecision(details.actions[0] || 'Review');
  }, [details.notes, row.quantity, row.status, row.title, tabs]);

  const sandboxToast = (action: string) => {
    onToast(`${action} saved in the v2 sandbox only. No production data, email, or upload was touched.`);
  };

  const renderEditableSummary = () => (
    <div className="live-detail-grid">
      <label className="editable-field">
        <span>Status</span>
        <select value={status} onChange={event => setStatus(event.target.value)}>
          {[row.status, 'Open', 'In Progress', 'Review', 'Ready', 'Complete'].filter((value, index, all) => all.indexOf(value) === index).map(value => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className="editable-field">
        <span>Quantity / Rows</span>
        <input value={quantity} onChange={event => setQuantity(event.target.value)} />
      </label>
      <label className="editable-field">
        <span>Action</span>
        <select value={decision} onChange={event => setDecision(event.target.value)}>
          {details.actions.map(action => <option key={action} value={action}>{action}</option>)}
        </select>
      </label>
      <ReadOnlyField label="Owner" value={row.owner} />
      {details.fields.map(field => <ReadOnlyField key={field.label} label={field.label} value={field.value} />)}
    </div>
  );

  const renderInquiry = () => (
    <div className="live-inquiry-wrap">
      <table className="live-inquiry-table">
        <thead><tr><th>Row</th><th>Lot</th><th>Location</th><th>Src</th><th>Pri</th><th>On Hand</th><th>Review</th><th>Available</th><th /></tr></thead>
        <tbody>
          {[
            ['R1', '27.F1', 'D.26.000', 'LD', '1', quantity, '0', quantity],
            ['R2', '27.U1', 'F.07.000', 'LD', '-', '124', '0', '124'],
            ['R3', '27.F1', 'H.03.000', 'LD', '1', '94', '0', '94'],
          ].map((cells, index) => (
            <tr key={cells[0]} className={index === 0 ? 'is-current' : ''}>
              {cells.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}
              <td><button type="button" className="table-open" onClick={() => sandboxToast(`Row ${cells[0]} opened`)}>Open</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderTabContent = () => {
    if (activeTab === 'inquiry') return renderInquiry();
    if (activeTab === 'photos') {
      return (
        <div className="live-photo-grid">
          <button type="button" className="live-photo-action" onClick={() => sandboxToast('Test photo queued')}><Camera size={26} /><strong>Take Photo</strong><span>Sandbox upload queue</span></button>
          <div className="live-photo-slot"><ImageIcon size={28} /><strong>No Photo</strong><span>Front view</span></div>
          <div className="live-photo-slot"><ImageIcon size={28} /><strong>No Photo</strong><span>Tag / detail</span></div>
        </div>
      );
    }
    if (activeTab === 'notes' || activeTab === 'findings') {
      return (
        <div className="live-notes-layout">
          <label className="editable-field full"><span>{activeTab === 'findings' ? 'QC Findings' : 'Work Note'}</span><textarea value={note} onChange={event => setNote(event.target.value)} rows={5} placeholder="Add a test note..." /></label>
          <div className="status-history">{details.history.map(entry => <div key={`${entry.label}-${entry.value}`}><span>{entry.label}</span><strong>{entry.value}</strong></div>)}</div>
        </div>
      );
    }
    if (activeTab === 'history') {
      return <div className="status-history live-history">{details.history.map(entry => <div key={`${entry.label}-${entry.value}`}><span>{entry.label}</span><strong>{entry.value}</strong></div>)}</div>;
    }
    if (activeTab === 'edits') {
      return (
        <div className="live-detail-grid">
          <label className="editable-field"><span>DesigCust</span><input defaultValue="" placeholder="Exact row only" /></label>
          <label className="editable-field"><span>DesigItem</span><input defaultValue="" placeholder="Exact row only" /></label>
          <label className="editable-field"><span>DesigLoc</span><input defaultValue="" placeholder="Exact row only" /></label>
          <ReadOnlyField label="Update Scope" value="Selected unique row only" />
          <div className="safe-action-note full-span">Designation changes never propagate to linked rows.</div>
        </div>
      );
    }
    if (activeTab === 'customer' || activeTab === 'location' || activeTab === 'assignment' || activeTab === 'team') {
      return (
        <div className="live-detail-grid">
          <ReadOnlyField label={activeTab === 'customer' ? 'Customer / Consignee' : activeTab === 'location' ? 'Location' : activeTab === 'team' ? 'Checker' : 'Assigned To'} value={activeTab === 'customer' ? 'Coastal Landscape' : activeTab === 'location' ? row.meta : row.owner} />
          <ReadOnlyField label="Contact / Lead" value={row.owner} />
          <ReadOnlyField label="Route / Block" value={row.meta} />
          <ReadOnlyField label="Current Status" value={status} />
        </div>
      );
    }
    if (activeTab === 'items' || activeTab === 'stops' || activeTab === 'queue' || activeTab === 'modules' || activeTab === 'approval' || activeTab === 'shortage' || activeTab === 'moves' || activeTab === 'po' || activeTab === 'recounts' || activeTab === 'blocks' || activeTab === 'crop-roll' || activeTab === 'stock' || activeTab === 'availability' || activeTab === 'reports' || activeTab === 'columns' || activeTab === 'materials' || activeTab === 'mistakes') {
      return (
        <div className="live-subrow-list">
          {[1, 2, 3].map(index => (
            <button type="button" key={index} onClick={() => sandboxToast(`${tabs.find(tab => tab.id === activeTab)?.label} row ${index} opened`)}>
              <span className="live-subrow-index">{String(index).padStart(2, '0')}</span>
              <span><strong>{index === 1 ? row.title : `${tabs.find(tab => tab.id === activeTab)?.label} ${index}`}</strong><small>{index === 1 ? row.meta : `${row.meta} | Test row ${index}`}</small></span>
              <Chip tone={index === 2 ? 'warning' : row.tone} label={index === 2 ? 'Review' : status} />
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      );
    }
    return renderEditableSummary();
  };

  return (
    <section className="module-detail-flow live-parity-detail">
      <button className="inline-back" type="button" onClick={onBack}><ArrowLeft size={20} /> Back to {labelForView(view)}</button>
      <article className="live-detail-card">
        <header className="live-detail-head">
          <div className="live-detail-identity">
            <div className="module-media-frame compact"><div className="module-media-mark">{moduleIcon(view, 28)}</div><span>{mediaInitials(row.title)}</span></div>
            <div><span>{demoMode ? 'Test Data' : 'Workflow Detail'} - {labelForView(view)}</span><h1>{row.title}</h1><p>{row.meta}</p></div>
          </div>
          <div className="module-detail-status"><Chip tone={row.tone} label={status} /><strong>{quantity}</strong></div>
        </header>

        <nav className="live-detail-tabs" aria-label={`${labelForView(view)} detail sections`}>
          {tabs.map(tab => <button key={tab.id} type="button" className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
        </nav>

        <section className="live-detail-content" aria-live="polite">
          <div className="live-detail-section-title"><span>{tabs.find(tab => tab.id === activeTab)?.label}</span><small>Live-shaped sandbox workflow</small></div>
          {renderTabContent()}
        </section>

        <footer className="live-detail-actions">
          <button type="button" className="ghost-button" onClick={() => sandboxToast('Test save')}><Save size={18} /> Save</button>
          <button type="button" className="primary-button" onClick={() => sandboxToast('Test commit')}><CheckCircle2 size={18} /> Commit</button>
        </footer>
      </article>
    </section>
  );
}

function CommunicationView({ demoMode }: { demoMode: boolean }) {
  const threads = communicationThreads();
  const [activeFilter, setActiveFilter] = useState('all');
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const visibleThreads = activeFilter === 'all'
    ? threads
    : threads.filter(thread => activeFilter === 'unread' ? thread.unread : !thread.unread);
  const activeThread = threads.find(thread => thread.id === activeThreadId);
  if (activeThread) {
    return (
      <section className="module-workspace communication-workspace">
        <button className="inline-back" type="button" onClick={() => setActiveThreadId(null)}><ArrowLeft size={22} /> Back to Messages</button>
        <div className="message-thread-detail">
          <div className="message-thread-head">
            <div>
              <span>{demoMode ? 'Sandbox Messages' : 'Messages'}</span>
              <h1>{activeThread.title}</h1>
              <p>{activeThread.members}</p>
            </div>
            <Chip tone={activeThread.unread ? 'blue' : 'green'} label={activeThread.unread ? 'New' : 'Open'} />
          </div>
          <div className="message-list" aria-label={`${activeThread.title} messages`}>
            {activeThread.messages.map(message => (
              <article className="message-bubble" key={`${message.from}-${message.time}-${message.body}`}>
                <strong>{message.from}</strong>
                <p>{message.body}</p>
                <span>{message.time}</span>
              </article>
            ))}
          </div>
          <div className="safe-action-note">Test app only. Replies are not sent.</div>
        </div>
      </section>
    );
  }
  return (
    <section className="module-workspace communication-workspace">
      <div className="module-workspace-head">
        <div>
          <span>{demoMode ? 'Sandbox Messages' : 'Messages'}</span>
          <h1>Communication</h1>
        </div>
      </div>
      <div className="filter-rail module-filter-rail">
        <label className="filter-select compact">
          <span>Thread View</span>
          <select value={activeFilter} onChange={event => setActiveFilter(event.target.value)}>
            <option value="all">All Threads</option>
            <option value="unread">Unread</option>
            <option value="open">Open</option>
          </select>
          <ChevronDown size={18} />
        </label>
      </div>
      <div className="module-card-list">
        {visibleThreads.map(thread => (
          <button type="button" className="message-thread-card" key={thread.id} onClick={() => setActiveThreadId(thread.id)}>
            <div className="thread-avatar">{thread.title.slice(0, 2).toUpperCase()}</div>
            <div>
              <h2>{thread.title}</h2>
              <p>{thread.preview}</p>
              <span>{thread.members}</span>
            </div>
            <div className="message-thread-side">
              <strong>{thread.date}</strong>
              {thread.unread ? <Chip tone="blue" label="New" /> : <Chip tone="green" label="Open" />}
            </div>
          </button>
        ))}
      </div>
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

function moduleIcon(view: ViewId, size = 24) {
  const props = { size, strokeWidth: 2.2 };
  switch (view) {
    case 'drive':
    case 'docks':
      return <Truck {...props} />;
    case 'tasks':
    case 'request':
      return <ClipboardList {...props} />;
    case 'comm':
      return <MessageCircle {...props} />;
    case 'bloom':
      return <ShoppingBag {...props} />;
    case 'inventory':
    case 'office':
      return <Store {...props} />;
    case 'managers':
      return <UserRound {...props} />;
    case 'sales':
      return <Handshake {...props} />;
    case 'building':
      return <Hammer {...props} />;
    case 'qc':
      return <ShieldCheck {...props} />;
    case 'production':
      return <Leaf {...props} />;
    case 'reports':
      return <BarChart3 {...props} />;
    default:
      return <Boxes {...props} />;
  }
}

function moduleWorkflowLabel(view: ViewId) {
  return ({
    drive: 'Inventory item workflow',
    docks: 'Dock, stop, and drop-off workflow',
    tasks: 'Task and AV blank workflow',
    comm: 'Field message workflow',
    bloom: 'Bloom picker workflow',
    inventory: 'Inventory hub workflow',
    managers: 'Manager review workflow',
    sales: 'Sales note workflow',
    building: 'Building task workflow',
    qc: 'Quality control workflow',
    office: 'Office workflow',
    production: 'Production workflow',
    reports: 'Reporting workflow',
    request: 'Request queue workflow',
    home: 'Module dashboard'
  } as Record<ViewId, string>)[view];
}

function moduleActionsForView(view: ViewId) {
  return ({
    drive: ['Save inventory note', 'Mark pull ready', 'Open item inquiry'],
    docks: ['Save stop status', 'Mark loaded', 'Flag mistake'],
    tasks: ['Save task note', 'Complete task', 'Assign reviewer'],
    comm: ['Send test reply', 'Mark read', 'Add participant'],
    bloom: ['Save order note', 'Mark picked', 'Retry photo match'],
    inventory: ['Save inventory note', 'Start recount', 'Open PO review'],
    managers: ['Approve test row', 'Request changes', 'Assign manager'],
    sales: ['Save sales note', 'Create follow up', 'Mark reviewed'],
    building: ['Save work note', 'Mark repaired', 'Escalate'],
    qc: ['Save QC note', 'Pass review', 'Create NCR'],
    office: ['Save office note', 'Export test file', 'Mark reviewed'],
    production: ['Save production note', 'Clear block', 'Flag hold risk'],
    reports: ['Run test export', 'Save report note', 'Mark reviewed'],
    request: ['Save request note', 'Complete request', 'Retry upload'],
    home: ['Open module']
  } as Record<ViewId, string[]>)[view];
}

function liveShapedDetailFor(view: ViewId, row: ModulePreviewRow) {
  const defaultFields = [
    { label: 'Module', value: labelForView(view) },
    { label: 'Owner', value: row.owner },
    { label: 'Status', value: row.status },
    { label: 'Rows / Qty', value: row.quantity },
    { label: 'Reference', value: row.meta },
    { label: 'Workflow', value: moduleWorkflowLabel(view) },
    { label: 'Data Mode', value: 'Live-shaped fixture' },
    { label: 'Write Mode', value: 'Sandbox only' }
  ];
  const defaultNotes = [
    `Review ${row.title} using the same field flow as the live app, without touching production data.`,
    'All save, complete, upload, remove, and message actions are local test actions in v2.'
  ];
  const defaultHistory = [
    { label: 'Loaded', value: 'Fixture data' },
    { label: 'Last Sync', value: 'Test mode' },
    { label: 'Safety', value: 'No emails or production writes' }
  ];
  return {
    fields: row.detail?.fields?.length ? row.detail.fields : defaultFields,
    notes: row.detail?.notes?.length ? row.detail.notes : defaultNotes,
    history: row.detail?.history?.length ? row.detail.history : defaultHistory,
    actions: row.detail?.actions?.length ? row.detail.actions : moduleActionsForView(view)
  };
}

function modulePreviewRows(view: ViewId): ModulePreviewRow[] {
  const base: Record<ViewId, ModulePreviewRow[]> = {
    home: [],
    request: [],
    drive: [
      { title: 'Acoma Crapemyrtle', meta: '003746.030.1 | H.03.000 | Lot 27.F1 | #3', owner: 'Kayla Knepp', status: 'Available', quantity: '94', tone: 'green' },
      { title: 'Dawn Redwood', meta: 'B.13.012 | Lot 27.S1 | #3 Lavender', owner: 'Abbey Burka', status: 'Request', quantity: '44', tone: 'blue' },
      { title: 'Compact Andorra Juniper', meta: '001360.050.1 | K.03.000 | Lot 27.U2 | #5', owner: 'JD Jones', status: 'Hold Check', quantity: '235', tone: 'warning' },
      { title: 'Big Blue Liriope', meta: '004350.010.1 | E.07.000 | Lot 26.U2 | #1', owner: 'Kayla Knepp', status: 'AV Check', quantity: '939', tone: 'purple' },
      { title: 'Madame Rosy Trumpet Creeper', meta: '002134.011.1 | E.23.000 | Lot 27.F1 | #1D', owner: 'Mitch Kaiser', status: 'Shear', quantity: '323', tone: 'orange' }
    ],
    tasks: [
      { title: 'AV Blanks - Block A', meta: 'Current Season | All Sizes | All Genus', owner: 'Dylan Collyge', status: 'Active', quantity: '45 items', tone: 'green' },
      { title: 'AV Blanks - Block B', meta: 'Current Season | All Sizes | All Genus', owner: 'Dylan Collyge', status: 'Active', quantity: '84 items', tone: 'green' },
      { title: 'AV Blanks - Block C', meta: 'Current Season | All Sizes | All Genus', owner: 'Dylan Collyge', status: 'Active', quantity: '201 items', tone: 'green' },
      { title: 'Photo, spec, and PRI check', meta: 'Big Blue Liriope | E.07.000 | Lot 26.U2', owner: 'Kayla Knepp', status: 'Open', quantity: '939', tone: 'blue' },
      { title: 'Hold risk review', meta: 'Compact Andorra Juniper | K.03.000 | Lot 27.U2', owner: 'JD Jones', status: 'Hold', quantity: '235', tone: 'warning' }
    ],
    docks: [
      { title: 'Dock 34', meta: 'Checker / inspector pending', owner: 'Tracey Tapscott', status: 'Loading', quantity: '85 items', tone: 'blue' },
      { title: 'Stop 60 - Dothan Nurseries', meta: 'AL route | Open stop', owner: 'Toby Brown', status: 'Open Stop', quantity: '27 rows', tone: 'green' },
      { title: 'Stop 42 - Oakland Garden Center', meta: 'TN route | Open stop', owner: 'Annette Hancock', status: 'Open Stop', quantity: '14 rows', tone: 'green' },
      { title: 'Mistake Review', meta: 'Customer and lot mismatch', owner: 'Mitch Kaiser', status: 'Needs Review', quantity: '1', tone: 'warning' },
      { title: 'Drop Off', meta: 'Completed stop review', owner: 'Dock Team', status: 'Ready', quantity: '3 stops', tone: 'blue' }
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
      { title: 'Task', meta: 'Inventory task launcher', owner: 'Inventory Office', status: 'Hub', quantity: 'Open', tone: 'green' },
      { title: 'Drive Mode', meta: 'Common name / location / card inventory', owner: 'Field Team', status: 'Current', quantity: '3,745 items', tone: 'blue' },
      { title: 'Crop Roll', meta: 'Blocks A through F', owner: 'Inventory Office', status: 'Current', quantity: '674 rows', tone: 'green' },
      { title: 'PO Management', meta: 'HL PO 27F1', owner: 'Managers', status: 'Built', quantity: '234 rows', tone: 'blue' },
      { title: 'Inventory Office', meta: 'Location moves and recount review', owner: 'Office', status: 'Open', quantity: '22 rows', tone: 'warning' },
      { title: 'Weather & Hold Risk', meta: 'Heat sensitive rows', owner: 'Grower Team', status: 'Watch', quantity: '9', tone: 'warning' }
    ],
    managers: [
      { title: 'Approval', meta: 'Shear approvals and NCR approvals', owner: 'Dylan Collyge', status: 'Active', quantity: '2 queues', tone: 'green' },
      { title: 'Crop Roll', meta: 'Manager crop roll review', owner: 'Grower Team', status: 'Open', quantity: '674 rows', tone: 'green' },
      { title: 'Move', meta: 'Location move approvals', owner: 'Managers', status: 'Review', quantity: '1', tone: 'warning' },
      { title: 'Season', meta: 'Current season setup', owner: 'Office', status: 'Current', quantity: 'F1', tone: 'blue' },
      { title: 'AV Blanks', meta: 'Blocks A through F task review', owner: 'Dylan Collyge', status: 'Active', quantity: '6 blocks', tone: 'green' },
      { title: 'Shortage / Cancel', meta: 'Dylan only shortage/cancel dashboard', owner: 'Managers', status: 'Clean', quantity: '0 net', tone: 'blue' },
      { title: 'Transaction History', meta: 'Recent inventory changes', owner: 'Managers', status: 'Search', quantity: 'Today', tone: 'purple' },
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

function slugifyFilter(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'open';
}

function rowFilterId(row: ModulePreviewRow) {
  return slugifyFilter(row.filter || row.status || 'Open');
}

function moduleFilterOptions(rows: ModulePreviewRow[]): ModuleFilter[] {
  const options: ModuleFilter[] = [{ id: 'all', label: 'All Rows' }];
  const seen = new Set<string>();
  rows.forEach(row => {
    const label = row.filter || row.status || 'Open';
    const id = slugifyFilter(label);
    if (!seen.has(id)) {
      seen.add(id);
      options.push({ id, label });
    }
  });
  return options;
}

function communicationThreads(): MessageThread[] {
  return [
    {
      id: 'kayla-photo',
      title: 'kayla_knepp',
      preview: 'screen shot please, text it to my phone',
      date: 'Jul 2',
      members: '2 members',
      unread: true,
      messages: [
        { from: 'kayla_knepp', body: 'I cannot see the request rows on iPhone after opening Que.', time: '8:13 AM' },
        { from: 'dylan_collyge', body: 'Send a screenshot and the itemcode. We will keep this in the sandbox until it is fixed.', time: '8:17 AM' },
        { from: 'kayla_knepp', body: 'screen shot please, text it to my phone', time: 'Jul 2' }
      ]
    },
    {
      id: 'dock-status',
      title: 'tony_bono',
      preview: 'Will get shortly.',
      date: 'Jun 15',
      members: '2 members',
      messages: [
        { from: 'dylan_collyge', body: 'Can you confirm Dock 34 checker and inspector status?', time: '9:28 AM' },
        { from: 'tony_bono', body: 'Will get shortly.', time: 'Jun 15' }
      ]
    },
    {
      id: 'customer-cards',
      title: 'megan_kelly',
      preview: 'Customer card cleanup is ready for review.',
      date: 'May 20',
      members: '3 members',
      unread: true,
      messages: [
        { from: 'megan_kelly', body: 'Customer card cleanup is ready for review.', time: 'May 20' },
        { from: 'dylan_collyge', body: 'Keep this in test mode. No emails should send from v2.', time: 'May 20' }
      ]
    },
    {
      id: 'manager-approval',
      title: 'mitch_kaiser',
      preview: 'Approval queue needs shear and NCR examples.',
      date: 'May 7',
      members: '4 members',
      messages: [
        { from: 'mitch_kaiser', body: 'Approval queue needs shear and NCR examples.', time: 'May 7' },
        { from: 'jd_jones', body: 'Grower review should be card view on phones and grid on larger screens.', time: 'May 7' }
      ]
    }
  ];
}

function tabLabel(tab: TabId) {
  return tabs.find(item => item.id === tab)?.label || 'Request';
}

function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}
