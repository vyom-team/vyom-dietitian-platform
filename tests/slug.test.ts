import { describe, expect, it } from "vitest";

import {
  isReservedSlug,
  slugCandidates,
  slugify,
  toBaseSlug,
} from "../src/lib/slug";

describe("slugify", () => {
  it("converts a practice name to a URL-safe slug", () => {
    expect(slugify("Healthy Life Nutrition")).toBe("healthy-life-nutrition");
  });

  it("preserves accented letters by their base form", () => {
    expect(slugify("Café Nutrición")).toBe("cafe-nutricion");
  });

  it("collapses punctuation and whitespace into single hyphens", () => {
    expect(slugify("Dr. Sharma's  Clinic & Wellness!")).toBe(
      "dr-sharma-s-clinic-wellness",
    );
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  --Wellness--  ")).toBe("wellness");
  });

  it("returns empty for names with no Latin-representable characters", () => {
    // Devanagari has no ASCII equivalent; the caller falls back.
    expect(slugify("पोषण")).toBe("");
  });

  it("caps length so a numeric suffix always fits the column", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(72);
  });
});

/**
 * The slug lands in URLs, so the safe alphabet is the security control. These
 * assert that hostile names cannot escape it.
 */
describe("slug injection resistance", () => {
  it.each([
    ["../../etc/passwd", "path traversal"],
    ["..%2F..%2Fadmin", "encoded traversal"],
    ["javascript:alert(1)", "script scheme"],
    ["data:text/html,<script>", "data scheme"],
    ["practice?next=https://evil.example", "query smuggling"],
    ["practice#fragment", "fragment"],
    ["practice/../admin", "embedded traversal"],
    ["<script>alert(1)</script>", "html tags"],
    ["'; DROP TABLE organizations; --", "sql injection attempt"],
    ["practice%00null", "null byte"],
  ])("neutralises %s (%s)", (input) => {
    const slug = slugify(input);
    expect(slug).toMatch(/^[a-z0-9-]*$/);
    expect(slug).not.toContain("/");
    expect(slug).not.toContain("..");
    expect(slug).not.toContain(":");
    expect(slug).not.toContain("<");
    expect(slug).not.toContain("?");
    expect(slug).not.toContain("#");
  });
});

describe("toBaseSlug", () => {
  it("never returns an empty slug", () => {
    expect(toBaseSlug("पोषण")).not.toBe("");
    expect(toBaseSlug("!!!")).not.toBe("");
  });

  it("avoids reserved application words", () => {
    for (const reserved of ["admin", "api", "login", "dashboard", "settings"]) {
      const slug = toBaseSlug(reserved);
      expect(isReservedSlug(slug)).toBe(false);
      expect(slug).not.toBe(reserved);
    }
  });

  it("leaves ordinary names untouched", () => {
    expect(toBaseSlug("Healthy Life Nutrition")).toBe("healthy-life-nutrition");
  });
});

describe("slugCandidates", () => {
  it("yields the base slug first", () => {
    const [first] = [...slugCandidates("Healthy Life", 3)];
    expect(first).toBe("healthy-life");
  });

  it("appends deterministic numeric suffixes for collisions", () => {
    const candidates = [...slugCandidates("Healthy Life", 4)];
    expect(candidates.slice(0, 4)).toEqual([
      "healthy-life",
      "healthy-life-2",
      "healthy-life-3",
      "healthy-life-4",
    ]);
  });

  it("keeps every candidate within the column limit", () => {
    for (const candidate of slugCandidates("a".repeat(200), 50)) {
      expect(candidate.length).toBeLessThanOrEqual(80);
    }
  });

  it("produces only safe characters for hostile input", () => {
    for (const candidate of slugCandidates("../../admin?x=1", 5)) {
      expect(candidate).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
