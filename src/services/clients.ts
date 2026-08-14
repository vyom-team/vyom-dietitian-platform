import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { ClientGender, ClientStatus, OrganizationRole } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { CLIENTS_PER_PAGE, type ClientListQuery } from "@/validations/client";
import { formatClientNumber, seesAllClients } from "@/lib/clients/rules";

// Re-exported so callers have one import for the client domain.
export { formatClientNumber, seesAllClients };
import type { CreateClientInput, UpdateClientInput } from "@/validations/client";

/**
 * Client domain service.
 *
 * SECURITY CONTRACT
 *
 *   `organizationId` is always supplied by the caller and is always expected to
 *   have come from the verified session, never from a request. Every query here
 *   additionally carries it in the WHERE clause, so a valid-looking client id
 *   from another practice matches nothing — the IDOR guard is at the query, not
 *   only in the layer above.
 *
 *   Role-based visibility is applied *in the database query*, never by filtering
 *   an over-fetched list in JavaScript. A dietitian's query never returns rows
 *   they may not see, so there is no window in which the data exists in process
 *   memory.
 *
 * PRIVACY: client rows contain personal data. Nothing here logs a client
 * object, name, email, phone, or address. Errors log ids and nothing more.
 */

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export type Viewer = {
  organizationId: string;
  membershipId: string;
  role: OrganizationRole;
};

/**
 * The WHERE fragment implementing that rule.
 *
 * Returned as a Prisma filter rather than applied after the fact, so the
 * restriction is part of the SQL.
 */
function visibilityFilter(viewer: Viewer): Prisma.ClientWhereInput {
  if (seesAllClients(viewer.role)) return {};

  return {
    assignments: {
      some: { organizationMemberId: viewer.membershipId, endedAt: null },
    },
  };
}

// ---------------------------------------------------------------------------
// Client number
// ---------------------------------------------------------------------------

/**
 * Reserves the next client number for a practice.
 *
 * `UPDATE ... RETURNING` on the tenant row, inside the caller's transaction.
 * The update takes a row lock, so two concurrent creations serialise and
 * receive different numbers. `count(clients) + 1` would race, and would also
 * reuse numbers once a client was archived.
 *
 * The unique index on (organization_id, client_number) is the final arbiter.
 */
async function reserveClientNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const rows = await tx.$queryRaw<{ next_client_number: number }[]>`
    UPDATE organizations
       SET next_client_number = next_client_number + 1
     WHERE id = ${organizationId}::uuid
    RETURNING next_client_number
  `;

  const next = rows[0]?.next_client_number;
  if (next === undefined) throw new Error("organization-not-found");

  // RETURNING gives the post-increment value, so the number just issued is one
  // less — the first client of a practice becomes VYM-000001.
  return formatClientNumber(next - 1);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type ClientListItem = {
  id: string;
  clientNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  status: ClientStatus;
  createdAt: Date;
  assignedName: string | null;
};

export type ClientListResult = {
  clients: ClientListItem[];
  total: number;
  page: number;
  pageCount: number;
  counts: { active: number; archived: number };
};

/**
 * Lists clients for a viewer.
 *
 * Search covers name, client number, email, and phone. It uses Prisma's
 * parameterised `contains`, never string-built SQL, so a search term cannot
 * alter the query.
 */
export async function listClients(
  viewer: Viewer,
  query: ClientListQuery,
): Promise<ClientListResult> {
  const base: Prisma.ClientWhereInput = {
    organizationId: viewer.organizationId,
    ...visibilityFilter(viewer),
  };

  const where: Prisma.ClientWhereInput = { ...base };

  if (query.status !== "all") {
    where.status = query.status === "archived" ? "ARCHIVED" : "ACTIVE";
  }

  if (query.assigned === "unassigned") {
    where.assignments = { none: { endedAt: null } };
  } else if (query.assigned) {
    // A membership id from another practice simply matches nothing, because the
    // query is already scoped to this organization's clients.
    where.assignments = {
      some: { organizationMemberId: query.assigned, endedAt: null },
    };
  }

  if (query.q) {
    const term = query.q;
    where.OR = [
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
      { clientNumber: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { phone: { contains: term } },
    ];
  }

  const page = Math.max(1, query.page);

  const [total, rows, active, archived] = await Promise.all([
    prisma.client.count({ where }),
    prisma.client.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * CLIENTS_PER_PAGE,
      take: CLIENTS_PER_PAGE,
      select: {
        id: true,
        clientNumber: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        assignments: {
          where: { endedAt: null },
          take: 1,
          select: { member: { select: { user: { select: { fullName: true } } } } },
        },
      },
    }),
    // Operational counts, scoped exactly like the list itself so a dietitian's
    // tallies match what they can actually see.
    prisma.client.count({ where: { ...base, status: "ACTIVE" } }),
    prisma.client.count({ where: { ...base, status: "ARCHIVED" } }),
  ]);

  return {
    clients: rows.map((row) => ({
      id: row.id,
      clientNumber: row.clientNumber,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      status: row.status,
      createdAt: row.createdAt,
      assignedName: row.assignments[0]?.member.user.fullName ?? null,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / CLIENTS_PER_PAGE)),
    counts: { active, archived },
  };
}

