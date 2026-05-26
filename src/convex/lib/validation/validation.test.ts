import { describe, expect, it } from "vitest";
import { validateReferenceImageMetadata } from "./validation.js";

describe("validateReferenceImageMetadata", () => {
  it("accepts supported reference image metadata within the size limit", () => {
    expect(
      validateReferenceImageMetadata({
        contentType: "image/png",
        size: 1024,
      }),
    ).toEqual({ valid: true });
  });

  it("rejects missing metadata", () => {
    expect(validateReferenceImageMetadata(null)).toEqual({
      valid: false,
      reason: "Reference image not found",
    });
  });

  it("rejects unsupported content types", () => {
    expect(
      validateReferenceImageMetadata({
        contentType: "application/pdf",
        size: 1024,
      }),
    ).toEqual({
      valid: false,
      reason: "Unsupported reference image type: application/pdf",
    });
  });

  it("rejects invalid sizes", () => {
    expect(
      validateReferenceImageMetadata({
        contentType: "image/jpeg",
        size: 0,
      }),
    ).toEqual({
      valid: false,
      reason: "Reference image size is invalid",
    });
  });

  it("rejects oversized reference images", () => {
    expect(
      validateReferenceImageMetadata({
        contentType: "image/webp",
        size: 8 * 1024 * 1024,
      }),
    ).toEqual({
      valid: false,
      reason: "Reference image exceeds 7 MB limit",
    });
  });
});
