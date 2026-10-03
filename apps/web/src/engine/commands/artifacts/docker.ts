import {
  Column,
  CommandOutput,
  type CommandSpec,
  Flag,
  ParsedArgs,
  Positional,
} from "@/engine/cli/command-spec";
import {
  account,
  commit,
  dockerRepository,
  fail,
  guarded,
  record,
  success,
} from "@/engine/commands/artifacts/shared";
import { plainCommand } from "@/engine/commands/shared";
import { ContainerLab, type LocalContainer } from "@/engine/domains/container-lab";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

const images = (w: World): readonly string[] =>
  w.containerLab.images.flatMap((i) => [...i.tags, i.id]);
const containers = (w: World): readonly string[] => w.containerLab.containers.map((c) => c.name);
const imageArg = Positional.required(
  "IMAGE",
  "Local image reference or exact simulated image ID.",
  images,
);
const containerArg = Positional.required("CONTAINER", "Container name or exact ID.", containers);
const findContainer = (w: World, name: string): LocalContainer =>
  w.containerLab.containers.find((c) => c.name === name || c.id === name) ??
  fail(`No such container: ${name}`);
const pull = (world: World, value: string, now: string): World => {
  const ref = ContainerLab.registryReference(value);
  dockerRepository(world, ref, false);
  const remote =
    world.containerLab.registryImages.find(
      (i) =>
        i.repositoryId === ref.repositoryId &&
        i.name === ref.image &&
        (ref.digest ? i.digest === ref.digest : i.tags.includes(ref.tag)),
    ) ?? fail(`Image not found in registry: ${ref.canonical}`);
  return commit(
    world,
    ContainerLab.withImage(world.containerLab, remote.recipe, ref.canonical, now),
  );
};
export const DockerCommands: readonly CommandSpec[] = [
  plainCommand({
    path: ["sim", "docker", "example"],
    summary: "Read a built-in Dockerfile/application fixture; no code is executed.",
    positionals: [
      Positional.optional("CONTEXT", "Built-in context.", () => ["./hello-web", "./hello-web-v2"]),
    ],
    run: guarded((ctx, args) =>
      success(ctx.world, ContainerLab.example(args.positionals[0] ?? ".")),
    ),
  }),
  plainCommand({
    path: ["docker", "build"],
    summary: "Build a simulated image from a fixed lesson context; no host files or Docker daemon.",
    positionals: [
      Positional.required("CONTEXT", "Only ., ./hello-web, ./hello-web-v2.", () => [
        ".",
        "./hello-web",
        "./hello-web-v2",
      ]),
    ],
    flags: [
      Flag.string("tag", "Image name and tag.", {
        required: true,
        aliases: ["-t"],
        singleUse: true,
      }),
    ],
    run: guarded((ctx, args) => {
      const recipe = ContainerLab.recipe(ParsedArgs.requiredPositional(args, 0));
      const ref = ContainerLab.reference(ParsedArgs.requiredString(args, "tag"));
      if (ref.digest) fail("Build requires a tag, not a digest reference.");
      return success(
        commit(
          ctx.world,
          ContainerLab.withImage(ctx.world.containerLab, recipe, ref.canonical, ctx.now),
        ),
        `Built ${ref.canonical}\nSimulated image ID: ${ContainerLab.digest(recipe)}\nNo Dockerfile was executed.`,
      );
    }),
  }),
  plainCommand({
    path: ["docker", "images"],
    summary: "List local images, separately from registry images.",
    run: guarded((ctx) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          ctx.world.containerLab.images.flatMap((i) =>
            (i.tags.length ? i.tags : ["<none>"]).map((tag) => ({
              reference: tag,
              id: i.id,
              recipe: i.recipe,
            })),
          ),
          [
            Column.create("REFERENCE", "reference"),
            Column.create("IMAGE ID", "id"),
            Column.create("LESSON", "recipe"),
          ],
        ),
      }),
    ),
  }),
  plainCommand({
    path: ["docker", "tag"],
    summary: "Add or move a local tag without copying the image.",
    positionals: [imageArg, Positional.required("TARGET", "Target NAME[:TAG].")],
    run: guarded((ctx, args) => {
      const source = ContainerLab.local(
        ctx.world.containerLab,
        ParsedArgs.requiredPositional(args, 0),
      );
      const target = ContainerLab.reference(ParsedArgs.requiredPositional(args, 1));
      if (target.digest) fail("Target must be a tag.");
      return success(
        commit(
          ctx.world,
          ContainerLab.withImage(
            ctx.world.containerLab,
            source.recipe,
            target.canonical,
            source.created,
          ),
        ),
        `Tagged ${target.canonical}`,
      );
    }),
  }),
  plainCommand({
    path: ["docker", "push"],
    summary: "Push a local tagged image to an existing simulated Artifact Registry repository.",
    positionals: [imageArg],
    run: guarded((ctx, args) => {
      const ref = ContainerLab.registryReference(ParsedArgs.requiredPositional(args, 0));
      if (ref.digest) fail("Push requires a tag.");
      const source = ContainerLab.local(ctx.world.containerLab, ref.canonical);
      const repo = dockerRepository(ctx.world, ref, true);
      const all = ctx.world.containerLab.registryImages;
      const occupied = all.find(
        (i) => i.repositoryId === repo.id && i.name === ref.image && i.tags.includes(ref.tag),
      );
      if (repo.immutableTags && occupied && occupied.digest !== source.id)
        fail("Tag is immutable and already points to a different digest.");
      const old = all.find(
        (i) => i.repositoryId === repo.id && i.name === ref.image && i.digest === source.id,
      );
      const registryImages = all
        .filter((i) => i !== old)
        .map((i) =>
          i.repositoryId === repo.id && i.name === ref.image
            ? { ...i, tags: i.tags.filter((t) => t !== ref.tag) }
            : i,
        );
      const next = {
        ...ctx.world.containerLab,
        registryImages: [
          ...registryImages,
          {
            repositoryId: repo.id,
            name: ref.image,
            digest: source.id,
            recipe: source.recipe,
            tags: [...new Set([...(old?.tags ?? []), ref.tag])],
            uploaded: old?.uploaded ?? ctx.now,
          },
        ],
      };
      return success(
        commit(ctx.world, next),
        `Pushed ${ref.canonical}\ndigest: ${source.id} (simulated)`,
      );
    }),
  }),
  plainCommand({
    path: ["docker", "pull"],
    summary: "Pull a tagged image or digest from simulated Artifact Registry.",
    positionals: [Positional.required("IMAGE", "Artifact Registry image reference.")],
    run: guarded((ctx, args) =>
      success(
        pull(ctx.world, ParsedArgs.requiredPositional(args, 0), ctx.now),
        `Pulled ${ParsedArgs.requiredPositional(args, 0)} (simulated).`,
      ),
    ),
  }),
  plainCommand({
    path: ["docker", "run"],
    summary:
      "Start a simulated detached lesson container; missing images are pulled from Artifact Registry.",
    positionals: [imageArg],
    flags: [
      Flag.boolean("detach", "Detached mode is required.", { aliases: ["-d"] }),
      Flag.string("name", "Container name."),
      Flag.string("publish", "One HOST_PORT:CONTAINER_PORT mapping.", {
        aliases: ["-p"],
        singleUse: true,
      }),
    ],
    run: guarded((ctx, args) => {
      if (!ParsedArgs.boolean(args, "detach"))
        fail("Only detached mode is supported; use -d. Interactive processes are not executed.");
      const raw = ParsedArgs.requiredPositional(args, 0);
      const local = ctx.world.containerLab.images.some(
        (i) => i.id === raw || i.tags.includes(ContainerLab.reference(raw).canonical),
      );
      const world = local ? ctx.world : pull(ctx.world, raw, ctx.now);
      const image = ContainerLab.local(world.containerLab, raw);
      const numbered = World.nextNumber(world);
      const name = Option.unwrapOr(ParsedArgs.string(args, "name"), `lesson-${numbered.number}`);
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(name)) fail("Invalid container name.");
      if (world.containerLab.containers.some((c) => c.name === name))
        fail(`Container name already exists: ${name}`);
      const publish = ParsedArgs.string(args, "publish");
      const ports = Option.isSome(publish) ? /^(\d+):(\d+)$/.exec(publish.value) : undefined;
      if (Option.isSome(publish) && !ports) fail("Use a single HOST_PORT:CONTAINER_PORT mapping.");
      const hostPort = ports ? Number(ports[1]) : 0;
      const containerPort = ports ? Number(ports[2]) : 0;
      if (ports && [hostPort, containerPort].some((p) => p < 1 || p > 65535))
        fail("Ports must be between 1 and 65535.");
      const container: LocalContainer = {
        id: `sim-container-${numbered.number}`,
        name,
        imageId: image.id,
        imageRef: raw,
        status: "RUNNING",
        hostPort,
        containerPort,
        created: ctx.now,
      };
      return success(
        commit(numbered.world, {
          ...world.containerLab,
          containers: [...world.containerLab.containers, container],
        }),
        `${container.id}\nSimulated container started; no process or network listener was created.`,
      );
    }),
  }),
  plainCommand({
    path: ["docker", "ps"],
    summary: "List running simulated containers.",
    flags: [Flag.boolean("all", "Include stopped containers.", { aliases: ["-a"] })],
    run: guarded((ctx, args) =>
      Result.ok({
        world: ctx.world,
        output: CommandOutput.table(
          ctx.world.containerLab.containers
            .filter((c) => ParsedArgs.boolean(args, "all") || c.status === "RUNNING")
            .map((c) => ({
              id: c.id,
              image: c.imageRef,
              status: c.status,
              ports: c.hostPort ? `${c.hostPort}->${c.containerPort}/tcp` : "",
              name: c.name,
            })),
          [
            Column.create("CONTAINER ID", "id"),
            Column.create("IMAGE", "image"),
            Column.create("STATUS", "status"),
            Column.create("PORTS", "ports"),
            Column.create("NAMES", "name"),
          ],
        ),
      }),
    ),
  }),
  plainCommand({
    path: ["docker", "logs"],
    summary: "Read fixed lesson startup logs; no application process runs.",
    positionals: [containerArg],
    run: guarded((ctx, args) => {
      const c = findContainer(ctx.world, ParsedArgs.requiredPositional(args, 0));
      const image = ContainerLab.local(ctx.world.containerLab, c.imageId);
      return success(
        ctx.world,
        `[simulated] ${ContainerLab.response(image.recipe)}; listening on container port 8080${c.status === "EXITED" ? "\n[simulated] stopped" : ""}`,
      );
    }),
  }),
  plainCommand({
    path: ["docker", "inspect"],
    summary: "Inspect a simulated container and its pinned image ID.",
    positionals: [containerArg],
    run: guarded((ctx, args) => {
      const c = findContainer(ctx.world, ParsedArgs.requiredPositional(args, 0));
      return record(ctx.world, {
        Id: c.id,
        Name: c.name,
        Image: c.imageId,
        Config: { Image: c.imageRef },
        State: { Status: c.status.toLowerCase() },
        HostConfig: {
          PortBindings: c.hostPort
            ? { [`${c.containerPort}/tcp`]: [{ HostPort: String(c.hostPort) }] }
            : {},
        },
      });
    }),
  }),
  plainCommand({
    path: ["sim", "docker", "request"],
    summary:
      "Check the published lesson port and show a fixed HTTP response; no HTTP request is sent.",
    positionals: [containerArg],
    run: guarded((ctx, args) => {
      const c = findContainer(ctx.world, ParsedArgs.requiredPositional(args, 0));
      if (c.status !== "RUNNING" || !c.hostPort || c.containerPort !== 8080)
        fail(
          "Connection failed (simulated): container must be running and publish host traffic to container port 8080.",
        );
      return success(
        ctx.world,
        `HTTP/1.1 200 OK (simulated)\n${ContainerLab.response(ContainerLab.local(ctx.world.containerLab, c.imageId).recipe)}`,
      );
    }),
  }),
  plainCommand({
    path: ["docker", "stop"],
    summary: "Stop a simulated container and release its published port.",
    positionals: [containerArg],
    run: guarded((ctx, args) => {
      const c = findContainer(ctx.world, ParsedArgs.requiredPositional(args, 0));
      return success(
        commit(ctx.world, {
          ...ctx.world.containerLab,
          containers: ctx.world.containerLab.containers.map((i) =>
            i.id === c.id ? { ...i, status: "EXITED" } : i,
          ),
        }),
        c.name,
      );
    }),
  }),
  plainCommand({
    path: ["docker", "rm"],
    summary: "Remove a stopped simulated container.",
    positionals: [containerArg],
    flags: [Flag.boolean("force", "Remove a running container too.", { aliases: ["-f"] })],
    run: guarded((ctx, args) => {
      const c = findContainer(ctx.world, ParsedArgs.requiredPositional(args, 0));
      if (c.status === "RUNNING" && !ParsedArgs.boolean(args, "force"))
        fail("Container is running. Stop it first or use --force.");
      return success(
        commit(ctx.world, {
          ...ctx.world.containerLab,
          containers: ctx.world.containerLab.containers.filter((i) => i.id !== c.id),
        }),
        c.name,
      );
    }),
  }),
  plainCommand({
    path: ["docker", "rmi"],
    summary: "Remove one local image tag or an unreferenced image ID; registry images remain.",
    positionals: [imageArg],
    run: guarded((ctx, args) => {
      const raw = ParsedArgs.requiredPositional(args, 0);
      const image = ContainerLab.local(ctx.world.containerLab, raw);
      const byId = image.id === raw;
      if (byId && image.tags.length > 1) fail("Image has multiple tags. Remove tags individually.");
      const tags = byId
        ? []
        : image.tags.filter((t) => t !== ContainerLab.reference(raw).canonical);
      if (!tags.length && ctx.world.containerLab.containers.some((c) => c.imageId === image.id))
        fail("Image is still referenced by a container. Remove the container first.");
      const remaining = ctx.world.containerLab.images.filter((i) => i.id !== image.id);
      return success(
        commit(ctx.world, {
          ...ctx.world.containerLab,
          images: tags.length ? [...remaining, { ...image, tags }] : remaining,
        }),
        `Removed local reference ${raw}.`,
      );
    }),
  }),
  plainCommand({
    path: ["gcloud", "auth", "configure-docker"],
    summary:
      "Configure simulated gcloud credential helpers for the specified Artifact Registry hosts.",
    positionals: [
      Positional.required("HOSTS", "Comma-separated LOCATION-docker.pkg.dev hosts.", () =>
        ContainerLab.locations().map((l) => `${l}-docker.pkg.dev`),
      ),
    ],
    run: guarded((ctx, args) => {
      account(ctx.world, args);
      const hosts = ParsedArgs.requiredPositional(args, 0).split(",").map(ContainerLab.host);
      return success(
        commit(ctx.world, {
          ...ctx.world.containerLab,
          authHosts: [...new Set([...ctx.world.containerLab.authHosts, ...hosts])],
        }),
        `Configured simulated gcloud credential helper for ${hosts.join(", ")}. Docker uses the active gcloud account at push/pull time.`,
      );
    }),
  }),
];
