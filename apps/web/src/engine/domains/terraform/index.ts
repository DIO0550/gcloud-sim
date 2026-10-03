import { Decoder as D } from "@/utils/Decoder";
import { Result } from "@/utils/Result";

export type TfResource = Readonly<{
  address: string;
  type: "google_compute_network" | "google_compute_subnetwork";
  project: string;
  name: string;
  region: string;
  network: string;
  cidr: string;
  privateAccess: boolean;
}>;
export type TfChange = Readonly<{ action: "create" | "update" | "delete"; resource: TfResource }>;
export type TfPlan = Readonly<{
  serial: number;
  mode: "normal" | "destroy" | "refresh-only";
  before: readonly TfResource[];
  after: readonly TfResource[];
  changes: readonly TfChange[];
  drift: readonly TfChange[];
  outputs: Readonly<Record<string, string>>;
}>;
export type TerraformState = Readonly<{
  files: Readonly<Record<string, string>>;
  initialized: boolean;
  serial: number;
  resources: readonly TfResource[];
  outputs: Readonly<Record<string, string>>;
  plans: Readonly<Record<string, TfPlan>>;
}>;
const resource = D.object<TfResource>({
  address: D.string,
  type: D.literal(["google_compute_network", "google_compute_subnetwork"]),
  project: D.string,
  name: D.string,
  region: D.string,
  network: D.string,
  cidr: D.string,
  privateAccess: D.boolean,
});
const plan = D.object<TfPlan>({
  serial: D.number,
  mode: D.literal(["normal", "destroy", "refresh-only"]),
  before: D.array(resource),
  after: D.array(resource),
  changes: D.array(
    D.object<TfChange>({ action: D.literal(["create", "update", "delete"]), resource }),
  ),
  drift: D.array(
    D.object<TfChange>({ action: D.literal(["create", "update", "delete"]), resource }),
  ),
  outputs: D.record(D.string),
});
export const TerraformState = {
  empty: (): TerraformState => ({
    files: {},
    initialized: false,
    serial: 0,
    resources: [],
    outputs: {},
    plans: {},
  }),
  decoder: D.object<TerraformState>({
    files: D.record(D.string),
    initialized: D.boolean,
    serial: D.number,
    resources: D.array(resource),
    outputs: D.record(D.string),
    plans: D.record(plan),
  }),
  id: (r: TfResource): string =>
    r.type === "google_compute_network"
      ? `projects/${r.project}/global/networks/${r.name}`
      : `projects/${r.project}/regions/${r.region}/subnetworks/${r.name}`,
  record: (r: TfResource) => ({
    address: r.address,
    id: TerraformState.id(r),
    project: r.project,
    name: r.name,
    ...(r.type === "google_compute_network"
      ? { auto_create_subnetworks: false }
      : {
          region: r.region,
          network: r.network,
          ip_cidr_range: r.cidr,
          private_ip_google_access: r.privateAccess,
        }),
  }),
  validate(state: TerraformState): Result<TerraformState, string> {
    const safe = (name: string): boolean =>
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name) &&
      !["constructor", "prototype", "__proto__"].includes(name);
    if (!Number.isSafeInteger(state.serial) || state.serial < 0)
      return Result.err("Invalid Terraform state serial.");
    if (
      Object.keys(state.files).length > 32 ||
      Object.entries(state.files).some(
        ([name, text]) => !safe(name) || !/\.(tf|tfvars)$/.test(name) || text.length > 64000,
      )
    )
      return Result.err("Invalid Terraform file name or file limits.");
    if (
      Object.keys(state.plans).length > 16 ||
      Object.keys(state.plans).some((name) => !safe(name) || Object.hasOwn(state.files, name))
    )
      return Result.err("Invalid saved plan name or limits.");
    const resourcesValid = (rs: readonly TfResource[]): boolean =>
      rs.length <= 100 &&
      new Set(rs.map((r) => r.address)).size === rs.length &&
      new Set(rs.map(TerraformState.id)).size === rs.length &&
      rs.every(
        (r) =>
          new RegExp(`^${r.type}\\.[A-Za-z_][A-Za-z0-9_-]*$`).test(r.address) &&
          /^[a-z][a-z0-9-]{0,62}$/.test(r.name) &&
          /^[a-z][a-z0-9-]+$/.test(r.project) &&
          (r.type !== "google_compute_network" ||
            (r.region === "" && r.network === "" && r.cidr === "" && !r.privateAccess)),
      );
    if (!resourcesValid(state.resources))
      return Result.err("Invalid or duplicate Terraform resource identity.");
    if (
      Object.values(state.plans).some(
        (p) =>
          !Number.isSafeInteger(p.serial) ||
          p.serial < 0 ||
          p.serial > state.serial ||
          !resourcesValid(p.before) ||
          !resourcesValid(p.after) ||
          p.changes.length > 200,
      )
    )
      return Result.err("Invalid saved Terraform plan.");
    if (!state.initialized && (state.resources.length || Object.keys(state.plans).length))
      return Result.err("Uninitialized Terraform state contains managed resources or plans.");
    return Result.ok(state);
  },
} as const;