export type ClientDetail = {
  id: string;
  clientNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
  gender: ClientGender | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  status: ClientStatus;
  archivedAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
  assignedMemberId: string | null;
  assignedName: string | null;
};

/**
 * One client, or null.
 *
 * Scoped by organization *and* by the viewer's visibility, so a dietitian
 * requesting a client they are not assigned to gets null — the same answer as
 * for a client that does not exist. The caller renders a not-found page either
 * way, which prevents using the detail route to probe for valid ids.
 */
export async function getClient(
  viewer: Viewer,
  clientId: string,
): Promise<ClientDetail | null> {
  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      organizationId: viewer.organizationId,
      ...visibilityFilter(viewer),
    },
    select: {
      id: true,
      clientNumber: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      dateOfBirth: true,
      gender: true,
      addressLine: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      status: true,
      archivedAt: true,
      createdAt: true,
      createdBy: { select: { fullName: true } },
      assignments: {
        where: { endedAt: null },
        take: 1,
        select: {
          organizationMemberId: true,
          member: { select: { user: { select: { fullName: true } } } },
        },
      },
    },
  });

  if (!client) return null;

  const assignment = client.assignments[0];

  return {
    id: client.id,
    clientNumber: client.clientNumber,
    firstName: client.firstName,
    lastName: client.lastName,
    email: client.email,
    phone: client.phone,
    dateOfBirth: client.dateOfBirth,
    gender: client.gender,
    addressLine: client.addressLine,
    city: client.city,
    state: client.state,
    postalCode: client.postalCode,
    country: client.country,
    status: client.status,
    archivedAt: client.archivedAt,
    createdAt: client.createdAt,
    createdByName: client.createdBy?.fullName ?? null,
    assignedMemberId: assignment?.organizationMemberId ?? null,
    assignedName: assignment?.member.user.fullName ?? null,
  };
}

export type AssignableMember = {
  membershipId: string;
  name: string;
  role: OrganizationRole;
};

/**
 * Staff who may hold a client.
 *
 * Owners and dietitians only. `RECEPTIONIST` is excluded because a caseload is
 * clinical responsibility, and `CLIENT` and `SUPER_ADMIN` are not staff of the
 * practice at all. The list is scoped to the organization, so the assignment
 * picker can only ever offer valid targets.
 */
