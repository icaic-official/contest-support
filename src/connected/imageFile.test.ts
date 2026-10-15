import { describe, expect, it } from "vitest";
import {
  MIB,
  classifyAttachmentError,
  imageKind,
  imageRejection,
} from "./imageFile";

describe("image files", () => {
  it("recognizes JPEG, PNG, and WebP signatures", () => {
    expect(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe("image/jpeg");
    expect(imageKind(new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))).toBe("image/png");
    expect(imageKind(new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]))).toBe("image/webp");
    expect(imageKind(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeUndefined();
  });

  it("explains the configured size, count, and total limits", () => {
    const limits = { maxImageBytes: 10 * MIB, maxImages: 12, maxTotalBytes: 120 * MIB };
    expect(imageRejection(100, undefined, limits, { count: 0, totalBytes: 0 }))
      .toBe("Choose a JPEG, PNG, or WebP image.");
    expect(imageRejection(11 * MIB, "image/jpeg", limits, { count: 0, totalBytes: 0 }))
      .toBe("This image is larger than 10 MB.");
    expect(imageRejection(100, "image/png", limits, { count: 12, totalBytes: 0 }))
      .toBe("This issue already has 12 images.");
    expect(imageRejection(MIB, "image/webp", limits, { count: 1, totalBytes: 120 * MIB }))
      .toBe("These images would exceed this issue's 120 MB limit.");
    expect(imageRejection(MIB, "image/jpeg", limits, { count: 1, totalBytes: 0 })).toBeUndefined();
  });

  it("separates validation failures from uploads that can be tried again", () => {
    expect(classifyAttachmentError("Choose a JPEG, PNG, or WebP image.").validation).toBe(true);
    expect(classifyAttachmentError("This event is archived. Images cannot be added.").restart)
      .toBe(false);
    expect(classifyAttachmentError("Upload failed. Check your connection and try again.").restart)
      .toBe(true);
    expect(classifyAttachmentError("Upload the image before finishing.").validation).toBe(false);
  });
});
