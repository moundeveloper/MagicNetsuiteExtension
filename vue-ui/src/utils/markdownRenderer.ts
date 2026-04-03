export const processCollapsibleSections = (text: string): string => {
  const lines = text.split("\n");
  const result: string[] = [];
  const stack: { type: string; summary: string }[] = [];

  for (const line of lines) {
    if (!line) continue;

    const collapseMatch = line.match(/^#{0,3}\?\?\?\s*(.+)?$/);
    const closeMatch = line.match(/^#{0,3}\?\?\?$/);

    if (collapseMatch) {
      const summary = collapseMatch[1]?.trim() || "Details";
      stack.push({ type: "details", summary });
      result.push(`<details class="collapsible"><summary>${escapeHtml(summary)}</summary><div class="collapsible-content">`);
    } else if (closeMatch && stack.length > 0) {
      result.push("</div></details>");
      stack.pop();
    } else {
      result.push(line);
    }
  }

  while (stack.length > 0) {
    result.push("</div></details>");
    stack.pop();
  }

  return result.join("\n");
};

export const processCalloutBoxes = (text: string): string => {
  const calloutRegex = /^:::(\w+)\s*(.*)$/gm;
  const calloutMap: Record<string, { icon: string; color: string; bg: string }> = {
    tip: { icon: "💡", color: "var(--p-green-700)", bg: "var(--p-green-50)" },
    warning: { icon: "⚠️", color: "var(--p-amber-700)", bg: "var(--p-amber-50)" },
    error: { icon: "❌", color: "var(--p-red-700)", bg: "var(--p-red-50)" },
    info: { icon: "ℹ️", color: "var(--p-blue-700)", bg: "var(--p-blue-50)" },
    note: { icon: "📝", color: "var(--p-slate-700)", bg: "var(--p-slate-50)" }
  };
  const defaultCallout = { icon: "ℹ️", color: "var(--p-blue-700)", bg: "var(--p-blue-50)" };

  let result = text.replace(calloutRegex, (match, type, title) => {
    const config = calloutMap[type.toLowerCase()] ?? defaultCallout;
    const titleHtml = title ? `<div class="callout-title">${escapeHtml(title)}</div>` : "";
    return `<div class="callout" style="--callout-color: ${config.color}; --callout-bg: ${config.bg}"><div class="callout-icon">${config.icon}</div><div class="callout-content">${titleHtml}`;
  });

  result = result.replace(/^:::$/gm, "</div></div>");

  return result;
};

export const processTables = (text: string): string => {
  const lines = text.split("\n");
  const result: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const tableMatch = line.match(/^\|(.+)\|$/);

    if (!tableMatch) {
      if (inTable) {
        result.push("</tbody></table>");
        inTable = false;
      }
      result.push(line);
      continue;
    }

    const cells = tableMatch[1]!.split("|").map((c: string) => c.trim());

    if (line.includes("---")) {
      continue;
    }

    if (!inTable) {
      inTable = true;
      const headers = cells
        .map((c: string) => `<th>${escapeHtml(c)}</th>`)
        .join("");
      result.push(`<table class="md-table"><thead><tr>${headers}</tr></thead><tbody>`);
    } else {
      const rows = cells.map((c: string) => `<td>${escapeHtml(c)}</td>`).join("");
      result.push(`<tr>${rows}</tr>`);
    }
  }

  if (inTable) {
    result.push("</tbody></table>");
  }

  return result.join("\n");
};

export const processCheckboxes = (text: string): string => {
  return text.replace(
    /^- \[([ xX])\] (.+)$/gm,
    (_, checked, label) => {
      const isChecked = checked.toLowerCase() === "x";
      return `<label class="checkbox-wrapper"><input type="checkbox" ${isChecked ? "checked" : ""} disabled /><span class="checkbox-label">${escapeHtml(label)}</span></label>`;
    }
  );
};

export const processHeadings = (text: string): string => {
  let html = text;
  html = html.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  return html;
};

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
    const ulMatch = line.match(/^(\s*)[-*] ([^<].*)$/);
    const olMatch = line.match(/^(\s*)(\d+)\. ([^<].*)$/);

    if (ulMatch) {
      const depth = ulMatch[1]!.length;
      const content = ulMatch[2]!;
      const top = stack[stack.length - 1];

      if (!top || depth > top.depth) {
        stack.push({ type: "ul", depth });
        result.push("<ul>");
      } else if (depth < top.depth) {
        closeUntil(depth);
        if (stack[stack.length - 1]?.type !== "ul") {
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

export const processInlineElementsNoEscape = (text: string): string => {
  let html = text;
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  html = html.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/^---$/gm, "<hr/>");
  return html;
};

export const processParagraphs = (text: string): string => {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      const blockStart = trimmed.slice(0, 50);
      if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|details|table|label|div|code|p)/.test(blockStart))
        return trimmed;
      return `<p>${trimmed.replace(/\n/g, " ")}</p>`;
    })
    .join("\n");
};

export const cleanExcessNewlines = (text: string): string => {
  return text.replace(/\n{3,}/g, "\n\n");
};

export const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
