export type CountingType = 'bunch' | 'spread';

export type CountingLotRow = {
  sourceUid: string;
  block: string;
  location: string;
  itemcode: string;
  commonname: string;
  contsize: string;
  lotcode: string;
  season: string;
  onHand: string | null;
};

export type CountRow = {
  sourceUid: string;
  countedQty: number | null;
  direction: string;
  rowOrder: number;
  note: string;
  updatedAt: string;
  actor: string;
};

export type CountingOption = { value: string; label: string; rowCount: number };

export type FieldCountingQuery = {
  countType: CountingType;
  block?: string;
  location?: string;
  page?: number;
  signal?: AbortSignal;
};

export type FieldCountingSnapshot = {
  datasetRevision: string;
  masterRevision: string;
  rows: CountingLotRow[];
  counts: CountRow[];
  options: CountingOption[];
  page: number;
  total: number;
  complete: boolean;
};

export type FieldCountingMutationEntry = {
  sourceUid: string;
  countedQty: number;
  note: string;
  expectedUpdatedAt: string | null;
  rowOrder: number;
};

export type FieldCountingMutation = {
  countType: CountingType;
  scope: { block: string; location: string };
  direction: string;
  entries: FieldCountingMutationEntry[];
  idempotencyKey: string;
};

export type FieldCountingReceipt = {
  revision: string;
  savedSourceUids: string[];
  reportId?: string;
  deliveryStatus?: 'queued';
};

export type FieldCountingBridge = {
  scopeKey: string;
  countType: CountingType;
  revisionKey: string;
  onRevision?(countType: CountingType, revision: string): void;
  readSnapshot(query: FieldCountingQuery): Promise<FieldCountingSnapshot>;
  saveCounts(input: FieldCountingMutation): Promise<FieldCountingReceipt>;
  completeAndEmail(input: FieldCountingMutation): Promise<FieldCountingReceipt>;
};
