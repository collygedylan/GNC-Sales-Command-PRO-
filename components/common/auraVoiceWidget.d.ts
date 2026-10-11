export interface AuraWidgetHandle {
  destroy(): void;
  getHandsFreeAutoStart(): boolean;
  setHandsFreeAutoStart(enabled: boolean): boolean;
}

export interface AuraWidgetOptions {
  host?: HTMLElement;
  userId?: string;
  handsFreeAutostart?: boolean;
  onHandsFreePreferenceChange?: (enabled: boolean) => void;
  isAuthorized?: () => boolean;
  requestAssistant?: (body: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown>;
  onReady?: () => void;
  [key: string]: unknown;
}

export function mountAuraWidget(options?: AuraWidgetOptions): AuraWidgetHandle;
