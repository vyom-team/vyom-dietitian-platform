import { describe, expect, it } from "vitest";

import {
  createPracticeSchema,
  ownerProfileSchema,
  practiceDetailsSchema,
} from "../src/validations/onboarding";

const validPractice = {
  name: "Healthy Life Nutrition",
  country: "IN",
  timezone: "Asia/Kolkata",
};

const validOwner = { fullName: "Rahul Sharma" };

describe("practice details validation", () => {
  it("accepts a minimal valid practice", () => {
    const result = practiceDetailsSchema.safeParse(validPractice);
    expect(result.success).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["  ", "whitespace only"],
    ["A", "too short"],
    ["!!!", "no letters or numbers"],
    ["x".repeat(121), "too long"],
  ])("rejects practice name %j (%s)", (name) => {
    expect(
      practiceDetailsSchema.safeParse({ ...validPractice, name }).success,
    ).toBe(false);
  });

  it("trims the practice name", () => {
    const result = practiceDetailsSchema.parse({
      ...validPractice,
      name: "  Healthy Life  ",
    });
    expect(result.name).toBe("Healthy Life");
  });

  it("accepts non-Latin practice names", () => {
    // The slug is generated separately, so the name itself need not be ASCII.
    expect(
      practiceDetailsSchema.safeParse({ ...validPractice, name: "पोषण क्लिनिक" })
        .success,
    ).toBe(true);
  });

  it("normalises the country code to uppercase", () => {
    const result = practiceDetailsSchema.parse({ ...validPractice, country: "in" });
    expect(result.country).toBe("IN");
  });

  it.each(["I", "IND", "", "1N"])("rejects country %j", (country) => {
    expect(
      practiceDetailsSchema.safeParse({ ...validPractice, country }).success,
    ).toBe(false);
  });

  it("rejects a timezone that does not exist", () => {
    // Looks plausible, is not in the IANA database.
    expect(
      practiceDetailsSchema.safeParse({
        ...validPractice,
        timezone: "Asia/Atlantis",
      }).success,
    ).toBe(false);
  });

  /*
   * ICU accepts these and silently resolves them to a guess — `IST` becomes
   * Asia/Calcutta, and `EST` becomes America/Panama, which does not observe
   * daylight saving. Storing one would drift every follow-up by an hour for
   * half the year, so they must be rejected outright.
   */
  it.each(["IST", "EST", "PST", "GMT", "CET"])(
    "rejects the ambiguous abbreviation %s",
    (timezone) => {
      expect(
        practiceDetailsSchema.safeParse({ ...validPractice, timezone }).success,
      ).toBe(false);
    },
  );

  it.each([
    "Asia/Kolkata",
    // Legacy spelling of the same zone; runtimes disagree on which is
    // canonical, so both must be accepted.
    "Asia/Calcutta",
    "America/New_York",
    "Europe/London",
    "UTC",
  ])("accepts IANA timezone %s", (timezone) => {
    expect(
      practiceDetailsSchema.safeParse({ ...validPractice, timezone }).success,
    ).toBe(true);
  });
});

describe("timezone option list", () => {
  it("contains the default value", async () => {
    // Regression guard: this runtime's ICU lists Asia/Calcutta and omits
    // Asia/Kolkata, so without an explicit addition the default would be
    // missing from the picker for Indian practitioners.
    const { getTimezones } = await import("../src/lib/locale");
    expect(getTimezones()).toContain("Asia/Kolkata");
    expect(getTimezones()).toContain("UTC");
  });

  it("offers only values the validator accepts", async () => {
    const { getTimezones } = await import("../src/lib/locale");
    const { isValidTimeZone } = await import("../src/validations/onboarding");

    const rejected = getTimezones().filter((zone) => !isValidTimeZone(zone));
    expect(rejected, "every offered timezone must pass validation").toEqual([]);
  });

  it("has no duplicates", async () => {
    const { getTimezones } = await import("../src/lib/locale");
    const zones = getTimezones();
    expect(new Set(zones).size).toBe(zones.length);
  });
});

/**
 * The website field is rendered as a link, so a non-http scheme stored here
 * would become a cross-site scripting vector for whoever clicks it.
 */
