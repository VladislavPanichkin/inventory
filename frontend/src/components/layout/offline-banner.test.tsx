import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "@/components/layout/offline-banner";

function setOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

describe("OfflineBanner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is hidden while online and appears/disappears with connectivity", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineBanner />);
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();

    act(() => setOnline(false));
    expect(screen.getByRole("status")).toHaveTextContent("You're offline");

    act(() => setOnline(true));
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
  });
});
