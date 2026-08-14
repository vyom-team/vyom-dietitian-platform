import { describe, expect, it } from "vitest";

import {
  assignClientSchema,
  clientListQuerySchema,
  createClientSchema,
  updateClientSchema,
} from "../src/validations/client";
import { formatClientNumber, seesAllClients } from "../src/lib/clients/rules";

const valid = { firstName: "Rahul", lastName: "Sharma" };
const uuid = "3f7c1a3e-2b6d-4f1e-9c8a-1d2e3f4a5b6c";

describe("client name validation", () => {
  it("accepts a minimal client", () => {
    expect(createClientSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["Priya", "Iyer"],
    ["Jean-Luc", "Picard"],
    ["Mary", "O'Brien"],
    ["राहुल", "शर्मा"],
    ["José", "Núñez"],
    ["Ana Maria", "da Silva"],
  ])("accepts the international name %s %s", (firstName, lastName) => {
    expect(createClientSchema.safeParse({ firstName, lastName }).success).toBe(true);
  });

  it.each(["", "   ", "123", "!!!", "-"])("rejects the name %j", (firstName) => {
    expect(createClientSchema.safeParse({ ...valid, firstName }).success).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    const parsed = createClientSchema.parse({
      firstName: "  Rahul  ",
      lastName: "  Sharma  ",
    });
    expect(parsed.firstName).toBe("Rahul");
    expect(parsed.lastName).toBe("Sharma");
  });

  it("caps name length", () => {
    expect(
      createClientSchema.safeParse({ ...valid, firstName: "x".repeat(81) }).success,
    ).toBe(false);
  });
});

describe("optional client fields", () => {
  it("treats empty strings as absent", () => {
    const parsed = createClientSchema.parse({
      ...valid,
      email: "",
      phone: "",
      city: "",
      dateOfBirth: "",
      gender: "",
    });
    expect(parsed.email).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
    expect(parsed.city).toBeUndefined();
    expect(parsed.dateOfBirth).toBeUndefined();
    expect(parsed.gender).toBeUndefined();
  });

  it("lowercases the email", () => {
    const parsed = createClientSchema.parse({ ...valid, email: "R.Sharma@Mail.COM" });
    expect(parsed.email).toBe("r.sharma@mail.com");
  });

  it("rejects a malformed email", () => {
    expect(createClientSchema.safeParse({ ...valid, email: "nope" }).success).toBe(
      false,
    );
  });

  it("accepts an international phone number", () => {
    expect(
      createClientSchema.safeParse({ ...valid, phone: "+91 98765 43210" }).success,
    ).toBe(true);
  });

  it("rejects obvious phone junk", () => {
    expect(
      createClientSchema.safeParse({ ...valid, phone: "call me" }).success,
    ).toBe(false);
  });
});

describe("date of birth", () => {
  it("accepts a plausible date", () => {
    expect(
      createClientSchema.safeParse({ ...valid, dateOfBirth: "1990-05-14" }).success,
    ).toBe(true);
  });

  it("rejects a future date", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect(
      createClientSchema.safeParse({ ...valid, dateOfBirth: future }).success,
    ).toBe(false);
  });

  it("rejects an implausibly distant past", () => {
    // Catches a mistyped century, e.g. 1090 for 1990.
    expect(
      createClientSchema.safeParse({ ...valid, dateOfBirth: "1090-01-01" }).success,
    ).toBe(false);
  });

  it.each(["not-a-date", "2024-13-01", "14/05/1990"])(
    "rejects malformed date %j",
    (dateOfBirth) => {
      expect(
        createClientSchema.safeParse({ ...valid, dateOfBirth }).success,
      ).toBe(false);
    },
  );
});

/**
 * The payload contract is the primary defence: the fields an attacker would
 * want to control are not part of it.
 */
