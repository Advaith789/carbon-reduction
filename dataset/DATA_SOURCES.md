# Dataset — "Buy More or Buy Better?" (UW–Madison Scope-3 purchasing carbon)

Seven files. Each value below is tagged **REAL** (traceable to a public/provided source) or
**REPRESENTATIVE** (synthetic, built to realistic magnitudes for the demo). Nothing real is
fabricated; nothing synthetic is passed off as real.

## Files

| File | What it is | Real vs representative |
| --- | --- | --- |
| `naics_emission_factors.csv` | kg CO2e per purchaser-$ by industry | **REAL** — EPA USEEIO Supply Chain GHG Emission Factors v1.3 (USD2022). Combined from the by-gas file using IPCC AR5 GWP-100 (CO2=1, CH4=28, N2O=265) + the dataset's pre-aggregated F-gas CO2e row. |
| `products.csv` | Device carbon footprints vs price | **co2e_kg = REAL** (Apple Environmental Progress Report 2026, cradle-to-grave). **price_usd = REPRESENTATIVE** (typical retail; the report lists no prices). |
| `uw_departments.csv` | Departments, buildings, budgets | **lat/lng = REAL** (UW campus). **budgets/FTE = REPRESENTATIVE**, anchored to real UW totals (22,560 staff FTE, 2025 Data Digest) and the real degrees-conferred ranking (CS largest). |
| `vendors.csv` | Vendors → NAICS | **REPRESENTATIVE** vendor list; **NAICS codes = REAL** classifications. |
| `transactions.csv` | OpenBook-style spend records | **REPRESENTATIVE**, built to realistic magnitudes; schema matches OpenBook Wisconsin. |
| `department_inventory.csv` | IT/lab asset inventory | **REPRESENTATIVE** (feeds refresh-cycle + SWAP policy levers). |

## Key result (from the REAL data)

- **Price→carbon elasticity for laptops: β = 0.760 (R² = 0.967).** A 10× pricier laptop emits
  **5.75×** the carbon — not 10×. So the spend-based method **over-counts** premium laptops by
  ~74% at the extreme.
- **β is category-specific.** Across *all* Macs (incl. the $6,999 Mac Pro at 1,572 kg) β = 1.17.
  "Buy better" holds for laptops; high-end desktops/workstations don't follow it. The
  decomposition must run per category — an honest nuance, not a bug.
- **Industry factors span ~20×:** a dollar of computers (0.057 kg CO2e/$) vs a dollar of lab
  chemicals (1.00–1.18). IT is where "buy better" pays off; chemicals are the real hotspot and
  get only the spend-based treatment (no product data) — hence "deep on IT, framework for the rest."

## How the app uses it

1. **Spend-based footprint** = `amount_usd × factor(vendor.naics)` — today's biased method.
2. **Quality-adjusted** (IT only, where `quantity` is known):
   `spend_based × (unit_price / ref_price)^(β − 1)`, β = 0.76. With β < 1, buying fewer/pricier
   laptops lowers the footprint vs what spend-based implies.
3. **Map:** one marker per department (real coords), colored by over-count gap
   `(spend_based − quality_adjusted)/spend_based`.
4. **Policy levers:** refresh-cycle extension + SWAP surplus routing from `department_inventory.csv`.

## To make it fully real later

Swap `transactions.csv` for a real OpenBook Wisconsin UW export (schema already matches), replace
representative prices with UW contract prices, and request department FTE from UW APIR. Nothing
else changes.
