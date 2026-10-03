import { Region } from "@/engine/domains/catalog";
import { Network, Subnet, SubnetModes } from "@/engine/domains/compute";
import { TerraformState, type TfResource } from "@/engine/domains/terraform";
import { type Expression, Hcl, type HclBlock, type HclBody } from "@/engine/domains/terraform/hcl";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

type Scalar = string | number | boolean;
export type TfConfiguration = Readonly<{
  resources: readonly TfResource[];
  outputs: Readonly<Record<string, string>>;
}>;
const fail = (message: string): never => {
  throw new Error(message);
};
const checkBody = (body: HclBody, allowed: readonly string[]): void => {
  if (body.blocks.length) fail(`Nested blocks are not supported here: ${body.blocks[0]?.type}`);
  for (const key of Object.keys(body.attributes))
    if (!allowed.includes(key)) fail(`Unsupported attribute: ${key}`);
};
const label = (block: HclBlock, count: number): string => {
  if (
    block.labels.length !== count ||
    block.labels.some(
      (v) =>
        !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(v) ||
        ["__proto__", "prototype", "constructor"].includes(v),
    )
  )
    fail(`Invalid labels for ${block.type}`);
  return block.labels[count - 1] ?? "";
};
const string = (v: Scalar | undefined, name: string): string =>
  typeof v === "string" && v.length > 0 ? v : fail(`${name} must be a non-empty string.`);

