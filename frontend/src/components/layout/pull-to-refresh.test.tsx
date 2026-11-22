import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PullToRefresh } from "@/components/layout/pull-to-refresh";

const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });

function pull(fromY: number, toY: number, toX = 10) {
  fireEvent.touchStart(window, touch(10, fromY));
  fireEvent.touchMove(window, touch(toX, toY));
  fireEvent.touchEnd(window, { touches: [] });
}

describe("PullToRefresh", () => {
  afterEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    document.body.removeAttribute("data-scroll-locked");
  });

  it("refreshes after a long enough pull at the top of the page", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<PullToRefresh onRefresh={onRefresh}>content</PullToRefresh>);

    await act(async () => pull(100, 300)); // 200px * 0.5 resistance = 100px ≥ threshold
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("ignores short pulls, upward swipes and horizontal swipes", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<PullToRefresh onRefresh={onRefresh}>content</PullToRefresh>);

    await act(async () => pull(100, 160)); // 30px after resistance: too short
    await act(async () => pull(300, 100)); // upward
    await act(async () => pull(100, 250, 400)); // mostly horizontal
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does nothing when the page is scrolled down or a dialog is open", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<PullToRefresh onRefresh={onRefresh}>content</PullToRefresh>);

    Object.defineProperty(window, "scrollY", { value: 50, configurable: true });
    await act(async () => pull(100, 400));
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });

    document.body.setAttribute("data-scroll-locked", "1");
    await act(async () => pull(100, 400));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("shows feedback while pulling", () => {
    render(<PullToRefresh onRefresh={vi.fn().mockResolvedValue(undefined)}>content</PullToRefresh>);
    fireEvent.touchStart(window, touch(10, 100));
    fireEvent.touchMove(window, touch(10, 300));
    expect(screen.getByTestId("pull-indicator")).toHaveTextContent("Release to refresh");
  });
});
