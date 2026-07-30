// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const citationFrameScript = readFileSync(
  resolve(process.cwd(), "../src/content/quizCitationFrame.js"),
  "utf8",
);

describe("NetSuite quiz citation frame", () => {
  it("keeps the live nshelp element, hides surrounding page chrome, and highlights across nested nodes", async () => {
    document.head.innerHTML =
      '<style id="netsuite-styles">#nshelp strong { color: navy; }</style>';
    document.body.innerHTML = `
      <header id="page-header">NetSuite header</header>
      <div id="helpcenter_body">
        <div id="helpcenter_content">
          <main id="page-layout">
            <nav id="help-nav">Help navigation</nav>
            <section id="article-shell">
              <article id="nshelp">
                <h1>Map/Reduce</h1>
                <p>Map/Reduce scripts <strong>yield automatically</strong> when required.</p>
                <a id="related-link" href="/app/help/helpcenter.nl?fid=related.html">Related topic</a>
                <nav class="nshelp_navheader">Article navigation</nav>
                <section class="nshelp_relatedtopics">Related topics</section>
                <footer id="nshelp_footer">Documentation footer</footer>
                <form id="helpcenter_feedback">Feedback</form>
              </article>
              <aside id="related">Related articles</aside>
            </section>
          </main>
        </div>
      </div>
      <footer id="page-footer">NetSuite footer</footer>
    `;
    window.location.hash =
      "#magic-netsuite-quiz=Map%2FReduce%20scripts%20yield%20automatically";
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => undefined);
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    window.eval(citationFrameScript);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(document.getElementById("nshelp")).not.toBeNull();
    expect(document.getElementById("netsuite-styles")).not.toBeNull();
    expect(document.getElementById("page-header")?.style.display).toBe("none");
    expect(document.getElementById("help-nav")?.style.display).toBe("none");
    expect(document.getElementById("related")?.style.display).toBe("none");
    const injectedStyles = document.getElementById(
      "magic-netsuite-quiz-citation-style",
    )?.textContent;
    expect(injectedStyles).toContain("#helpcenter_content");
    expect(injectedStyles).toContain("height: 100% !important");
    expect(injectedStyles).toContain("color: inherit !important");
    expect(injectedStyles).toContain("cursor: text !important");
    expect(document.querySelector(".nshelp_navheader")).toBeNull();
    expect(document.querySelector(".nshelp_relatedtopics")).toBeNull();
    expect(document.getElementById("nshelp_footer")).toBeNull();
    expect(document.getElementById("helpcenter_feedback")).toBeNull();
    const relatedLink = document.getElementById(
      "related-link",
    ) as HTMLAnchorElement;
    expect(relatedLink.getAttribute("href")).toBe(
      "/app/help/helpcenter.nl?fid=related.html",
    );
    expect(relatedLink.getAttribute("aria-disabled")).toBe("true");
    expect(relatedLink.tabIndex).toBe(-1);
    const linkClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    expect(relatedLink.dispatchEvent(linkClick)).toBe(false);
    expect(linkClick.defaultPrevented).toBe(true);
    expect(
      document.querySelector("mark[data-magic-netsuite-citation]")?.textContent,
    ).toBe("Map/Reduce scripts yield automatically");
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "magic-netsuite-quiz-citation",
        status: "ready",
      }),
      "*",
    );
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "center", inline: "nearest" }),
    );

    postMessage.mockRestore();
    window.location.hash = "";
  });

  it("finds legacy citations after removing inline Markdown decoration", async () => {
    document.head.innerHTML = "";
    document.body.innerHTML = `
      <div id="helpcenter_body">
        <div id="helpcenter_content">
          <article id="nshelp">
            <p>Unsupported features include embedded null values in CHAR fields, DEFAULT clauses, and subqueries in SELECT lists.</p>
          </article>
        </div>
      </div>
    `;
    window.location.hash =
      "#magic-netsuite-quiz=embedded%20null%20values%20in%20%60CHAR%60%20fields%2C%20%60DEFAULT%60%20clauses%2C%20and%20subqueries%20in%20%60SELECT%60%20lists.";
    const postMessage = vi
      .spyOn(window, "postMessage")
      .mockImplementation(() => undefined);
    HTMLElement.prototype.scrollIntoView = vi.fn();

    window.eval(citationFrameScript);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(
      document.querySelector("mark[data-magic-netsuite-citation]")?.textContent,
    ).toBe(
      "embedded null values in CHAR fields, DEFAULT clauses, and subqueries in SELECT lists.",
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ready" }),
      "*",
    );

    postMessage.mockRestore();
    window.location.hash = "";
  });
});
