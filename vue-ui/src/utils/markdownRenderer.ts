// ── Helpers ──────────────────────────────────────────────────────────────────

export const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// ── Collapsible sections  ??? Title … ??? ────────────────────────────────────

export const processCollapsibleSections = (text: string): string => {
  const lines = text.split("\n");
  const result: string[] = [];
  const stack: string[] = [];

  for (const line of lines) {
    // Opening: ??? followed by at least one non-whitespace char
    const openMatch = line.match(/^\?\?\?\s+(.+)$/);
    // Closing: exactly ??? on its own (no trailing text)
    const closeMatch = /^\?\?\?\s*$/.test(line) && !openMatch;

    if (openMatch) {
      const summary = openMatch[1]!.trim();
      stack.push("details");
      result.push(
        `<details class="collapsible"><summary>${escapeHtml(summary)}</summary><div class="collapsible-content">`
      );
    } else if (closeMatch && stack.length > 0) {
      result.push("</div></details>");
      stack.pop();
    } else {
      result.push(line);
    }
  }

  // Auto-close any unclosed sections
  while (stack.length > 0) {
    result.push("</div></details>");
    stack.pop();
  }

  return result.join("\n");
};

// ── Callout boxes  :::type Title … ::: ───────────────────────────────────────

export const processCalloutBoxes = (text: string): string => {
  const calloutMap: Record<
    string,
    { icon: string; color: string; bg: string }
  > = {
    tip: { icon: "💡", color: "var(--p-green-700)", bg: "var(--p-green-50)" },
    warning: {
      icon: "⚠️",
      color: "var(--p-amber-700)",
      bg: "var(--p-amber-50)"
    },
    error: { icon: "❌", color: "var(--p-red-700)", bg: "var(--p-red-50)" },
    info: { icon: "ℹ️", color: "var(--p-blue-700)", bg: "var(--p-blue-50)" },
    note: { icon: "📝", color: "var(--p-slate-700)", bg: "var(--p-slate-50)" }
  };
  const defaultCallout = {
    icon: "ℹ️",
    color: "var(--p-blue-700)",
    bg: "var(--p-blue-50)"
  };

  const lines = text.split("\n");
  const result: string[] = [];
  let inCallout = false;

  for (const line of lines) {
    // Opening: :::type optional title
    const openMatch = line.match(/^:::(\w+)\s*(.*)$/);
    // Closing: exactly ::: on its own
    const closeMatch = /^:::\s*$/.test(line);

    if (openMatch && !inCallout) {
      const type = openMatch[1]!.toLowerCase();
      const title = openMatch[2]?.trim() || "";
      const config = calloutMap[type] ?? defaultCallout;
      const titleHtml = title
        ? `<div class="callout-title">${escapeHtml(title)}</div>`
        : `<div class="callout-title">${type.charAt(0).toUpperCase() + type.slice(1)}</div>`;
      result.push(
        `<div class="callout" style="--callout-color: ${config.color}; --callout-bg: ${config.bg}"><div class="callout-icon">${config.icon}</div><div class="callout-content">${titleHtml}`
      );
      inCallout = true;
    } else if (closeMatch && inCallout) {
      result.push("</div></div>");
      inCallout = false;
    } else {
      result.push(line);
    }
  }

  // Auto-close unclosed callouts
  if (inCallout) {
    result.push("</div></div>");
  }

  return result.join("\n");
};

// ── Tables ───────────────────────────────────────────────────────────────────

export const processTables = (text: string): string => {
  const lines = text.split("\n");
  const result: string[] = [];
  let inTable = false;
  let headerDone = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const tableMatch = trimmed.match(/^\|(.+)\|$/);

    if (!tableMatch) {
      if (inTable) {
        result.push("</tbody></table>");
        inTable = false;
        headerDone = false;
      }
      result.push(line);
      continue;
    }

    // Skip separator rows like |---|---|
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
      continue;
    }

    const cells = tableMatch[1]!.split("|").map((c: string) => c.trim());

    if (!inTable) {
      inTable = true;
      headerDone = true;
      const headers = cells.map((c: string) => `<th>${escapeHtml(c)}</th>`).join("");
      result.push(
        `<table class="md-table"><thead><tr>${headers}</tr></thead><tbody>`
      );
    } else {
      const row = cells.map((c: string) => `<td>${escapeHtml(c)}</td>`).join("");
      result.push(`<tr>${row}</tr>`);
    }
  }

  if (inTable) {
    result.push("</tbody></table>");
  }

  return result.join("\n");
};

