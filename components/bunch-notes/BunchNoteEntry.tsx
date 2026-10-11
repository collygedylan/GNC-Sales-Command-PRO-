import React, { Component, Suspense, lazy, useEffect, useMemo, useState, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import useSWR, { SWRConfig, type Cache, type State } from 'swr';
import type { BunchCardBoardProps, BunchViewMount, StructuredBunchNoteProps } from './view-contracts';

type StructuredViewProps = Omit<StructuredBunchNoteProps, 'accountKey' | 'revisionKey'>;
type CardBoardViewProps = Omit<BunchCardBoardProps, 'accountKey' | 'revisionKey'>;
type ViewProps =
  | { kind: 'structured'; props: StructuredViewProps }
  | { kind: 'cards'; props: CardBoardViewProps };

const STRUCTURED_CHUNK_PATH = '__BUNCH_STRUCTURED_CHUNK__';
const CARD_BOARD_CHUNK_PATH = '__BUNCH_CARD_BOARD_CHUNK__';
let structuredLoadAttempt = 0;
let cardLoadAttempt = 0;
function isComponentType<P extends object>(value: unknown): value is ComponentType<P> {
  return typeof value === 'function';
}

async function importView<P extends object>(chunkPath: string, attempt: number, exportName: string): Promise<ComponentType<P>> {
  const retryToken = attempt ? `?retry=${attempt}` : '';
  const module: Record<string, unknown> = await import(new URL(`${chunkPath}${retryToken}`, import.meta.url).href);
  const view = module[exportName];
  if (!isComponentType<P>(view)) throw new Error(`Bunch view export ${exportName} is missing.`);
  return view;
}

const lazyStructured = () => lazy(async () => {
  const view = await importView<StructuredViewProps>(STRUCTURED_CHUNK_PATH, structuredLoadAttempt++, 'StructuredBunchNote');
  return { default: view };
});
const lazyCards = () => lazy(async () => {
  const view = await importView<CardBoardViewProps>(CARD_BOARD_CHUNK_PATH, cardLoadAttempt++, 'BunchNoteCardBoard');
  return { default: view };
});

// Keep the lazy payloads at module scope so multiple mounted Bunch hosts share
// one import result. Retry replaces only the rejected lazy payload.
const moduleLevelStructured = lazyStructured();
const moduleLevelCards = lazyCards();

class RecoverableViewBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (this.state.failed) return <div className="bn-view-load-error" role="alert">
      <span>The Bunch Notes view could not load.</span>
      <button type="button" onClick={this.props.onRetry}>Retry view</button>
    </div>;
    return this.props.children;
  }
}

function RetryableView<P extends object>({ props, initialView, createView }: {
  props: P;
  initialView: LazyExoticComponent<ComponentType<P>>;
  createView: () => LazyExoticComponent<ComponentType<P>>;
}) {
  const [generation, setGeneration] = useState(0);
  const [View, setView] = useState<LazyExoticComponent<ComponentType<P>>>(() => initialView);
  const retry = () => {
    setView(() => createView());
    setGeneration(value => value + 1);
  };
  return <RecoverableViewBoundary key={generation} onRetry={retry}>
    <Suspense fallback={<p className="bn-view-loading" role="status">Loading Bunch Notes…</p>}>
      {React.createElement(View, props)}
    </Suspense>
  </RecoverableViewBoundary>;
}

function LazyView({ kind, props }: ViewProps) {
  if (kind === 'structured') return <RetryableView
    props={props}
    initialView={moduleLevelStructured}
    createView={lazyStructured}
  />;
  return <RetryableView
    props={props}
    initialView={moduleLevelCards}
    createView={lazyCards}
  />;
}

type StructuredSnapshot = { kind: 'structured'; value: unknown; progress: NonNullable<StructuredViewProps['progress']> };
type CardsSnapshot = { kind: 'cards'; rows: BunchCardBoardProps['rows']; locations: BunchCardBoardProps['locations']; users: BunchCardBoardProps['users'] };
type ViewSnapshot = StructuredSnapshot | CardsSnapshot;

function AuthoritativeView({ view, accountKey, revisionKey }: {
  view: ViewProps;
  accountKey: string;
  revisionKey: string;
}) {
  const key = ['bunch-note-view', accountKey, revisionKey] as const;
  const snapshot = useMemo<ViewSnapshot>(() => view.kind === 'structured'
    ? { kind: 'structured', value: view.props.value, progress: view.props.progress || {} }
    : { kind: 'cards', rows: view.props.rows, locations: view.props.locations, users: view.props.users },
  [view]);
  const { data, mutate } = useSWR<ViewSnapshot>(key, null, {
    fallbackData: snapshot,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    keepPreviousData: false
  });

  // The legacy bridge remains the authoritative reader. SWR only caches its
  // account/revision snapshot and never starts a second database request.
  useEffect(() => { void mutate(snapshot, { revalidate: false }); }, [snapshot, mutate]);

  if (view.kind === 'structured') {
    const current: StructuredSnapshot = data?.kind === 'structured' ? data
      : snapshot.kind === 'structured' ? snapshot
        : { kind: 'structured', value: view.props.value, progress: view.props.progress || {} };
    return <LazyView kind="structured" props={{ ...view.props, value: current.value, progress: current.progress }} />;
  }

  const current: CardsSnapshot = data?.kind === 'cards' ? data
    : snapshot.kind === 'cards' ? snapshot
      : { kind: 'cards', rows: view.props.rows, locations: view.props.locations, users: view.props.users };
  return <LazyView kind="cards" props={{ ...view.props, rows: current.rows, locations: current.locations, users: current.users }} />;
}

function BunchViewRoot({ view, accountKey, revisionKey }: {
  view: ViewProps;
  accountKey: string;
  revisionKey: string;
}) {
  const provider = useMemo(() => {
    const cache: Cache = new Map<string, State>();
    return () => cache;
  }, [accountKey]);
  const config = useMemo(() => ({ provider }), [provider]);
  return <SWRConfig value={config}>
    <AuthoritativeView view={view} accountKey={accountKey} revisionKey={revisionKey} />
  </SWRConfig>;
}

function mountView<T extends { accountKey: string; revisionKey: string }>(
  host: HTMLElement,
  initial: T,
  render: (props: T) => ReactNode
): BunchViewMount<T> {
  let root: Root | null = createRoot(host);
  let destroyed = false;
  const draw = (props: T) => {
    if (!root || destroyed) return;
    root.render(render(props));
  };
  draw(initial);
  return {
    update(next) { if (host.isConnected) draw(next); else this.destroy(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root?.unmount();
      root = null;
      host.replaceChildren();
    }
  };
}

export function mountStructuredBunchNote(host: HTMLElement, props: StructuredBunchNoteProps): BunchViewMount<StructuredBunchNoteProps> {
  return mountView(host, props, next => {
    const { accountKey, revisionKey, ...viewProps } = next;
    return <BunchViewRoot key={accountKey} view={{ kind: 'structured', props: viewProps }} accountKey={accountKey} revisionKey={revisionKey} />;
  });
}

export function mountBunchNoteCards(host: HTMLElement, props: BunchCardBoardProps): BunchViewMount<BunchCardBoardProps> {
  return mountView(host, props, next => {
    const { accountKey, revisionKey, ...viewProps } = next;
    return <BunchViewRoot key={accountKey} view={{ kind: 'cards', props: viewProps }} accountKey={accountKey} revisionKey={revisionKey} />;
  });
}

export const mountBunchCardBoard = mountBunchNoteCards;
