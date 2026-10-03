import { TfBackend, type TfBackendState } from "@/engine/domains/terraform/backend";
import { type TfResource, TfResources } from "@/engine/domains/terraform/resources";
import { type TfMove, TfStructure } from "@/engine/domains/terraform/structure";
import { Decoder as D } from "@/utils/Decoder";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type { TfResource } from "@/engine/domains/terraform/resources";
export type TfChange = Readonly<{ action: "create" | "update" | "delete"; resource: TfResource }>;
export type TfPlan = Readonly<{
  backendRevision: number;
  moves: readonly TfMove[];
  serial: number;
  mode: "normal" | "destroy" | "refresh-only";
  before: readonly TfResource[];
  after: readonly TfResource[];
  changes: readonly TfChange[];
  drift: readonly TfChange[];
  outputs: Readonly<Record<string, string>>;
}>;
export type TerraformState = Readonly<{
  backend: TfBackendState;
  files: Readonly<Record<string, string>>;
  initialized: boolean;
  serial: number;
  resources: readonly TfResource[];
  outputs: Readonly<Record<string, string>>;
  plans: Readonly<Record<string, TfPlan>>;
}>;
const resource = TfResources.decoder;
const plan = D.object<TfPlan>({
  backendRevision: D.number,
  moves: D.array(D.object<TfMove>({ from: D.string, to: D.string })),
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
    backend: TfBackend.empty(),
    files: {},
    initialized: false,
    serial: 0,
    resources: [],
    outputs: {},
    plans: {},
  }),
  decoder: D.object<TerraformState>({
    backend: TfBackend.decoder,
    files: D.record(D.string),
    initialized: D.boolean,
    serial: D.number,
    resources: D.array(resource),
    outputs: D.record(D.string),
    plans: D.record(plan),
  }),
  id: TfResources.id,
  record: TfResources.record,
  validate(state: TerraformState): Result<TerraformState, string> {
    const safe = (name: string): boolean =>
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name) &&
      !["constructor", "prototype", "__proto__"].includes(name);
    if (!Number.isSafeInteger(state.serial) || state.serial < 0)
      return Result.err("Invalid Terraform state serial.");
    if (
      Object.keys(state.files).length > 32 ||
      Object.entries(state.files).some(
        ([name, text]) => !TfStructure.filePath(name) || text.length > 64000,
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
          TfStructure.resourceType(r.address) === r.type &&
          (r.type === "google_storage_bucket"
            ? /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/.test(r.name)
            : /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/.test(r.name)) &&
          /^[a-z][a-z0-9-]+$/.test(r.project) &&
          (r.type !== "google_compute_network" ||
            (r.region === "" && r.network === "" && r.cidr === "" && !r.privateAccess)),
      );
    if (!resourcesValid(state.resources))
      return Result.err("Invalid or duplicate Terraform resource identity.");
    try {
      TfBackend.validate(state.backend);
      const data = [
        ...state.backend.remotes.flatMap((r) => [r.data, ...r.versions.map((v) => v.data)]),
        ...(Option.isSome(state.backend.migration) ? [state.backend.migration.value.data] : []),
      ];
      for (const saved of data) {
        if (
          !Number.isSafeInteger(saved.serial) ||
          saved.serial < 0 ||
          !resourcesValid(saved.resources)
        )
          throw new Error("Invalid remote state data.");
        for (const r of saved.resources) TfResources.validate(r);
      }
      for (const r of state.resources) TfResources.validate(r);
      for (const p of Object.values(state.plans))
        for (const r of [
          ...p.before,
          ...p.after,
          ...p.changes.map((c) => c.resource),
          ...p.drift.map((c) => c.resource),
        ])
          TfResources.validate(r);
      for (const p of Object.values(state.plans)) TfStructure.validateMoves(p.moves);
    } catch (error) {
      return Result.err(error instanceof Error ? error.message : "Invalid saved moves.");
    }
    if (
      Object.values(state.plans).some(
        (p) =>
          !Number.isSafeInteger(p.backendRevision) ||
          p.backendRevision < 0 ||
          p.backendRevision > state.backend.revision ||
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
