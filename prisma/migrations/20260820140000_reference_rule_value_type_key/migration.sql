-- ===========================================================================
-- Fix: EAR, RDA and UL for the same population collapsed into one row
--
-- The idempotency key omitted value_type, so an EAR, an RDA and a Tolerable
-- Upper Limit for the same nutrient, sex and age band shared one key. Importing
-- all three left only the last one written.
--
-- That is not merely lossy. The surviving row was usually the UL, so a table
-- stating "iron RDA 19 mg, UL 45 mg" ended up holding 45 — and a UL presented
-- as a target is a safety ceiling turned into something to aim for.
--
-- value_type joins the key. Three statements about one population are three
-- rows, which is what the publication actually says.
-- ===========================================================================

DROP INDEX IF EXISTS "reference_rules_applicability_key";

CREATE UNIQUE INDEX "reference_rules_applicability_key"
  ON "reference_rules" (
    "source_version_id",
    "rule_type",
    "rule_key",
    "nutrient_id",
    "sex_applicability",
    "age_min_years",
    "age_max_years",
    "physiological_state",
    "value_type"
  )
  NULLS NOT DISTINCT;
