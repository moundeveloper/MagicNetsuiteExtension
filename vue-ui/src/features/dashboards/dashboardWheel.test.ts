// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import {
  installDashboardWheel,
  wheelIndex,
  wheelCenter,
  preferredWheelItems,
  type DashboardWheelItem,
} from "../../../../shared/dashboardWheel";
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});
const items: DashboardWheelItem[] = Array.from({ length: 10 }, (_, index) => ({
  id: String(index),
  title: `Dashboard ${index}`,
  mode: "server",
}));
const key = (
  type: string,
  value: string,
  options: Record<string, boolean> = {},
) =>
  window.dispatchEvent(
    new KeyboardEvent(type, {
      key: value,
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
      ...options,
    }),
  );
const move = (x: number, y: number) =>
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }),
  );
function fixture(count = 10) {
  const opened: DashboardWheelItem[] = [];
  dispose = installDashboardWheel({
    shortcut: () => "ctrl+alt+d",
    items: () => items.slice(0, count),
    open: (item) => opened.push(item),
  });
  move(500, 350);
  key("keydown", "d");
  return {
    opened,
    root: document.getElementById("magic-dashboard-wheel")!.shadowRoot!,
  };
}
describe("dashboard wheel", () => {
  it("centers the navigator independently of the last mouse position", () => {
    const { root } = fixture();
    const wheel = root.querySelector<HTMLElement>(".wheel")!;
    expect(
      parseFloat(wheel.style.left) + parseFloat(wheel.style.width) / 2,
    ).toBe(window.innerWidth / 2);
    expect(
      parseFloat(wheel.style.top) + parseFloat(wheel.style.height) / 2,
    ).toBe(window.innerHeight / 2);
  });
  it("uses current preferred views and ignores stale, internal and detail paths", () => {
    expect(
      preferredWheelItems([
        "/notes",
        "/notes",
        "/records",
        "/processing",
        "/",
        "/settings",
        "/missing",
        "/records/customer/1",
      ]).map((item) => item.path),
    ).toEqual(["/records", "/notes"]);
    expect(preferredWheelItems(null)).toEqual([]);
  });
  it("opens a preferred view with its route on release", () => {
    const opened: DashboardWheelItem[] = [];
    dispose = installDashboardWheel({
      shortcut: () => "ctrl+alt+d",
      items: () => preferredWheelItems(["/notes"]),
      open: (item) => opened.push(item),
    });
    key("keydown", "d");
    move(window.innerWidth / 2, window.innerHeight / 2 - 140);
    expect(opened).toEqual([]);
    key("keyup", "d");
    expect(opened).toMatchObject([
      { kind: "view", path: "/notes", title: "Notes" },
    ]);
  });
  it("maps every radial sector and cancels in the center or outside the wheel", () => {
    for (let count = 1; count <= 8; count++)
      for (let index = 0; index < count; index++) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
        expect(
          wheelIndex(
            Math.cos(angle) * 100,
            Math.sin(angle) * 100,
            count,
            60,
            170,
          ),
        ).toBe(index);
      }
    expect(wheelIndex(0, 0, 8, 60, 170)).toBe(-1);
    expect(wheelIndex(180, 0, 8, 60, 170)).toBe(-1);
    expect(wheelIndex(100, 0, 0, 60, 170)).toBe(-1);
    expect(wheelCenter(1000, 800)).toEqual({ x: 500, y: 400 });
    expect(wheelCenter(260, 180)).toEqual({ x: 130, y: 90 });
  });
  it("opens the hovered dashboard only on release, once", () => {
    const { opened, root } = fixture();
    expect(root.querySelectorAll("[role=option]")).toHaveLength(8);
    move(window.innerWidth / 2, window.innerHeight / 2 - 140);
    expect(
      root
        .querySelector("[aria-selected=true]")
        ?.getAttribute("data-dashboard-wheel-item"),
    ).toBe("0");
    expect(opened).toEqual([]);
    key("keyup", "d");
    key("keyup", "Alt");
    expect(opened.map((item) => item.id)).toEqual(["0"]);
    expect(document.getElementById("magic-dashboard-wheel")).toBeNull();
  });
  it("cancels with center release, Escape or loss of focus", () => {
    const { opened } = fixture();
    key("keyup", "d");
    key("keydown", "d");
    move(window.innerWidth / 2, window.innerHeight / 2 - 140);
    key("keydown", "Escape");
    key("keyup", "d");
    key("keydown", "d");
    move(window.innerWidth / 2, window.innerHeight / 2 - 140);
    window.dispatchEvent(new Event("blur"));
    key("keyup", "d");
    expect(opened).toEqual([]);
  });
  it("suppresses key repeat even after cancelling while still holding the trigger", () => {
    fixture();
    key("keydown", "Escape");
    const repeated = new KeyboardEvent("keydown", {
      key: "d",
      repeat: true,
      ctrlKey: true,
      altKey: true,
      cancelable: true,
    });
    window.dispatchEvent(repeated);
    expect(repeated.defaultPrevented).toBe(true);
    expect(document.getElementById("magic-dashboard-wheel")).toBeNull();
    key("keyup", "d");
  });
  it("pages through live dashboard data and supports arrows and mouse release", () => {
    const { opened, root } = fixture();
    window.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, cancelable: true }),
    );
    expect(root.querySelectorAll("[role=option]")).toHaveLength(2);
    key("keydown", "ArrowLeft");
    window.dispatchEvent(
      new MouseEvent("mouseup", { button: 0, cancelable: true }),
    );
    expect(opened.map((item) => item.id)).toEqual(["9"]);
  });
  it("does not execute when empty, and removes listeners when disposed", () => {
    const { opened } = fixture(0);
    key("keyup", "d");
    expect(opened).toEqual([]);
    dispose?.();
    dispose = undefined;
    key("keydown", "d");
    expect(document.getElementById("magic-dashboard-wheel")).toBeNull();
  });
});
