// @vitest-environment node
import { expect, test } from "vitest";
import { applicationLb, executeLb } from "@/engine/__tests__/lb.setup";
import { lbHealth, lbProbe } from "@/engine/domains/load-balancing/graph";

test("global Application LB connects every hop and has two explicit healthy applications", () => {
  const s = applicationLb();
  const b = s.world.backendServices[0];
  const r = s.world.forwardingRules[0];
  expect(b).toBeDefined();
  expect(r).toBeDefined();
  if (b === undefined || r === undefined) {
    throw new Error("Missing LB");
  }
  expect(lbHealth(s.world, b).map((h) => h.healthState)).toEqual(["HEALTHY", "HEALTHY"]);
  expect(
    lbProbe(s.world, r, {
      host: "example.test",
      path: "/",
      port: 80,
      sourceIp: "198.51.100.10",
      network: "",
      region: "",
      minHealthy: 2,
    }),
  ).toMatchObject({
    success: true,
    healthy: 2,
    chain: ["web-front", "web-proxy", "web-map", "web-backend"],
  });
  expect(
    executeLb(s, "gcloud compute backend-services get-health web-backend --global").text,
  ).toContain("HEALTHY");
});
