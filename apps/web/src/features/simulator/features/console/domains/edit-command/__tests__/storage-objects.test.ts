// @vitest-environment node
import { expect, test } from "vitest";
import { run, session } from "@/engine/__tests__/setup";
import { World } from "@/engine/domains/world";
import {
  deleteObjectCommand,
  StorageFolderCreateForm,
  StorageObjectEditForm,
  StorageObjectUploadForm,
} from "@/features/simulator/features/console/domains/edit-command/storage";
import { Option } from "@/utils/Option";

const projectId = "ace-dev-01";

test("Cloud Storage の疑似アップロード・フォルダ作成・オブジェクト編集・削除が CLI エンジンでそのまま通る", () => {
  let s = run(session(), "gcloud storage buckets create gs://my-assets --location=ASIA-NORTHEAST1");

  // 1. ファイルを疑似アップロード（拡張子から text/html を自動設定）
  const uploadSteps = StorageObjectUploadForm.toSteps(
    { bucket: "my-assets", prefix: "", fileName: "index.html", contentType: "" },
    projectId,
  );
  expect(uploadSteps).toHaveLength(2);
  for (const step of uploadSteps) {
    s = run(s, step.line);
  }
  const bucket1 = Option.unwrap(World.findBucket(s.world, "my-assets"));
  const uploaded = bucket1.objects.find((o) => o.name === "index.html");
  expect(uploaded?.contentType).toBe("text/html");

  // 2. フォルダを作成
  const folderCmd = StorageFolderCreateForm.toCommand(
    { bucket: "my-assets", prefix: "", folderName: "images" },
    projectId,
  );
  s = run(s, folderCmd);
  const bucket2 = Option.unwrap(World.findBucket(s.world, "my-assets"));
  expect(bucket2.objects.some((o) => o.name === "images/.keep")).toBe(true);

  // 3. オブジェクトのストレージクラスと Content-Type を編集
  const obj = bucket2.objects.find((o) => o.name === "index.html");
  expect(obj).toBeDefined();
  if (obj === undefined) return;
  const editSteps = StorageObjectEditForm.toSteps(
    {
      ...StorageObjectEditForm.fromObject(bucket2, obj),
      storageClass: "NEARLINE",
      contentType: "text/plain",
    },
    projectId,
  );
  expect(editSteps).toHaveLength(1);
  s = run(s, editSteps[0]?.line ?? "");
  const bucket3 = Option.unwrap(World.findBucket(s.world, "my-assets"));
  const edited = bucket3.objects.find((o) => o.name === "index.html");
  expect(edited?.storageClass).toEqual(Option.some("NEARLINE"));
  expect(edited?.contentType).toBe("text/plain");

  // 4. オブジェクトを削除
  s = run(s, deleteObjectCommand("my-assets", "index.html", projectId));
  const bucket4 = Option.unwrap(World.findBucket(s.world, "my-assets"));
  expect(bucket4.objects.some((o) => o.name === "index.html")).toBe(false);
});
