# Nutrition datasets

Working directory for raw nutrition source files and their provenance records.

**Nothing in `raw/` or `processed/` is committed.** These are third-party files
whose redistribution terms have not been cleared for this project. This README
and `manifests/` *are* committed, so what we hold and under what terms stays
reviewable without the files themselves.

The web application never reads anything here. Only the ingestion CLI does —
see [`docs/nutrition-data.md`](../../docs/nutrition-data.md).

```
data/nutrition/
├── raw/            source files, exactly as published — never edited by hand
│   ├── ifct/
│   ├── indb/
│   ├── usda/
│   └── references/
├── processed/      deterministic script output only
├── manifests/      provenance records (committed)
└── README.md       this file (committed)
```

If a source file needs reshaping, write a deterministic preprocessing script.
Never edit a raw file by hand: a hand-edited source cannot be re-derived, and
its checksum stops meaning anything.

---

## Status

| Source | Version | Held | Format | Development | Production | Import |
|---|---|---|---|---|---|---|
| **IFCT** ICMR-NIN | 2017 | ✅ PDF + extracted CSV | PDF 585 pp; CSV 542 rows | Allowed | `PERMISSION_REQUIRED` | ✅ **Imported** |
| **INDB** Anuvaad | 2024.11 | ✅ XLSX | XLSX, 1,014 recipes | Allowed | `UNKNOWN` | ✅ **Imported** |
| **ICMR-NIN RDA/EAR** | 2020 | ❌ | PDF | — | `PERMISSION_REQUIRED` | Reference only |
| **ICMR-NIN Dietary Guidelines** | 2024 | ❌ | PDF | — | `PERMISSION_REQUIRED` | Reference only |
| **USDA FoodData Central** | 2026-04 | ❌ | CSV / JSON | — | `UNKNOWN` | Not acquired |

**INDB and IFCT are imported.** The RDA/EAR and Dietary Guidelines are
registered but not acquired.

IFCT is imported from a **tabular extraction** of the publication, not from a
publisher-issued data file — ICMR-NIN issues none. Every value is therefore a
transcription. It was cross-verified against a second, independent extraction:
1,950 Table 1 values compared, zero mismatches. The tables beyond Table 1 could
not be cross-verified because the second extraction was too corrupted there. See
`manifests/ifct-2017-tables.source.json` for the full record.

> **2026-08-20 — permission reported.** The project owner reports permission
> from ICMR-NIN to use these publications **for development**. Recorded as
> stated; this repository has not verified it. Commercial use and
> redistribution remain `UNKNOWN` and still need written scope before launch.
>
> Two things this does **not** change:
>
> 1. **The RDA/EAR tables are still not here.** They are a different
>    publication from IFCT and are what the nutrition-target screens need. The
>    import path is ready — see `docs/nutrition-targets.md` — and is waiting on
>    a machine-readable copy.
> 2. **The IFCT PDF is still restricted.** Its owner permissions continue to
>    deny copy/extract; a licence to use the data does not alter the bits in
>    the file. Request a machine-readable copy rather than OCR-ing 585 pages of
>    tables into a clinical database, where a misread decimal is invisible and
>    permanent.

---

## IFCT 2017 — acquired, but not a data source

`raw/ifct/IFCT2017.pdf` · 12,401,190 bytes · SHA-256 `7fc5a511…20d0e8c`

Downloaded manually from the official ICMR-NIN URL. Size and checksum match the
published file exactly, so the copy is authentic and unmodified.

**It cannot be imported, and the reason is not technical.**

ICMR-NIN publishes IFCT 2017 as a book. There is no CSV, XLSX, JSON, or API
anywhere on `nin.res.in`. The PDF is encrypted (AES, V4/R4) and, while it opens
without a password, its owner permissions **explicitly deny copy / text
extraction**:

| Permitted | Denied |
|---|---|
| print | **copy / extract text** |
| extract for accessibility | modify, annotate, fill forms, assemble, high-quality print |

That is a deliberate technical protection measure applied by the copyright
owner, on a work already marked *All Rights Reserved*. Vyom does not circumvent
it. The accessibility flag is a narrow carve-out for assistive technology
serving a person with a disability — not a licence to harvest 585 pages of
tables into a product database.

**What the file is legitimately used for:** a person reading it, and verifying
mappings or spot-checking values obtained through a permitted route.

**To make IFCT importable**, ICMR-NIN must supply the underlying dataset, or
written permission covering extraction, storage, display in a commercial SaaS
product, and the required attribution wording.

⚠️ `ifct2017.com` no longer belongs to the project and now redirects to
unrelated commercial sites. Third-party copies on GitHub, Kaggle, Scribd, and
academia.edu are not authoritative and must not be used.

---

## INDB 2024.11 — imported

`raw/indb/Anuvaad_INDB_2024.11.xlsx` · 1,063,574 bytes · SHA-256 `c3902389…dda25d9`

Downloaded from the publisher's own site. No login, no paywall, no technical
protection — nothing was bypassed to obtain it.

1,014 commonly consumed Indian recipes with 40 nutrients each, per 100 g and per
serving. Better suited to meal planning than a composition table: a dietitian
plans "a bowl of dal", not "22 g of raw toor dal".

**Licence: `UNKNOWN`.** The site describes it as open-access and states no formal
terms; the authors' repository carries no LICENSE file. That is an unresolved
question, not a permission — and INDB is derived primarily from IFCT 2017, so it
sits downstream of the same ICMR-NIN rights.

Known gaps, all visible in the data rather than papered over:

- **No vitamin B12.** Not in the dataset. Nothing fabricates it, so INDB foods
  carry no B12 row — which reads as "not measured". Worth knowing for a largely
  vegetarian population.
- **No food categories.** Every record imports as `OTHER`; the publisher's own
  sub-dataset name is kept on the source record instead.
- **Recipes only.** The 1,095 individual food items described in the method paper
  are not in this download.
- **No preparation state.** Imports as `UNKNOWN` rather than a guessed `COOKED`.

---

## Manifests

One JSON file per source in `manifests/`, recording publisher, version, official
URL, acquisition date, filename, checksum, licence, permission status, and what
still has to happen before production use.

Every value corresponds to something actually verified. Where a fact is not
established the manifest says `UNKNOWN` — never a plausible guess.

---

## Commands

```bash
npm run nutrition:registry          # sources, nutrients, units — no values

# adapter route (INDB and future inspected datasets)
npm run nutrition:import-source -- --source INDB --version 2024.11     --file raw/indb/Anuvaad_INDB_2024.11.xlsx --dry-run
npm run nutrition:import-source -- --source INDB --version 2024.11     --file raw/indb/Anuvaad_INDB_2024.11.xlsx

# manifest route (flat nutrient tables)
npm run nutrition:import -- --manifest <file>.json --dry-run

npm run nutrition:report            # data quality
npm run nutrition:verify            # security assertions
```

`NUTRITION_DATA_DIR` overrides this directory. It defaults here.

---

## Source data vs Vyom normalized data

**Source data** is what a publisher wrote: their food codes, their column names,
their category words, their units. It lives in `raw/` and, once ingested, on
`SourceFood` with the original row preserved.

**Vyom normalized data** is `Food`, `FoodNutrient`, `Nutrient` — one shape no
matter which dataset a value came from. Every value carries the source version
that published it.

The two are never merged. That separation is what lets a second dataset arrive
without disturbing the first, and what makes any value traceable back to a
printed table.
