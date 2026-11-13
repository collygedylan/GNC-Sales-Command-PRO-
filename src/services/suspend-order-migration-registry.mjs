export const suspendOrderReceiptMigrationName = '20261113120000_suspend_close_order_receipt.sql';

export function suspendOrderReceiptMigrationContract(name) {
  if (name !== suspendOrderReceiptMigrationName) return null;
  return `select position('suspend-close-exact-order-v3079' in pg_get_functiondef(
    'suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)'::regprocedure))>0
    and not has_function_privilege('authenticated',
      'suspend_tag_private.group_command(uuid,text,jsonb,uuid,bigint)','execute') as installed`;
}
