import { Scope } from "@/engine/domains/compute";
import type { Expression, HclBody } from "@/engine/domains/terraform/hcl";
import { type TfResource, TfResources } from "@/engine/domains/terraform/resources";

type Scalar = string | number | boolean;
type Evaluate = (expression: Expression | undefined) => Scalar | undefined;
const fail = (message: string): never => {
  throw new Error(message);
};
const text = (v: Scalar | undefined, name: string): string =>
  typeof v === "string" && v ? v : fail(`${name} must be a non-empty string.`);
const bool = (v: Scalar | undefined, name: string, fallback = false): boolean =>
  v === undefined ? fallback : typeof v === "boolean" ? v : fail(`${name} must be bool.`);
const number = (v: Scalar | undefined, name: string, fallback: number): number =>
  v === undefined ? fallback : typeof v === "number" ? v : fail(`${name} must be number.`);
const check = (
  body: HclBody,
  attributes: readonly string[],
  blocks: readonly string[] = [],
): void => {
  for (const key of Object.keys(body.attributes))
    if (!attributes.includes(key)) fail(`Unsupported attribute: ${key}`);
  for (const block of body.blocks)
    if (block.labels.length || !blocks.includes(block.type))
      fail(`Unsupported nested block: ${block.type}`);
};
const one = (body: HclBody, name: string, required = false): HclBody => {
  const found = body.blocks.filter((b) => b.type === name);
  if (found.length > 1 || (required && !found.length))
    fail(`Expected ${required ? "exactly" : "at most"} one ${name} block.`);
  return found[0]?.body ?? { attributes: {}, blocks: [] };
};
const list = (
  expr: Expression | undefined,
  evaluate: Evaluate,
  name: string,
): readonly string[] => {
  if (expr === undefined) return [];
  if (typeof expr !== "object" || !("list" in expr))
    return fail(`${name} must be a list of strings.`);
  return [...new Set(expr.list.map((v) => text(evaluate(v), name)))].sort();
};
const reference = (raw: string, project: string, collection: string, region?: string): string => {
  const path = raw.replace("https://www.googleapis.com/compute/v1/", "");
  if (!path.includes("/")) return path;
  const prefix = `projects/${project}/${region ? `regions/${region}` : "global"}/${collection}/`;
  if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/"))
    fail(`Cross-project, location mismatch or invalid ${collection} reference.`);
  return path.slice(prefix.length);
};
export const TfResourceConfiguration = {
  compile(
    type: string,
    address: string,
    body: HclBody,
    evaluate: Evaluate,
    provider: Readonly<Record<string, Scalar | undefined>>,
  ): TfResource {
    const attr = (name: string) => evaluate(body.attributes[name]);
    const name = text(attr("name"), "name");
    const project = text(attr("project") ?? provider.project, "project");
    const base = { address, project, name };
    if (type === "google_storage_bucket") {
      check(
        body,
        [
          "name",
          "project",
          "location",
          "storage_class",
          "uniform_bucket_level_access",
          "public_access_prevention",
          "force_destroy",
        ],
        ["versioning"],
      );
      const versioning = one(body, "versioning");
      check(versioning, ["enabled"]);
      if (body.blocks.length && versioning.attributes.enabled === undefined)
        fail("versioning requires enabled.");
      const prevention = attr("public_access_prevention") ?? "inherited";
      if (!["enforced", "inherited"].includes(String(prevention)))
        fail("public_access_prevention must be enforced or inherited.");
      return {
        ...base,
        type,
        location: text(attr("location"), "location").toUpperCase(),
        storageClass: text(attr("storage_class") ?? "STANDARD", "storage_class").toUpperCase(),
        uniformAccess: bool(attr("uniform_bucket_level_access"), "uniform_bucket_level_access"),
        publicAccessPrevention: prevention === "enforced",
        forceDestroy: bool(attr("force_destroy"), "force_destroy"),
        versioning: bool(evaluate(versioning.attributes.enabled), "versioning.enabled"),
      };
    }
    if (type === "google_compute_firewall") {
      check(
        body,
        [
          "name",
          "project",
          "network",
          "direction",
          "priority",
          "source_ranges",
          "destination_ranges",
          "target_tags",
          "disabled",
        ],
        ["allow", "deny"],
      );
      const direction = attr("direction") ?? "INGRESS";
      if (direction !== "INGRESS" && direction !== "EGRESS")
        return fail("direction must be INGRESS or EGRESS.");
      const rules = (kind: string) =>
        body.blocks
          .filter((b) => b.type === kind)
          .map((b) => {
            check(b.body, ["protocol", "ports"]);
            return {
              protocol: text(evaluate(b.body.attributes.protocol), "protocol"),
              ports: list(b.body.attributes.ports, evaluate, "ports"),
            };
          })
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return {
        ...base,
        type,
        network: reference(text(attr("network"), "network"), project, "networks"),
        direction,
        priority: number(attr("priority"), "priority", 1000),
        disabled: bool(attr("disabled"), "disabled"),
        sourceRanges: list(body.attributes.source_ranges, evaluate, "source_ranges"),
        destinationRanges:
          body.attributes.destination_ranges === undefined && direction === "EGRESS"
            ? ["0.0.0.0/0"]
            : list(body.attributes.destination_ranges, evaluate, "destination_ranges"),
        targetTags: list(body.attributes.target_tags, evaluate, "target_tags"),
        allowed: rules("allow"),
        denied: rules("deny"),
      };
    }
    if (type !== "google_compute_instance") return fail(`Unsupported resource type: ${type}`);
    check(
      body,
      ["name", "project", "zone", "machine_type", "tags", "metadata", "allow_stopping_for_update"],
      ["boot_disk", "network_interface", "service_account"],
    );
    const boot = one(body, "boot_disk", true);
    check(boot, [], ["initialize_params"]);
    const params = one(boot, "initialize_params", true);
    check(params, ["image", "size", "type"]);
    const nic = one(body, "network_interface", true);
    check(nic, ["network", "subnetwork"], ["access_config"]);
    const access = one(nic, "access_config");
    check(access, []);
    const sa = one(body, "service_account");
    check(sa, ["email", "scopes"]);
    const hasSa = body.blocks.some((b) => b.type === "service_account");
    const zone = text(attr("zone") ?? provider.zone, "zone");
    const metadataExpr = body.attributes.metadata;
    const metadata: Record<string, string> = {};
    if (metadataExpr !== undefined) {
      if (typeof metadataExpr !== "object" || !("object" in metadataExpr))
        fail("metadata must be an object of strings.");
      if (typeof metadataExpr === "object" && "object" in metadataExpr)
        for (const [key, value] of Object.entries(metadataExpr.object).sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          const resolved = evaluate(value);
          if (typeof resolved !== "string") fail("metadata values must be strings.");
          metadata[key] = resolved as string;
        }
    }
    const image = TfResources.image(text(evaluate(params.attributes.image), "image"));
    if (hasSa && sa.attributes.scopes === undefined) fail("service_account requires scopes.");
    return {
      ...base,
      type,
      zone,
      machineType: text(attr("machine_type"), "machine_type"),
      network: reference(text(evaluate(nic.attributes.network), "network"), project, "networks"),
      subnet: reference(
        text(evaluate(nic.attributes.subnetwork), "subnetwork"),
        project,
        "subnetworks",
        zone.slice(0, -2),
      ),
      image: `projects/${image.project}/global/images/${image.name}`,
      diskSize: number(evaluate(params.attributes.size), "size", 10),
      diskType: text(evaluate(params.attributes.type) ?? "pd-standard", "type"),
      externalIp: nic.blocks.length === 1,
      tags: list(body.attributes.tags, evaluate, "tags"),
      metadata,
      serviceAccount: hasSa ? text(evaluate(sa.attributes.email), "service_account.email") : "",
      scopes: hasSa
        ? [...new Set(list(sa.attributes.scopes, evaluate, "scopes").flatMap(Scope.expand))].sort()
        : [],
      allowStopping: bool(attr("allow_stopping_for_update"), "allow_stopping_for_update"),
    };
  },
} as const;
