import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Engine } from "@/engine";
import { run, session } from "@/engine/__tests__/setup";
import { observeResources } from "@/engine/domains/observability-lab/resources";
import { ObservePrelude, ObserveSolutions } from "@/engine/missions/observability-lab";
import { TreeNode, TreeSelection } from "@/engine/resource-tree";
import { ObservabilityLabProperties } from "@/features/simulator/components/ObservabilityLabProperties";

const selection = (
  collection: "channels" | "objectives" | "collectors" | "buckets",
  name: string,
) => ({ kind: "observability-lab", projectId: "ace-dev-01", collection, name }) as const;
test("channels show enabled and verified independently", () => {
  const before = run(session(), ...ObservePrelude, ...ObserveSolutions.notification.slice(0, -2));
  const s = selection("channels", "oncall");
  const view = render(<ObservabilityLabProperties world={before.world} selection={s} />);
  expect(screen.getByText("有効").nextElementSibling).toHaveTextContent("はい");
  expect(screen.getByText("検証済み").nextElementSibling).toHaveTextContent("いいえ");
  view.rerender(
    <ObservabilityLabProperties
      world={run(before, ...ObserveSolutions.notification.slice(-2)).world}
      selection={s}
    />,
  );
  expect(screen.getByText("検証済み").nextElementSibling).toHaveTextContent("はい");
  expect(
    Engine.completionCandidates(before.world, "gcloud monitoring channels describe on"),
  ).toContain("oncall");
});
test("SLO shows zero-data versus consumed error budget", () => {
  const before = run(session(), ...ObservePrelude, ...ObserveSolutions.slo.slice(0, 2));
  const s = selection("objectives", "availability");
  const view = render(<ObservabilityLabProperties world={before.world} selection={s} />);
  expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
  expect(screen.getByText("SLI").nextElementSibling).toHaveTextContent("データなし");
  view.rerender(
    <ObservabilityLabProperties
      world={run(before, ...ObserveSolutions.slo.slice(2)).world}
      selection={s}
    />,
  );
  expect(screen.getByText("OUT_OF_SLO")).toBeInTheDocument();
  expect(screen.getByText("SLI").nextElementSibling).toHaveTextContent("0.98");
  expect(screen.getByText("バーンレート").nextElementSibling).toHaveTextContent("1.999");
});
test("every new collection is represented in the tree with a scoped, executable describe command", () => {
  for (const lesson of [
    "notification",
    "scope",
    "slo",
    "agent",
    "prometheus",
    "routing",
    "audit",
  ] as const) {
    const s = run(session(), ...ObservePrelude, ...ObserveSolutions[lesson]);
    const tree = JSON.stringify(TreeNode.fromWorld(s.world));
    for (const item of observeResources(s.world, "ace-dev-01")) {
      const chosen = {
        kind: "observability-lab",
        projectId: "ace-dev-01",
        collection: item.collection,
        name: item.name,
      } as const;
      expect(tree).toContain(TreeSelection.key(chosen));
      const command = TreeSelection.describeCommand(chosen);
      expect(command.some).toBe(true);
      if (command.some) {
        expect(run(s, command.value).text, command.value).not.toContain("ERROR:");
      }
    }
  }
});
test("bucket retention and collector readiness are derived from current state", () => {
  const s = run(session(), ...ObservePrelude, ...ObserveSolutions.routing);
  render(
    <ObservabilityLabProperties
      world={s.world}
      selection={selection("buckets", "us-central1/archive")}
    />,
  );
  expect(screen.getByText("保持日数").nextElementSibling).toHaveTextContent("7");
  expect(screen.getByText("保持中のログ").nextElementSibling).toHaveTextContent("1");
});