/** Only the declared, documented Google network provider subset is accepted. */
export const TfConfiguration = {
  compile(
    files: Readonly<Record<string, string>>,
    observed: readonly TfResource[] = [],
  ): TfConfiguration {
    const roots = Object.keys(files)
      .filter((name) => !name.includes("/") && name.endsWith(".tf"))
      .sort();
    const blocks = roots.flatMap((name) => {
      const parsed = Hcl.parse(files[name] ?? "");
      if (Object.keys(parsed.attributes).length)
        fail(`Top-level attributes are not allowed in ${name}.`);
      return parsed.blocks;
    });
    if (blocks.length > 100) fail("At most 100 root blocks are supported.");
    const allowed = ["terraform", "provider", "resource", "variable", "output"];
    for (const b of blocks) if (!allowed.includes(b.type)) fail(`Unsupported block: ${b.type}`);
    const providers = blocks.filter((b) => b.type === "provider");
    if (providers.length > 1) fail("Only one default Google provider is supported.");
    const provider = providers[0];
    if (provider && label(provider, 1) !== "google") fail("Only provider google is supported.");
    if (provider) checkBody(provider.body, ["project", "region"]);
    for (const block of blocks.filter((b) => b.type === "terraform")) {
      label(block, 0);
      if (Object.keys(block.body.attributes).length)
        fail("Terraform version constraints are not supported yet.");
      for (const child of block.body.blocks) {
        if (child.type !== "required_providers" || child.labels.length || child.body.blocks.length)
          fail(`Unsupported terraform block: ${child.type}`);
        for (const [name, expr] of Object.entries(child.body.attributes)) {
          if (name !== "google" || typeof expr !== "object" || !("object" in expr))
            fail("Only hashicorp/google is supported.");
          if (typeof expr === "object" && "object" in expr) {
            const attrs = expr.object;
            if (
              attrs.source !== "hashicorp/google" ||
              Object.keys(attrs).some((k) => k !== "source")
            )
              fail(
                'Only source = "hashicorp/google" is supported; version constraints are not simulated.',
              );
          }
        }
      }
    }
    const values: Record<string, Scalar> = {};
    for (const name of Object.keys(files)
      .filter((n) => n === "terraform.tfvars" || (!n.includes("/") && n.endsWith(".auto.tfvars")))
      .sort((a, b) =>
        a === "terraform.tfvars" ? -1 : b === "terraform.tfvars" ? 1 : a.localeCompare(b),
      )) {
      const parsed = Hcl.parse(files[name] ?? "");
      if (parsed.blocks.length) fail("tfvars cannot contain blocks.");
      for (const [key, expr] of Object.entries(parsed.attributes)) {
        if (typeof expr === "object") fail("tfvars values must be scalar literals.");
        else values[key] = expr;
      }
    }
    const variables: Record<string, Scalar> = {};
    for (const b of blocks.filter((b) => b.type === "variable")) {
      const name = label(b, 1);
      if (Object.hasOwn(variables, name)) fail(`Duplicate variable: ${name}`);
      checkBody(b.body, ["type", "default", "description"]);
      const type = b.body.attributes.type;
      if (
        typeof type !== "object" ||
        !("ref" in type) ||
        !["string", "number", "bool"].includes(type.ref)
      )
        fail(`Variable ${name} requires type string, number or bool.`);
      const value = Object.hasOwn(values, name) ? values[name] : b.body.attributes.default;
      if (value === undefined || typeof value === "object")
        fail(`Missing literal value for variable ${name}.`);
      const expected =
        typeof type === "object" && "ref" in type
          ? type.ref === "bool"
            ? "boolean"
            : type.ref
          : "";
      if (typeof value !== expected) fail(`Wrong type for variable ${name}.`);
      variables[name] = value as Scalar;
    }
    for (const name of Object.keys(values))
      if (!Object.hasOwn(variables, name)) fail(`Undeclared variable: ${name}`);
    const resources = new Map<string, TfResource>(observed.map((r) => [r.address, r]));
    const definitions = new Map<string, HclBlock>();
    for (const b of blocks.filter((b) => b.type === "resource")) {
      const name = label(b, 2);
      const address = `${b.labels[0]}.${name}`;
      if (definitions.has(address)) fail(`Duplicate resource: ${address}`);
      definitions.set(address, b);
    }
    const visiting = new Set<string>();
    const evaluate = (expr: Expression | undefined): Scalar | undefined => {
      if (expr === undefined || typeof expr !== "object") return expr;
      if (!("ref" in expr))
        return fail("Object expressions are only supported in required_providers.");
      const parts = expr.ref.split(".");
      if (parts[0] === "var" && parts.length === 2)
        return variables[parts[1] ?? ""] ?? fail(`Unknown variable: ${expr.ref}`);
      if (parts.length !== 3) return fail(`Unsupported reference: ${expr.ref}`);
      const r = resolve(`${parts[0]}.${parts[1]}`);
      if (parts[2] === "id") return TerraformState.id(r);
      if (parts[2] === "self_link")
        return `https://www.googleapis.com/compute/v1/${TerraformState.id(r)}`;
      if (parts[2] === "name") return r.name;
      if (r.type === "google_compute_subnetwork" && parts[2] === "private_ip_google_access")
        return r.privateAccess;
      if (r.type === "google_compute_subnetwork" && parts[2] === "ip_cidr_range") return r.cidr;
      return fail(`Unsupported reference: ${expr.ref}`);
    };
    const providerValue = (name: string): Scalar | undefined => {
      const expr = provider?.body.attributes[name];
      if (typeof expr === "object" && (!("ref" in expr) || !expr.ref.startsWith("var.")))
        fail("Provider configuration may only reference variables.");
      return evaluate(expr);
    };
    const resolve = (address: string): TfResource => {
      const existing = resources.get(address);
      if (existing) return existing;
      if (visiting.has(address)) return fail(`Dependency cycle: ${address}`);
      visiting.add(address);
      const b = definitions.get(address) ?? fail(`Unknown resource: ${address}`);
      const type = b.labels[0];
      if (type !== "google_compute_network" && type !== "google_compute_subnetwork")
        return fail(`Unsupported resource type: ${type}`);
      checkBody(
        b.body,
        type === "google_compute_network"
          ? ["name", "project", "auto_create_subnetworks"]
          : ["name", "project", "region", "network", "ip_cidr_range", "private_ip_google_access"],
      );
      const attr = (name: string): Scalar | undefined => evaluate(b.body.attributes[name]);
      const name = string(attr("name"), "name");
      const project = string(attr("project") ?? providerValue("project"), "project");
      let r: TfResource = {
        address,
        type,
        project,
        name,
        region: "",
        network: "",
        cidr: "",
        privateAccess: false,
      };
      if (type === "google_compute_network") {
        if (attr("auto_create_subnetworks") !== false)
          fail("Only custom networks (auto_create_subnetworks = false) are supported.");
      } else {
        const raw = string(attr("network"), "network");
        const short = raw.replace("https://www.googleapis.com/compute/v1/", "");
        const match = /^projects\/([^/]+)\/global\/networks\/([^/]+)$/.exec(short);
        if (short.includes("/") && (!match || match[1] !== project))
          fail("Cross-project or invalid network reference.");
        const access = attr("private_ip_google_access") ?? false;
        if (typeof access !== "boolean") fail("private_ip_google_access must be bool.");
        r = {
          ...r,
          region: string(attr("region") ?? providerValue("region"), "region"),
          network: match?.[2] ?? raw,
          cidr: string(attr("ip_cidr_range"), "ip_cidr_range"),
          privateAccess: access as boolean,
        };
      }
      TfConfiguration.validateResource(r);
      resources.set(address, r);
      visiting.delete(address);
      return r;
    };
    for (const address of definitions.keys()) resolve(address);
    const ids = [...resources.values()].map(TerraformState.id);
    if (new Set(ids).size !== ids.length)
      fail("Multiple addresses refer to the same remote object.");
    const outputs: Record<string, string> = {};
    for (const block of blocks.filter((b) => b.type === "output")) {
      const name = label(block, 1);
      if (Object.hasOwn(outputs, name)) fail(`Duplicate output: ${name}`);
      checkBody(block.body, ["value", "description"]);
      const value = evaluate(block.body.attributes.value);
      if (value === undefined) fail(`Output ${name} requires value.`);
      outputs[name] = String(value);
    }
    return { resources: [...resources.values()], outputs };
  },

  outputsFrom(
    files: Readonly<Record<string, string>>,
    observed: readonly TfResource[],
  ): Readonly<Record<string, string>> {
    return TfConfiguration.compile(files, observed).outputs;
  },

  validateResource(r: TfResource): void {
    const checked = Network.create({
      projectId: r.project,
      name: r.name,
      subnetMode: SubnetModes.Custom,
    });
    if (!Result.isOk(checked)) fail(checked.error);
    if (r.type !== "google_compute_subnetwork") return;
    const region = Region.parse(r.region);
    if (!Option.isSome(region)) fail(`Unknown region: ${r.region}`);
    const parts = r.cidr.split("/");
    const octets = (parts[0] ?? "").split(".").map(Number);
    const prefix = Number(parts[1]);
    if (
      parts.length !== 2 ||
      octets.length !== 4 ||
      octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255) ||
      !Number.isInteger(prefix) ||
      prefix < 8 ||
      prefix > 29 ||
      !/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(r.cidr)
    )
      fail(`Invalid subnet IPv4 CIDR (supported prefix /8–/29): ${r.cidr}`);
    const ip = octets.reduce((a, b) => a * 256 + b, 0);
    if (ip % 2 ** (32 - prefix) !== 0) fail(`CIDR must use its network address: ${r.cidr}`);
    if (Option.isSome(region)) {
      const subnet = Subnet.create({
        projectId: r.project,
        name: r.name,
        region: region.value,
        network: r.network,
        ipCidrRange: r.cidr,
        privateIpGoogleAccess: r.privateAccess,
      });
      if (!Result.isOk(subnet)) fail(subnet.error);
    }
  },
} as const;
