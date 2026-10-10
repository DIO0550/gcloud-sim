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
  sensitiveOutputs: readonly string[];
  dependencies: Readonly<Record<string, readonly string[]>>;
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
  providerVersion: string;
  sensitiveOutputs: readonly string[];
  events: readonly Readonly<{ kind: "vet" | "restore"; serial: number; detail: string }>[];
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
  sensitiveOutputs: D.array(D.string),
  dependencies: D.record(D.array(D.string)),
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
    providerVersion: "",
    sensitiveOutputs: [],
    events: [],
    files: {},
    initialized: false,
    serial: 0,
    resources: [],
    outputs: {},
    plans: {},
  }),
  decoder: D.object<TerraformState>({
    backend: TfBackend.decoder,
    providerVersion: D.string,
    sensitiveOutputs: D.array(D.string),
    events: D.array(
      D.object({ kind: D.literal(["vet", "restore"]), serial: D.number, detail: D.string }),
    ),
    files: D.record(D.string),
    initialized: D.boolean,
    serial: D.number,
    resources: D.array(resource),
    outputs: D.record(D.string),
    plans: D.record(plan),
  }),
  planDecoder: plan,
  id: TfResources.id,
  record: TfResources.record,
  validate(state: TerraformState): Result<TerraformState, string> {
    if (state.providerVersion && !["4.84.0", "5.45.0", "6.0.0"].includes(state.providerVersion)) {
      return Result.err("Invalid simulated provider version.");
    }
    if (
      state.sensitiveOutputs.length > 100 ||
      state.sensitiveOutputs.some((k) => !Object.hasOwn(state.outputs, k))
    ) {
      return Result.err("Invalid sensitive output names.");
    }
    if (
      state.events.length > 32 ||
      state.events.some(
        (e) =>
          !Number.isSafeInteger(e.serial) ||
          e.serial < 0 ||
          e.serial > state.serial ||
          e.detail.length > 64000,
      )
    ) {
      return Result.err("Invalid Terraform exercise history.");
    }
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
    const outputsValid = (
      outputs: Readonly<Record<string, string>>,
      sensitive: readonly string[],
    ): boolean =>
      Object.keys(outputs).length <= 100 &&
      Object.entries(outputs).every(
        ([key, value]) => TfStructure.identifier(key) && value.length <= 64000,
      ) &&
      sensitive.length <= 100 &&
      new Set(sensitive).size === sensitive.length &&
      sensitive.every((key) => Object.hasOwn(outputs, key));
    if (!outputsValid(state.outputs, state.sensitiveOutputs)) {
      return Result.err("Invalid Terraform outputs or sensitive names.");
    }
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
          !resourcesValid(saved.resources) ||
          !outputsValid(saved.outputs, saved.sensitiveOutputs)
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
          p.changes.length > 200 ||
          p.drift.length > 200 ||
          !outputsValid(p.outputs, p.sensitiveOutputs) ||
          Object.keys(p.dependencies).length > 100 ||
          Object.entries(p.dependencies).some(
            ([address, dependencies]) =>
              !TfStructure.resourceType(address) ||
              dependencies.length > 100 ||
              dependencies.some((dependency) => !TfStructure.resourceType(dependency)),
          ),
      )
    )
      return Result.err("Invalid saved Terraform plan.");
    if (!state.initialized && (state.resources.length || Object.keys(state.plans).length))
      return Result.err("Uninitialized Terraform state contains managed resources or plans.");
    return Result.ok(state);
  },
} as const;
