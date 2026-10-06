import type { ReactElement } from "react";
import { World } from "@/engine/domains/world";
import { Option } from "@/utils/Option";
import { joined, NotFound, type Row, Section, type SelectionProps } from "./PropertyParts";

export const LbResourceProperties = ({
  world,
  selection,
}: SelectionProps<"lb-resource">): ReactElement => {
  const found = World.findLocated(world, "lbResources", {
    projectId: selection.projectId,
    name: selection.name,
    location: `${selection.location}/${selection.resourceKind}`,
  });
  if (!Option.isSome(found)) {
    return <NotFound what="LBリソース" />;
  }
  const r = found.value;
  const rows: Row[] = [{ label: "location", value: r.location }];
  if (r.kind === "urlMaps") {
    rows.push(
      { label: "defaultService", value: r.defaultService },
      ...r.routes.map((route, i) => ({
        label: `route ${i + 1}`,
        value: `${route.hosts.join(", ")} ${route.paths.length === 0 ? "(default)" : route.paths.join(", ")} → ${route.service}`,
      })),
    );
  }
  if (r.kind === "targetHttpProxies" || r.kind === "targetHttpsProxies") {
    rows.push(
      { label: "urlMap", value: r.urlMap },
      { label: "sslCertificates", value: joined(r.sslCertificates) },
    );
  }
  if (r.kind === "sslCertificates") {
    rows.push(
      { label: "domains", value: joined(r.domains) },
      { label: "status", value: r.status },
      {
        label: "証明書の評価",
        value:
          "activate-certificateで教材用に状態を指定します。実際のDNS検証・証明書発行は行いません。",
      },
    );
  }
  if (r.kind === "networkEndpointGroups") {
    rows.push(
      { label: "type", value: "GCE_VM_IP_PORT" },
      { label: "network / subnet", value: `${r.network} / ${r.subnet}` },
      { label: "defaultPort", value: String(r.defaultPort) },
      ...r.endpoints.map((e, i) => ({
        label: `endpoint ${i + 1}`,
        value: `${e.instance} ${e.ipAddress}:${e.port}`,
      })),
    );
  }
  if (r.kind === "backendBuckets") {
    rows.push(
      { label: "bucketName", value: r.bucketName },
      { label: "CDN", value: String(r.enableCdn) },
      { label: "cacheMode", value: r.cacheMode },
      {
        label: "CDNの評価",
        value: "構成と接続先を判定します。キャッシュヒット・速度・実通信は再現しません。",
      },
    );
  }
  return <Section title="接続構成" rows={rows} />;
};
