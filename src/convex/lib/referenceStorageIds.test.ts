import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel.js";
import { mergedReferenceStorageIds } from "./referenceStorageIds.js";

describe("mergedReferenceStorageIds", () => {
  const a = "kg1" as Id<"_storage">;
  const b = "kg2" as Id<"_storage">;

  it("uses the array when that is the only source", () => {
    expect(mergedReferenceStorageIds({ referenceStorageIds: [a, b] })).toEqual([a, b]);
  });

  it("uses legacy singular when the array is absent", () => {
    expect(mergedReferenceStorageIds({ referenceStorageId: a })).toEqual([a]);
  });

  it("does not duplicate when the legacy id is already listed", () => {
    expect(mergedReferenceStorageIds({ referenceStorageIds: [a], referenceStorageId: a })).toEqual([a]);
  });

  it("appends the legacy id when it is not in the array", () => {
    expect(mergedReferenceStorageIds({ referenceStorageIds: [a], referenceStorageId: b })).toEqual([a, b]);
  });
});
