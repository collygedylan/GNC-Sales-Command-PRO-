export interface AuraWidgetHandle {
  getVoicePreference(): string;
  setVoicePreference(value: string): Promise<string>;
  openVoice(text?: string): boolean;
  destroy(): void;
  getHandsFreeAutoStart(): boolean;
  setHandsFreeAutoStart(enabled: boolean): boolean;
}

export interface AuraWidgetOptions {
  initialVoiceName?: string;
  voiceEngine?: string;
  onVoicePreferenceChange?: () => void;
  onVoiceActivity?: (active: boolean) => void;
  onPanelOpenChange?: (open: boolean) => void;
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
