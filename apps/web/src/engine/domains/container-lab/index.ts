import { Region } from "@/engine/domains/catalog";
import { IamMember, type IamPolicy, RoleName } from "@/engine/domains/iam-policy";
import { ProjectId } from "@/engine/domains/resource-hierarchy";
import { Decoder as D } from "@/utils/Decoder";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

export type Recipe = "hello-web" | "hello-web-v2";
export type LocalImage = Readonly<{
  id: string;
  recipe: Recipe;
  tags: readonly string[];
  created: string;
}>;
export type LocalContainer = Readonly<{
  id: string;
  name: string;
  imageId: string;
  imageRef: string;
  status: "RUNNING" | "EXITED";
  hostPort: number;
  containerPort: number;
  created: string;
}>;
export type ArtifactRepository = Readonly<{
  id: string;
  projectId: string;
  location: string;
  name: string;
  description: string;
  immutableTags: boolean;
  iamPolicy: IamPolicy;
  created: string;
}>;
export type RegistryImage = Readonly<{
  repositoryId: string;
  name: string;
  digest: string;
  recipe: Recipe;
  tags: readonly string[];
  uploaded: string;
}>;
export type CloudBuild = Readonly<{
  id: string;
  projectId: string;
  region: string;
  source: Recipe;
  tag: string;
  serviceAccount: string;
  status: "QUEUED" | "WORKING" | "SUCCESS" | "FAILURE" | "CANCELLED";
  created: string;
  digest: string;
  logs: readonly string[];
}>;
export type ReleaseEvidence = Readonly<{
  id: "ace-release";
  stage: "LOCAL_VALIDATED" | "DEPLOYMENT_VALIDATED";
  digest: string;
  localValidatedAt: string;
  deploymentValidatedAt: string;
}>;
export type ContainerLab = Readonly<{
  releases: readonly ReleaseEvidence[];
  builds: readonly CloudBuild[];
  images: readonly LocalImage[];
  containers: readonly LocalContainer[];
  authHosts: readonly string[];
  repositories: readonly ArtifactRepository[];
  registryImages: readonly RegistryImage[];
}>;
export type ImageRef = Readonly<{ name: string; tag: string; digest: string; canonical: string }>;
export type RegistryRef = ImageRef &
  Readonly<{
    host: string;
    projectId: string;
    location: string;
    repository: string;
    repositoryId: string;
    image: string;
  }>;
const fail = (message: string): never => {
  throw new Error(message);
};
const recipe = D.literal<Recipe>(["hello-web", "hello-web-v2"]);
const policy = D.object<IamPolicy>({
  bindings: D.array(
    D.object({
      role: D.parsed(RoleName.parse, "role"),
      members: D.array(D.validated(IamMember.parse)),
    }),
  ),
});
const localImage = D.object<LocalImage>({
  id: D.string,
  recipe,
  tags: D.array(D.string),
  created: D.string,
});
const container = D.object<LocalContainer>({
  id: D.string,
  name: D.string,
  imageId: D.string,
  imageRef: D.string,
  status: D.literal(["RUNNING", "EXITED"]),
  hostPort: D.number,
  containerPort: D.number,
  created: D.string,
});
const repository = D.object<ArtifactRepository>({
  id: D.string,
  projectId: D.string,
  location: D.string,
  name: D.string,
  description: D.string,
  immutableTags: D.boolean,
  iamPolicy: policy,
  created: D.string,
});
const registryImage = D.object<RegistryImage>({
  repositoryId: D.string,
  name: D.string,
  digest: D.string,
  recipe,
  tags: D.array(D.string),
  uploaded: D.string,
});
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
const imageName = (name: string): boolean =>
  name.length <= 240 && name.split("/").every((p) => /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(p));
