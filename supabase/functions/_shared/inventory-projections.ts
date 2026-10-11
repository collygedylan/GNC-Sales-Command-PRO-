import type { Database } from "./database.types.ts";
import { jsonObject, jsonValue, type Json } from "../../../services/database-contract-runtime.ts";

type InventoryRow = Database["public"]["Tables"]["ph_master_inventory"]["Row"];
type InventoryColumn = keyof InventoryRow & string;
type CsvColumnsValid<Columns extends string> = Columns extends `${infer Head},${infer Tail}`
  ? Head extends InventoryColumn ? CsvColumnsValid<Tail> : never
  : Columns extends InventoryColumn ? Columns : never;
function inventoryProjection<const Columns extends string>(columns: Columns & (CsvColumnsValid<Columns> extends never ? never : unknown)): Columns {
  return columns;
}

export const INVENTORY_MASTER_INITIAL_COLUMNS = [
  "unique_id", "warehouseid", "plantgroupcode", "itemcode", "qualitycode", "contsize", "commonname",
  "lotcode", "locationcode", "source", "desigitem", "desigcust", "desigloc", "priority", "ptravailable", "s_lts", "season_supply", "saleyear",
  "itemspec", "locationnote", "locationnotedate", "fieldtagcolor", "holdstopcode", "holdstopreason", "holdstopbegindate", "season", "blockalpha", "blocknumber",
  "hold_release_approved_at", "hold_release_approved_by", "hold_release_approved_by_display", "hold_release_approved_holdstopbegindate",
  "app_tab_assignment", "assignedto", "date_completed", "av_note", "sales_note", "salesnote", "match", "loc_match_qty", "initial_ptr", "spec", "caliper",
  "av_rule_bundle_updated_at", "av_rule_av_note_updated_at", "av_rule_spec_updated_at", "av_rule_match_updated_at", "av_rule_caliper_updated_at", "av_rule_photo_updated_at",
  "av_rule_priority_snapshot", "av_rule_holdstop_snapshot", "av_rule_last_clear_reason", "av_rule_last_cleared_at",
  "eval_task_type", "eval_task_status", "eval_task_instructions", "eval_task_assigned_by", "eval_task_assigned_at", "eval_task_completed_by", "eval_task_completed_at",
  "eval_task_recount_qty", "eval_task_moved_up_qty", "eval_task_hold_action", "eval_task_hold_code", "eval_task_hold_reason", "eval_task_result_note",
  "photo_link", "photo_name", "dock_photo_link", "dock_photo_name", "flyer_photo_link", "flyer_photo_name", "flyer_completed",
  "flyer_av_note", "flyer_match", "flyer_loc_match_qty", "flyer_spec", "flyer_caliper", "flyer_pick", "flyer_initial_ptr",
] as const satisfies readonly InventoryColumn[];

export const INVENTORY_MASTER_INITIAL_BASE_COLUMNS = INVENTORY_MASTER_INITIAL_COLUMNS.filter((field) =>
  !field.startsWith("hold_release_") && !field.startsWith("av_rule_")
);

