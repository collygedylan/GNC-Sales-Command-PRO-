export type BunchPdfRecord = { job_id: string; filename: string; base64: string };
export type BunchPdfRpcResult = { data: unknown; error: { message?: string; code?: string } | null };
export type BunchPdfRpc = (name: "bunch_note_delivery_lookup_v1" | "bunch_note_freeze_pdfs_v1", args: Record<string, unknown>) => Promise<BunchPdfRpcResult>;
export type BunchPdfRenderer = (reports: unknown[], preparedBy: string) => Promise<BunchPdfRecord[]>;
export type BunchProfileLookup = (profileId: string) => Promise<{ username: string; displayName: string | null } | null>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function ensureBunchCompletionPdf(input: {
  event: Record<string, unknown>;
  rpc: BunchPdfRpc;
  lookupProfile: BunchProfileLookup;
  render: BunchPdfRenderer;
}): Promise<"already_frozen" | "frozen" | "not_applicable"> {
  const event = input.event;
  const payload = record(event.payload);
  if (event.event_type !== "bunch_note_submission" || payload.automatic_completion !== true
    || payload.report_kind !== "completed_work") return "not_applicable";
  if (event.status !== "processing" || !String(event.lease_token || "").trim()) {
    throw new Error("BUNCH_NOTE_DELIVERY_LEASE_REQUIRED");
  }
  const eventId = String(event.event_id || "").trim();
  if (!eventId) throw new Error("BUNCH_NOTE_DELIVERY_EVENT_REQUIRED");
  const lookupResult = await input.rpc("bunch_note_delivery_lookup_v1", { p_event_id: eventId });
  if (lookupResult.error) throw new Error(`BUNCH_NOTE_DELIVERY_LOOKUP_FAILED:${lookupResult.error.code || "unknown"}`);
  const delivery = record(lookupResult.data);
  if (Array.isArray(delivery.pdfs)) return "already_frozen";
  if (delivery.pdfs !== null || !Array.isArray(delivery.reports) || delivery.reports.length === 0) {
    throw new Error("BUNCH_NOTE_COMPLETION_REPORT_INVALID");
  }
  const previewId = String(delivery.preview_id || "").trim();
  if (!previewId || String(payload.preview_id || "") !== previewId) throw new Error("BUNCH_NOTE_PREVIEW_MISMATCH");
  const createdBy = String(delivery.created_by || "").trim();
  const profile = createdBy ? await input.lookupProfile(createdBy) : null;
  if (!profile) throw new Error("BUNCH_NOTE_PREPARER_MISSING");
  const preparedBy = String(profile.displayName || profile.username || "Unknown").trim() || "Unknown";
  const pdfs = await input.render(delivery.reports, preparedBy);
  const freezeResult = await input.rpc("bunch_note_freeze_pdfs_v1", { p_preview_id: previewId, p_pdfs: pdfs });
  if (freezeResult.error) throw new Error(`BUNCH_NOTE_PDF_FREEZE_FAILED:${freezeResult.error.code || "unknown"}`);
  if (!Array.isArray(record(freezeResult.data).pdfs)) throw new Error("BUNCH_NOTE_PDF_FREEZE_INVALID");
  return "frozen";
}
