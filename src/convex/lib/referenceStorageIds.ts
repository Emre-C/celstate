import type { Doc, Id } from "../_generated/dataModel.js";

export function mergedReferenceStorageIds(
  generation: Pick<Doc<"generations">, "referenceStorageIds">,
): Id<"_storage">[] {
  return generation.referenceStorageIds ?? [];
}
