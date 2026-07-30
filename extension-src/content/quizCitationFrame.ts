(() => {
  const HASH_PREFIX = "#magic-netsuite-quiz=";
  if (!window.location.hash.startsWith(HASH_PREFIX)) return;

  const report = (status: string, detail = "") => {
    window.parent.postMessage(
      {
        source: "magic-netsuite-quiz-citation",
        status,
        detail
      },
      "*"
    );
  };

  const stripInlineMarkdown = (value) =>
    String(value || "")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/(`+)([\s\S]*?)\1/g, "$2")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,;:!?])/g, "$1$2")
      .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, "$1$2")
      .trim()
      .replace(/^"([\s\S]*)"$/, "$1")
      .replace(/^“([\s\S]*)”$/, "$1")
      .replace(/^'([\s\S]*)'$/, "$1")
      .replace(/^‘([\s\S]*)’$/, "$1");

  const normalizeWithPositions = (root: Element) => {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (
            !parent ||
            ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return node.nodeValue?.trim()
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        }
      }
    );
    const positions: Array<{ node: Text; offset: number }> = [];
    let normalized = "";
    let previousWasWhitespace = true;
    let node: Text | null;

    while ((node = walker.nextNode() as Text | null)) {
      const value = node.nodeValue || "";
      for (let offset = 0; offset < value.length; offset += 1) {
        const character = value[offset];
        if (/\s/.test(character)) {
          if (!previousWasWhitespace && normalized) {
            normalized += " ";
            positions.push({ node, offset });
          }
          previousWasWhitespace = true;
        } else {
          normalized += character;
          positions.push({ node, offset });
          previousWasWhitespace = false;
        }
      }
    }

    if (normalized.endsWith(" ")) {
      normalized = normalized.slice(0, -1);
      positions.pop();
    }
    return { normalized, positions };
  };

  const isolateHelpContent = (helpRoot: HTMLElement) => {
    let current: HTMLElement = helpRoot;
    let parent = current.parentElement;

    while (parent) {
      [...parent.children].forEach((child) => {
        if (child !== current) {
          (child as HTMLElement).style.setProperty("display", "none", "important");
        }
      });
      if (parent === document.body) break;
      parent.style.setProperty("min-width", "0", "important");
      parent.style.setProperty("max-width", "100%", "important");
      parent.style.setProperty("width", "100%", "important");
      parent.style.setProperty("margin", "0", "important");
      parent.style.setProperty("padding", "0", "important");
      parent.style.setProperty("border", "0", "important");
      parent.style.setProperty("background", "transparent", "important");
      current = parent;
      parent = parent.parentElement;
    }

    const style = document.createElement("style");
    style.id = "magic-netsuite-quiz-citation-style";
    style.textContent = `
      html, body {
        min-width: 0 !important;
        max-width: 100% !important;
      }
      #helpcenter_content,
      #helpcenter_body {
        height: 100% !important;
      }
      #nshelp a {
        pointer-events: none !important;
        color: inherit !important;
        cursor: text !important;
      }
      #nshelp .nshelp_relatedtopics,
      #nshelp .nshelp_navheader,
      #nshelp #nshelp_footer,
      #nshelp #helpcenter_feedback,
      .nshelp_relatedtopics,
      .nshelp_navheader,
      #nshelp_footer,
      #helpcenter_feedback {
        display: none !important;
      }
      ::highlight(magic-netsuite-citation) {
        color: #7c2d12;
        background: #fde68a;
        text-decoration: underline;
        text-decoration-color: #f59e0b;
        text-decoration-thickness: 2px;
      }
      mark[data-magic-netsuite-citation] {
        color: #7c2d12 !important;
        background: #fde68a !important;
        outline: 2px solid #f59e0b !important;
        scroll-margin-block: 48px;
      }
    `;
    document.head.appendChild(style);
  };

  const disableHelpLinks = (helpRoot: HTMLElement) => {
    helpRoot.querySelectorAll("a").forEach((link) => {
      link.setAttribute("aria-disabled", "true");
      link.setAttribute("tabindex", "-1");
    });

    const preventNavigation = (event: Event) => {
      const target =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (!target || !helpRoot.contains(target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener("click", preventNavigation, true);
    document.addEventListener("auxclick", preventNavigation, true);
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") preventNavigation(event);
      },
      true
    );
  };

  const removeHelpExtras = () => {
    document
      .querySelectorAll(
        ".nshelp_relatedtopics, .nshelp_navheader, #nshelp_footer, #helpcenter_feedback"
      )
      .forEach((element) => element.remove());
  };

  const highlightQuote = (helpRoot: HTMLElement, quote: string) => {
    const target = stripInlineMarkdown(quote).trim().replace(/\s+/g, " ");
    if (!target) return null;
    const { normalized, positions } = normalizeWithPositions(helpRoot);
    const startIndex = normalized.toLocaleLowerCase().indexOf(
      target.toLocaleLowerCase()
    );
    if (startIndex < 0) return null;

    const start = positions[startIndex];
    const end = positions[startIndex + target.length - 1];
    if (!start || !end) return null;

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);

    if (globalThis.CSS?.highlights && typeof globalThis.Highlight === "function") {
      (CSS.highlights as any).set("magic-netsuite-citation", new Highlight(range));
      return {
        range,
        target: start.node.parentElement || helpRoot
      };
    }

    const mark = document.createElement("mark");
    mark.dataset.magicNetsuiteCitation = "true";
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
    return { range: null, target: mark };
  };

  const scrollHighlightIntoView = ({
    range,
    target
  }: {
    range: Range | null;
    target: Element;
  }) => {
    target.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "instant"
    });

    if (!range) return;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    window.scrollBy({
      top: rect.top - window.innerHeight * 0.35,
      behavior: "instant"
    });
  };

  try {
    const quote = decodeURIComponent(
      window.location.hash.slice(HASH_PREFIX.length)
    );
    const helpRoot = document.getElementById("nshelp");
    if (!helpRoot) {
      report("error", "The NetSuite page did not contain documentation.");
      return;
    }

    isolateHelpContent(helpRoot);
    removeHelpExtras();
    disableHelpLinks(helpRoot);
    const highlighted = highlightQuote(helpRoot, quote);
    if (!highlighted) {
      report("error", "The cited quote was not found inside the documentation.");
      return;
    }

    const settleOnHighlight = () => scrollHighlightIntoView(highlighted);
    requestAnimationFrame(() => {
      settleOnHighlight();
      report("ready");
      window.setTimeout(settleOnHighlight, 150);
      window.setTimeout(settleOnHighlight, 700);
    });
  } catch (error) {
    report(
      "error",
      error instanceof Error
        ? error.message
        : "The citation reader could not prepare this page."
    );
  }
})();
