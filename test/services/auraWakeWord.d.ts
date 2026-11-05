export type WakeWordController = { startFromGesture(): boolean; stop(): void; setSuspended(value: boolean): void; destroy(): void; supported: boolean; enabled: boolean };
export function createWakeWordController(options?: { getRecognition?: () => unknown; isAuthorized?: () => boolean; isVisible?: () => boolean;
  onWake?: (remainder: string, metadata: { completed: boolean }) => unknown; onState?: (state: { enabled: boolean; state: string; supported: boolean }) => void }): WakeWordController;
