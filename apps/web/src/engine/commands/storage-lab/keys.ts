import { CommandFailure } from "@/engine/cli/command-failure";
import type { CommandSpec } from "@/engine/cli/command-spec";
import { invalid, missing, name, sf, text } from "@/engine/commands/compute-lab/shared";
import { IamPolicy } from "@/engine/domains/iam-policy";
import { allows } from "@/engine/domains/serverless-lab/runtime";
import { keyPath, storageAgent } from "@/engine/domains/storage-lab/model";
import { Result } from "@/utils/Result";
import { storageConfig } from "./config";
import { storageFinish } from "./runtime";

export const StorageKeyCommands: readonly CommandSpec[] = [
  ...["enable", "disable"].map((op) =>
    storageConfig(
      ["gcloud", "kms", "keys", "versions", op],
      "cloudkms.cryptoKeyVersions.update",
      "cloudkms.googleapis.com",
      (c, a) => {
        const key = c.world.serverlessLab.keys.find(
          (k) =>
            k.projectId === c.project.projectId &&
            k.region === text(a, "location") &&
            k.ring === text(a, "keyring") &&
            k.name === text(a, "key"),
        );
        if (!key || name(a) !== "1") {
          return missing("Only the modeled primary version 1 exists in this key scope.");
        }
        const enabled = op === "enable";
        if (key.enabled === enabled) {
          return invalid("Key version is already in the requested state.");
        }
        const world = {
          ...c.world,
          serverlessLab: {
            ...c.world.serverlessLab,
            keys: c.world.serverlessLab.keys.map((k) => (k === key ? { ...k, enabled } : k)),
          },
        };
        return storageFinish(world, {
          name: `${keyPath(key)}/cryptoKeyVersions/1`,
          state: enabled ? "ENABLED" : "DISABLED",
        });
      },
      [sf("keyring", true), sf("location", true), sf("key", true)],
    ),
  ),
  storageConfig(
    ["gcloud", "storage", "service-agent"],
    "storage.buckets.get",
    "storage.googleapis.com",
    (c, a) => {
      const email = storageAgent(c.world, c.project.projectId);
      const keyName = text(a, "authorize-cmek");
      if (!keyName) {
        return storageFinish(c.world, { email_address: email });
      }
      const key = c.world.serverlessLab.keys.find((k) => keyPath(k) === keyName);
      if (!key) {
        return missing("CMEK key not found.");
      }
      if (
        !allows(c.world, key.projectId, c.principal, "cloudkms.cryptoKeys.setIamPolicy", key.policy)
      ) {
        return Result.err(
          CommandFailure.permissionDenied({
            permission: "cloudkms.cryptoKeys.setIamPolicy",
            target: { type: "project", id: key.projectId },
            rolesIncluding: ["roles/cloudkms.admin"],
          }),
        );
      }
      const policy = IamPolicy.addBinding(
        key.policy,
        "roles/cloudkms.cryptoKeyEncrypterDecrypter",
        `serviceAccount:${email}`,
      );
      const world = {
        ...c.world,
        serverlessLab: {
          ...c.world.serverlessLab,
          keys: c.world.serverlessLab.keys.map((k) => (k === key ? { ...k, policy } : k)),
        },
      };
      return storageFinish(world, { email_address: email, authorizedKey: keyName });
    },
    [sf("authorize-cmek")],
    false,
  ),
];
