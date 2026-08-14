export type AppRuntimeConfig = {
  environment: 'sandbox';
  projectRef: string;
  supabaseUrl: string;
  publishableKey: string;
  testData: true;
  productionProjectRef: string;
};

export type DataSource = 'sandbox' | 'cache';

export type InventoryRow = Record<string, unknown> & {
  unique_id: string | number;
  itemcode?: string;
  commonname?: string;
  contsize?: string;
  locationcode?: string;
  lotcode?: string;
  saleyear?: number | string;
  blockalpha?: string;
  blocknumber?: number | string;
  ptravailable?: number;
  ptronhand?: number;
  ptrreviewed?: number;
  holdstopcode?: string;
  source_payload?: Record<string, unknown>;
};

export type WorkflowRow = {
  id: string;
  moduleKey: string;
  title: string;
  subtitle?: string;
  owner?: string;
  status?: string;
  count?: number;
  itemcode?: string;
  locationcode?: string;
  lotcode?: string;
  detail?: Record<string, unknown>;
};

export type RequestRow = Record<string, unknown> & {
  unique_id?: string | number;
  COMMONNAME?: string;
  commonname?: string;
  LOCATIONCODE?: string;
  locationcode?: string;
  LOTCODE?: string;
  lotcode?: string;
  CONTSIZE?: string;
  contsize?: string;
};

export type AvOptionRow = InventoryRow & {
  normalizedItemcode: string;
};

export type UploadJob = {
  id: string;
  requestId: string;
  fileName: string;
  state: 'queued' | 'uploading' | 'retrying' | 'uploaded' | 'failed';
  attempts: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type UserPreferences = {
  username: string;
  theme: 'light' | 'dark';
  displayMode: 'cards' | 'grid';
  requestColumns: string[];
  updatedAt: string;
};

export type PageResult<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  source: DataSource;
};