// ── Checkboxes ───────────────────────────────────────────────────────────────

export const processCheckboxes = (text: string): string => {
  return text.replace(/^- \[([ xX])\] (.+)$/gm, (_, checked, label) => {
    const isChecked = checked.toLowerCase() === "x";
    return `<label class="checkbox-wrapper"><input type="checkbox" ${isChecked ? "checked" : ""} disabled /><span class="checkbox-label">${label}</span></label>`;
  });
};

// ── Headings ─────────────────────────────────────────────────────────────────

export const processHeadings = (text: string): string => {
  let html = text;
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  return html;
};

// ── Lists (unordered + ordered with nesting) ─────────────────────────────────

export const processLists = (html: string): string => {
  const lines = html.split("\n");
  const result: string[] = [];

  type ListType = "ul" | "ol";
  const stack: { type: ListType; depth: number }[] = [];

  const closeUntil = (depth: number) => {
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
      const top = stack.pop()!;
      result.push(`</${top.type}>`);
    }
  };

  for (const line of lines) {
    // Unordered: - or * (don't match lines that start with HTML tags)
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    // Ordered: 1. 2. etc.
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);

    // Skip if the content starts with [ ] (checkbox) or an HTML tag
    if (ulMatch && /^\[[ xX]\]/.test(ulMatch[2]!)) {
      closeUntil(-1);
      result.push(line);
      continue;
    }

    if (ulMatch) {
      const depth = ulMatch[1]!.length;
      const content = ulMatch[2]!;
      const top = stack[stack.length - 1];

      if (!top || depth > top.depth) {
        stack.push({ type: "ul", depth });
        result.push("<ul>");
      } else if (depth < top.depth) {
        closeUntil(depth);
        if (stack.length === 0 || stack[stack.length - 1]?.type !== "ul") {
          stack.push({ type: "ul", depth });
          result.push("<ul>");
        }
      }
      result.push(`<li>${content}</li>`);
    } else if (olMatch) {
      const depth = olMatch[1]!.length;
      const content = olMatch[3]!;
      const top = stack[stack.length - 1];

      if (!top || depth > top.depth) {
        stack.push({ type: "ol", depth });
        result.push("<ol>");
      } else if (depth < top.depth) {
        closeUntil(depth);
        if (stack.length === 0 || stack[stack.length - 1]?.type !== "ol") {
          stack.push({ type: "ol", depth });
          result.push("<ol>");
        }
      }
      result.push(`<li>${content}</li>`);
    } else {
      closeUntil(-1);
      result.push(line);
    }
  }

  closeUntil(-1);
  return result.join("\n");
};

// ── Inline elements (bold, italic, code, links, etc.) ────────────────────────

export const processInlineElements = (text: string): string => {
  let html = text;

  // Inline code (must come first to prevent further processing inside backticks)
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links: [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Auto-link bare URLs (not already inside an href)
  html = html.replace(
    /(?<!="|'>)(https?:\/\/[^\s<)"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Bold + italic
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(
    /(?<![*\w])\*([^*\n]+)\*(?![*\w])/g,
    "<em>$1</em>"
  );

  // Blockquotes
  html = html.replace(/^&gt;\s?(.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/^>\s?(.+)$/gm, "<blockquote>$1</blockquote>");

  // Horizontal rules
  html = html.replace(/^---$/gm, "<hr/>");

  return html;
};

// ── Paragraphs ───────────────────────────────────────────────────────────────

const BLOCK_ELEMENTS =
  /^<(h[1-6]|ul|ol|pre|blockquote|hr|details|table|label|div|code|p|a\s)/;

export const processParagraphs = (text: string): string => {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      // Don't wrap blocks that already start with a block-level HTML element
      if (BLOCK_ELEMENTS.test(trimmed)) return trimmed;
      // Convert single newlines within a paragraph to <br> for line breaks
      return `<p>${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .filter(Boolean)
    .join("\n");
};

// ── Clean excess whitespace ──────────────────────────────────────────────────

export const cleanExcessNewlines = (text: string): string => {
  return text.replace(/\n{3,}/g, "\n\n");
};