export const INVENTORY_MASTER_FULL_COLUMNS = [
  "unique_id", "itemcode", "commonname", "contsize", "locationcode", "lotcode", "ptravailable",
  "season_supply", "priority", "qualitycode", "field_tag_color", "s_lts", "season", "plantgroupcode",
  "listprice", "concat", "last_updated", "assignedto", "date_completed", "end_cap_folder", "end_cap_qty",
  "end_cap_level", "match", "spec", "caliper", "pic_note", "sales_note", "av_note",
  "photo_link", "photo_name", "dock_spec", "dock_caliper", "dock_note", "dock_photo_link", "dock_photo_name",
  "flyer_cat", "flyer_title", "flyer_inst", "flyer_assigned", "flyer_notes", "flyer_photo_link", "flyer_photo_name",
  "flyer_completed", "initial_ptr", "loc_match_qty", "warehousei", "desigitem", "desigcust", "desigloc",
  "ptronhand", "ptrreviewed", "holdstopcode", "holdstopbegindate", "holdstopreason", "hsreasonbegin", "season_oh",
  "season_demand", "oversellpercentage", "itemspec", "locationnote", "locationnotedate", "suspend", "suspendto",
  "specialpuller", "pulltagnote1", "pulltagnote2", "fieldtagcolor", "salesnote", "inventorynote", "locationptn1",
  "locationptn2", "prisetby", "priupdated", "bypassloc", "largeptrqty", "maxorderquantity", "lochold",
  "ext_ptronhand", "varietycode", "genusname", "botanicalname", "reversecommon", "sortnamevariety", "containersort",
  "saleyear", "blockalpha", "blocknumber", "bay", "pullerresponsibility", "grower", "si_lts",
  "a_lts", "ai_lts", "season_available", "holdstopenddate", "salesnote_1", "fnsalesnote", "warehousename",
  "mcstatus", "hz", "intercopo", "insurancegroup", "brand", "printedcontainercode", "warehouseid",
  "isreserve", "salesrepid", "salesrepname", "nationalaccount", "idgroup", "customeridentityid", "customername",
  "consigneeidentityid", "consigneename", "consigneecity", "consigneestate", "consigneezip", "tripnumber", "stopnumber",
  "zonecode", "tagcode", "transactionnumber", "purchaseordernumber", "extunitprice", "ordertotal", "requestdate",
  "stagename", "step", "customersku", "formattedupc", "descriptorcode", "quantityordered", "quantityshipped",
  "unitprice", "handlingchargeperitem", "taggingchargeperitem", "combinedprice", "freightrateperitem", "landed", "retailprice",
  "picknote", "planstart", "generalloadinstr", "invoicedate", "consigneeaddress_1", "consigneeaddress_2", "altshipcomment",
  "shiptotelephone_1", "okloadinstructions", "txloadinstructions", "ncloadinstructions", "hlloadinstructions", "dock", "dock_num",
  "equiv_unit", "equiv_uom", "wingdingunits", "dropweight", "internalinvnote", "hardinesszone", "tagdeptnote",
  "ext_unit_merch_shipped", "ext_eunit_shipped", "avg_price_eunit_shipped", "requestdateweek", "carrier", "suspend_to", "qa_code",
  "si_available", "source", "filename", "app_tab_assignment", "salesnotebegindate", "ncr_approval_type", "ncr_requested_by_username",
  "ncr_requested_by_display", "ncr_requested_by_email", "ncr_requested_at", "ncr_approval_message", "hold_release_approved_at", "hold_release_approved_by", "hold_release_approved_by_display",
  "hold_release_approved_holdstopbegindate", "flyer_av_note", "flyer_match", "flyer_loc_match_qty", "flyer_spec", "flyer_caliper", "flyer_pick",
  "flyer_initial_ptr", "eval_task_type", "eval_task_status", "eval_task_instructions", "eval_task_assigned_by", "eval_task_assigned_at", "eval_task_completed_by",
  "eval_task_completed_at", "eval_task_recount_qty", "eval_task_moved_up_qty", "eval_task_hold_action", "eval_task_hold_code", "eval_task_hold_reason", "eval_task_result_note",
  "av_rule_bundle_updated_at", "av_rule_av_note_updated_at", "av_rule_spec_updated_at", "av_rule_match_updated_at", "av_rule_caliper_updated_at", "av_rule_photo_updated_at", "av_rule_priority_snapshot",
  "av_rule_holdstop_snapshot", "av_rule_last_clear_reason", "av_rule_last_cleared_at",
] as const satisfies readonly InventoryColumn[];

