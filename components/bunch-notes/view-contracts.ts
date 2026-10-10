export type BunchAccountRevision = {
  accountKey: string;
  revisionKey: string;
};

export type StructuredBunchNoteProps = BunchAccountRevision & {
  value: unknown;
  mode: string;
  disabled?: boolean;
  progress?: Record<string, { status?: string }>;
  onChange?: (value: unknown) => void;
  onDetails?: (actionId: string) => void;
  onWork?: (actionId: string) => void;
};

export type BunchCardRecord = Record<string, unknown>;

export type BunchCardBoardProps = BunchAccountRevision & {
  rows: BunchCardRecord[];
  locations: BunchCardRecord[];
  users: BunchCardRecord[];
  busy?: boolean;
  viewState?: Record<string, unknown>;
  onViewState?: (value: Record<string, unknown>) => void;
  onCardChange?: (...args: unknown[]) => unknown;
  onMove?: (...args: unknown[]) => unknown;
  onLocationInstructions?: (...args: unknown[]) => unknown;
  onSave?: (...args: unknown[]) => unknown;
};

export type BunchViewMount<T> = {
  update(next: T): void;
  destroy(): void;
};
