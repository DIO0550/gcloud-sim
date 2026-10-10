import { CommandFailure } from "@/engine/cli/command-failure";
import { CommandContext, type CommandSpec, Flag, ParsedArgs } from "@/engine/cli/command-spec";
import { ProtocolRule } from "@/engine/domains/compute";
import { type DnsRecord, type PolicyRule, patchNetwork } from "@/engine/domains/network-lab/model";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import { Result } from "@/utils/Result";
import {
  command,
  finish,
  integer,
  invalid,
  lifecycle,
  list,
  missing,
  name,
  ref,
  rf,
  sf,
  text,
  zf,
} from "./shared";

const records = ["gcloud", "dns", "record-sets"];
const policies = ["gcloud", "compute", "network-firewall-policies"];
const recordFlags = [
  sf("zone", true),
  Flag.enum("type", "Supported record type.", ["A", "CNAME", "TXT"], { required: true }),
];
export const SecurityDnsCommands: readonly CommandSpec[] = [
  command(
    ["gcloud", "compute", "networks", "update"],
    "compute.networks.update",
    (c, a) => {
      const n = c.world.networks.find(
        (n) => n.projectId === c.project.projectId && n.name === name(a),
      );
      if (!n) {
        return missing("VPC network not found.");
      }
      const updated = {
        ...n,
        firewallPolicyOrder: text(a, "network-firewall-policy-enforcement-order") as
          | "BEFORE_CLASSIC_FIREWALL"
          | "AFTER_CLASSIC_FIREWALL",
      };
      return finish(
        { ...c.world, networks: c.world.networks.map((v) => (v === n ? updated : v)) },
        updated,
      );
    },
    [
      Flag.enum(
        "network-firewall-policy-enforcement-order",
        "Policy/classic rule order.",
        ["BEFORE_CLASSIC_FIREWALL", "AFTER_CLASSIC_FIREWALL"],
        { required: true },
      ),
    ],
  ),
  ...["create", "update", "delete", "describe"].map((op) =>
    command(
      [...records, op],
      `dns.resourceRecordSets.${op === "describe" ? "get" : op}`,
      (c, a) => {
        const zone = text(a, "zone");
        if (!c.world.dnsZones.some((z) => z.projectId === c.project.projectId && z.name === zone)) {
          return missing("Managed zone not found in this project.");
        }
        const found = c.world.networkLab.records.find(
          (r) =>
            r.projectId === c.project.projectId &&
            r.zone === zone &&
            r.name === name(a) &&
            r.type === text(a, "type"),
        );
        if (op === "create" && found) {
          return invalid("Record set already exists; use update.");
        }
        if (op !== "create" && !found) {
          return missing("Record set not found for this zone/name/type.");
        }
        if (op === "describe" && found) {
          return finish(c.world, found);
        }
        if (op === "delete") {
          return finish(
            patchNetwork(c.world, {
              records: c.world.networkLab.records.filter((r) => r !== found),
            }),
            { deleted: name(a) },
          );
        }
        const created: DnsRecord = {
          projectId: c.project.projectId,
          name: name(a),
          region: "global",
          zone,
          type: text(a, "type") as DnsRecord["type"],
          ttl: integer(a, "ttl", 300),
          data: ParsedArgs.list(a, "rrdatas"),
        };
        return finish(
          patchNetwork(c.world, {
            records: [...c.world.networkLab.records.filter((r) => r !== found), created],
          }),
          created,
        );
      },
      [
        ...recordFlags,
        ...(["create", "update"].includes(op)
          ? [
              Flag.integer("ttl", "1..86400 seconds."),
              Flag.list("rrdatas", "IPv4, absolute CNAME or short TXT strings.", {
                required: true,
              }),
            ]
          : []),
      ],
      true,
      "dns.googleapis.com",
      op === "delete",
      "records",
    ),
  ),
  command(
    [...records, "list"],
    "dns.resourceRecordSets.list",
    (c, a) => {
      if (
        !c.world.dnsZones.some(
          (z) => z.projectId === c.project.projectId && z.name === text(a, "zone"),
        )
      ) {
        return missing("Managed zone not found.");
      }
      return list(
        c.world,
        c.world.networkLab.records.filter(
          (r) => r.projectId === c.project.projectId && r.zone === text(a, "zone"),
        ),
      );
    },
    [sf("zone", true)],
    false,
    "dns.googleapis.com",
  ),
  command(
    ["gcloud", "dns", "managed-zones", "update"],
    "dns.managedZones.update",
    (c, a) => {
      const found = c.world.dnsZones.find(
        (z) => z.projectId === c.project.projectId && z.name === name(a),
      );
      if (!found) {
        return missing("Managed zone not found.");
      }
      if (found.visibility !== "private") {
        return invalid("Only private-zone network authorization updates are modeled.");
      }
      const updated = { ...found, networks: ParsedArgs.list(a, "networks") };
      return finish(
        { ...c.world, dnsZones: c.world.dnsZones.map((z) => (z === found ? updated : z)) },
        updated,
      );
    },
    [Flag.list("networks", "Authorized VPC names in the zone project.", { required: true })],
    true,
    "dns.googleapis.com",
  ),
  command(
    ["gcloud", "dns", "managed-zones", "delete"],
    "dns.managedZones.delete",
    (c, a) => {
      const found = c.world.dnsZones.find(
        (z) => z.projectId === c.project.projectId && z.name === name(a),
      );
      if (!found) {
        return missing("Managed zone not found.");
      }
      return finish(
        { ...c.world, dnsZones: c.world.dnsZones.filter((z) => z !== found) },
        { deleted: name(a) },
      );
    },
    [],
    true,
    "dns.googleapis.com",
    true,
  ),
  command(
    ["gcloud", "compute", "firewall-rules", "update"],
    "compute.firewalls.update",
    (c, a) => {
      const f = c.world.firewallRules.find(
        (f) => f.projectId === c.project.projectId && f.name === name(a),
      );
      if (!f) {
        return missing("Firewall rule not found.");
      }
      const supported = [
        "priority",
        "source-ranges",
        "destination-ranges",
        "target-tags",
        "target-service-accounts",
        "source-service-accounts",
        "allow",
        "deny",
        "disabled",
        "enable-logging",
      ];
      if (!supported.some((k) => ParsedArgs.has(a, k))) {
        return invalid("Specify at least one supported update flag.");
      }
      if (ParsedArgs.has(a, "allow") && ParsedArgs.has(a, "deny")) {
        return invalid("Choose --allow or --deny.");
      }
      const protocols = Result.all(
        ParsedArgs.list(a, ParsedArgs.has(a, "deny") ? "deny" : "allow").map(ProtocolRule.parse),
      );
      if (!protocols.ok) {
        return invalid(protocols.error);
      }
      const ranges = (k: string, previous: readonly string[]) =>
        ParsedArgs.has(a, k) ? ParsedArgs.list(a, k) : previous;
      const updated = {
        ...f,
        priority: integer(a, "priority", f.priority),
        sourceRanges: ranges("source-ranges", f.sourceRanges),
        destinationRanges: ranges("destination-ranges", f.destinationRanges),
        targetTags: ranges("target-tags", f.targetTags),
        targetServiceAccounts: ranges("target-service-accounts", f.targetServiceAccounts ?? []),
        sourceServiceAccounts: ranges("source-service-accounts", f.sourceServiceAccounts ?? []),
        disabled: ParsedArgs.has(a, "disabled") ? ParsedArgs.boolean(a, "disabled") : f.disabled,
        logging: ParsedArgs.has(a, "enable-logging")
          ? ParsedArgs.boolean(a, "enable-logging")
          : f.logging,
        allowed: ParsedArgs.has(a, "allow") ? protocols.value : f.allowed,
        denied: ParsedArgs.has(a, "deny") ? protocols.value : f.denied,
      };
      if (ParsedArgs.has(a, "allow")) {
        updated.denied = [];
      }
      if (ParsedArgs.has(a, "deny")) {
        updated.allowed = [];
      }
      return finish(
        { ...c.world, firewallRules: c.world.firewallRules.map((v) => (v === f ? updated : v)) },
        updated,
      );
    },
    [
      Flag.integer("priority", "0..65535."),
      ...[
        "source-ranges",
        "destination-ranges",
        "target-tags",
        "target-service-accounts",
        "source-service-accounts",
        "allow",
        "deny",
      ].map((k) => Flag.list(k, `Update ${k}.`)),
      Flag.boolean("disabled", "Disable rule."),
      Flag.boolean("enable-logging", "Record explicit checks."),
    ],
  ),
  command(
    ["sim", "network", "secure-tags", "bind"],
    "compute.instances.createTagBinding",
    (c, a) =>
      Result.flatMap(CommandContext.resolveZone(c, ParsedArgs.string(a, "zone")), (zone) => {
        if (
          !c.world.instances.some(
            (i) => i.projectId === c.project.projectId && i.zone === zone && i.name === name(a),
          )
        ) {
          return missing("VM not found in this project/zone.");
        }
        const binding = {
          projectId: c.project.projectId,
          name: name(a),
          region: zone.slice(0, -2),
          instance: name(a),
          zone,
          tags: ParsedArgs.list(a, "tags"),
        };
        return finish(
          patchNetwork(c.world, {
            secureTags: [
              ...c.world.networkLab.secureTags.filter(
                (t) =>
                  t.projectId !== binding.projectId ||
                  t.instance !== binding.instance ||
                  t.zone !== zone,
              ),
              binding,
            ],
          }),
          binding,
        );
      }),
    [
      zf,
      Flag.list("tags", "Synthetic pre-provisioned tagValues/NUMBER identifiers.", {
        required: true,
      }),
    ],
  ),
  command(
    [...policies, "create"],
    "compute.firewallPolicies.create",
    (c, a) =>
      Result.flatMap(ref(c, a), (r) => {
        const created = { ...r, network: "", association: "", rules: [] };
        return finish(
          patchNetwork(c.world, { policies: [...c.world.networkLab.policies, created] }),
          created,
        );
      }),
    [Flag.boolean("global", "Global network firewall policy.")],
  ),
  ...lifecycle(policies, "policies", "compute.firewallPolicies", false, [
    Flag.boolean("global", "Global scope."),
  ]),
  ...["create", "delete"].map((op) =>
    command(
      [...policies, "associations", op],
      "compute.firewallPolicies.use",
      (c, a) => {
        const p = c.world.networkLab.policies.find(
          (p) => p.projectId === c.project.projectId && p.name === text(a, "firewall-policy"),
        );
        if (!p) {
          return missing("Network firewall policy not found.");
        }
        if (
          !allows(c.world, c.project.projectId, c.principal, "compute.networks.setFirewallPolicy")
        ) {
          return Result.err(
            CommandFailure.permissionDenied({
              permission: "compute.networks.setFirewallPolicy",
              target: { type: "project", id: c.project.projectId },
              rolesIncluding: ["roles/compute.networkAdmin"],
            }),
          );
        }
        if (op === "create" && p.network) {
          return invalid(
            "This lesson models one VPC association per policy. Delete the association first.",
          );
        }
        if (op === "delete" && (!p.network || p.association !== name(a))) {
          return missing("Policy has no VPC association.");
        }
        const updated = {
          ...p,
          network: op === "create" ? text(a, "network") : "",
          association: op === "create" ? name(a) : "",
        };
        return finish(
          patchNetwork(c.world, {
            policies: c.world.networkLab.policies.map((v) => (v === p ? updated : v)),
          }),
          { ...updated, association: name(a) },
        );
      },
      [
        sf("firewall-policy", true),
        sf("network", op === "create"),
        Flag.boolean("global-firewall-policy", "Global policy."),
      ],
      true,
      "compute.googleapis.com",
      op === "delete",
    ),
  ),
  ...["create", "delete"].map((op) =>
    command(
      [...policies, "rules", op],
      "compute.firewallPolicies.update",
      (c, a) => {
        const p = c.world.networkLab.policies.find(
          (p) => p.projectId === c.project.projectId && p.name === text(a, "firewall-policy"),
        );
        if (!p) {
          return missing("Network firewall policy not found.");
        }
        const priority = Number(name(a));
        if (!/^\d+$/.test(name(a)) || !Number.isInteger(priority)) {
          return invalid("Rule priority must be an integer.");
        }
        const found = p.rules.find((r) => r.priority === priority);
        if (op === "delete" && !found) {
          return missing("Policy rule not found at priority.");
        }
        if (op === "create" && found) {
          return invalid("Policy rule priority already used.");
        }
        let rules = p.rules.filter((r) => r !== found);
        if (op === "create") {
          const parsed = Result.all(ParsedArgs.list(a, "layer4-configs").map(ProtocolRule.parse));
          if (!parsed.ok) {
            return invalid(parsed.error);
          }
          const rule: PolicyRule = {
            priority,
            direction: text(a, "direction", "INGRESS") as PolicyRule["direction"],
            action: text(a, "action") as PolicyRule["action"],
            protocols: parsed.value,
            sourceRanges: ParsedArgs.list(a, "src-ip-ranges"),
            destinationRanges: ParsedArgs.list(a, "dest-ip-ranges"),
            secureTags: ParsedArgs.list(a, "target-secure-tags"),
            logging: ParsedArgs.boolean(a, "enable-logging"),
          };
          rules = [...rules, rule];
        }
        const updated = { ...p, rules };
        return finish(
          patchNetwork(c.world, {
            policies: c.world.networkLab.policies.map((v) => (v === p ? updated : v)),
          }),
          updated,
        );
      },
      [
        sf("firewall-policy", true),
        Flag.boolean("global-firewall-policy", "Global policy."),
        ...(op === "create"
          ? [
              Flag.enum("action", "L3/L4 only; inspection is unsupported.", ["allow", "deny"], {
                required: true,
              }),
              Flag.enum("direction", "Traffic direction.", ["INGRESS", "EGRESS"]),
              Flag.list("layer4-configs", "Protocols and ports.", { required: true }),
              Flag.list("src-ip-ranges", "Canonical IPv4 source ranges."),
              Flag.list("dest-ip-ranges", "Canonical IPv4 destination ranges."),
              Flag.list("target-secure-tags", "Synthetic secure tag IDs."),
              Flag.boolean("enable-logging", "Record matching checks."),
            ]
          : []),
      ],
      true,
      "compute.googleapis.com",
      op === "delete",
    ),
  ),
  command(
    ["gcloud", "compute", "routers", "delete"],
    "compute.routers.delete",
    (c, a) =>
      Result.flatMap(ref(c, a, true), (r) => {
        const router = c.world.routers.find(
          (v) => v.projectId === r.projectId && v.region === r.region && v.name === r.name,
        );
        if (!router) {
          return missing("Cloud Router not found in scope.");
        }
        return finish(
          { ...c.world, routers: c.world.routers.filter((v) => v !== router) },
          { deleted: r.name },
        );
      }),
    [rf],
    true,
    "compute.googleapis.com",
    true,
  ),
];
