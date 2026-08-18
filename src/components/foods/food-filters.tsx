"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Search and filters for the food database.
 *
 * State lives in the URL rather than in React, so a filtered view is linkable
 * and survives a refresh — and, more importantly, the *server* does the
 * filtering. The browser never receives the whole food database to sift
 * through, which matters at a thousand foods and would matter far more at the
 * ten thousand a composition table would add.
 */
export function FoodFilters({
  sources,
}: {
  sources: { code: string; name: string; count: number }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentQuery = params.get("q") ?? "";
  const currentSource = params.get("source") ?? "all";

  const [term, setTerm] = useState(currentQuery);

  const push = (next: Record<string, string | undefined>) => {
    const search = new URLSearchParams(params.toString());

    for (const [key, value] of Object.entries(next)) {
      if (!value || value === "all") search.delete(key);
      else search.set(key, value);
    }
    // Any change to the filters invalidates the current page number.
    search.delete("page");

    startTransition(() => {
      router.push(search.size ? `/foods?${search}` : "/foods");
    });
  };

  /*
   * Debounced search, matching the client list. Without it every keystroke is
   * a server round trip; 300ms batches typing while still feeling immediate.
   */
  useEffect(() => {
    if (term === currentQuery) return;

    const timer = setTimeout(() => push({ q: term || undefined }), 300);
    return () => clearTimeout(timer);
    // `push` and `currentQuery` derive from params, and depending on them would
    // re-trigger the effect and fight the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const hasFilters = Boolean(currentQuery) || currentSource !== "all";

  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
      <InputGroup className="sm:max-w-xs">
        <InputGroupAddon>
          <Search className="size-4" aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          name="q"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search foods — try khichdi"
          aria-label="Search foods by name"
        />
      </InputGroup>

      {sources.length > 1 ? (
        <Select value={currentSource} onValueChange={(value) => push({ source: value })}>
          <SelectTrigger className="sm:w-52" aria-label="Filter by source">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {sources.map((source) => (
              <SelectItem key={source.code} value={source.code}>
                {source.code} ({source.count.toLocaleString("en-IN")})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setTerm("");
            startTransition(() => router.push("/foods"));
          }}
        >
          <X className="size-4" aria-hidden="true" />
          Clear
        </Button>
      ) : null}

      <span
        aria-live="polite"
        className={cn("type-caption sr-only", isPending && "not-sr-only")}
      >
        {isPending ? "Searching…" : ""}
      </span>
    </div>
  );
}
