# Tasks AV Blanks filters — V2026.09.09.02

Tasks exposes searchable, multi-select **Genus Name** and **Container Size** filters for AV Blanks, including the restricted evaluator's EVAL Tasks → AV Blanks queue. The existing authorized row scope and CAV blank rules are unchanged.

Selections within a facet are OR; genus and size combine with AND. Filtering uses the existing loaded task data and cached state. Block/Location navigation and Back retain selections. Other simplified evaluator queues do not apply hidden AV Blanks filters; returning to AV Blanks restores those choices.

AV Blanks has a two-column phone filter rail, readable full labels, and the existing mobile filter sheet. Desktop retains the normal filter layout. No database migration, permission change, inventory update, email or historical data change is included.

Regression coverage uses synthetic inventory and blocks external traffic. It exercises managers, sales/marketing, and evaluators on phone and desktop layouts across Chromium, Firefox, and WebKit, including combined matching, excluded CAV rows, clearing, navigation, and evaluator queue transitions.
