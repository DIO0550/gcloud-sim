import { TerraformState, type TfResource } from "@/engine/domains/terraform";
import { TfBackend } from "@/engine/domains/terraform/backend";
import {
  TfExpressions as E,
  type TfEvaluate,
  type TfValue,
} from "@/engine/domains/terraform/expressions";
import { type Expression, Hcl, type HclBlock, type HclBody } from "@/engine/domains/terraform/hcl";
import { TfModuleCatalog } from "@/engine/domains/terraform/module-catalog";
import { TfResourceConfiguration } from "@/engine/domains/terraform/resource-configuration";
import { type TfMove, TfStructure } from "@/engine/domains/terraform/structure";
import { TfVersions } from "@/engine/domains/terraform/versions";
export type TfCompileOptions = Readonly<{
  variables?: Readonly<Record<string, TfValue>>;
  varFiles?: readonly string[];
  providerVersion?: string;
}>;
type Provider = Readonly<Record<string, string | number | boolean | undefined>>;
type Compiled = Readonly<{
  resources: readonly TfResource[];
  outputs: Readonly<Record<string, TfValue>>;
  moves: readonly TfMove[];
  sensitive: readonly string[];
}>;
type Context = Readonly<{
  directory: string;
  prefix: string;
  inputs: Readonly<Record<string, TfValue>>;
  sensitiveInputs?: readonly string[];
  provider: Provider;
  ancestors: readonly string[];
  budget: {
    blocks: number;
    modules: number;
    constraints: string[];
    dependencies: Record<string, Set<string>>;
  };
}>;
const fail = (message: string): never => {
  throw new Error(message);
};
const checkBody = (body: HclBody, allowed: readonly string[]): void => {
  if (body.blocks.length) {
    fail(`Nested blocks are not supported here: ${body.blocks[0]?.type}`);
  }
  for (const key of Object.keys(body.attributes)) {
    if (!allowed.includes(key)) {
      fail(`Unsupported attribute: ${key}`);
    }
  }
};
const label = (block: HclBlock, count: number): string => {
  if (block.labels.length !== count || block.labels.some((v) => !TfStructure.identifier(v))) {
    fail(`Invalid labels for ${block.type}`);
  }
  return block.labels[count - 1] ?? "";
};
const literal = (expr: Expression): TfValue =>
  E.evaluate(expr, (ref) => fail(`Literal value cannot reference ${ref}.`));
