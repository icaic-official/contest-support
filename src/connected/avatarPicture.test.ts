import { describe, expect, it } from "vitest";
import { ImageRequestError } from "@/backend/errors";
import {
  type AvatarDraft,
  centeredSquare,
  encodeAttempts,
  firstFit,
  uploadFailed,
} from "./avatarPicture";

describe("centeredSquare", () => {
  it("takes the middle of a landscape image", () => {
    expect(centeredSquare(400, 200)).toEqual({ x: 100, y: 0, size: 200 });
  });

  it("takes the middle of a portrait image", () => {
    expect(centeredSquare(3024, 4032)).toEqual({ x: 0, y: 504, size: 3024 });
  });

  it("keeps a square image whole", () => {
    expect(centeredSquare(80, 80)).toEqual({ x: 0, y: 0, size: 80 });
  });
});

describe("encodeAttempts", () => {
  it("steps quality down before it steps the size down", () => {
    const attempts = encodeAttempts(2000);
    expect(attempts.slice(0, 4).map((attempt) => attempt.side)).toEqual([512, 512, 512, 512]);
    const qualities = attempts.slice(0, 4).map((attempt) => attempt.quality);
    expect([...qualities].sort((a, b) => b - a)).toEqual(qualities);
    expect(attempts.map((attempt) => attempt.side)).toContain(256);
    expect(Math.max(...attempts.map((attempt) => attempt.side))).toBe(512);
  });

  it("never enlarges a small picture", () => {
    const attempts = encodeAttempts(200);
    expect(new Set(attempts.map((attempt) => attempt.side))).toEqual(new Set([200]));
  });
});

describe("firstFit", () => {
  const attempts = encodeAttempts(1000);

  it("returns the first encoding that fits and stops", async () => {
    const tried: number[] = [];
    const blob = await firstFit(
      attempts,
      async ({ side, quality }) => {
        tried.push(quality);
        return new Blob([new Uint8Array(Math.round(side * quality * 300))]);
      },
      100_000,
    );
    expect(blob?.size).toBeLessThanOrEqual(100_000);
    expect(tried.length).toBeGreaterThan(1);
    expect(tried.length).toBeLessThan(attempts.length);
  });

  it("returns the sharpest encoding when it already fits", async () => {
    let calls = 0;
    await firstFit(attempts, async () => (calls++, new Blob([new Uint8Array(10)])), 100);
    expect(calls).toBe(1);
  });

  it("skips an attempt that produced nothing", async () => {
    let calls = 0;
    const blob = await firstFit(
      attempts,
      async () => (++calls === 1 ? null : new Blob([new Uint8Array(10)])),
      100,
    );
    expect(blob?.size).toBe(10);
    expect(calls).toBe(2);
  });

  it("gives up when nothing fits", async () => {
    const blob = await firstFit(attempts, async () => new Blob([new Uint8Array(500)]), 100);
    expect(blob).toBeUndefined();
  });
});

describe("uploadFailed", () => {
  const draft: AvatarDraft = { blob: new Blob(["x"]), requestId: "request-1" };

  it("ends the attempt when the server rejected the picture", () => {
    const result = uploadFailed(
      new ImageRequestError("Choose a JPEG, PNG, or WebP picture.", { validation: true }),
      draft,
    );
    expect(result).toEqual({ phase: "idle", error: "Choose a JPEG, PNG, or WebP picture." });
  });

  it("ends the attempt when the upload expired", () => {
    const result = uploadFailed(
      new ImageRequestError("The picture upload expired. Select the picture again.", {
        restart: true,
      }),
      draft,
    );
    expect(result.phase).toBe("idle");
  });

  it("keeps the draft and its request ID when the outcome is unknown", () => {
    const result = uploadFailed(new TypeError("Failed to fetch"), draft);
    expect(result.phase).toBe("preview");
    if (result.phase !== "preview") return;
    expect(result.draft).toBe(draft);
    expect(result.error).toContain("may not have saved");
  });

  it("keeps the draft when the provider failed without a flag", () => {
    const result = uploadFailed(new ImageRequestError("The picture request failed. Try again."), draft);
    expect(result).toEqual({
      phase: "preview",
      draft,
      error: "The picture request failed. Try again.",
    });
  });
});
