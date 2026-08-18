/**
 * Phase 8A security and schema verification.
 *
 *   npm run nutrition:verify
 *
 * Asserts that the guarantees Phase 8A claims are actually enforced by the
 * database, rather than merely described in a migration comment. Read-only:
 * it inspects the catalog and writes nothing.
 *
 * The two things it exists to prove:
 *
 *   1. Reference data is readable by clinical users of any practice and
 *      writable by none of them.
 *   2. Adding global data did not loosen anything tenant-scoped. The Phase 3–7
 *      policies and helpers are counted, and a drop in that count fails the
 *      run.
 */

import { Client } from "pg";

import { scriptConnectionString } from "../load-env.js";

const connectionString = scriptConnectionString;

if (!connectionString) {
  console.error("No database connection string. Set DATABASE_URL in .env.local first.");
  process.exit(1);
}

/** Tables clinical users may read. */
const READABLE = [
  "nutrition_sources",
  "nutrition_source_versions",
  "nutrients",
  "foods",
  "food_aliases",
  "food_nutrients",
  "units",
  "unit_conversions",
] as const;

/** Tables the browser may not touch at all. */
const INTERNAL = ["source_foods", "dataset_imports"] as const;

const ALL_TABLES = [...READABLE, ...INTERNAL];

/** Tenant-scoped tables that must keep exactly the isolation they had. */
const TENANT_TABLES = [
  "organizations",
  "organization_members",
  "user_profiles",
  "subscriptions",
  "organization_invitations",
  "clients",
  "client_assignments",
  "nutrition_assessments",
] as const;

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  pass  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const client = new Client({ connectionString });

