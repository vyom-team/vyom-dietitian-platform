/**
 * Country and timezone options.
 *
 * Both lists are derived from the runtime's own ICU data rather than shipped as
 * hardcoded tables:
 *
 *   - Country *names* come from `Intl.DisplayNames`, so they are correctly
 *     spelled and stay current without us maintaining a translation table.
 *   - Timezones come from `Intl.supportedValuesOf('timeZone')`, which is the
 *     same IANA database the platform validates against — so a value offered
 *     here can never be one the validator rejects.
 *
 * Only the ISO 3166-1 alpha-2 *codes* are listed below, because no standard API
 * enumerates them. Codes are stable reference data, unlike names.
 */

/** ISO 3166-1 alpha-2 codes. */
const COUNTRY_CODES = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AR","AT","AU","AW","AZ","BA","BB",
  "BD","BE","BF","BG","BH","BI","BJ","BM","BN","BO","BR","BS","BT","BW","BY",
  "BZ","CA","CD","CF","CG","CH","CI","CL","CM","CN","CO","CR","CU","CV","CY",
  "CZ","DE","DJ","DK","DM","DO","DZ","EC","EE","EG","ER","ES","ET","FI","FJ",
  "FM","FR","GA","GB","GD","GE","GH","GM","GN","GQ","GR","GT","GW","GY","HK",
  "HN","HR","HT","HU","ID","IE","IL","IN","IQ","IR","IS","IT","JM","JO","JP",
  "KE","KG","KH","KI","KM","KN","KP","KR","KW","KY","KZ","LA","LB","LC","LI",
  "LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MG","MH","MK","ML",
  "MM","MN","MO","MR","MT","MU","MV","MW","MX","MY","MZ","NA","NE","NG","NI",
  "NL","NO","NP","NR","NZ","OM","PA","PE","PG","PH","PK","PL","PR","PS","PT",
  "PW","PY","QA","RO","RS","RU","RW","SA","SB","SC","SD","SE","SG","SI","SK",
  "SL","SM","SN","SO","SR","SS","ST","SV","SY","SZ","TD","TG","TH","TJ","TL",
  "TM","TN","TO","TR","TT","TV","TW","TZ","UA","UG","US","UY","UZ","VC","VE",
  "VN","VU","WS","YE","ZA","ZM","ZW",
] as const;

export type CountryOption = { code: string; label: string };

let countryCache: CountryOption[] | undefined;

/**
 * Countries as `{ code, label }`, alphabetical by label.
 *
 * India sorts naturally rather than being pinned to the top: Vyom is built for
 * Indian practice, but the default value already handles that, and a list that
 * silently reorders itself is harder to scan.
 */
export function getCountries(): CountryOption[] {
  if (countryCache) return countryCache;

  const display = new Intl.DisplayNames(["en"], { type: "region" });

  countryCache = COUNTRY_CODES.map((code) => ({
    code,
    // `of()` returns the code itself for anything ICU does not recognise, which
    // is a usable fallback rather than a blank row.
    label: display.of(code) ?? code,
  })).sort((a, b) => a.label.localeCompare(b.label));

  return countryCache;
}

export function getCountryLabel(code: string): string {
  return getCountries().find((c) => c.code === code)?.label ?? code;
}

let timezoneCache: string[] | undefined;

/**
 * Identifiers ICU may omit from `supportedValuesOf` depending on its version.
 *
 * Runtimes differ on canonicalisation: some list `Asia/Calcutta` (the legacy
 * spelling) and not `Asia/Kolkata`, and several omit `UTC` entirely. Without
 * these, the default value would be missing from the picker — an Indian
 * practitioner would open the field and not find their own timezone, which is
 * the one that matters most here.
 *
 * Both spellings resolve identically, so offering both is correct rather than
 * merely convenient.
 */
const ALWAYS_INCLUDED = ["Asia/Kolkata", "UTC"] as const;

/** IANA timezone identifiers, sorted and de-duplicated. */
export function getTimezones(): string[] {
  if (timezoneCache) return timezoneCache;

  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : // Older runtimes lack the API. The field stays usable with a small set
        // rather than rendering an empty list.
        ["Asia/Calcutta", "America/New_York", "Europe/London"];

  timezoneCache = [...new Set([...supported, ...ALWAYS_INCLUDED])].sort();

  return timezoneCache;
}

/**
 * The browser's own timezone, when we can determine it and recognise it.
 *
 * Used only to pre-fill the field — never saved without the user seeing and
 * accepting it, since a VPN or a travelling user would otherwise have the wrong
 * zone written silently.
 */
export function detectTimezone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && getTimezones().includes(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** e.g. "Asia/Kolkata (GMT+5:30)" — the offset makes the list far easier to scan. */
export function formatTimezoneLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());

    const offset = parts.find((part) => part.type === "timeZoneName")?.value;
    return offset ? `${zone} (${offset})` : zone;
  } catch {
    return zone;
  }
}
