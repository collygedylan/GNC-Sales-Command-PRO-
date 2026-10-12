import { useEffect, useState, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createWakeWordController, type WakeWordController } from '../../services/auraWakeWord.js';
export function WakeWordProvider({ children, controllerRef, isAuthorized, onWake }: { children: ReactNode;
  controllerRef: MutableRefObject<WakeWordController | null>; isAuthorized: () => boolean; onWake: (text: string) => unknown }) {
  const [state, setState] = useState({ enabled: false, state: 'off', supported: false });
  useEffect(() => {
    const controller = createWakeWordController({ isAuthorized, onWake: (text, metadata) => onWake(metadata.completed ? text : ''), onState: setState });
    controllerRef.current = controller;
    setState({ enabled: false, state: 'off', supported: controller.supported });
    return () => { controller.destroy(); controllerRef.current = null; };
  }, [controllerRef, isAuthorized, onWake]);
  const host = document.getElementById('aura-standby-control');
  const note = state.state === 'permission-denied' ? 'Microphone permission denied. Enable access to use Standby Mode.'
    : !state.supported ? 'Standby Mode is unavailable in this browser.' : `Standby Mode: ${state.enabled ? 'On' : 'Off'}`;
  return <>{children}{host && createPortal(<>
    <button type="button" className="nav-outdoor-toggle" aria-label={note} title={note} aria-pressed={state.enabled} disabled={!state.supported}
      onClick={() => state.enabled ? controllerRef.current?.stop() : controllerRef.current?.startFromGesture()}>🎙</button>
    <span role="status" className="sr-only">{note}</span>
  </>, host)}</>;
}
