import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useRef } from 'react';
import { mountAuraWidget, type AuraWidgetOptions } from './auraVoiceWidget.js';
import { WakeWordProvider } from './WakeWordProvider';
import type { WakeWordController } from '../../services/auraWakeWord.js';

function AuraWidgetOwner({ options, onWidget }: { options: AuraWidgetOptions; onWidget: (widget: ReturnType<typeof mountAuraWidget> | null) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<ReturnType<typeof mountAuraWidget> | null>(null);
  const wakeRef = useRef<WakeWordController | null>(null);
  const activityRef = useRef({ panel: false, voice: false });
  const authorized = useCallback(() => Boolean(widgetRef.current && options.isAuthorized?.()), [options]);
  const onWake = useCallback((text: string) => widgetRef.current?.openVoice(text), []);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || options.isAuthorized?.() !== true) return;
    const widget = mountAuraWidget({ ...options, host,
      onPanelOpenChange: open => { activityRef.current.panel = open; wakeRef.current?.setSuspended(open || activityRef.current.voice); options.onPanelOpenChange?.(open); },
      onVoiceActivity: active => { activityRef.current.voice = active; wakeRef.current?.setSuspended(active || activityRef.current.panel); options.onVoiceActivity?.(active); },
    });
    widgetRef.current = widget;
    onWidget(widget);
    options.onReady?.();
    return () => { widgetRef.current = null; widget.destroy(); onWidget(null); };
  }, [options]);
  return <WakeWordProvider controllerRef={wakeRef} isAuthorized={authorized} onWake={onWake}><div ref={hostRef} data-aura-react-owner="true" /></WakeWordProvider>;
}

export type AuraReactMount = {
  getVoicePreference(): string;
  setVoicePreference(value: string): Promise<string>;
  getHandsFreeAutoStart(): boolean;
  setHandsFreeAutoStart(enabled: boolean): boolean;
  destroy(): void;
};

/** React owns the lifetime of the existing widget and its single voice session. */
export function mountAuraWidgetReact(host: HTMLElement, options: AuraWidgetOptions): AuraReactMount {
  if (!host || typeof options?.isAuthorized !== 'function' || !options.isAuthorized()) return {
    getVoicePreference() { return 'Kore'; },
    setVoicePreference() { return Promise.reject(new Error('Sign in with your active account.')); },
    getHandsFreeAutoStart() { return false; },
    setHandsFreeAutoStart() { return false; },
    destroy() {},
  };
  let root: Root | null = createRoot(host);
  let widget: ReturnType<typeof mountAuraWidget> | null = null;
  const onWidget = (value: ReturnType<typeof mountAuraWidget> | null) => { widget = value; };
  root.render(<AuraWidgetOwner options={options} onWidget={onWidget} />);
  return {
    getVoicePreference() { return widget?.getVoicePreference() ?? 'Kore'; },
    setVoicePreference(value) { return widget?.setVoicePreference(value) ?? Promise.reject(new Error('AURA is still loading.')); },
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
