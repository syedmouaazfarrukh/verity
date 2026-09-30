# Demo uploads — upload these live, in this order

1. `1-conflict-emailed-note-hoa-be.md` → **Blocked**. Critical conflict (24h SLA): a note a colleague forwarded by email says the monthly cap is €130, but the live "Home-office allowance — Belgium" (v3) says €150. Shows "Live document says / Your document says". Also a medium "older version" flag (v3 ≤ live v3).
2. `2-duplicate-meal-vouchers-be.md` → **Blocked**. High "duplicate" (72h SLA): every rule already exists in "Meal vouchers — Belgium" (v2). Plus a medium "older version" flag (v1 ≤ v2).
3. `3-new-version-mobility-budget-be.md` → **Live**, clean, when uploaded by `lies` or `admin`. (Uploaded by a consultant like `sofie`, it's blocked until the owner approves it.) v2 replaces v1 (max budget €16,000 → €16,500); v1 becomes superseded and shows in the version history.
4. `4-missing-metadata-parental-leave.md` → **Live** with one low "missing metadata" flag (30d SLA): no country and no effective date. New topic "Parental leave" appears.

Who uploads what: `sofie` → 1, `lies` → 2 and 3, `admin` → 4. File 4 has no country, so it counts as company-wide and only `admin` can upload it.