export const INVENTORY_MASTER_BROWSE_COLUMNS = [
  "unique_id", "warehouseid", "plantgroupcode", "itemcode", "qualitycode", "contsize", "commonname",
  "lotcode", "locationcode", "source", "desigitem", "desigcust", "desigloc", "priority",
  "ptravailable", "s_lts", "season_supply", "saleyear", "itemspec", "locationnote", "locationnotedate",
  "fieldtagcolor", "holdstopcode", "holdstopreason", "holdstopbegindate", "season", "blockalpha", "blocknumber",
  "hold_release_approved_at", "hold_release_approved_by", "hold_release_approved_by_display", "hold_release_approved_holdstopbegindate", "app_tab_assignment", "assignedto", "date_completed",
  "av_note", "sales_note", "salesnote", "match", "loc_match_qty", "initial_ptr", "spec",
  "caliper", "av_rule_bundle_updated_at", "av_rule_av_note_updated_at", "av_rule_spec_updated_at", "av_rule_match_updated_at", "av_rule_caliper_updated_at", "av_rule_photo_updated_at",
  "av_rule_priority_snapshot", "av_rule_holdstop_snapshot", "av_rule_last_clear_reason", "av_rule_last_cleared_at", "eval_task_type", "eval_task_status", "eval_task_instructions",
  "eval_task_assigned_by", "eval_task_assigned_at", "eval_task_completed_by", "eval_task_completed_at", "eval_task_recount_qty", "eval_task_moved_up_qty", "eval_task_hold_action",
  "eval_task_hold_code", "eval_task_hold_reason", "eval_task_result_note", "photo_link", "photo_name", "dock_photo_link", "dock_photo_name",
  "flyer_photo_link", "flyer_photo_name", "flyer_completed", "flyer_av_note", "flyer_match", "flyer_loc_match_qty", "flyer_spec",
  "flyer_caliper", "flyer_pick", "flyer_initial_ptr", "warehousei", "ptronhand", "ptrreviewed", "hsreasonbegin",
  "season_oh", "season_demand", "oversellpercentage", "suspend", "suspendto", "specialpuller", "pulltagnote1",
  "pulltagnote2", "inventorynote", "locationptn1", "locationptn2", "prisetby", "priupdated", "bypassloc",
  "largeptrqty", "maxorderquantity", "lochold", "listprice", "ext_ptronhand", "varietycode", "genusname",
  "botanicalname", "reversecommon", "sortnamevariety", "containersort", "bay", "pullerresponsibility", "grower",
  "si_lts", "a_lts", "ai_lts", "season_available", "holdstopenddate", "fnsalesnote", "warehousename",
  "mcstatus", "hz", "intercopo", "insurancegroup", "brand", "printedcontainercode", "salesnotebegindate",
  "equiv_unit", "last_updated", "filename", "ncr_approval_type", "ncr_requested_by_username", "ncr_requested_by_display", "ncr_requested_by_email",
  "ncr_requested_at", "ncr_approval_message", "end_cap_folder", "end_cap_qty", "end_cap_level", "flyer_cat", "flyer_title",
  "flyer_inst", "flyer_assigned", "flyer_notes", "pic_note",
  "consigneename", "customername", "dock", "dock_caliper", "dock_note", "dock_num", "dock_spec",
  "field_tag_color", "picknote", "planstart", "qa_code", "salesnote_1", "salesrepid", "salesrepname",
  "stopnumber", "suspend_to", "tripnumber",
] as const satisfies readonly InventoryColumn[];