describe("client payload cannot carry privileged fields", () => {
  it("drops an injected organizationId", () => {
    const parsed = createClientSchema.parse({
      ...valid,
      organizationId: "11111111-1111-1111-1111-111111111111",
    });
    expect(parsed).not.toHaveProperty("organizationId");
  });

  it("drops an injected clientNumber", () => {
    // Server-generated. Accepting one would allow collisions and impersonation
    // of another client's identifier.
    const parsed = createClientSchema.parse({ ...valid, clientNumber: "VYM-000001" });
    expect(parsed).not.toHaveProperty("clientNumber");
  });

  it("drops injected status and archivedAt", () => {
    const parsed = createClientSchema.parse({
      ...valid,
      status: "ARCHIVED",
      archivedAt: new Date().toISOString(),
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("archivedAt");
  });

  it("drops an injected createdById", () => {
    const parsed = createClientSchema.parse({ ...valid, createdById: uuid });
    expect(parsed).not.toHaveProperty("createdById");
  });

  it("has no clinical fields at all", () => {
    // Phase 6 stores no health data. If any of these ever parse, a clinical
    // value has leaked into an administrative model.
    const parsed = createClientSchema.parse({
      ...valid,
      weight: 70,
      height: 170,
      bmi: 24,
      allergies: "peanuts",
      medications: "none",
      medicalConditions: "diabetes",
      calories: 2000,
    });
    for (const field of [
      "weight",
      "height",
      "bmi",
      "allergies",
      "medications",
      "medicalConditions",
      "calories",
    ]) {
      expect(parsed, `${field} must not be accepted`).not.toHaveProperty(field);
    }
  });

  it("requires a uuid client id on update", () => {
    for (const clientId of ["1", "abc", "", "../../etc"]) {
      expect(
        updateClientSchema.safeParse({ clientId, ...valid }).success,
      ).toBe(false);
    }
    expect(updateClientSchema.safeParse({ clientId: uuid, ...valid }).success).toBe(
      true,
    );
  });

  it("requires a uuid membership id on assignment", () => {
    expect(
      assignClientSchema.safeParse({ clientId: uuid, assignedMemberId: "nope" })
        .success,
    ).toBe(false);
    expect(
      assignClientSchema.safeParse({ clientId: uuid, assignedMemberId: uuid }).success,
    ).toBe(true);
  });

  it("treats an empty assignment as unassigned rather than invalid", () => {
    const parsed = assignClientSchema.parse({ clientId: uuid, assignedMemberId: "" });
    expect(parsed.assignedMemberId).toBeUndefined();
  });
});

/**
 * The list query comes from the URL, so every value is attacker-controlled.
 * Nonsense is clamped rather than thrown, because a hand-edited URL should show
 * page one, not an error page.
 */
describe("list query parsing", () => {
  it("defaults to active clients on page one", () => {
    const parsed = clientListQuerySchema.parse({});
    expect(parsed.status).toBe("active");
    expect(parsed.page).toBe(1);
  });

  it.each(["abc", "-5", "0", "", "9e99"])("clamps page %j to 1", (page) => {
    expect(clientListQuerySchema.parse({ page }).page).toBe(1);
  });

  it("falls back to active for an unknown status", () => {
    expect(clientListQuerySchema.parse({ status: "deleted" }).status).toBe("active");
    expect(clientListQuerySchema.parse({ status: "'; DROP TABLE" }).status).toBe(
      "active",
    );
  });

  it("keeps a search term as an opaque string", () => {
    // Passed to Prisma's parameterised `contains`, never concatenated into SQL.
    const hostile = "'; DROP TABLE clients; --";
    expect(clientListQuerySchema.parse({ q: hostile }).q).toBe(hostile);
  });

  it("caps the search term length", () => {
    expect(clientListQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(
      false,
    );
  });

  it("normalises 'all' assignment to undefined", () => {
    expect(clientListQuerySchema.parse({ assigned: "all" }).assigned).toBeUndefined();
    expect(clientListQuerySchema.parse({ assigned: "" }).assigned).toBeUndefined();
  });
});

describe("client number formatting", () => {
  it("zero-pads to six digits", () => {
    expect(formatClientNumber(1)).toBe("VYM-000001");
    expect(formatClientNumber(42)).toBe("VYM-000042");
    expect(formatClientNumber(999_999)).toBe("VYM-999999");
  });

  it("does not truncate beyond the padding width", () => {
    expect(formatClientNumber(1_000_000)).toBe("VYM-1000000");
  });

  it("is readable aloud — no ambiguous separators", () => {
    expect(formatClientNumber(124)).toMatch(/^VYM-\d{6}$/);
  });
});

describe("role visibility rule", () => {
  it("gives owners and receptionists the whole practice", () => {
    expect(seesAllClients("OWNER")).toBe(true);
    expect(seesAllClients("RECEPTIONIST")).toBe(true);
  });

  it("limits dietitians to their own caseload", () => {
    expect(seesAllClients("DIETITIAN")).toBe(false);
  });

  it("gives a client-role member nothing", () => {
    // Belt and braces: requireClientContext already rejects CLIENT outright.
    expect(seesAllClients("CLIENT")).toBe(false);
  });
});
