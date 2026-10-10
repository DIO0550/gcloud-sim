import type { FileStorage } from "./model";

/** Fixed reference examples, not a catalog of all supported cloud combinations. */
export const fileProfileValid = (f: FileStorage): boolean => {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(f.name)) {
    return false;
  }
  if (f.kind === "filestore") {
    const minimum = f.tier === "BASIC_HDD" ? 1024 : 2560;
    return (
      f.location === "us-central1-c" &&
      ["BASIC_HDD", "BASIC_SSD"].includes(f.tier) &&
      f.capacity >= minimum &&
      f.capacity <= 65433 &&
      f.protocol === "NFS_V3" &&
      /^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(f.share) &&
      f.pool === ""
    );
  }
  if (f.kind === "netapp-pool") {
    return (
      f.location === "us-central1" &&
      f.capacity === 2048 &&
      f.tier === "STANDARD" &&
      f.protocol === "" &&
      f.share === "" &&
      f.pool === ""
    );
  }
  if (f.kind === "netapp-volume") {
    return (
      f.location === "us-central1" &&
      f.capacity === 1024 &&
      f.tier === "STANDARD" &&
      ["NFSV3", "NFSV4", "NFSV3,NFSV4"].includes(f.protocol) &&
      /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(f.share) &&
      f.pool.length > 0
    );
  }
  return (
    f.location === "us-central1-a" &&
    f.capacity === 18000 &&
    f.tier === "1000" &&
    f.protocol === "LUSTRE" &&
    /^[A-Za-z0-9]{1,8}$/.test(f.share) &&
    f.pool === ""
  );
};
