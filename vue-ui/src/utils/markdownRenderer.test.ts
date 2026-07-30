import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  renderMarkdownTextWith,
  sanitizeRenderedHtmlWith
} from "./markdownRenderer";

const window = new JSDOM("<!doctype html><html><body></body></html>").window;
const purifier = createDOMPurify(
  window as unknown as Parameters<typeof createDOMPurify>[0]
);

describe("markdown rendering security", () => {
  it("removes executable markup and event handlers", () => {
    const rendered = renderMarkdownTextWith(
      purifier,
      '# Hello <img src=x onerror="alert(1)"><script>alert(2)</script>'
    );

    expect(rendered).toContain("<h1>Hello");
    expect(rendered).not.toContain("<img");
    expect(rendered).not.toContain("<script");
    expect(rendered).not.toContain("onerror");
  });

  it("removes unsafe link schemes while preserving HTTPS links", () => {
    const unsafe = renderMarkdownTextWith(
      purifier,
      "[open](javascript:alert(1))"
    );
    const safe = renderMarkdownTextWith(
      purifier,
      "[docs](https://docs.oracle.com/)"
    );

    expect(unsafe).not.toContain('href="javascript:');
    expect(safe).toContain('href="https://docs.oracle.com/"');
    expect(safe).toContain('rel="noopener noreferrer"');
  });

  it("keeps renderer classes but strips style, id, and name attributes", () => {
    const rendered = sanitizeRenderedHtmlWith(
      purifier,
      '<div class="callout callout-tip" style="background:red" id="x" name="x">Tip</div>'
    );

    expect(rendered).toContain('class="callout callout-tip"');
    expect(rendered).not.toContain("style=");
    expect(rendered).not.toContain("id=");
    expect(rendered).not.toContain("name=");
  });
});
