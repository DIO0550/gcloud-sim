import { type CommandSpec, Flag, ParsedArgs, Positional } from "@/engine/cli/command-spec";
import {
  type IdentityGroup,
  type IdentityUser,
  patchAdmin,
  validateAdminLab,
} from "@/engine/domains/admin-lab/model";
import type { JsonRecord } from "@/types/Json";
import { Result } from "@/utils/Result";
import { finish, invalid, missing, records, scoped, sf, text } from "./shared";

export const IdentityCustomer = "C01simulator";
const userRecord = (u: IdentityUser): JsonRecord => ({
  id: `SIMULATED-${u.email}`,
  userName: u.email,
  name: { givenName: u.givenName, familyName: u.familyName },
  active: u.active,
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  customer: u.customer,
});
const groupRecord = (g: IdentityGroup): JsonRecord => ({
  name: `groups/SIMULATED-${g.email}`,
  groupKey: { id: g.email },
  displayName: g.displayName,
  parent: `customers/${g.customer}`,
  labels: { "cloudidentity.googleapis.com/groups.discussion_forum": "" },
  members: [...g.members],
});
const organizationScope = (ctx: import("@/engine/cli/command-spec").CommandContext) =>
  Result.ok(`organizations/${ctx.world.organization.id}`);
const adminPermission = "resourcemanager.organizations.setIamPolicy";
export const IdentityCommands: readonly CommandSpec[] = [
  ...["create", "describe", "list", "update", "delete"].map((op) =>
    scoped({
      path: ["sim", "identity", "users", op],
      api: "cloudidentityscim.googleapis.com",
      permission: adminPermission,
      scope: organizationScope,
      positionals:
        op === "list"
          ? []
          : [
              Positional.required("EMAIL", "SCIM teaching user email.", (w) =>
                w.adminLab.users.map((u) => u.email),
              ),
            ],
      flags: [
        sf("customer", true),
        ...(op === "create" ? [sf("given-name", true), sf("family-name", true)] : []),
        ...(op === "update"
          ? [Flag.boolean("active", "Activate the user (--no-active disables).")]
          : []),
      ],
      destructive: op === "delete",
      run: (ctx, a) => {
        if (text(a, "customer") !== IdentityCustomer) {
          return invalid(`This organization is mapped to teaching customer ${IdentityCustomer}.`);
        }
        const users = ctx.world.adminLab.users;
        const email = op === "list" ? "" : ParsedArgs.requiredPositional(a, 0);
        const existing = users.find((u) => u.email === email && u.customer === IdentityCustomer);
        if (op === "list") {
          return records(ctx.world, users.map(userRecord));
        }
        if (op === "describe") {
          return existing
            ? finish(ctx.world, userRecord(existing))
            : missing("Identity user not found.");
        }
        if (op === "delete") {
          if (!existing) {
            return missing("Identity user not found.");
          }
          if (ctx.world.adminLab.groups.some((g) => g.members.includes(email))) {
            return invalid("Remove group memberships before deleting the user.");
          }
          return finish(patchAdmin(ctx.world, { users: users.filter((u) => u !== existing) }), {
            deleted: email,
          });
        }
        if (op === "update") {
          if (!existing) {
            return missing("Identity user not found.");
          }
          if (!ParsedArgs.has(a, "active")) {
            return invalid("Specify --active or --no-active.");
          }
          const updated = { ...existing, active: ParsedArgs.boolean(a, "active") };
          return finish(
            patchAdmin(ctx.world, { users: users.map((u) => (u === existing ? updated : u)) }),
            userRecord(updated),
          );
        }
        if (existing) {
          return invalid("Identity user already exists.");
        }
        const user: IdentityUser = {
          email,
          customer: IdentityCustomer,
          givenName: text(a, "given-name"),
          familyName: text(a, "family-name"),
          active: true,
        };
        const world = patchAdmin(ctx.world, { users: [...users, user] });
        const validation = validateAdminLab(world);
        return validation.ok ? finish(world, userRecord(user)) : invalid(validation.error);
      },
    }),
  ),
  ...["create", "describe", "search", "delete"].map((op) =>
    scoped({
      path: ["gcloud", "identity", "groups", op],
      api: "cloudidentity.googleapis.com",
      permission: adminPermission,
      scope: organizationScope,
      positionals:
        op === "search"
          ? []
          : [
              Positional.required("GROUP_EMAIL", "Teaching group email.", (w) =>
                w.adminLab.groups.map((g) => g.email),
              ),
            ],
      flags: [
        ...(op === "create" || op === "search" ? [sf("customer"), sf("organization")] : []),
        ...(op === "create" ? [sf("display-name")] : []),
        ...(op === "search" ? [sf("labels", true)] : []),
      ],
      destructive: op === "delete",
      run: (ctx, a) => {
        if (op === "create" || op === "search") {
          if (ParsedArgs.has(a, "customer") === ParsedArgs.has(a, "organization")) {
            return invalid("Specify exactly one of --customer or --organization.");
          }
          if (
            (ParsedArgs.has(a, "customer") && text(a, "customer") !== IdentityCustomer) ||
            (ParsedArgs.has(a, "organization") &&
              text(a, "organization") !== ctx.world.organization.id)
          ) {
            return invalid("Unknown identity customer/organization mapping.");
          }
        }
        const groups = ctx.world.adminLab.groups;
        const email = op === "search" ? "" : ParsedArgs.requiredPositional(a, 0);
        const existing = groups.find((g) => g.email === email);
        if (op === "search") {
          if (text(a, "labels") !== "cloudidentity.googleapis.com/groups.discussion_forum") {
            return invalid("Only discussion-forum groups are modeled.");
          }
          return records(ctx.world, groups.map(groupRecord));
        }
        if (op === "describe") {
          return existing
            ? finish(ctx.world, groupRecord(existing))
            : missing("Identity group not found.");
        }
        if (op === "delete") {
          if (!existing) {
            return missing("Identity group not found.");
          }
          return finish(patchAdmin(ctx.world, { groups: groups.filter((g) => g !== existing) }), {
            deleted: email,
          });
        }
        if (existing) {
          return invalid("Identity group already exists.");
        }
        const group: IdentityGroup = {
          email,
          customer: IdentityCustomer,
          displayName: text(a, "display-name", email),
          members: [],
        };
        const world = patchAdmin(ctx.world, { groups: [...groups, group] });
        const validation = validateAdminLab(world);
        return validation.ok ? finish(world, groupRecord(group)) : invalid(validation.error);
      },
    }),
  ),
  ...["add", "delete", "list"].map((op) =>
    scoped({
      path: ["gcloud", "identity", "groups", "memberships", op],
      api: "cloudidentity.googleapis.com",
      permission: adminPermission,
      scope: organizationScope,
      flags: [sf("group-email", true), ...(op === "list" ? [] : [sf("member-email", true)])],
      run: (ctx, a) => {
        const group = ctx.world.adminLab.groups.find((g) => g.email === text(a, "group-email"));
        if (!group) {
          return missing("Identity group not found.");
        }
        if (op === "list") {
          return records(
            ctx.world,
            group.members.map((email) => ({
              preferredMemberKey: { id: email },
              roles: [{ name: "MEMBER" }],
            })),
          );
        }
        const email = text(a, "member-email");
        if (
          !ctx.world.adminLab.users.some(
            (u) =>
              u.email === email && u.customer === group.customer && (op === "delete" || u.active),
          )
        ) {
          return invalid(
            "Choose an active user in the same customer. Nested groups and external members are unsupported.",
          );
        }
        if (op === "delete" && !group.members.includes(email)) {
          return missing("Membership not found.");
        }
        const members =
          op === "add"
            ? [...new Set([...group.members, email])]
            : group.members.filter((m) => m !== email);
        const updated = { ...group, members };
        return finish(
          patchAdmin(ctx.world, {
            groups: ctx.world.adminLab.groups.map((g) => (g === group ? updated : g)),
          }),
          groupRecord(updated),
        );
      },
    }),
  ),
];
