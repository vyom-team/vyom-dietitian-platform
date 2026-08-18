/**
 * Food name normalization.
 *
 * Produces the *comparison* form of a name. The published name is never
 * altered — `Food.canonicalName` keeps exactly what the source wrote, and this
 * feeds `Food.normalizedName`, which is what search matches against.
 *
 * WHY BOTH
 *
 * Real Indian dataset names look like this:
 *
 *     "Plain khitchdi (Plain khichri/khichdi)"
 *     "Hot tea (Garam Chai)"
 *     "Instant idli (with semolina)"
 *
 * A dietitian types "khichdi" or "chai". Matching against the published string
 * fails, because the word they want is behind a bracket and a slash. Matching
 * against a flattened form succeeds — and the practitioner still sees the name
 * the source published, which is what makes the record verifiable against the
 * printed table.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not create aliases. A parenthetical is ambiguous: "(Garam Chai)" is
 * an alternative name, "(with semolina)" is a qualifier, and no reliable rule
 * separates them. Guessing would invent aliases, which the phase brief
 * forbids. Instead the bracketed words land in the normalized form, so search
 * finds them, and no unverified alias row is ever written.
 */

/**
 * The searchable form of a food name.
 *
 * Unicode-normalised, case-folded, and flattened so brackets and slashes stop
 * hiding words. Letters and digits from any script survive — Devanagari names
 * must not be stripped by a Latin-only filter.
 */
export function normalizeFoodName(name: string): string {
  return (
    name
      // NFKC first: composed and decomposed forms of the same Indic or
      // accented character must not compare as different strings.
      .normalize("NFKC")
      .toLowerCase()
      // Brackets and slashes separate words rather than joining them.
      // "(Plain khichri/khichdi)" has to become three findable words.
      .replace(/[()[\]{}/\\,;:]/g, " ")
      /*
       * Keep letters, combining marks, and numbers from every script, plus the
       * few symbols that carry meaning in a food name: 0.5% milk, vitamin-D.
       *
       * \p{M} is essential and easy to miss. Indic vowel signs are combining
       * marks, not letters — without it "दाल" becomes "द ल", and every
       * Devanagari, Tamil, or Bengali food name is quietly mangled. For an
       * India-first product that is not a cosmetic bug.
       */
      .replace(/[^\p{L}\p{M}\p{N}\s%.\-+]/gu, " ")
      // A hyphen between words is a separator; inside a word it is not.
      .replace(/\s*-\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Normalizes a search term the same way as a stored name.
 *
 * The two must go through identical treatment. If a query were normalised even
 * slightly differently from the names it is matched against, searches would
 * fail in ways nobody could reproduce.
 */
export function normalizeSearchTerm(term: string): string {
  return normalizeFoodName(term);
}

/**
 * Splits a normalized name into search tokens.
 *
 * Short tokens are dropped: a one or two character fragment matches almost
 * everything and makes results worse rather than better.
 */
export function searchTokens(term: string): string[] {
  return normalizeSearchTerm(term)
    .split(" ")
    .filter((token) => token.length >= 2);
}