export async function listAssignableMembers(
  organizationId: string,
): Promise<AssignableMember[]> {
  const members = await prisma.organizationMember.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      role: { in: ["OWNER", "DIETITIAN"] },
    },
    select: {
      id: true,
      role: true,
      user: { select: { fullName: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return members.map((member) => ({
    membershipId: member.id,
    name: member.user.fullName ?? member.user.email,
    role: member.role,
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type ClientMutationResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; reason: "not-found" | "invalid-assignee" | "conflict" | "failed" };

/**
 * Verifies an assignment target belongs to this practice and may hold clients.
 *
 * The browser supplies a membership id, so this is the check that stops a
 * client being handed to another practice's staff. The database trigger backs
 * it up, but the rejection should happen here with a usable message.
 */
async function resolveAssignee(
  tx: Prisma.TransactionClient,
  organizationId: string,
  memberId: string,
): Promise<string | null> {
  const member = await tx.organizationMember.findFirst({
    where: {
      id: memberId,
      organizationId,
      status: "ACTIVE",
      role: { in: ["OWNER", "DIETITIAN"] },
    },
    select: { id: true },
  });

  return member?.id ?? null;
}

/**
 * Creates a client, optionally assigned.
 *
 * One transaction: number reservation, the client row, and the assignment
 * either all succeed or none do. A client with a reserved-but-unused number
 * would be harmless; a client whose assignment silently failed would send work
 * to nobody.
 *
 * Structured so a future `checkSubscriptionLimit(organizationId)` slots in
 * ahead of the transaction without disturbing anything else.
 */
export async function createClient(
  viewer: Viewer,
  createdByProfileId: string,
  input: CreateClientInput,
): Promise<ClientMutationResult<{ id: string; clientNumber: string }>> {
  try {
    const created = await prisma.$transaction(async (tx) => {
      let assigneeId: string | null = null;

      if (input.assignedMemberId) {
        assigneeId = await resolveAssignee(
          tx,
          viewer.organizationId,
          input.assignedMemberId,
        );
        if (!assigneeId) throw new Error("invalid-assignee");
      }

      const clientNumber = await reserveClientNumber(tx, viewer.organizationId);

      const client = await tx.client.create({
        data: {
          organizationId: viewer.organizationId,
          clientNumber,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email ?? null,
          phone: input.phone ?? null,
          dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null,
          gender: input.gender ?? null,
          addressLine: input.addressLine ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          postalCode: input.postalCode ?? null,
          country: input.country ?? null,
          createdById: createdByProfileId,
        },
        select: { id: true, clientNumber: true },
      });

      if (assigneeId) {
        await tx.clientAssignment.create({
          data: { clientId: client.id, organizationMemberId: assigneeId },
        });
      }

      return client;
    });

    return { ok: true, data: created };
  } catch (error) {
    if (error instanceof Error && error.message === "invalid-assignee") {
      return { ok: false, reason: "invalid-assignee" };
    }
    // Metadata only — never the client's details.
    console.error("[clients] create failed", {
      organizationId: viewer.organizationId,
      error,
    });
    return { ok: false, reason: "failed" };
  }
}

/** Updates a client's details. Assignment is changed separately. */
export async function updateClient(
  viewer: Viewer,
  input: UpdateClientInput,
): Promise<ClientMutationResult> {
  try {
    // Scoped by organization and visibility, so a client outside the viewer's
    // reach is simply not found.
    const existing = await prisma.client.findFirst({
      where: {
        id: input.clientId,
        organizationId: viewer.organizationId,
        ...visibilityFilter(viewer),
      },
      select: { id: true },
    });

    if (!existing) return { ok: false, reason: "not-found" };

    await prisma.client.update({
      where: { id: existing.id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        dateOfBirth: input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null,
        gender: input.gender ?? null,
        addressLine: input.addressLine ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country ?? null,
      },
    });

    return { ok: true, data: undefined };
  } catch (error) {
    console.error("[clients] update failed", {
      organizationId: viewer.organizationId,
      clientId: input.clientId,
      error,
    });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Archives or restores a client.
 *
 * Never a delete. Assessments, plans, and progress records will reference
 * clients, and clinical records carry retention obligations — so the row stays
 * and its status changes.
 *
 * Assignments are left untouched by archiving: who was responsible for a client
 * is information a practice may need long after the client goes inactive.
 */
export async function setClientStatus(
  viewer: Viewer,
  clientId: string,
  status: ClientStatus,
): Promise<ClientMutationResult> {
  try {
    const result = await prisma.client.updateMany({
      where: { id: clientId, organizationId: viewer.organizationId },
      data: {
        status,
        archivedAt: status === "ARCHIVED" ? new Date() : null,
      },
    });

    return result.count === 1
      ? { ok: true, data: undefined }
      : { ok: false, reason: "not-found" };
  } catch (error) {
    console.error("[clients] status change failed", {
      organizationId: viewer.organizationId,
      clientId,
      status,
      error,
    });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Assigns, reassigns, or unassigns a client.
 *
 * Reassignment ends the current assignment rather than overwriting it, so the
 * practice keeps a record of who was responsible and when. `null` unassigns.
 */
export async function assignClient(
  viewer: Viewer,
  clientId: string,
  memberId: string | null,
): Promise<ClientMutationResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const client = await tx.client.findFirst({
        where: { id: clientId, organizationId: viewer.organizationId },
        select: { id: true },
      });

      if (!client) return { ok: false, reason: "not-found" as const };

      let assigneeId: string | null = null;
      if (memberId) {
        assigneeId = await resolveAssignee(tx, viewer.organizationId, memberId);
        if (!assigneeId) return { ok: false, reason: "invalid-assignee" as const };
      }

      // Close the current assignment. Ended rows are exempt from the partial
      // unique index, so the new one can be opened immediately.
      await tx.clientAssignment.updateMany({
        where: { clientId: client.id, endedAt: null },
        data: { endedAt: new Date() },
      });

      if (assigneeId) {
        await tx.clientAssignment.create({
          data: { clientId: client.id, organizationMemberId: assigneeId },
        });
      }

      return { ok: true as const, data: undefined };
    });
  } catch (error) {
    console.error("[clients] assignment failed", {
      organizationId: viewer.organizationId,
      clientId,
      error,
    });
    return { ok: false, reason: "failed" };
  }
}
