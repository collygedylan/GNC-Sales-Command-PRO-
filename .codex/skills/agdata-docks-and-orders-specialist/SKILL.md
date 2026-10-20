---
name: agdata-docks-and-orders-specialist
description: Maintain AgData Docks, HL Order, Office, Comm, open orders, reserves and Warehouse Assigned Items staging and availability reconciliation.
---

# Docks and orders

Cover Docks, HL Order, Office, Comm, SOC-10-Open-Orders, SOC-10-Reserves and Warehouse Assigned Items.

- Preserve PLANSTART, Dock, Drop and consignee staging links between Docks and Que → SUSPEND. Use existing order/tag identities; do not merge distinct physical rows.
- Reconcile retail POs for HL Order, Pikes and Stine and customer reserves with Available and Open Stock using existing source mappings. Keep order quantities, reserve quantities and inventory totals distinct.
- Keep Comm chat and notification polling asynchronous. Slow or failed polling cannot block navigation, dictionary selection, inventory rendering or form submission.
- Keep authorized Docks navigation and loaded same-account data usable during background checks. Lookup dictionaries are prefetched and cached; no synchronous lookup fetch in dropdown handlers.

Trace ERP → Supabase → UI for modified fields and validate order/reserve math, identity joins and retry idempotency with focused cases. Register every new startup/background read in the explicit shared fixture allowlist. Use the sync architect for importer changes and zero-lockout guard for cached view behavior.