const variables = (
  blocks: readonly HclBlock[],
  inputs: Readonly<Record<string, TfValue>>,
): Readonly<Record<string, TfValue>> => {
  const result: Record<string, TfValue> = {};
  const expected = (value: TfValue, type: Expression): boolean => {
    if (typeof type === "object" && "ref" in type) {
      const name = type.ref === "bool" ? "boolean" : type.ref;
      if (!["string", "number", "boolean"].includes(name)) {
        fail(`Unsupported variable type: ${type.ref}`);
      }
      return typeof value === name;
    }
    if (
      typeof type === "object" &&
      "call" in type &&
      ["list", "map", "set"].includes(type.call) &&
      type.args.length === 1
    ) {
      const inner = type.args[0] as Expression;
      if (
        type.call === "set" &&
        (typeof inner !== "object" || !("ref" in inner) || inner.ref !== "string")
      ) {
        fail("Only set(string) variables are supported.");
      }
      if (type.call === "map") {
        return Object.values(E.object(value)).every((v) => expected(v, inner));
      }
      return E.list(value).every((v) => expected(v, inner));
    }
    return fail("Variable type must be string, number, bool, or a list/map/set of scalars.");
  };
  for (const block of blocks.filter((b) => b.type === "variable")) {
    const name = label(block, 1);
    if (Object.hasOwn(result, name)) {
      fail(`Duplicate variable: ${name}`);
    }
    checkBody(block.body, ["type", "default", "description", "sensitive"]);
    const type = block.body.attributes.type ?? fail(`Variable ${name} requires a type.`);
    const fallback = block.body.attributes.default;
    let value = inputs[name];
    if (value === undefined && fallback !== undefined) {
      value = literal(fallback);
    }
    if (value === undefined) {
      fail(`Missing literal value for variable ${name}.`);
    }
    if (!expected(value as TfValue, type)) {
      fail(`Wrong type for variable ${name}.`);
    }
    if (typeof type === "object" && "call" in type && type.call === "set") {
      value = new Set(E.list(value as TfValue).map((v) => String(E.scalar(v))));
    }
    if (
      block.body.attributes.sensitive !== undefined &&
      typeof block.body.attributes.sensitive !== "boolean"
    ) {
      fail("sensitive must be bool.");
    }
    result[name] = value as TfValue;
  }
  for (const key of Object.keys(inputs)) {
    if (!Object.hasOwn(result, key)) {
      fail(`Undeclared variable: ${key}`);
    }
  }
  return result;
};
const compile = (
  files: Readonly<Record<string, string>>,
  observed: readonly TfResource[],
  options: TfCompileOptions,
  context: Context,
  validate: (resource: TfResource) => void,
): Compiled => {
  const roots = Object.keys(files)
    .filter(
      (name) =>
        name.endsWith(".tf") &&
        name.slice(0, name.lastIndexOf("/") + 1) ===
          (context.directory ? `${context.directory}/` : ""),
    )
    .sort();
  if (context.prefix && !roots.length) {
    fail(`Local module has no .tf files: ${context.directory}`);
  }
  const blocks = roots.flatMap((name) => {
    const parsed = Hcl.parse(files[name] ?? "");
    if (Object.keys(parsed.attributes).length) {
      fail(`Top-level attributes are not allowed in ${name}.`);
    }
    return parsed.blocks;
  });
  context.budget.blocks += blocks.length;
  if (context.budget.blocks > 200) {
    fail("At most 200 expanded blocks are supported.");
  }
  for (const b of blocks) {
    if (
      ![
        "terraform",
        "provider",
        "resource",
        "variable",
        "output",
        "module",
        "moved",
        "locals",
      ].includes(b.type)
    ) {
      fail(`Unsupported block: ${b.type}`);
    }
  }
  context.budget.constraints.push(...TfVersions.constraints(blocks, !context.prefix));
  const values: Record<string, TfValue> = { ...context.inputs };
  if (!context.prefix) {
    const auto = Object.keys(files)
      .filter((n) => n === "terraform.tfvars" || (!n.includes("/") && n.endsWith(".auto.tfvars")))
      .sort((a, b) =>
        a === "terraform.tfvars" ? -1 : b === "terraform.tfvars" ? 1 : a.localeCompare(b),
      );
    for (const name of [...auto, ...(options.varFiles ?? [])]) {
      if (!name.endsWith(".tfvars") || !TfStructure.filePath(name)) {
        fail("-var-file requires a virtual .tfvars file.");
      }
      const parsed = Hcl.parse(files[name] ?? fail(`Variable file not found: ${name}`));
      if (parsed.blocks.length) {
        fail("tfvars cannot contain blocks.");
      }
      for (const [key, expr] of Object.entries(parsed.attributes)) {
        values[key] = literal(expr);
      }
    }
    Object.assign(values, options.variables ?? {});
  }
  const vars = variables(blocks, values);
  const resourceDefinitions = new Map<string, HclBlock>();
  const moduleDefinitions = new Map<string, HclBlock>();
  for (const block of blocks.filter((b) => b.type === "resource" || b.type === "module")) {
    const name = label(block, block.type === "module" ? 1 : 2);
    const key = block.type === "module" ? name : `${block.labels[0]}.${name}`;
    const map = block.type === "module" ? moduleDefinitions : resourceDefinitions;
    if (map.has(key)) {
      fail(`Duplicate ${block.type}: ${key}`);
    }
    map.set(key, block);
  }
  const locals: Record<string, Expression> = {};
  for (const block of blocks.filter((b) => b.type === "locals")) {
    label(block, 0);
    if (block.body.blocks.length) {
      fail("locals cannot contain blocks.");
    }
    for (const [key, value] of Object.entries(block.body.attributes)) {
      if (Object.hasOwn(locals, key)) {
        fail(`Duplicate local: ${key}`);
      }
      locals[key] = value;
    }
  }
  const visiting = new Set<string>();
  const memo = new Map<string, TfValue>();
  const resources: TfResource[] = [];
  const children: Compiled[] = [];
  const providerBlocks = blocks.filter((b) => b.type === "provider");
  if (context.prefix && providerBlocks.length) {
    fail("Child provider configurations are not supported; inherit the root Google provider.");
  }
  const providers = new Map<string, Provider>();
  const sensitiveMemo = new Set<string>();
  const dependencyMemo = new Map<string, Set<string>>();
  const recordDependencies = (addresses: Iterable<string>): void => {
    for (const address of addresses) {
      dependencyCollector?.add(address);
      if (!currentAddress) {
        continue;
      }
      const dependencies = context.budget.dependencies[currentAddress] ?? new Set<string>();
      dependencies.add(address);
      context.budget.dependencies[currentAddress] = dependencies;
    }
  };
  const once = (key: string, run: () => TfValue): TfValue => {
    if (memo.has(key)) {
      recordDependencies(dependencyMemo.get(key) ?? []);
      if (sensitiveMemo.has(key)) {
        sensitiveRead = true;
      }
      return memo.get(key) as TfValue;
    }
    if (visiting.has(key)) {
      return fail(`Dependency cycle: ${key}`);
    }
    visiting.add(key);
    const parentSensitive = sensitiveRead;
    const parentCollector = dependencyCollector;
    const dependencies = new Set<string>();
    dependencyCollector = dependencies;
    sensitiveRead = false;
    const value = run();
    dependencyCollector = parentCollector;
    dependencyMemo.set(key, dependencies);
    recordDependencies(dependencies);
    if (sensitiveRead) {
      sensitiveMemo.add(key);
    }
    sensitiveRead = parentSensitive || sensitiveRead;
    memo.set(key, value);
    visiting.delete(key);
    return value;
  };
  let currentAddress = "";
  let dependencyCollector: Set<string> | undefined;
  let sensitiveRead = false;
  const sensitiveVars = new Set([
    ...(context.sensitiveInputs ?? []),
    ...blocks
      .filter((b) => b.type === "variable" && b.body.attributes.sensitive === true)
      .map((b) => b.labels[0]),
  ]);
  const evaluate = (expr: Expression, scope: Readonly<Record<string, TfValue>> = {}): TfValue =>
    E.evaluate(expr, (ref) => {
      const [kind = "", name = "", ...rest] = ref.split(".");
      let value: TfValue;
      if (Object.hasOwn(scope, kind)) {
        value = scope[kind] as TfValue;
        return [name, ...rest].reduce(E.at, value);
      }
      if (kind === "var") {
        value = vars[name] ?? fail(`Unknown variable: ${ref}`);
        if (sensitiveVars.has(name)) {
          sensitiveRead = true;
        }
      } else if (kind === "local") {
        value = once(`local.${name}`, () =>
          evaluate(locals[name] ?? fail(`Unknown local: ${name}`)),
        );
      } else if (kind === "module") {
        value = resolveModule(name);
      } else {
        value = resolveResource(`${kind}.${name}`);
      }
      if ((currentAddress || dependencyCollector) && kind !== "var" && kind !== "local") {
        const referenced = resources.filter((r) =>
          r.address.startsWith(`${context.prefix}${kind}.${name}`),
        );
        if (kind === "module") {
          referenced.push(
            ...children
              .flatMap((c) => c.resources)
              .filter((r) => r.address.startsWith(`${context.prefix}module.${name}`)),
          );
        }
        recordDependencies(referenced.map((r) => r.address));
      }
      return rest.reduce(E.at, value);
    });
  for (const block of providerBlocks) {
    if (label(block, 1) !== "google") {
      fail("Only provider google is supported.");
    }
    checkBody(block.body, ["project", "region", "zone", "alias"]);
    const alias = block.body.attributes.alias;
    if (alias !== undefined && (typeof alias !== "string" || !TfStructure.identifier(alias))) {
      fail("Invalid provider alias.");
    }
    const key = typeof alias === "string" ? `google.${alias}` : "google";
    if (providers.has(key)) {
      fail("Duplicate Google provider configuration.");
    }
    const provider: Record<string, string | number | boolean> = {};
    for (const name of ["project", "region", "zone"]) {
      const expr = block.body.attributes[name];
      if (expr !== undefined) {
        const value = E.evaluate(expr, (ref) => {
          const [kind, key] = ref.split(".");
          if (kind !== "var" || ref.split(".").length !== 2) {
            fail("Provider configuration may only reference variables.");
          }
          if (sensitiveVars.has(key)) {
            fail("Sensitive provider configuration is outside this teaching subset.");
          }
          return vars[key ?? ""] ?? fail(`Unknown provider variable: ${ref}`);
        });
        provider[name] = E.scalar(value);
      }
    }
    providers.set(key, provider);
  }
  if (!providers.has("google")) {
    providers.set("google", context.provider);
  }
  const defaultProvider = providers.get("google") as Provider;
  const selectedProvider = (expr: Expression | undefined): Provider => {
    if (expr === undefined) {
      return defaultProvider;
    }
    return providers.get(Hcl.address(expr)) ?? fail("Provider alias is not configured.");
  };
  type Instance = Readonly<{ suffix: string; scope: Readonly<Record<string, TfValue>> }>;
  const instances = (body: HclBody): readonly Instance[] => {
    const count = body.attributes.count;
    const each = body.attributes.for_each;
    if (count !== undefined && each !== undefined) {
      fail("count and for_each are mutually exclusive.");
    }
    if (count !== undefined) {
      const n = evaluate(count);
      if (sensitiveRead) {
        fail("Sensitive count values are not supported.");
      }
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || n > 100) {
        fail("count must be an integer from 0 to 100.");
      }
      return Array.from({ length: n as number }, (_, index) => ({
        suffix: `[${index}]`,
        scope: { count: { index } },
      }));
    }
    if (each !== undefined) {
      const value = evaluate(each);
      if (sensitiveRead) {
        fail("Sensitive for_each values are not supported.");
      }
      const entries =
        value instanceof Set
          ? [...value].sort().map((k) => [k, k] as const)
          : Object.entries(E.object(value)).sort(([a], [b]) => a.localeCompare(b));
      return entries.map(([key, value]) => {
        if (!TfStructure.instanceKey(key)) {
          return fail("for_each keys must use safe letters, numbers, underscores or hyphens.");
        }
        return { suffix: `[${JSON.stringify(key)}]`, scope: { each: { key, value } } };
      });
    }
    return [{ suffix: "", scope: {} }];
  };
  const group = (block: HclBlock, entries: readonly [Instance, TfValue][]): TfValue => {
    if (block.body.attributes.count !== undefined) {
      return entries.map(([, value]) => value);
    }
    if (block.body.attributes.for_each !== undefined) {
      return Object.fromEntries(
        entries.map(([instance, value]) => [E.at(instance.scope.each as TfValue, "key"), value]),
      );
    }
    return entries[0]?.[1] ?? fail("Missing singleton instance.");
  };
  const depends = (block: HclBlock, scope: Readonly<Record<string, TfValue>>): void => {
    const dependency = block.body.attributes.depends_on;
    if (dependency === undefined) {
      return;
    }
    if (typeof dependency !== "object" || !("list" in dependency)) {
      fail("depends_on requires a list of resource or module addresses.");
    }
    if (typeof dependency !== "object" || !("list" in dependency)) {
      return;
    }
    for (const expr of dependency.list) {
      const address = Hcl.address(expr);
      if (!TfStructure.resourceType(address) && !TfStructure.moduleAddress(address)) {
        fail("depends_on requires whole resource or module addresses.");
      }
      evaluate(expr, scope);
    }
  };
  const resolveModule = (name: string): TfValue =>
    once(`module.${name}`, () => {
      const block = moduleDefinitions.get(name) ?? fail(`Unknown module: ${name}`);
      if (block.body.blocks.length) {
        fail("Nested blocks in a module call are not supported.");
      }
      const source = block.body.attributes.source;
      if (typeof source !== "string") {
        return fail("Module source must be a literal local path or catalog source.");
      }
      let moduleFiles = files;
      let directory: string;
      if (source.startsWith("./") || source.startsWith("../")) {
        if (block.body.attributes.version !== undefined) {
          fail("Local modules cannot specify a registry version.");
        }
        directory = TfStructure.modulePath(context.directory, source);
      } else {
        const catalog =
          TfModuleCatalog[source] ??
          fail(`Remote module not in the offline teaching catalog: ${source}`);
        const version = block.body.attributes.version;
        if (typeof version !== "string" || !TfVersions.matches(catalog.version, version)) {
          fail(
            "Catalog module requires a compatible literal version constraint (available: 9.0.0).",
          );
        }
        directory = `catalog/${source.replaceAll("/", "-")}`;
        moduleFiles = {
          ...files,
          ...Object.fromEntries(
            Object.entries(catalog.files).map(([path, content]) => [
              `${directory}/${path}`,
              content,
            ]),
          ),
        };
      }
      if (context.ancestors.includes(directory)) {
        fail(`Recursive local module: ${directory || "."}`);
      }
      const result = instances(block.body).map((instance): [Instance, TfValue] => {
        if (context.ancestors.length >= 5 || ++context.budget.modules > 32) {
          fail("Module limit: depth 4 and at most 32 expanded calls.");
        }
        const parentCollector = dependencyCollector;
        const prerequisites = new Set<string>();
        dependencyCollector = prerequisites;
        depends(block, instance.scope);
        const inputs: Record<string, TfValue> = {};
        const sensitiveInputs: string[] = [];
        for (const [key, expr] of Object.entries(block.body.attributes)) {
          if (["source", "version", "count", "for_each", "depends_on", "providers"].includes(key)) {
            continue;
          }
          const previousSensitive = sensitiveRead;
          sensitiveRead = false;
          inputs[key] = evaluate(expr, instance.scope);
          if (sensitiveRead) {
            sensitiveInputs.push(key);
          }
          sensitiveRead = previousSensitive || sensitiveRead;
        }
        let provider = defaultProvider;
        const mapping = block.body.attributes.providers;
        if (mapping !== undefined) {
          if (
            typeof mapping !== "object" ||
            !("object" in mapping) ||
            Object.keys(mapping.object).join() !== "google"
          ) {
            fail("Only providers = { google = google.ALIAS } is supported.");
          }
          if (typeof mapping === "object" && "object" in mapping) {
            provider = selectedProvider(mapping.object.google);
          }
        }
        dependencyCollector = parentCollector;
        for (const address of prerequisites) {
          parentCollector?.add(address);
        }
        const child = compile(
          moduleFiles,
          observed,
          {},
          {
            directory,
            prefix: `${context.prefix}module.${name}${instance.suffix}.`,
            inputs,
            sensitiveInputs,
            provider,
            ancestors: [...context.ancestors, directory],
            budget: context.budget,
          },
          validate,
        );
        for (const resource of child.resources) {
          const dependencies = context.budget.dependencies[resource.address] ?? new Set<string>();
          for (const address of prerequisites) {
            dependencies.add(address);
          }
          context.budget.dependencies[resource.address] = dependencies;
        }
        children.push(child);
        if (child.sensitive.length > 0) {
          sensitiveRead = true;
        }
        return [instance, child.outputs];
      });
      return group(block, result);
    });
  const resolveResource = (address: string): TfValue =>
    once(address, () => {
      const block = resourceDefinitions.get(address) ?? fail(`Unknown resource: ${address}`);
      const result = instances(block.body).map((instance): [Instance, TfValue] => {
        const parentAddress = currentAddress;
        const parentSensitive = sensitiveRead;
        currentAddress = `${context.prefix}${address}${instance.suffix}`;
        sensitiveRead = false;
        depends(block, instance.scope);
        const evalInstance: TfEvaluate = (expr) => evaluate(expr, instance.scope);
        const body = E.materialize(block.body, evalInstance, [
          "count",
          "for_each",
          "depends_on",
          "provider",
        ]);
        if (sensitiveRead) {
          fail(
            "Sensitive values in resource attributes are outside this teaching subset. Use the masked-output/state-protection lesson.",
          );
        }
        currentAddress = parentAddress;
        sensitiveRead = parentSensitive;
        const provider = selectedProvider(block.body.attributes.provider);
        const type = block.labels[0] ?? "";
        const fullAddress = `${context.prefix}${address}${instance.suffix}`;
        let configured: TfResource;
        if (type === "google_compute_network" || type === "google_compute_subnetwork") {
          checkBody(
            body,
            type === "google_compute_network"
              ? ["name", "project", "auto_create_subnetworks"]
              : [
                  "name",
                  "project",
                  "region",
                  "network",
                  "ip_cidr_range",
                  "private_ip_google_access",
                ],
          );
          const attr = (name: string) => body.attributes[name];
          const string = (value: unknown, name: string): string => {
            if (typeof value !== "string" || !value) {
              return fail(`${name} must be a non-empty string.`);
            }
            return value;
          };
          const project = string(attr("project") ?? provider.project, "project");
          const auto = attr("auto_create_subnetworks");
          if (type === "google_compute_network" && typeof auto !== "boolean") {
            fail("auto_create_subnetworks must be bool.");
          }
          const base = {
            address: fullAddress,
            type,
            project,
            name: string(attr("name"), "name"),
            region: "",
            network: "",
            cidr: "",
            privateAccess: false,
          } as const;
          configured = base;
          if (auto === true) {
            configured = { ...base, autoMode: true };
          }
          if (type === "google_compute_subnetwork") {
            const raw = string(attr("network"), "network").replace(
              "https://www.googleapis.com/compute/v1/",
              "",
            );
            const match = /^projects\/([^/]+)\/global\/networks\/([^/]+)$/.exec(raw);
            if (raw.includes("/") && (!match || match[1] !== project)) {
              fail("Cross-project or invalid network reference.");
            }
            const access = attr("private_ip_google_access") ?? false;
            if (typeof access !== "boolean") {
              fail("private_ip_google_access must be bool.");
            }
            configured = {
              ...base,
              region: string(attr("region") ?? provider.region, "region"),
              network: match?.[2] ?? raw,
              cidr: string(attr("ip_cidr_range"), "ip_cidr_range"),
              privateAccess: access as boolean,
            };
          }
        } else {
          configured = TfResourceConfiguration.compile(
            type,
            fullAddress,
            body,
            (expr) => {
              if (expr === undefined) {
                return undefined;
              }
              return E.scalar(literal(expr));
            },
            provider,
          );
        }
        validate(configured);
        const resource = observed.find((r) => r.address === fullAddress) ?? configured;
        resources.push(resource);
        if (resources.length > 100) {
          fail("At most 100 expanded resources are supported.");
        }
        const record = TerraformState.record(resource);
        return [
          instance,
          {
            ...record,
            id: TerraformState.id(resource),
            self_link:
              resource.type === "google_storage_bucket"
                ? `https://www.googleapis.com/storage/v1/b/${resource.name}`
                : `https://www.googleapis.com/compute/v1/${TerraformState.id(resource)}`,
          } as unknown as TfValue,
        ];
      });
      return group(block, result);
    });
  for (const address of resourceDefinitions.keys()) {
    resolveResource(address);
  }
  for (const name of moduleDefinitions.keys()) {
    resolveModule(name);
  }
  const allResources = [...resources, ...children.flatMap((m) => m.resources)];
  if (allResources.length > 100) {
    fail("At most 100 expanded resources are supported.");
  }
  if (new Set(allResources.map(TerraformState.id)).size !== allResources.length) {
    fail("Multiple addresses refer to the same remote object.");
  }
  const outputs: Record<string, TfValue> = {};
  const sensitive: string[] = [];
  for (const block of blocks.filter((b) => b.type === "output")) {
    const name = label(block, 1);
    if (Object.hasOwn(outputs, name)) {
      fail(`Duplicate output: ${name}`);
    }
    checkBody(block.body, ["value", "description", "sensitive"]);
    sensitiveRead = false;
    outputs[name] = evaluate(block.body.attributes.value ?? fail(`Output ${name} requires value.`));
    if (
      block.body.attributes.sensitive !== undefined &&
      typeof block.body.attributes.sensitive !== "boolean"
    ) {
      fail("sensitive must be bool.");
    }
    if (sensitiveRead && block.body.attributes.sensitive !== true) {
      fail(`Output ${name} references a sensitive variable; declare sensitive = true.`);
    }
    if (block.body.attributes.sensitive === true) {
      sensitive.push(name);
    }
  }
  const moves: TfMove[] = children.flatMap((m) => m.moves);
  for (const block of blocks.filter((b) => b.type === "moved")) {
    label(block, 0);
    checkBody(block.body, ["from", "to"]);
    const from = `${context.prefix}${Hcl.address(block.body.attributes.from ?? fail("moved requires from."))}`;
    const to = `${context.prefix}${Hcl.address(block.body.attributes.to ?? fail("moved requires to."))}`;
    if (TfStructure.moduleAddress(from)) {
      if (!TfStructure.moduleAddress(to)) {
        fail("A module must move to a module address.");
      }
      const targets = allResources.filter((r) => r.address.startsWith(`${to}.`));
      if (!targets.length) {
        fail("Moved module destination is not declared.");
      }
      for (const resource of targets) {
        moves.push({ from: `${from}${resource.address.slice(to.length)}`, to: resource.address });
      }
    } else {
      moves.push({ from, to });
    }
  }
  return { resources: allResources, outputs, moves, sensitive };
};
export const compileTerraform = (
  files: Readonly<Record<string, string>>,
  observed: readonly TfResource[],
  options: TfCompileOptions,
  validate: (r: TfResource) => void,
): Readonly<{
  resources: readonly TfResource[];
  outputs: Readonly<Record<string, string>>;
  moves: readonly TfMove[];
  sensitive: readonly string[];
  providerVersion: string;
  dependencies: Readonly<Record<string, readonly string[]>>;
}> => {
  TfBackend.configuration(files);
  const budget = {
    blocks: 0,
    modules: 0,
    constraints: [] as string[],
    dependencies: {} as Record<string, Set<string>>,
  };
  const result = compile(
    files,
    observed,
    options,
    { directory: "", prefix: "", inputs: {}, provider: {}, ancestors: [""], budget },
    validate,
  );
  const providerVersion = TfVersions.select(budget.constraints, options.providerVersion);
  TfStructure.validateMoves(result.moves);
  for (const move of result.moves) {
    if (result.resources.some((r) => r.address === move.from)) {
      fail(`Moved source is still declared: ${move.from}`);
    }
    if (
      !result.resources.some((r) => r.address === TfStructure.destination(move.from, result.moves))
    ) {
      fail(`Moved destination is not declared: ${move.to}`);
    }
  }
  return {
    ...result,
    providerVersion,
    dependencies: Object.fromEntries(
      Object.entries(budget.dependencies).map(([key, values]) => [key, [...values]]),
    ),
    outputs: Object.fromEntries(
      Object.entries(result.outputs).map(([key, value]) => [
        key,
        typeof value === "object" ? JSON.stringify(E.json(value)) : String(value),
      ]),
    ),
  };
};
