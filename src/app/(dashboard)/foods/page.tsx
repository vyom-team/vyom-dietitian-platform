import type { Metadata } from "next";
import Link from "next/link";
import { Apple, Database } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { FoodFilters } from "@/components/foods/food-filters";
import { FoodList } from "@/components/foods/food-list";
import { ListPage } from "@/components/templates/page-templates";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { requireClinicalContext } from "@/lib/auth/dal";
import { listSourcesWithFoods, searchFoods } from "@/services/nutrition/search";
import { foodSearchQuerySchema, FOODS_PER_PAGE } from "@/validations/nutrition";

export const metadata: Metadata = { title: "Food Database" };

/**
 * Food database.
 *
 * Reference data is **global**: every practice reads the same foods, and that
 * is correct — IFCT's figure for toor dal is the same fact everywhere. It is
 * the one screen in the product where a cross-tenant read is intended.
 *
 * It is still clinical data by audience, so `requireClinicalContext()` gates
 * it: a receptionist has no workflow that reaches the food database. The
 * database enforces the same boundary independently through RLS, so this page
 * is not the only thing standing between them and it.
 *
 * Search, filtering, and pagination all happen in the database query. The
 * browser never receives the whole table to filter locally.
 */
export default async function FoodsPage({ searchParams }: PageProps<"/foods">) {
  await requireClinicalContext();

  const params = await searchParams;
  const query = foodSearchQuerySchema.parse({
    q: params.q,
    category: params.category,
    source: params.source,
    page: params.page,
  });

  const [result, sources] = await Promise.all([
    searchFoods({
      query: query.q,
      category: query.category,
      sourceCode: query.source,
      page: query.page,
      pageSize: FOODS_PER_PAGE,
    }),
    listSourcesWithFoods(),
  ]);

  const isFiltered = Boolean(query.q || query.category || query.source);
  const databaseIsEmpty = result.total === 0 && !isFiltered;

  return (
    <ListPage
      title="Food database"
      description="Indian foods and their published nutrition values."
      toolbar={databaseIsEmpty ? undefined : <FoodFilters sources={sources} />}
    >
      {databaseIsEmpty ? (
        <EmptyState
          icon={Database}
          title="No foods imported yet"
          description="The food database is populated by the ingestion CLI, not through this screen. Run npm run nutrition:import-source once a dataset is available."
        />
      ) : result.results.length === 0 ? (
        <EmptyState
          icon={Apple}
          title="No foods match"
          description="Try a shorter term, or a different spelling. Search does not guess between spellings — 'dal' and 'daal' are different words here."
          action={
            <Button asChild variant="outline">
              <Link href="/foods">Clear search</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          <FoodList foods={result.results} />

          <nav
            className="flex items-center justify-between gap-4"
            aria-label="Food database pages"
          >
            <p className="type-caption">
              {result.total.toLocaleString("en-IN")}{" "}
              {result.total === 1 ? "food" : "foods"}
              {result.totalPages > 1
                ? ` · page ${result.page} of ${result.totalPages}`
                : ""}
            </p>

            {result.totalPages > 1 ? (
              <div className="flex items-center gap-2">
                <PageLink
                  page={result.page - 1}
                  disabled={result.page <= 1}
                  params={params}
                  label="Previous"
                />
                <PageLink
                  page={result.page + 1}
                  disabled={result.page >= result.totalPages}
                  params={params}
                  label="Next"
                />
              </div>
            ) : null}
          </nav>

          {/*
            * Shown wherever these values are, not buried in a settings page.
            * The practitioner reading a number is the person who should know
            * its licensing status is unresolved.
            */}
          <Alert>
            <AlertTitle>Development data</AlertTitle>
            <AlertDescription>
              These values come from third-party datasets whose licensing has not
              been cleared for commercial use. Verify against the published
              source before relying on them clinically.
            </AlertDescription>
          </Alert>
        </div>
      )}
    </ListPage>
  );
}

/** A real link, so pages are bookmarkable and open in a new tab as expected. */
function PageLink({
  page,
  disabled,
  params,
  label,
}: {
  page: number;
  disabled: boolean;
  params: Record<string, string | string[] | undefined>;
  label: string;
}) {
  if (disabled) {
    return (
      <Button variant="outline" size="sm" disabled aria-disabled="true">
        {label}
      </Button>
    );
  }

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page") continue;
    if (typeof value === "string" && value) search.set(key, value);
  }
  if (page > 1) search.set("page", String(page));

  return (
    <Button variant="outline" size="sm" asChild>
      <Link
        href={search.size ? `/foods?${search}` : "/foods"}
        rel={label === "Previous" ? "prev" : "next"}
      >
        {label}
      </Link>
    </Button>
  );
}
