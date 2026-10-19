export type BunchPerson = { id: string; username: string; display_name: string };
export type BunchSource = { row_id: string; location: string; lot: string; ptravailable: number | null; actual_qty: number | null };
export type BunchWorkCard = {
  stablecard_id: string; job_id: string; card_id: string; revision: number; job_revision: number;
  status: 'open' | 'complete' | 'cancelled'; can_complete: boolean;
  itemcode: string; variety: string; contsize: string; source_location: string; lot: string;
  ptravailable: number | null; action: string; destination: string; notes: string;
  assignees: BunchPerson[]; sources: BunchSource[];
};
export type BunchReview = {
  id: string; revision: number; status: string; job_id: string; card_id: string;
  itemcode: string; variety: string; contsize: string; source_location: string; destination: string;
  completed_by: string; actual_qty: number; ptravailable: number | null; variance: number | null;
  sources: BunchSource[]; assigned_counter_id: string | null; assigned_counter_username: string | null;
  recount_qty: number | null; can_assign: boolean; can_complete: boolean;
};
export type BunchAssigneeOption = BunchPerson & { count: number };
export type BunchQueuePage = {
  cards: BunchWorkCard[]; total: number; active_count: number; review_count: number; can_review: boolean; counters: BunchPerson[];
  /** Counts span all authorized active cards, independent of this page/filter. */
  assignee_options: BunchAssigneeOption[]; unassigned_count: number;
};
export type BunchReviewPage = { reviews: BunchReview[]; total: number; review_count: number; can_review: boolean; counters: BunchPerson[] };
export type BunchQueueFilter = 'mine' | 'all' | 'completed' | 'unassigned' | `assignee:${string}`;
export type BunchMutation = {
  operation: 'complete_card' | 'assign_counter' | 'complete_recount';
  payload: Record<string, unknown>; commandId: string; expectedRevision: number; target: string;
};
export type BunchQueueTransport = (payload: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
