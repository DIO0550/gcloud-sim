import type { TreeLabel, TreeNode } from "@/engine/resource-tree";

export const labelKey = (label: TreeLabel): string =>
  label.kind === "text" ? label.text : `group:${label.group}`;
export const labels = (nodes: readonly TreeNode[]): readonly string[] =>
  nodes.map((node) => labelKey(node.label));
export const find = (nodes: readonly TreeNode[], key: string): TreeNode | undefined => {
  for (const node of nodes) {
    if (labelKey(node.label) === key) {
      return node;
    }
    const child = find(node.children, key);
    if (child !== undefined) {
      return child;
    }
  }
  return undefined;
};
