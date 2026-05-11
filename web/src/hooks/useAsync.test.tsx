import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAsync } from "./useAsync.ts";

describe("useAsync", () => {
  it("starts in loading state", () => {
    const { result } = renderHook(() => useAsync(() => new Promise(() => {}), []));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("resolves to data", async () => {
    const { result } = renderHook(() => useAsync(async () => 42, []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe(42);
    expect(result.current.error).toBeNull();
  });

  it("captures rejection as error", async () => {
    const { result } = renderHook(() =>
      useAsync(async () => {
        throw new Error("boom");
      }, [])
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("boom");
  });

  it("aborts the signal when deps change", async () => {
    const signals: AbortSignal[] = [];
    const producer = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<number>(() => {});
    });

    const { rerender } = renderHook(({ dep }: { dep: number }) => useAsync(producer, [dep]), {
      initialProps: { dep: 1 },
    });

    expect(signals[0]!.aborted).toBe(false);
    rerender({ dep: 2 });
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it("aborts on unmount", () => {
    let capturedSignal: AbortSignal | undefined;
    const { unmount } = renderHook(() =>
      useAsync((signal) => {
        capturedSignal = signal;
        return new Promise<number>(() => {});
      }, [])
    );
    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("ignores AbortError rejections", async () => {
    const { result } = renderHook(() =>
      useAsync(async (signal) => {
        await new Promise((r) => setTimeout(r, 0));
        if (signal.aborted) throw new DOMException("aborted", "AbortError");
        return 1;
      }, [])
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it("reload re-runs the producer", async () => {
    let count = 0;
    const { result } = renderHook(() => useAsync(async () => ++count, []));
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.data).toBe(2));
  });
});
