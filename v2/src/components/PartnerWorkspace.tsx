import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';

export type PartnerView = 'av' | 'orders';

export function partnerWorkspaceUrl(view: PartnerView, embedded = true) {
  return `partner/nursery/?${embedded ? 'embedded=1&' : ''}view=${view}`;
}

export function isPartnerReady(event: MessageEvent, frame: Window | null, origin: string) {
  return Boolean(frame && event.source === frame && event.origin === origin &&
    event.data && typeof event.data === 'object' && event.data.type === 'bloomscapes:ready');
}

/** The shell never passes its prototype session into the authenticated partner app. */
export function PartnerWorkspace({ view }: { view: PartnerView }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const url = partnerWorkspaceUrl(view);

  useEffect(() => {
    setState('loading');
    const timer = window.setTimeout(() => setState(current => current === 'ready' ? current : 'failed'), 20_000);
    const onMessage = (event: MessageEvent) => {
      if (isPartnerReady(event, frameRef.current?.contentWindow || null, window.location.origin)) {
        window.clearTimeout(timer);
        setState('ready');
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
  }, [view, attempt]);

  return (
    <section className="partner-workspace" aria-labelledby="partner-heading">
      <header className="partner-intro">
        <div>
          <span className="partner-demo-label">Synthetic partnership · Test inventory</span>
          <h1 id="partner-heading">{view === 'av' ? 'Nursery AV' : 'BloomScapes orders'}</h1>
          <p>Separate native nursery sign-in required. The AgMetric test profile does not grant access.</p>
        </div>
        <nav className="partner-links" aria-label="BloomScapes demo experiences">
          <a className="partner-open-link" href={partnerWorkspaceUrl(view, false)} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" /> Open full page
          </a>
          <a className="partner-open-link" href="https://bloomscapes-nursery-demo.dylancollyge.chatgpt.site/shop" target="_blank" rel="noopener noreferrer">Storefront</a>
          <a className="partner-open-link" href="https://bloomscapes-nursery-demo.dylancollyge.chatgpt.site/operations/" target="_blank" rel="noopener noreferrer">Retailer operations</a>
        </nav>
      </header>
      <div className="partner-frame-wrap" aria-busy={state === 'loading'}>
        <iframe
          key={`${view}:${attempt}`}
          ref={frameRef}
          title="BloomScapes nursery workspace"
          src={url}
          className={`partner-frame ${state === 'ready' ? 'partner-frame-ready' : ''}`}
          referrerPolicy="same-origin"
          onError={() => setState('failed')}
        />
        {state !== 'ready' ? (
          <div className="partner-frame-status" role={state === 'failed' ? 'alert' : 'status'}>
            {state === 'loading' ? <Loader2 className="spin" size={24} aria-hidden="true" /> : null}
            <strong>{state === 'loading' ? 'Opening the secure nursery workspace…' : 'The nursery workspace could not be opened.'}</strong>
            <p>{state === 'loading' ? 'Your nursery account is checked inside the workspace.' : 'Check your connection, then retry or open the full-page workspace. No action has been submitted by this shell.'}</p>
            {state === 'failed' ? <button type="button" className="ghost-button" onClick={() => { setState('loading'); setAttempt(current => current + 1); }}><RefreshCw size={16} aria-hidden="true" /> Retry workspace</button> : null}
            <a href={partnerWorkspaceUrl(view, false)} target="_blank" rel="noopener noreferrer">Open full-page nursery workspace</a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
