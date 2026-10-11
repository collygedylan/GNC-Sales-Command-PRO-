import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useRef } from 'react';
import { mountAuraWidget, type AuraWidgetOptions } from './auraVoiceWidget.js';

function AuraWidgetOwner({ options, onWidget }: { options: AuraWidgetOptions; onWidget: (widget: ReturnType<typeof mountAuraWidget> | null) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || options.isAuthorized?.() !== true) return;
    const widget = mountAuraWidget({ ...options, host });
    onWidget(widget);
    options.onReady?.();
    return () => { widget.destroy(); onWidget(null); };
  }, [options]);
  return <div ref={hostRef} data-aura-react-owner="true" />;
}

export type AuraReactMount = {
  getHandsFreeAutoStart(): boolean;
  setHandsFreeAutoStart(enabled: boolean): boolean;
  destroy(): void;
};

/** React owns the lifetime of the existing widget and its single voice session. */
export function mountAuraWidgetReact(host: HTMLElement, options: AuraWidgetOptions): AuraReactMount {
  if (!host || typeof options?.isAuthorized !== 'function' || !options.isAuthorized()) return {
    getHandsFreeAutoStart() { return false; },
    setHandsFreeAutoStart() { return false; },
    destroy() {},
  };
  let root: Root | null = createRoot(host);
  let widget: ReturnType<typeof mountAuraWidget> | null = null;
  const onWidget = (value: ReturnType<typeof mountAuraWidget> | null) => { widget = value; };
  root.render(<AuraWidgetOwner options={options} onWidget={onWidget} />);
  return {
    getHandsFreeAutoStart() { return widget?.getHandsFreeAutoStart() ?? false; },
    setHandsFreeAutoStart(enabled) { return widget?.setHandsFreeAutoStart(enabled) ?? false; },
    destroy() {
      root?.unmount();
      root = null;
      widget = null;
      host.replaceChildren();
    },
  };
}
