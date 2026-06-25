import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel.js";
import { mergedReferenceStorageIds } from "./referenceStorageIds.js";

describe("mergedReferenceStorageIds", () => {
  const a = "kg1" as Id<"_storage">;
  const b = "kg2" as Id<"_storage">;

  it("uses the array when that is the only source", () => {
    expect(mergedReferenceStorageIds({ referenceStorageIds: [a, b] })).toEqual([a, b]);
  });

  it("returns empty array when the array is absent", () => {
    expect(mergedReferenceStorageIds({})).toEqual([]);
  });
});
