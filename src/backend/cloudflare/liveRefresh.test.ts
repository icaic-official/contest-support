import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISCONNECTED_REFRESH_MS,
  startRefreshSchedule,
} from "../../connected/hooks/refreshSchedule";
import { createCloudflareBackend } from "./backend";

afterEach(() => vi.useRealTimers());

describe("refresh with the Cloudflare live channel", () => {
  class Socket {
    onmessage: WebSocket["onmessage"] = null;
    onclose: WebSocket["onclose"] = null;
    onerror: WebSocket["onerror"] = null;
    close = vi.fn();
    message(type: string) {
      this.onmessage?.call(
        this as unknown as WebSocket,
        new MessageEvent("message", { data: JSON.stringify({ type }) }),
      );
    }
    drop() {
      this.onclose?.call(this as unknown as WebSocket, new Event("close") as CloseEvent);
    }
  }

  /** Wires the channel to a refresh counter as useSessionSnapshot does. */
  function wire() {
    const sockets: Socket[] = [];
    const refresh = vi.fn();
    const window = new EventTarget();
    const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    let connected = false;
    let stopSchedule = startRefreshSchedule({ refresh, connected, window, document });
    const backend = createCloudflareBackend({
      origin: 'https://connector.example',
      webSocket: () => {
        sockets.push(new Socket());
        return sockets.at(-1) as unknown as WebSocket;
      },
    });
    const stopUpdates = backend.updates.subscribe({
      sessionId: "49c15a39-79ec-4597-bad6-2b949cfe32b2",
      userId: "10e98b04-539e-4058-b8c5-c903a28b7005",
      onChange: refresh,
      onConnection: (value) => {
        connected = value;
        stopSchedule();
        stopSchedule = startRefreshSchedule({ refresh, connected, window, document });
        refresh();
      },
    });
    return {
      // The newest socket is the one the client currently uses.
      get socket() { return sockets.at(-1)!; },
      refresh,
      stop: () => { stopSchedule(); stopUpdates(); },
    };
  }

  it("refreshes once a minute when connected, follows a live hint, and refreshes when the channel drops", () => {
    vi.useFakeTimers();
    const live = wire();
    const { refresh, stop } = live;
    live.socket.message("ready");
    expect(refresh).toHaveBeenCalledTimes(1);

    refresh.mockClear();
    vi.advanceTimersByTime(59_000);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    refresh.mockClear();
    live.socket.message("change");
    expect(refresh).toHaveBeenCalledTimes(1);

    refresh.mockClear();
    live.socket.drop();
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DISCONNECTED_REFRESH_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });
});
