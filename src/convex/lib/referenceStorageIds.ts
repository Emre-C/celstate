import type { Doc, Id } from "../_generated/dataModel.js";

export function mergedReferenceStorageIds(
  generation: Pick<Doc<"generations">, "referenceStorageIds" | "referenceStorageId">,
): Id<"_storage">[] {
  const fromArray = generation.referenceStorageIds ?? [];
  const legacy = generation.referenceStorageId;
  if (legacy && !fromArray.some((id) => id === legacy)) {
    return [...fromArray, legacy];
  }
  return fromArray;
}
