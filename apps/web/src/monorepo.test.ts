import type { SpansPayload } from "@auralia/shared";
import { describe, expect, it } from "vitest";

describe("monorepo wiring", () => {
  it("resolves @auralia/shared types from the workspace", () => {
    const doc: SpansPayload = {
      source_id: "s",
      chapter_id: "c",
      text: "hello",
      spans: [],
    };
    expect(doc.text).toBe("hello");
  });
});
