import { describe, expect, it } from "vitest";
import { createRefreshQueue } from "./refreshQueue";

/** A read that finishes when the test says so. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe("refresh queue", () => {
  it("runs reads one at a time, in order", async () => {
    const queue = createRefreshQueue();
    const log: string[] = [];
    const first = gate();
    const a = queue.read(1, async () => {
      log.push("a start");
      await first.opened;
      log.push("a end");
    });
    await Promise.resolve();
    const b = queue.read(1, async () => {
      log.push("b start");
    });
    expect(log).toEqual(["a start"]);
    first.open();
    await Promise.all([a, b]);
    expect(log).toEqual(["a start", "a end", "b start"]);
  });

  it("shares a read that has not started, so a burst costs two reads", async () => {
    const queue = createRefreshQueue();
    let reads = 0;
    const running = gate();
    const read = async () => {
      reads++;
      await running.opened;
    };
    const first = queue.read(1, read);
    await Promise.resolve();
    // Five hints arrive while the first read runs.
    const burst = [1, 2, 3, 4, 5].map(() => queue.read(1, read));
    expect(new Set(burst).size).toBe(1);
    running.open();
    await Promise.all([first, ...burst]);
    expect(reads).toBe(2);
  });

  it("does not share a read that already started", async () => {
    const queue = createRefreshQueue();
    let reads = 0;
    const read = async () => {
      reads++;
    };
    await queue.read(1, read);
    await queue.read(1, read);
    expect(reads).toBe(2);
  });

  it("does not share a read across scopes", async () => {
    const queue = createRefreshQueue();
    const first = gate();
    const reads: number[] = [];
    const blocker = queue.read(1, () => first.opened);
    await Promise.resolve();
    const old = queue.read(1, async () => void reads.push(1));
    const next = queue.read(2, async () => void reads.push(2));
    expect(next).not.toBe(old);
    first.open();
    await Promise.all([blocker, old, next]);
    expect(reads).toEqual([1, 2]);
  });

  it("runs queued work after the reads that came before it", async () => {
    const queue = createRefreshQueue();
    const log: string[] = [];
    const first = gate();
    void queue.read(1, async () => {
      await first.opened;
      log.push("read");
    });
    const applied = queue.after(() => log.push("apply"));
    first.open();
    await applied;
    expect(log).toEqual(["read", "apply"]);
  });

  it("keeps running after work throws", async () => {
    const queue = createRefreshQueue();
    await expect(
      queue.after(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    let ran = false;
    await queue.read(1, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("keeps running later reads after one read rejects", async () => {
    const queue = createRefreshQueue();
    await expect(
      queue.read(1, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    let ran = false;
    await queue.read(1, async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
