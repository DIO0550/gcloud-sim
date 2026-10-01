import { render, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";

import { fakeTerminal } from "@/features/simulator/__tests__/setup";
import { Terminal } from "@/features/simulator/components/Terminal";
import { Option } from "@/utils/Option";

test("挿入を取り込んだら onInsertConsumed を呼び、入力行に文字列が入る", async () => {
  const terminal = fakeTerminal();
  let consumed = 0;
  render(
    <Terminal
      transcript={[]}
      screenClearCount={0}
      pendingInsert={Option.some("gcloud projects list")}
      onInsertConsumed={() => {
        consumed += 1;
      }}
      onSubmit={() => {}}
      completionCandidates={() => []}
      createView={async () => terminal.view}
      caption="configuration: default"
    />,
  );
  await waitFor(() => expect(consumed).toBe(1));
  expect(terminal.written.at(-1)).toContain("gcloud projects list");
});