async function main() {
  await client.connect();

  console.log("");
  console.log("Phase 8A — nutrition reference data verification");
  console.log("===============================================");

  // --- Tables exist --------------------------------------------------------
  console.log("\n  Schema");
  const tables = await client.query<{ tablename: string; rowsecurity: boolean }>(
    `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`,
  );
  const tableMap = new Map(tables.rows.map((row) => [row.tablename, row.rowsecurity]));

  for (const table of ALL_TABLES) {
    check(`table ${table} exists`, tableMap.has(table));
  }

  // --- RLS enabled everywhere ---------------------------------------------
  console.log("\n  Row Level Security enabled");
  for (const table of ALL_TABLES) {
    check(`RLS enabled on ${table}`, tableMap.get(table) === true);
  }

  // --- Policies ------------------------------------------------------------
  console.log("\n  Policies");
  const policies = await client.query<{
    tablename: string;
    policyname: string;
    cmd: string;
    qual: string | null;
  }>(
    `SELECT tablename, policyname, cmd, qual FROM pg_policies WHERE schemaname = 'public'`,
  );

  for (const table of READABLE) {
    const forTable = policies.rows.filter((row) => row.tablename === table);
    check(`${table}: exactly one policy`, forTable.length === 1, `found ${forTable.length}`);

    const policy = forTable[0];
    check(`${table}: policy is SELECT only`, policy?.cmd === "SELECT", policy?.cmd);
    check(
      `${table}: policy calls is_clinical_user`,
      Boolean(policy?.qual?.includes("is_clinical_user")),
      policy?.qual ?? "no USING clause",
    );
    // A policy that admits everyone is the failure mode this whole file exists
    // to catch, so it is asserted explicitly rather than inferred.
    check(
      `${table}: policy is not USING (true)`,
      policy?.qual?.trim() !== "true",
      policy?.qual ?? "",
    );
  }

  for (const table of INTERNAL) {
    const forTable = policies.rows.filter((row) => row.tablename === table);
    check(
      `${table}: no policies (deny-all to the browser)`,
      forTable.length === 0,
      `found ${forTable.length}`,
    );
  }

  // --- Grants --------------------------------------------------------------
  console.log("\n  Grants");
  const grants = await client.query<{
    table_name: string;
    grantee: string;
    privilege_type: string;
  }>(
    `SELECT table_name, grantee, privilege_type
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('authenticated', 'anon')`,
  );

  for (const table of READABLE) {
    const forTable = grants.rows.filter((row) => row.table_name === table);
    const auth = forTable.filter((row) => row.grantee === "authenticated");
    const anon = forTable.filter((row) => row.grantee === "anon");

    check(
      `${table}: authenticated has SELECT only`,
      auth.length === 1 && auth[0]?.privilege_type === "SELECT",
      auth.map((row) => row.privilege_type).join(", ") || "no grants",
    );
    check(`${table}: anon has no grants`, anon.length === 0, `${anon.length} grants`);
  }

  for (const table of INTERNAL) {
    const forTable = grants.rows.filter((row) => row.table_name === table);
    check(
      `${table}: no grants to authenticated or anon`,
      forTable.length === 0,
      `${forTable.length} grants`,
    );
  }

  // --- The helper function -------------------------------------------------
  console.log("\n  Clinical-user helper");
  const helper = await client.query<{
    provolatile: string;
    prosecdef: boolean;
    proconfig: string[] | null;
    prosrc: string;
  }>(
    `SELECT p.provolatile, p.prosecdef, p.proconfig, p.prosrc
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'vyom_private' AND p.proname = 'is_clinical_user'`,
  );

  const fn = helper.rows[0];
  check("is_clinical_user exists", Boolean(fn));
  check("is_clinical_user is STABLE", fn?.provolatile === "s", fn?.provolatile);
  check("is_clinical_user is SECURITY DEFINER", fn?.prosecdef === true);
  check(
    "is_clinical_user pins an empty search_path",
    // Postgres normalises `SET search_path = ''` to `search_path=""`; older
    // versions record it bare. Both mean the same thing: nothing on the path,
    // so no caller-controlled schema can shadow an object the function uses.
    Boolean(
      fn?.proconfig?.some(
        (entry) => entry === "search_path=" || entry === 'search_path=""',
      ),
    ),
    JSON.stringify(fn?.proconfig),
  );
  check(
    "is_clinical_user excludes RECEPTIONIST",
    !fn?.prosrc.includes("RECEPTIONIST"),
  );
  check(
    "is_clinical_user includes OWNER and DIETITIAN",
    Boolean(fn?.prosrc.includes("OWNER") && fn?.prosrc.includes("DIETITIAN")),
  );

  // --- Constraints that enforce the data rules -----------------------------
  console.log("\n  Constraints");
  const constraints = await client.query<{ conname: string; contype: string }>(
    `SELECT c.conname, c.contype
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = ANY($1)`,
    [ALL_TABLES],
  );
  const constraintNames = new Set(constraints.rows.map((row) => row.conname));

  for (const name of [
    "foods_canonical_name_not_blank",
    "foods_origin_complete",
    "food_nutrients_value_non_negative",
    "food_nutrients_basis_positive",
    "source_foods_confidence_range",
    "source_foods_mapping_matches_food",
    "unit_conversions_factor_positive",
    "unit_conversions_distinct_units",
    "dataset_imports_counts_non_negative",
    "dataset_imports_completed_at_matches_status",
  ]) {
    check(`CHECK ${name}`, constraintNames.has(name));
  }

  // --- Column types that the precision rule depends on ---------------------
  console.log("\n  Column types");
  const columns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    numeric_scale: number | null;
    is_nullable: string;
  }>(
    `SELECT table_name, column_name, data_type, numeric_scale, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [ALL_TABLES],
  );

  const column = (table: string, name: string) =>
    columns.rows.find((row) => row.table_name === table && row.column_name === name);

  const value = column("food_nutrients", "value");
  check("food_nutrients.value is NUMERIC", value?.data_type === "numeric", value?.data_type);
  check("food_nutrients.value has scale 6", value?.numeric_scale === 6, String(value?.numeric_scale));
  // NOT NULL is what makes "missing" the absence of a row rather than a null
  // value, which is the only representation that cannot be confused with zero.
  check("food_nutrients.value is NOT NULL", value?.is_nullable === "NO");

  const basis = column("food_nutrients", "basis_quantity");
  check("food_nutrients.basis_quantity is NUMERIC", basis?.data_type === "numeric");

  const factor = column("unit_conversions", "factor");
  check("unit_conversions.factor is NUMERIC", factor?.data_type === "numeric");

  const sourceVersion = column("food_nutrients", "source_version_id");
  check(
    "food_nutrients.source_version_id is NOT NULL (every value is traceable)",
    sourceVersion?.is_nullable === "NO",
  );

  // No organization_id anywhere: reference data is global by construction, and
  // a stray tenant column would quietly turn it back into per-tenant data.
  const strayTenantColumns = columns.rows.filter(
    (row) => row.column_name === "organization_id",
  );
  check(
    "no reference table carries organization_id",
    strayTenantColumns.length === 0,
    strayTenantColumns.map((row) => row.table_name).join(", "),
  );

  // --- Partial indexes the schema cannot express ---------------------------
  console.log("\n  Indexes");
  const indexes = await client.query<{ indexname: string; indexdef: string }>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1)`,
    [ALL_TABLES],
  );
  const indexMap = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]));

  check("foods_origin_unique exists", indexMap.has("foods_origin_unique"));
  check(
    "food_nutrients uniqueness spans food + nutrient + version",
    indexMap.has("food_nutrients_food_id_nutrient_id_source_version_id_key"),
  );
  check(
    "units_one_canonical_per_category is partial",
    Boolean(indexMap.get("units_one_canonical_per_category")?.includes("WHERE")),
  );
  check(
    "unit_conversions_global_unique is partial on food_id IS NULL",
    Boolean(indexMap.get("unit_conversions_global_unique")?.includes("food_id IS NULL")),
  );

  // --- Earlier phases still intact -----------------------------------------
  console.log("\n  Phases 3–7 unchanged");
  for (const table of TENANT_TABLES) {
    check(`${table}: RLS still enabled`, tableMap.get(table) === true);
  }

  const tenantPolicies = policies.rows.filter((row) =>
    (TENANT_TABLES as readonly string[]).includes(row.tablename),
  );
  // Ten before this phase. A lower number means a policy was dropped.
  check(
    "tenant-scoped policies still number 10",
    tenantPolicies.length === 10,
    `found ${tenantPolicies.length}`,
  );

  const helpers = await client.query<{ proname: string }>(
    `SELECT p.proname FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'vyom_private'`,
  );
  const helperNames = new Set(helpers.rows.map((row) => row.proname));
  for (const name of [
    "current_organization_ids",
    "current_staff_organization_ids",
    "current_clinical_organization_ids",
  ]) {
    check(`Phase 3–7 helper ${name} still present`, helperNames.has(name));
  }

  const assessmentPolicy = policies.rows.find(
    (row) => row.tablename === "nutrition_assessments",
  );
  check(
    "nutrition_assessments still scoped by organization",
    Boolean(assessmentPolicy?.qual?.includes("organization_id")),
  );
  // The new global helper must not have leaked into a tenant policy, which
  // would drop the organization check on health data.
  check(
    "no tenant policy uses the global is_clinical_user helper",
    !tenantPolicies.some((row) => row.qual?.includes("is_clinical_user")),
  );

  console.log("");
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log("");

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("\nVerification failed to run.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    void client.end();
  });