export const INVENTORY_MASTER_INITIAL_FIELDS = INVENTORY_MASTER_INITIAL_COLUMNS.join(",");
export const INVENTORY_MASTER_INITIAL_BASE_FIELDS = INVENTORY_MASTER_INITIAL_BASE_COLUMNS.join(",");
export const INVENTORY_MASTER_FULL_FIELDS = INVENTORY_MASTER_FULL_COLUMNS.join(",");
export const INVENTORY_MASTER_BROWSE_FIELDS = INVENTORY_MASTER_BROWSE_COLUMNS.join(",");
export const INVENTORY_PO_DETAIL_FIELDS = inventoryProjection("unique_id,itemcode,commonname,contsize,locationcode,lotcode,ptravailable,app_tab_assignment,priority,season");
export const INVENTORY_NCR_QUEUE_FIELDS = inventoryProjection("unique_id,warehouseid,plantgroupcode,itemcode,qualitycode,contsize,commonname,itemspec,locationcode,lotcode,source,desigitem,desigcust,desigloc,priority,ptronhand,ptravailable,s_lts,saleyear,season,locationnote,locationnotedate,locationptn1,fieldtagcolor,holdstopcode,holdstopreason,holdstopbegindate,last_updated,photo_link,photo_name,dock_photo_link,dock_photo_name,flyer_photo_link,flyer_photo_name,flyer_completed,flyer_av_note,flyer_match,flyer_loc_match_qty,flyer_spec,flyer_caliper,flyer_pick,flyer_initial_ptr,av_note,sales_note,salesnote,match,loc_match_qty,initial_ptr,spec,caliper,ncr_approval_type,ncr_requested_by_username,ncr_requested_by_display,ncr_requested_by_email,ncr_requested_at,ncr_approval_message,hold_release_approved_at,hold_release_approved_by,hold_release_approved_by_display,hold_release_approved_holdstopbegindate,app_tab_assignment,assignedto,eval_task_type,eval_task_status,eval_task_instructions,eval_task_assigned_by,eval_task_assigned_at,eval_task_completed_by,eval_task_completed_at,eval_task_recount_qty,eval_task_moved_up_qty,eval_task_hold_action,eval_task_hold_code,eval_task_hold_reason,eval_task_result_note");
export const INVENTORY_NOT_ON_INVENTORY_FIELDS = inventoryProjection("unique_id,warehouseid,plantgroupcode,itemcode,qualitycode,contsize,commonname,itemspec,locationcode,lotcode,source,desigitem,desigcust,desigloc,priority,ptronhand,ptravailable,s_lts,saleyear,season,locationnote,locationnotedate,locationptn1,fieldtagcolor,holdstopcode,holdstopreason,holdstopbegindate,last_updated,photo_link,photo_name,dock_photo_link,dock_photo_name,flyer_photo_link,flyer_photo_name,flyer_completed,flyer_av_note,flyer_match,flyer_loc_match_qty,flyer_spec,flyer_caliper,flyer_pick,flyer_initial_ptr,av_note,sales_note,salesnote,match,loc_match_qty,initial_ptr,spec,caliper,app_tab_assignment,assignedto");

const FIXED_INVENTORY_PROJECTIONS = [
  INVENTORY_MASTER_INITIAL_FIELDS,
  INVENTORY_MASTER_INITIAL_BASE_FIELDS,
  INVENTORY_MASTER_FULL_FIELDS,
  INVENTORY_MASTER_BROWSE_FIELDS,
  INVENTORY_PO_DETAIL_FIELDS,
  INVENTORY_NCR_QUEUE_FIELDS,
  INVENTORY_NOT_ON_INVENTORY_FIELDS,
  "filename,last_updated",
] as const;

const fixedProjectionMatchers = new Map<string, (field: string) => boolean>(
  FIXED_INVENTORY_PROJECTIONS.map((fields) => {
    const allowed = new Set(fields.split(","));
    return [fields, (field: string) => allowed.has(field)];
  }),
);

/** Return a cached field matcher for fixed production projections. */
export function inventoryProjectionMatcher(fields: string): ((field: string) => boolean) | null {
  if (fields === "*") return null;
  const prepared = fixedProjectionMatchers.get(fields);
  if (prepared) return prepared;
  const allowed = new Set(fields.split(",").map((field) => field.trim()).filter(Boolean));
  return (field) => allowed.has(field);
}

/** Validate JSON objects and copy only the fixed projection in one pass. */
export function projectInventoryRows(rows: unknown, fields: string): Json[] {
  if (!Array.isArray(rows)) return [];
  const matches = inventoryProjectionMatcher(fields);
  return rows.map((row) => {
    const value = jsonObject(jsonValue(row));
    if (!matches) return value;
    const projected: Record<string, Json | undefined> = {};
    for (const [key, fieldValue] of Object.entries(value)) {
      if (matches(key)) projected[key] = fieldValue;
    }
    return projected;
  });
}