describe("website URL safety", () => {
  it.each([
    ["javascript:alert(1)", "javascript scheme"],
    ["JavaScript:alert(1)", "mixed-case javascript scheme"],
    ["data:text/html;base64,PHNjcmlwdD4=", "data scheme"],
    ["vbscript:msgbox(1)", "vbscript scheme"],
    ["file:///etc/passwd", "file scheme"],
    ["practice.com", "missing scheme"],
    ["not a url", "not a url"],
  ])("rejects %j (%s)", (website) => {
    expect(
      practiceDetailsSchema.safeParse({ ...validPractice, website }).success,
    ).toBe(false);
  });

  it.each(["https://practice.com", "http://practice.com", "https://sub.practice.co.in/path"])(
    "accepts %s",
    (website) => {
      expect(
        practiceDetailsSchema.safeParse({ ...validPractice, website }).success,
      ).toBe(true);
    },
  );

  it("treats an empty website as absent rather than invalid", () => {
    const result = practiceDetailsSchema.parse({ ...validPractice, website: "" });
    expect(result.website).toBeUndefined();
  });
});

describe("optional contact fields", () => {
  it("rejects a malformed practice email", () => {
    expect(
      practiceDetailsSchema.safeParse({ ...validPractice, email: "not-an-email" })
        .success,
    ).toBe(false);
  });

  it("lowercases the practice email", () => {
    const result = practiceDetailsSchema.parse({
      ...validPractice,
      email: "Hello@Practice.COM",
    });
    expect(result.email).toBe("hello@practice.com");
  });

  it("accepts an international phone number", () => {
    expect(
      practiceDetailsSchema.safeParse({ ...validPractice, phone: "+91 98765 43210" })
        .success,
    ).toBe(true);
  });

  it("rejects obvious phone junk", () => {
    expect(
      practiceDetailsSchema.safeParse({ ...validPractice, phone: "call me" }).success,
    ).toBe(false);
  });

  it("treats empty optional fields as absent", () => {
    const result = practiceDetailsSchema.parse({
      ...validPractice,
      email: "",
      phone: "",
      city: "",
    });
    expect(result.email).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.city).toBeUndefined();
  });
});

describe("owner profile validation", () => {
  it("requires a full name", () => {
    expect(ownerProfileSchema.safeParse({ fullName: "" }).success).toBe(false);
    expect(ownerProfileSchema.safeParse({ fullName: "R" }).success).toBe(false);
    expect(ownerProfileSchema.safeParse(validOwner).success).toBe(true);
  });

  it("keeps the professional title free text", () => {
    // Credentials vary by country and registering body; an enum would exclude
    // legitimate ones.
    for (const title of ["Registered Dietitian", "RD", "PhD, RDN", "आहार विशेषज्ञ"]) {
      expect(
        ownerProfileSchema.safeParse({ ...validOwner, professionalTitle: title })
          .success,
      ).toBe(true);
    }
  });
});

/**
 * The payload contract is the primary defence against privilege escalation:
 * the fields an attacker would want simply are not part of it.
 */
describe("privilege escalation via the payload", () => {
  it("silently drops an injected role", () => {
    const result = createPracticeSchema.parse({
      practice: validPractice,
      owner: { ...validOwner, role: "SUPER_ADMIN" },
    });
    expect(result.owner).not.toHaveProperty("role");
    expect(JSON.stringify(result)).not.toContain("SUPER_ADMIN");
  });

  it("drops an injected userId", () => {
    const result = createPracticeSchema.parse({
      practice: validPractice,
      owner: { ...validOwner, userId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(result.owner).not.toHaveProperty("userId");
  });

  it("drops an injected organizationId, slug, and status", () => {
    const result = createPracticeSchema.parse({
      practice: {
        ...validPractice,
        id: "00000000-0000-0000-0000-000000000000",
        slug: "admin",
        status: "ACTIVE",
      },
      owner: validOwner,
    });
    expect(result.practice).not.toHaveProperty("id");
    expect(result.practice).not.toHaveProperty("slug");
    expect(result.practice).not.toHaveProperty("status");
  });

  it("rejects a payload missing required sections", () => {
    expect(createPracticeSchema.safeParse({ practice: validPractice }).success).toBe(
      false,
    );
    expect(createPracticeSchema.safeParse({ owner: validOwner }).success).toBe(false);
    expect(createPracticeSchema.safeParse({}).success).toBe(false);
  });
});
