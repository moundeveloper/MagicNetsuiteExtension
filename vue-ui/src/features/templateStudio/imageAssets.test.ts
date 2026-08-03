// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  fitTemplateImageDimensions,
  sanitizeTemplateSvg,
  svgSourceToTemplateImageAsset,
  templateImagePreviewUrl,
} from "./imageAssets";

describe("Template Studio image assets", () => {
  it("renders logical SVG sizes at print density without changing aspect ratio", () => {
    expect(fitTemplateImageDimensions(595, 842, 4)).toEqual({
      width: 2380,
      height: 3368,
    });

    const wide = fitTemplateImageDimensions(12000, 2000);
    expect(wide.width).toBe(8192);
    expect(wide.height).toBeCloseTo(1365, 0);
    expect(wide.width / wide.height).toBeCloseTo(6, 2);
  });

  it("keeps uploaded SVG as editable source instead of rasterizing it", () => {
    const asset = svgSourceToTemplateImageAsset(
      "logo.svg",
      '<svg viewBox="0 0 120 40"><rect width="120" height="40"/></svg>',
      { source: "upload" },
    );

    expect(asset.kind).toBe("svg");
    expect(asset.dataUrl).toBeUndefined();
    expect(asset.svgSource).toContain("<rect");
    expect(templateImagePreviewUrl(asset)).toMatch(
      /^data:image\/svg\+xml;charset=utf-8,/,
    );
  });

  it("removes executable and external SVG content", () => {
    const sanitized = sanitizeTemplateSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
        <style>@import url("https://example.com/font.css"); .x { fill: red; }</style>
        <script>alert(1)</script>
        <image href="https://example.com/tracker.png" onload="alert(2)" />
        <rect class="x" width="20" height="20" />
      </svg>
    `);

    expect(sanitized.source).not.toContain("<script");
    expect(sanitized.source).not.toContain("onload");
    expect(sanitized.source).not.toContain("https://");
    expect(sanitized.source).toContain("<rect");
  });

  it("rejects raster payloads embedded inside SVG", () => {
    expect(() =>
      sanitizeTemplateSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/></svg>',
      ),
    ).toThrow(/cannot contain embedded base64/i);
  });
});