const tagValid = (tag: string): boolean => /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag);
export const ContainerLab = {
  empty: (): ContainerLab => ({
    releases: [],
    builds: [],
    images: [],
    containers: [],
    authHosts: [],
    repositories: [],
    registryImages: [],
  }),
  decoder: D.object<ContainerLab>({
    releases: D.array(
      D.object<ReleaseEvidence>({
        id: D.literal(["ace-release"]),
        stage: D.literal(["LOCAL_VALIDATED", "DEPLOYMENT_VALIDATED"]),
        digest: D.string,
        localValidatedAt: D.string,
        deploymentValidatedAt: D.string,
      }),
    ),
    builds: D.array(
      D.object<CloudBuild>({
        id: D.string,
        projectId: D.string,
        region: D.string,
        source: recipe,
        tag: D.string,
        serviceAccount: D.string,
        status: D.literal(["QUEUED", "WORKING", "SUCCESS", "FAILURE", "CANCELLED"]),
        created: D.string,
        digest: D.string,
        logs: D.array(D.string),
      }),
    ),
    images: D.array(localImage),
    containers: D.array(container),
    authHosts: D.array(D.string),
    repositories: D.array(repository),
    registryImages: D.array(registryImage),
  }),
  locations: (): readonly string[] => [...Region.all(), "us", "europe", "asia"],
  location(value: string): string {
    if (!ContainerLab.locations().includes(value))
      fail(`Unsupported Artifact Registry location: ${value}`);
    return value;
  },
  repositoryId(projectId: string, location: string, name: string): string {
    return `projects/${projectId}/locations/${location}/repositories/${name}`;
  },
  repositoryName(name: string): string {
    if (!/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(name))
      fail(
        "Repository ID must be 2–63 lowercase letters, digits or hyphens, starting with a letter and ending with a letter or digit.",
      );
    return name;
  },
  host(value: string): string {
    const match = /^([a-z0-9-]+)-docker\.pkg\.dev$/.exec(value);
    if (!match)
      return fail("Use a supported LOCATION-docker.pkg.dev hostname (without https:// or a path).");
    ContainerLab.location(match[1] ?? "");
    return value;
  },
  reference(value: string): ImageRef {
    const digestParts = value.split("@");
    if (digestParts.length > 2) return fail("Invalid image reference.");
    const raw = digestParts[0] ?? "";
    const colon = raw.lastIndexOf(":");
    const name = colon >= 0 ? raw.slice(0, colon) : raw;
    const tag = digestParts.length === 2 ? "" : colon >= 0 ? raw.slice(colon + 1) : "latest";
    const digest = digestParts[1] ?? "";
    if (
      !imageName(name) ||
      (digestParts.length === 2
        ? colon >= 0 || !/^sha256:[a-f0-9]{64}$/.test(digest)
        : !tagValid(tag))
    )
      return fail(
        "Invalid image reference. Use NAME[:TAG] or NAME@sha256:DIGEST; custom registry ports are unsupported.",
      );
    return { name, tag, digest, canonical: digest ? `${name}@${digest}` : `${name}:${tag}` };
  },
  registryReference(value: string): RegistryRef {
    const ref = ContainerLab.reference(value);
    const [host = "", projectId = "", repository = "", ...parts] = ref.name.split("/");
    ContainerLab.host(host);
    if (!Result.isOk(ProjectId.parse(projectId))) fail("Invalid project ID in image reference.");
    ContainerLab.repositoryName(repository);
    if (!parts.length) fail("Use LOCATION-docker.pkg.dev/PROJECT/REPOSITORY/IMAGE[:TAG].");
    const location = host.replace("-docker.pkg.dev", "");
    return {
      ...ref,
      host,
      projectId,
      location,
      repository,
      repositoryId: ContainerLab.repositoryId(projectId, location, repository),
      image: parts.join("/"),
    };
  },
  recipe(context: string): Recipe {
    if ([".", "hello-web", "./hello-web"].includes(context)) return "hello-web";
    if (["hello-web-v2", "./hello-web-v2"].includes(context)) return "hello-web-v2";
    return fail(
      "Only built-in contexts ./hello-web (or .) and ./hello-web-v2 are supported. Run sim docker example. No host files are read.",
    );
  },
  digest(recipe: Recipe): string {
    return `sha256:${(recipe === "hello-web" ? "1" : "2").repeat(64)}`;
  },
  response(recipe: Recipe): string {
    return `Hello from gcloud-sim ${recipe === "hello-web" ? "v1" : "v2"}`;
  },
  example(context: string): string {
    const selected = ContainerLab.recipe(context);
    return `Built-in context: ${selected} (simulated; no code runs)\n\nDockerfile:\nFROM node:24-alpine\nWORKDIR /app\nCOPY server.js .\nEXPOSE 8080\nCMD ["node", "server.js"]\n\nserver.js:\nrequire('node:http').createServer((req, res) => res.end('${ContainerLab.response(selected)}')).listen(8080);`;
  },
  local(lab: ContainerLab, value: string): LocalImage {
    const byId = lab.images.find((i) => i.id === value);
    if (byId) return byId;
    const ref = ContainerLab.reference(value);
    return (
      lab.images.find((i) => i.tags.includes(ref.canonical)) ?? fail(`No local image: ${value}`)
    );
  },
  withImage(lab: ContainerLab, selected: Recipe, ref: string, now: string): ContainerLab {
    const canonical = ContainerLab.reference(ref).canonical;
    const id = ContainerLab.digest(selected);
    const old = lab.images.find((i) => i.id === id);
    const images = lab.images
      .filter((i) => i.id !== id)
      .map((i) => ({ ...i, tags: i.tags.filter((t) => t !== canonical) }));
    return {
      ...lab,
      images: [
        ...images,
        {
          id,
          recipe: selected,
          created: old?.created ?? now,
          tags: [...new Set([...(old?.tags ?? []), canonical])],
        },
      ],
    };
  },
  publish(lab: ContainerLab, ref: RegistryRef, recipe: Recipe, now: string): ContainerLab {
    const repo =
      lab.repositories.find((r) => r.id === ref.repositoryId) ?? fail("Repository not found.");
    if (ref.digest) fail("Push requires a tag.");
    const digest = ContainerLab.digest(recipe);
    const occupied = lab.registryImages.find(
      (i) => i.repositoryId === repo.id && i.name === ref.image && i.tags.includes(ref.tag),
    );
    if (repo.immutableTags && occupied && occupied.digest !== digest)
      fail("Tag is immutable and already points to a different digest.");
    const old = lab.registryImages.find(
      (i) => i.repositoryId === repo.id && i.name === ref.image && i.digest === digest,
    );
    const others = lab.registryImages
      .filter((i) => i !== old)
      .map((i) =>
        i.repositoryId === repo.id && i.name === ref.image
          ? { ...i, tags: i.tags.filter((t) => t !== ref.tag) }
          : i,
      );
    return {
      ...lab,
      registryImages: [
        ...others,
        {
          repositoryId: repo.id,
          name: ref.image,
          digest,
          recipe,
          tags: [...new Set([...(old?.tags ?? []), ref.tag])],
          uploaded: old?.uploaded ?? now,
        },
      ],
    };
  },
  validate(lab: ContainerLab): Result<ContainerLab, string> {
    try {
      if (lab.releases.length > 1) {
        fail("Only one fixed release lesson is supported.");
      }
      for (const evidence of lab.releases) {
        if (evidence.digest !== ContainerLab.digest("hello-web")) {
          fail("Invalid release evidence digest.");
        }
        if (!Number.isFinite(Date.parse(evidence.localValidatedAt))) {
          fail("Invalid local validation timestamp.");
        }
        if (evidence.stage === "LOCAL_VALIDATED" && evidence.deploymentValidatedAt !== "") {
          fail("Local evidence cannot contain a deployment validation.");
        }
        if (evidence.stage === "DEPLOYMENT_VALIDATED") {
          const deployed = Date.parse(evidence.deploymentValidatedAt);
          if (!Number.isFinite(deployed) || deployed < Date.parse(evidence.localValidatedAt)) {
            fail("Invalid deployment validation timestamp.");
          }
        }
      }
      if (lab.builds.length > 100 || !unique(lab.builds.map((b) => b.id)))
        fail("Invalid build collection.");
      for (const b of lab.builds) {
        if (!/^build-[1-9][0-9]*$/.test(b.id) || !Result.isOk(ProjectId.parse(b.projectId)))
          fail("Invalid build identity.");
        if (b.region !== "global" && !Option.isSome(Region.parse(b.region)))
          fail("Invalid build region.");
        if (ContainerLab.registryReference(b.tag).digest) fail("Build target requires a tag.");
        if (!/^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(b.serviceAccount))
          fail("Invalid build service account.");
        if (b.digest !== (b.status === "SUCCESS" ? ContainerLab.digest(b.source) : ""))
          fail("Invalid build result digest.");
      }
      if (
        lab.images.length > 100 ||
        lab.containers.length > 100 ||
        lab.repositories.length > 100 ||
        lab.registryImages.length > 200 ||
        lab.authHosts.length > 8
      )
        fail("Container lab resource limit exceeded.");
      if (
        !unique(lab.images.map((i) => i.id)) ||
        !unique(lab.images.flatMap((i) => i.tags)) ||
        lab.images.reduce((n, i) => n + i.tags.length, 0) > 200
      )
        fail("Duplicate local image or tag, or too many tags.");
      for (const i of lab.images) {
        if (i.id !== ContainerLab.digest(i.recipe)) fail("Invalid simulated image digest.");
        for (const tag of i.tags) {
          const ref = ContainerLab.reference(tag);
          if (ref.canonical !== tag || (ref.digest && ref.digest !== i.id))
            fail("Invalid canonical image tag.");
        }
      }
      if (!unique(lab.containers.map((c) => c.id)) || !unique(lab.containers.map((c) => c.name)))
        fail("Duplicate container ID or name.");
      if (
        !unique(
          lab.containers
            .filter((c) => c.status === "RUNNING" && c.hostPort > 0)
            .map((c) => String(c.hostPort)),
        )
      )
        fail("Conflicting published ports.");
      for (const c of lab.containers) {
        if (
          !/^sim-container-\d+$/.test(c.id) ||
          !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(c.name) ||
          !lab.images.some((i) => i.id === c.imageId)
        )
          fail("Invalid container or missing local image.");
        for (const port of [c.hostPort, c.containerPort])
          if (!Number.isInteger(port) || port < 0 || port > 65535) fail("Invalid container port.");
        if ((c.hostPort === 0) !== (c.containerPort === 0)) fail("Incomplete published port.");
      }
      if (!unique(lab.repositories.map((r) => r.id)) || !unique(lab.authHosts))
        fail("Duplicate repository or auth host.");
      for (const host of lab.authHosts) ContainerLab.host(host);
      for (const r of lab.repositories) {
        ContainerLab.repositoryName(r.name);
        ContainerLab.location(r.location);
        if (
          !Result.isOk(ProjectId.parse(r.projectId)) ||
          r.id !== ContainerLab.repositoryId(r.projectId, r.location, r.name)
        )
          fail("Invalid repository identity.");
      }
      if (
        !unique(lab.registryImages.map((i) => `${i.repositoryId}/${i.name}@${i.digest}`)) ||
        !unique(
          lab.registryImages.flatMap((i) => i.tags.map((t) => `${i.repositoryId}/${i.name}:${t}`)),
        )
      )
        fail("Duplicate registry image or tag.");
      for (const i of lab.registryImages) {
        if (
          !lab.repositories.some((r) => r.id === i.repositoryId) ||
          !imageName(i.name) ||
          i.digest !== ContainerLab.digest(i.recipe) ||
          i.tags.length > 100 ||
          i.tags.some((t) => !tagValid(t))
        )
          fail("Invalid registry image or missing repository.");
      }
      return Result.ok(lab);
    } catch (e) {
      return Result.err(e instanceof Error ? e.message : "Invalid container lab.");
    }
  },
} as const;
