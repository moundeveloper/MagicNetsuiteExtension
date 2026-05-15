/**
 * pdfUtils.ts
 * ─────────────────────────────────────────────────────────────
 * Two responsibilities:
 *   1. extractPdfText    — PDF.js text extraction from uploaded PDFs.
 *   2. generateDocument  — markdown → styled HTML document (blob URL).
 *
 * The "document" output is a fully-styled HTML document shown in an iframe.
 * The user prints it to PDF via the browser's native print dialog which
 * gives perfect quality, full Unicode support, and zero encoding issues.
 */

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface PdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfTextResult {
  pages: PdfPage[];
  /** Full concatenated text across all pages */
  fullText: string;
  pageCount: number;
}

export interface PdfGenerateOptions {
  filename: string;
  title: string;
  author?: string;
  /**
   * Markdown string. Full supported syntax documented in toolManager.ts.
   */
  content: string;
}

export interface PdfGenerateResult {
  /** Blob URL pointing to the generated HTML document (transient — dies on page refresh) */
  url: string;
  filename: string;
  /** Size of the HTML source in bytes */
  bytes: number;
  /**
   * The raw HTML string used to create the blob.
   * Persist this to recreate a fresh blob URL after page refresh.
   */
  html: string;
}

// ─────────────────────────────────────────────
// 1. PDF TEXT EXTRACTION  (PDF.js)
// ─────────────────────────────────────────────

interface LineItem {
  x: number;
  str: string;
  height: number;
}

interface LineObject {
  text: string;
  height: number;
  y: number;
}

/**
 * Extract text from a PDF File object using PDF.js (lazy-loaded).
 * Uses y-coordinate grouping to reconstruct proper lines and paragraph breaks.
 */
export const extractPdfText = async (file: File): Promise<PdfTextResult> => {
  const pdfjsLib = await import("pdfjs-dist");

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const typedArray = new Uint8Array(arrayBuffer);

  const loadingTask = pdfjsLib.getDocument({ data: typedArray });
  const pdf = await loadingTask.promise;

  const pages: PdfPage[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    const rawItems = textContent.items.filter(
      (item): item is typeof item & { str: string; transform: number[]; height: number } =>
        "str" in item &&
        typeof (item as { str?: unknown }).str === "string" &&
        ((item as { str: string }).str).trim().length > 0
    );

    if (rawItems.length === 0) {
      pages.push({ pageNumber: i, text: "" });
      continue;
    }

    const BUCKET = 3;
    const lineMap = new Map<number, LineItem[]>();

    for (const item of rawItems) {
      const transform = (item as unknown as { transform: number[] }).transform;
      const height = (item as unknown as { height: number }).height ?? 0;
      const str = (item as { str: string }).str;
      const y = Math.round((transform[5] ?? 0) / BUCKET) * BUCKET;

      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y)!.push({ x: transform[4] ?? 0, str, height });
    }

    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

    const lineObjects: LineObject[] = [];
    for (const y of sortedYs) {
      const lineItems = lineMap.get(y)!.sort((a, b) => a.x - b.x);
      const text = lineItems.map((it) => it.str).join(" ").replace(/\s{2,}/g, " ").trim();
      const height = Math.max(...lineItems.map((it) => it.height));
      if (text) lineObjects.push({ text, height, y });
    }

    if (lineObjects.length === 0) {
      pages.push({ pageNumber: i, text: "" });
      continue;
    }

    const avgHeight =
      lineObjects.reduce((sum, l) => sum + l.height, 0) / lineObjects.length || 12;
    const paragraphThreshold = avgHeight * 1.5;

    const textLines: string[] = [];
    for (let j = 0; j < lineObjects.length; j++) {
      const current = lineObjects[j]!;
      textLines.push(current.text);
      if (j < lineObjects.length - 1) {
        const next = lineObjects[j + 1]!;
        const gap = current.y - next.y;
        if (gap > paragraphThreshold) {
          textLines.push("");
        }
      }
    }

    pages.push({ pageNumber: i, text: textLines.join("\n") });
  }

  return {
    pages,
    fullText: pages.map((p) => p.text).join("\n\n"),
    pageCount: pdf.numPages
  };
};

// ─────────────────────────────────────────────
// 2. MARKDOWN → HTML CONVERTER
// ─────────────────────────────────────────────

const escHtml = (str: string): string =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Apply inline markdown to a raw string (bold, italic, code, links, strikethrough) */
const inlineMarkdown = (raw: string): string => {
  let s = escHtml(raw);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_\n]+?)_/g, "<em>$1</em>");
  s = s.replace(/~~(.+?)~~/g, "<del>$1</del>");
  s = s.replace(/`([^`]+?)`/g, "<code>$1</code>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
};

/** Parse a GFM table from an array of `| ... |` lines */
const parseMarkdownTable = (tableLines: string[]): string => {
  const parseRow = (line: string): string[] =>
    line.split("|").slice(1, -1).map((cell) => cell.trim());

  const isSeparator = (line: string): boolean =>
    /^\s*\|[\s\-:|]+\|\s*$/.test(line);

  const sepIdx = tableLines.findIndex(isSeparator);
  const headerRows = sepIdx > 0 ? tableLines.slice(0, sepIdx) : [];
  const bodyRows = sepIdx >= 0 ? tableLines.slice(sepIdx + 1) : tableLines;

  let html = '<table>';
  if (headerRows.length > 0) {
    html += "<thead>";
    for (const row of headerRows) {
      html += "<tr>" + parseRow(row).map((c) => `<th>${inlineMarkdown(c)}</th>`).join("") + "</tr>";
    }
    html += "</thead>";
  }
  const dataRows = bodyRows.filter((r) => !isSeparator(r));
  if (dataRows.length > 0) {
    html += "<tbody>";
    for (const row of dataRows) {
      html += "<tr>" + parseRow(row).map((c) => `<td>${inlineMarkdown(c)}</td>`).join("") + "</tr>";
    }
    html += "</tbody>";
  }
  return html + "</table>";
};

/** Detect and return a callout type from a blockquote's first line, or null */
const CALLOUT_TYPES: Record<string, { label: string; icon: string; cls: string }> = {
  NOTE:      { label: "Note",      icon: "ℹ",  cls: "callout-note"      },
  INFO:      { label: "Info",      icon: "ℹ",  cls: "callout-note"      },
  TIP:       { label: "Tip",       icon: "💡", cls: "callout-tip"       },
  IMPORTANT: { label: "Important", icon: "★",  cls: "callout-important" },
  WARNING:   { label: "Warning",   icon: "⚠",  cls: "callout-warning"   },
  CAUTION:   { label: "Caution",   icon: "⚠",  cls: "callout-warning"   },
  DANGER:    { label: "Danger",    icon: "✖",  cls: "callout-danger"    },
};

type ListType = "ul" | "ol" | null;

/** Indent level (2 spaces = 1 level) */
const getIndent = (line: string): number => {
  const match = line.match(/^(\s*)/);
  return match ? Math.floor((match[1] ?? "").length / 2) : 0;
};

/**
 * Convert a markdown string to an HTML body fragment.
 * Supports: headings (H1–H3), bullet/numbered/checkbox lists (nested),
 * GFM tables, fenced code blocks (with language label), blockquotes,
 * callout admonitions (> [!NOTE] etc.), horizontal rules, bold/italic/
 * strikethrough/inline-code/links.
 */
export const markdownToHtml = (markdown: string): string => {
  const lines = markdown.split("\n");
  const parts: string[] = [];

  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  // List stack: each entry tracks the tag and indent level
  type ListFrame = { type: ListType; indent: number };
  const listStack: ListFrame[] = [];

  let inTable = false;
  let tableLines: string[] = [];

  // Blockquote / callout buffering
  let inQuote = false;
  let quoteLines: string[] = [];

  // ── helpers ──────────────────────────────────────────────────

  const closeListsToLevel = (targetIndent: number) => {
    while (listStack.length > 0 && listStack[listStack.length - 1]!.indent >= targetIndent) {
      const frame = listStack.pop()!;
      parts.push(`</${frame.type}>`);
    }
  };

  const closeAllLists = () => closeListsToLevel(-1);

  const flushTable = () => {
    if (inTable) {
      if (tableLines.length >= 2) parts.push(parseMarkdownTable(tableLines));
      inTable = false;
      tableLines = [];
    }
  };

  const renderQuoteBlock = (qlines: string[]) => {
    const firstLine = qlines[0]?.trim() ?? "";
    const calloutMatch = firstLine.match(/^\[!([\w]+)\]\s*(.*)?$/);
    if (calloutMatch) {
      const key = calloutMatch[1]!.toUpperCase();
      const meta = CALLOUT_TYPES[key] ?? { label: key, icon: "ℹ", cls: "callout-note" };
      const titleExtra = calloutMatch[2]?.trim() ?? "";
      const bodyLines = qlines.slice(1);
      const bodyHtml = bodyLines.length
        ? markdownToHtml(bodyLines.join("\n"))
        : "";
      parts.push(
        `<div class="callout ${meta.cls}">` +
          `<div class="callout-title">${meta.icon} ${escHtml(titleExtra || meta.label)}</div>` +
          (bodyHtml ? `<div class="callout-body">${bodyHtml}</div>` : "") +
        `</div>`
      );
    } else {
      const inner = qlines.map((l) => `<p>${inlineMarkdown(l)}</p>`).join("");
      parts.push(`<blockquote>${inner}</blockquote>`);
    }
  };

  const flushQuote = () => {
    if (inQuote) {
      renderQuoteBlock(quoteLines);
      inQuote = false;
      quoteLines = [];
    }
  };

  const flushAll = () => {
    closeAllLists();
    flushTable();
    flushQuote();
  };

  // ── main loop ─────────────────────────────────────────────────

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    // ── Fenced code block ──────────────────────────────────────
    if (line.startsWith("```")) {
      if (inCode) {
        const langLabel = codeLang
          ? `<span class="code-lang">${escHtml(codeLang)}</span>`
          : "";
        parts.push(
          `<div class="code-block">${langLabel}<pre><code>${escHtml(codeLines.join("\n"))}</code></pre></div>`
        );
        codeLines = [];
        codeLang = "";
        inCode = false;
      } else {
        flushAll();
        codeLang = line.slice(3).trim();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeLines.push(raw); continue; }

    // ── GFM table row ──────────────────────────────────────────
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      closeAllLists();
      flushQuote();
      inTable = true;
      tableLines.push(trimmed);
      continue;
    } else {
      flushTable();
    }

    // ── Blockquote / callout ───────────────────────────────────
    if (trimmed.startsWith("> ") || trimmed === ">") {
      closeAllLists();
      flushTable();
      inQuote = true;
      quoteLines.push(trimmed.replace(/^>\s?/, ""));
      continue;
    } else {
      flushQuote();
    }

    // ── Headings ──────────────────────────────────────────────
    if (trimmed.startsWith("### ")) {
      flushAll();
      parts.push(`<h3>${inlineMarkdown(trimmed.slice(4).trim())}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      flushAll();
      parts.push(`<h2>${inlineMarkdown(trimmed.slice(3).trim())}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      flushAll();
      parts.push(`<h1>${inlineMarkdown(trimmed.slice(2).trim())}</h1>`);
    }

    // ── Lists (bullet, ordered, checkbox) ─────────────────────
    else if (/^(\s*)[-*] \[[ xX]\] /.test(line)) {
      // Checkbox item
      const indent = getIndent(line);
      const checked = /\[[xX]\]/.test(line);
      const text = line.replace(/^(\s*)[-*] \[[ xX]\] /, "").trim();
      closeListsToLevel(indent);
      if (!listStack.length || listStack[listStack.length - 1]!.indent < indent) {
        parts.push("<ul class=\"task-list\">");
        listStack.push({ type: "ul", indent });
      }
      const chk = checked ? "checked" : "";
      parts.push(
        `<li class="task-item"><input type="checkbox" disabled ${chk}> ${inlineMarkdown(text)}</li>`
      );
    } else if (/^(\s*)[-*] /.test(line)) {
      const indent = getIndent(line);
      const text = line.replace(/^(\s*)[-*] /, "").trim();
      closeListsToLevel(indent);
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent || top.type !== "ul") {
        parts.push("<ul>");
        listStack.push({ type: "ul", indent });
      }
      parts.push(`<li>${inlineMarkdown(text)}</li>`);
    } else if (/^(\s*)\d+\. /.test(line)) {
      const indent = getIndent(line);
      const text = line.replace(/^(\s*)\d+\. /, "").trim();
      closeListsToLevel(indent);
      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent || top.type !== "ol") {
        parts.push("<ol>");
        listStack.push({ type: "ol", indent });
      }
      parts.push(`<li>${inlineMarkdown(text)}</li>`);
    }

    // ── Horizontal rule ───────────────────────────────────────
    else if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushAll();
      parts.push("<hr>");
    }

    // ── Blank line ────────────────────────────────────────────
    else if (trimmed === "") {
      closeAllLists();
      flushQuote();
    }

    // ── Paragraph ─────────────────────────────────────────────
    else {
      closeAllLists();
      flushQuote();
      parts.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }

  // Flush any open blocks at end of input
  if (inCode && codeLines.length > 0) {
    const langLabel = codeLang
      ? `<span class="code-lang">${escHtml(codeLang)}</span>`
      : "";
    parts.push(
      `<div class="code-block">${langLabel}<pre><code>${escHtml(codeLines.join("\n"))}</code></pre></div>`
    );
  }
  closeAllLists();
  flushTable();
  flushQuote();

  return parts.join("\n");
};

// ─────────────────────────────────────────────
// 3. DOCUMENT GENERATION  (HTML blob)
// ─────────────────────────────────────────────

const DOCUMENT_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.75;
    color: #1f2937;
    background: #fff;
  }

  body {
    min-height: 100vh;
    background: #f3f4f6;
  }

  .page {
    max-width: 820px;
    margin: 0 auto;
    padding: 56px 64px 80px;
    background: #fff;
    min-height: 100vh;
  }

  /* ── Document header ── */
  .doc-header {
    border-bottom: 3px solid #4f46e5;
    padding-bottom: 24px;
    margin-bottom: 40px;
  }

  .doc-title {
    font-size: 2.2rem;
    font-weight: 800;
    color: #1e1b4b;
    line-height: 1.15;
    letter-spacing: -0.02em;
    margin-bottom: 8px;
  }

  .doc-meta {
    font-size: 0.78rem;
    color: #6b7280;
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    margin-top: 10px;
  }

  .doc-meta span { display: inline-flex; align-items: center; gap: 4px; }

  /* ── Headings ── */
  .doc-body h1 {
    font-size: 1.65rem;
    font-weight: 700;
    color: #1e1b4b;
    margin: 2.5rem 0 0.8rem;
    padding-bottom: 8px;
    border-bottom: 2px solid #e5e7eb;
    letter-spacing: -0.01em;
  }

  .doc-body h2 {
    font-size: 1.2rem;
    font-weight: 700;
    color: #312e81;
    margin: 2rem 0 0.5rem;
    letter-spacing: -0.005em;
  }

  .doc-body h3 {
    font-size: 1rem;
    font-weight: 600;
    color: #4338ca;
    margin: 1.5rem 0 0.4rem;
  }

  /* ── Paragraphs ── */
  .doc-body p {
    margin: 0.65rem 0;
    color: #374151;
  }

  /* ── Lists ── */
  .doc-body ul, .doc-body ol {
    margin: 0.5rem 0 0.5rem 1.5rem;
    color: #374151;
  }

  .doc-body li { margin: 0.25rem 0; }

  /* Nested lists */
  .doc-body ul ul, .doc-body ol ol,
  .doc-body ul ol, .doc-body ol ul {
    margin-top: 0.2rem;
    margin-bottom: 0.2rem;
  }

  /* Task list */
  .doc-body .task-list { list-style: none; margin-left: 0.25rem; }
  .doc-body .task-item { display: flex; align-items: flex-start; gap: 8px; margin: 0.3rem 0; }
  .doc-body .task-item input[type="checkbox"] {
    margin-top: 4px; accent-color: #6366f1; flex-shrink: 0;
  }

  /* ── HR ── */
  .doc-body hr {
    border: none;
    border-top: 1px solid #d1d5db;
    margin: 2rem 0;
  }

  /* ── Code ── */
  .doc-body .code-block {
    position: relative;
    margin: 1rem 0;
  }

  .doc-body .code-lang {
    position: absolute;
    top: 0;
    right: 0;
    background: #6366f1;
    color: #fff;
    font-size: 0.68rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 0 4px 0 4px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .doc-body pre {
    background: #f8f7ff;
    border: 1px solid #e0e7ff;
    border-left: 3px solid #6366f1;
    border-radius: 6px;
    padding: 1rem 1.25rem;
    overflow-x: auto;
    font-size: 0.82rem;
    line-height: 1.6;
  }

  .doc-body code {
    font-family: "JetBrains Mono", "Fira Code", "Cascadia Code",
                 Consolas, "Courier New", monospace;
    font-size: 0.83rem;
    color: #4338ca;
    background: #eef2ff;
    padding: 1px 5px;
    border-radius: 3px;
  }

  .doc-body pre code {
    background: none; padding: 0; color: #1e1b4b;
  }

  /* ── Links / text ── */
  .doc-body a { color: #6366f1; text-decoration: underline; }
  .doc-body strong { font-weight: 700; color: #111827; }
  .doc-body em { font-style: italic; color: #374151; }
  .doc-body del { text-decoration: line-through; color: #9ca3af; }

  /* ── Blockquote ── */
  .doc-body blockquote {
    border-left: 4px solid #c7d2fe;
    margin: 1rem 0;
    padding: 0.6rem 1rem;
    background: #f5f3ff;
    border-radius: 0 6px 6px 0;
    color: #4b5563;
    font-style: italic;
  }

  .doc-body blockquote p { margin: 0.25rem 0; color: inherit; }

  /* ── Callout boxes ── */
  .doc-body .callout {
    border-radius: 8px;
    margin: 1.25rem 0;
    overflow: hidden;
  }

  .doc-body .callout-title {
    font-weight: 700;
    font-size: 0.85rem;
    padding: 8px 14px;
    letter-spacing: 0.02em;
  }

  .doc-body .callout-body {
    padding: 10px 14px;
    font-size: 0.9rem;
  }

  .doc-body .callout-body p { margin: 0.2rem 0; }

  /* Note / Info */
  .doc-body .callout-note { border: 1px solid #bfdbfe; }
  .doc-body .callout-note .callout-title { background: #dbeafe; color: #1e40af; }
  .doc-body .callout-note .callout-body { background: #eff6ff; color: #1e3a8a; }

  /* Tip */
  .doc-body .callout-tip { border: 1px solid #bbf7d0; }
  .doc-body .callout-tip .callout-title { background: #dcfce7; color: #166534; }
  .doc-body .callout-tip .callout-body { background: #f0fdf4; color: #14532d; }

  /* Important */
  .doc-body .callout-important { border: 1px solid #c4b5fd; }
  .doc-body .callout-important .callout-title { background: #ede9fe; color: #5b21b6; }
  .doc-body .callout-important .callout-body { background: #f5f3ff; color: #4c1d95; }

  /* Warning / Caution */
  .doc-body .callout-warning { border: 1px solid #fde68a; }
  .doc-body .callout-warning .callout-title { background: #fef3c7; color: #92400e; }
  .doc-body .callout-warning .callout-body { background: #fffbeb; color: #78350f; }

  /* Danger */
  .doc-body .callout-danger { border: 1px solid #fecaca; }
  .doc-body .callout-danger .callout-title { background: #fee2e2; color: #991b1b; }
  .doc-body .callout-danger .callout-body { background: #fff1f2; color: #7f1d1d; }

  /* ── Tables ── */
  .doc-body table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.25rem 0;
    font-size: 0.88rem;
  }

  .doc-body th {
    background: #eef2ff;
    color: #1e1b4b;
    font-weight: 700;
    text-align: left;
    padding: 9px 14px;
    border: 1px solid #c7d2fe;
    white-space: nowrap;
  }

  .doc-body td {
    padding: 8px 14px;
    border: 1px solid #e5e7eb;
    color: #374151;
    vertical-align: top;
  }

  .doc-body tr:nth-child(even) td { background: #fafafa; }
  .doc-body tr:hover td { background: #f5f3ff; }

  /* ── Print / PDF styles ── */
  @media print {
    body { background: #fff; }
    .page { padding: 0; max-width: 100%; min-height: unset; }
    .doc-body pre  { break-inside: avoid; }
    .doc-body table { break-inside: avoid; }
    .doc-body .callout { break-inside: avoid; }
    h1, h2, h3 { break-after: avoid; }
    .no-print { display: none !important; }

    /* Page numbers via CSS counters */
    @page { margin: 20mm 18mm; }
    .page-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 10px;
      color: #9ca3af;
      padding: 8px 0;
      border-top: 1px solid #e5e7eb;
    }
  }

  /* Screen-only footer placeholder */
  .page-footer {
    margin-top: 48px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
    font-size: 0.72rem;
    color: #9ca3af;
    text-align: center;
  }
`;

/**
 * Generate a styled HTML document from markdown content.
 * Returns a blob URL (text/html) that can be set as an iframe src.
 */
export const generateDocument = (options: PdfGenerateOptions): PdfGenerateResult => {
  const bodyHtml = markdownToHtml(options.content);
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const authorMeta = options.author
    ? `<span>&#9998; ${escHtml(options.author)}</span>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(options.title)}</title>
  <style>${DOCUMENT_CSS}</style>
</head>
<body>
  <div class="page">
    <header class="doc-header">
      <div class="doc-title">${escHtml(options.title)}</div>
      <div class="doc-meta">
        <span>&#128197; ${dateStr}</span>
        ${authorMeta}
      </div>
    </header>
    <div class="doc-body">
      ${bodyHtml}
    </div>
    <footer class="page-footer no-print">
      ${escHtml(options.title)} &nbsp;·&nbsp; ${dateStr}
    </footer>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const filename = options.filename.endsWith(".pdf")
    ? options.filename
    : `${options.filename}.pdf`;

  return { url, filename, bytes: html.length, html };
};

/**
 * Revoke a blob URL created by generateDocument to free memory.
 */
export const revokePdfUrl = (url: string) => {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. REAL PDF DOWNLOAD  (jsPDF — real selectable text, no VFS required)
// ─────────────────────────────────────────────────────────────────────────────

// A4 page constants (points)
const PDF_A4_W = 595.28;
const PDF_A4_H = 841.89;
const PDF_ML   = 50;    // left margin
const PDF_MT   = 60;    // top margin
const PDF_MB   = 55;    // bottom margin
const PDF_CW   = PDF_A4_W - PDF_ML - 50; // 495.28 (50 pt right margin)

// ── Inline segment ────────────────────────────────────────────────────────────

interface PdfSeg {
  text:   string;
  bold:   boolean;
  italic: boolean;
  code:   boolean;
  strike: boolean;
}

/** Parse inline markdown into flat styled segments. */
const parsePdfSegs = (raw: string): PdfSeg[] => {
  const result: PdfSeg[] = [];
  const re =
    /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*([^*\n]+?)\*|_([^_\n]+?)_|~~(.+?)~~|`([^`]+?)`|\[([^\]]+?)\]\([^)]+?\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (text: string, b: boolean, it: boolean, c: boolean, s: boolean) => {
    if (text) result.push({ text, bold: b, italic: it, code: c, strike: s });
  };
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) push(raw.slice(last, m.index), false, false, false, false);
    if      (m[1] != null) push(m[1], true,  true,  false, false);
    else if (m[2] != null) push(m[2], true,  false, false, false);
    else if (m[3] != null) push(m[3], false, true,  false, false);
    else if (m[4] != null) push(m[4], false, true,  false, false);
    else if (m[5] != null) push(m[5], false, false, false, true);
    else if (m[6] != null) push(m[6], false, false, true,  false);
    else if (m[7] != null) push(m[7], false, false, false, false); // link → plain text
    last = m.index + m[0]!.length;
  }
  if (last < raw.length) push(raw.slice(last), false, false, false, false);
  return result.length
    ? result
    : [{ text: raw, bold: false, italic: false, code: false, strike: false }];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JDoc = any; // jsPDF instance — typed as any to avoid a static import of the class

/** Apply the correct font/size to `doc` for a segment (side-effect). */
const pdfApplySegFont = (doc: JDoc, seg: PdfSeg, baseSz: number): void => {
  if (seg.code) {
    doc.setFont('courier', 'normal');
    doc.setFontSize(baseSz - 1);
  } else {
    const style =
      seg.bold && seg.italic ? 'bolditalic'
      : seg.bold             ? 'bold'
      : seg.italic           ? 'italic'
      : 'normal';
    doc.setFont('helvetica', style);
    doc.setFontSize(baseSz);
  }
};

/** Return the rendered width (pt) of a segment. Sets font as a side-effect. */
const pdfSegW = (doc: JDoc, seg: PdfSeg, baseSz: number): number => {
  pdfApplySegFont(doc, seg, baseSz);
  return doc.getTextWidth(seg.text) as number;
};

/**
 * Word-wrap inline segments so each line fits within `maxW`.
 * Returns an array of lines; each line is an array of PdfSeg.
 */
const pdfWrapSegs = (
  doc:    JDoc,
  segs:   PdfSeg[],
  maxW:   number,
  baseSz: number,
): PdfSeg[][] => {
  const lines: PdfSeg[][] = [];
  let line: PdfSeg[] = [];
  let lineW = 0;

  const newLine = (): void => {
    lines.push(line);
    line  = [];
    lineW = 0;
  };

  for (const seg of segs) {
    // Tokenise into words + spaces
    const tokens: Array<{ t: string; isSp: boolean }> = [];
    let buf = '';
    for (const ch of seg.text) {
      if (ch === ' ' || ch === '\n') {
        if (buf) { tokens.push({ t: buf, isSp: false }); buf = ''; }
        tokens.push({ t: ch === '\n' ? '\n' : ' ', isSp: true });
      } else {
        buf += ch;
      }
    }
    if (buf) tokens.push({ t: buf, isSp: false });

    for (const { t, isSp } of tokens) {
      if (t === '\n') { newLine(); continue; }
      const tSeg: PdfSeg = { ...seg, text: t };
      const w = pdfSegW(doc, tSeg, baseSz);
      if (isSp) {
        if (line.length === 0) continue;           // skip leading space on new line
        if (lineW + w <= maxW) { line.push(tSeg); lineW += w; }
        // space that would overflow: discard (natural line-break boundary)
      } else {
        if (lineW + w > maxW && line.length > 0) newLine();
        line.push(tSeg);
        lineW += w;
      }
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.length ? lines : [[]];
};

/** Draw one pre-wrapped line of segments at baseline `y`. */
const pdfDrawLine = (
  doc:      JDoc,
  segs:     PdfSeg[],
  x0:       number,
  y:        number,
  baseSz:   number,
  defColor: string,
): void => {
  let x = x0;
  for (const seg of segs) {
    pdfApplySegFont(doc, seg, baseSz);
    const color = seg.code ? '#4338ca' : seg.strike ? '#9ca3af' : defColor;
    doc.setTextColor(color);
    doc.text(seg.text, x, y);
    const w = doc.getTextWidth(seg.text) as number;
    if (seg.strike) {
      doc.setDrawColor(color);
      doc.setLineWidth(0.4);
      doc.line(x, y - baseSz * 0.3, x + w, y - baseSz * 0.3);
    }
    x += w;
  }
};

// ── Render context ────────────────────────────────────────────────────────────

interface PdfCtx { doc: JDoc; y: number; }

/** Add a new page and reset y to the top margin. */
const pdfNewPage = (ctx: PdfCtx): void => {
  ctx.doc.addPage();
  ctx.y = PDF_MT;
};

/** If fewer than `needed` points remain on the page, start a new page. */
const pdfRoom = (ctx: PdfCtx, needed: number): void => {
  if (ctx.y + needed > PDF_A4_H - PDF_MB) pdfNewPage(ctx);
};

// ── Block renderers ───────────────────────────────────────────────────────────

/**
 * Render an inline-formatted paragraph with word-wrap.
 * Advances ctx.y; returns the new ctx.y value.
 */
const pdfParagraph = (
  ctx:   PdfCtx,
  raw:   string,
  sz:    number,
  lineH: number,
  color: string,
  lx:    number = PDF_ML,
  maxW:  number = PDF_CW,
): number => {
  if (!raw.trim()) return ctx.y;
  const segs  = parsePdfSegs(raw);
  const lines = pdfWrapSegs(ctx.doc, segs, maxW, sz);
  for (const ln of lines) {
    pdfRoom(ctx, lineH);
    pdfDrawLine(ctx.doc, ln, lx, ctx.y, sz, color);
    ctx.y += lineH;
  }
  return ctx.y;
};

const pdfHeading = (ctx: PdfCtx, text: string, level: 1 | 2 | 3): void => {
  const H = {
    1: { sz: 16, color: '#1e1b4b', top: 22, bot: 8,  rule: true  },
    2: { sz: 13, color: '#312e81', top: 16, bot: 6,  rule: false },
    3: { sz: 11, color: '#4338ca', top: 12, bot: 4,  rule: false },
  }[level];
  const lineH = H.sz * 1.3;
  pdfRoom(ctx, H.top + lineH + H.bot);
  ctx.y += H.top;
  pdfParagraph(ctx, text, H.sz, lineH, H.color);
  if (H.rule) {
    ctx.doc.setDrawColor('#e5e7eb');
    ctx.doc.setLineWidth(1);
    ctx.doc.line(PDF_ML, ctx.y, PDF_ML + PDF_CW, ctx.y);
    ctx.y += 4;
  }
  ctx.y += H.bot;
};

const pdfHR = (ctx: PdfCtx): void => {
  pdfRoom(ctx, 22);
  ctx.y += 10;
  ctx.doc.setDrawColor('#d1d5db');
  ctx.doc.setLineWidth(0.5);
  ctx.doc.line(PDF_ML, ctx.y, PDF_ML + PDF_CW, ctx.y);
  ctx.y += 12;
};

const pdfCodeBlock = (ctx: PdfCtx, codeLines: string[], lang: string): void => {
  const fs  = 8.5;
  const lh  = fs * 1.5;   // ≈ 12.75 pt per line

  ctx.y += 4;

  if (lang) {
    pdfRoom(ctx, 18);
    ctx.doc.setFont('helvetica', 'bold');
    ctx.doc.setFontSize(7.5);
    ctx.doc.setFillColor('#6366f1');
    const labelW = (ctx.doc.getTextWidth(lang.toUpperCase()) as number) + 12;
    ctx.doc.rect(PDF_ML, ctx.y - 9, labelW, 12, 'F');
    ctx.doc.setTextColor('#ffffff');
    ctx.doc.text(lang.toUpperCase(), PDF_ML + 6, ctx.y);
    ctx.y += 16;
  }

  ctx.doc.setFont('courier', 'normal');
  ctx.doc.setFontSize(fs);

  for (const cl of codeLines) {
    pdfRoom(ctx, lh + 2);
    const lineTop = ctx.y - lh + 3;
    ctx.doc.setFillColor('#f8f7ff');
    ctx.doc.rect(PDF_ML, lineTop, PDF_CW, lh, 'F');
    ctx.doc.setFillColor('#6366f1');
    ctx.doc.rect(PDF_ML, lineTop, 3, lh, 'F');
    ctx.doc.setTextColor('#1e1b4b');
    ctx.doc.text(cl, PDF_ML + 10, ctx.y);
    ctx.y += lh;
  }

  ctx.y += 8;
};

interface PdfListItem {
  raw:     string;
  type:    'ul' | 'ol';
  indent:  number;
  isTask:  boolean;
  checked: boolean;
  num:     number;
}

const pdfListItems = (ctx: PdfCtx, items: PdfListItem[]): void => {
  const fs   = 10;
  const lh   = fs * 1.5;
  const iPad = 14; // pts per indent level

  for (const item of items) {
    const bulletX = PDF_ML + item.indent * iPad;
    const textX   = bulletX + 16;
    const maxW    = PDF_CW - item.indent * iPad - 16;

    // Pre-wrap to know total height
    const segs   = parsePdfSegs(item.raw);
    const wlines = pdfWrapSegs(ctx.doc, segs, maxW, fs);

    pdfRoom(ctx, lh); // ensure at least one line

    // Marker
    const marker =
      item.isTask       ? (item.checked ? '[X]' : '[ ]')
      : item.type === 'ol' ? `${item.num}.`
      : '\u2022'; // bullet •

    ctx.doc.setFont('helvetica', 'normal');
    ctx.doc.setFontSize(fs);
    ctx.doc.setTextColor('#374151');
    ctx.doc.text(marker, bulletX, ctx.y);

    // Text lines
    for (let li = 0; li < wlines.length; li++) {
      if (li > 0) pdfRoom(ctx, lh);
      pdfDrawLine(ctx.doc, wlines[li]!, textX, ctx.y, fs, '#374151');
      ctx.y += lh;
    }
  }
};

const pdfTable = (ctx: PdfCtx, tableLines: string[]): void => {
  const parseRow = (line: string): string[] =>
    line.split('|').slice(1, -1).map((c) => c.trim());
  const isSep = (line: string): boolean => /^\|[\s\-:|]+\|$/.test(line);

  const sepIdx = tableLines.findIndex(isSep);
  if (sepIdx < 0) return;

  const headerLines = tableLines.slice(0, sepIdx);
  const bodyLines   = tableLines.slice(sepIdx + 1).filter((l) => !isSep(l));
  if (headerLines.length === 0 && bodyLines.length === 0) return;

  const allRows = [
    ...headerLines.map((l) => ({ cells: parseRow(l), header: true,  even: false })),
    ...bodyLines.map((l, ri) => ({ cells: parseRow(l), header: false, even: ri % 2 === 1 })),
  ];

  const numCols = Math.max(...allRows.map((r) => r.cells.length), 1);
  const colW    = PDF_CW / numCols;
  const cellPad = 5;
  const cellTW  = colW - cellPad * 2;
  const cellFs  = 9.5;
  const cellLH  = cellFs * 1.4;

  ctx.y += 8;

  for (const row of allRows) {
    // Measure row height (tallest cell wins)
    let rowH = cellPad * 2 + cellLH;
    for (let ci = 0; ci < numCols; ci++) {
      const wlines = pdfWrapSegs(ctx.doc, parsePdfSegs(row.cells[ci] ?? ''), cellTW, cellFs);
      const h = wlines.length * cellLH + cellPad * 2;
      if (h > rowH) rowH = h;
    }

    pdfRoom(ctx, rowH);

    for (let ci = 0; ci < numCols; ci++) {
      const cx = PDF_ML + ci * colW;
      const bg = row.header ? '#eef2ff' : row.even ? '#fafafa' : '#ffffff';
      ctx.doc.setFillColor(bg);
      ctx.doc.rect(cx, ctx.y, colW, rowH, 'F');
      ctx.doc.setDrawColor('#e5e7eb');
      ctx.doc.setLineWidth(0.5);
      ctx.doc.rect(cx, ctx.y, colW, rowH, 'S');

      const textColor = row.header ? '#1e1b4b' : '#374151';
      const wlines    = pdfWrapSegs(ctx.doc, parsePdfSegs(row.cells[ci] ?? ''), cellTW, cellFs);
      let textY = ctx.y + cellPad + cellFs * 0.85;
      for (const wl of wlines) {
        const renderSegs = row.header ? wl.map((s) => ({ ...s, bold: true })) : wl;
        pdfDrawLine(ctx.doc, renderSegs, cx + cellPad, textY, cellFs, textColor);
        textY += cellLH;
      }
    }

    ctx.y += rowH;
  }

  ctx.y += 12;
};

const CALLOUT_PDF_STYLES: Record<
  string,
  { border: string; bg: string; color: string; label: string }
> = {
  NOTE:      { border: '#60a5fa', bg: '#eff6ff', color: '#1e40af', label: 'Note'      },
  INFO:      { border: '#60a5fa', bg: '#eff6ff', color: '#1e40af', label: 'Info'      },
  TIP:       { border: '#34d399', bg: '#f0fdf4', color: '#166534', label: 'Tip'       },
  IMPORTANT: { border: '#a78bfa', bg: '#f5f3ff', color: '#5b21b6', label: 'Important' },
  WARNING:   { border: '#fbbf24', bg: '#fffbeb', color: '#92400e', label: 'Warning'   },
  CAUTION:   { border: '#fbbf24', bg: '#fffbeb', color: '#92400e', label: 'Caution'   },
  DANGER:    { border: '#f87171', bg: '#fff1f2', color: '#991b1b', label: 'Danger'    },
};

const pdfQuoteOrCallout = (ctx: PdfCtx, qlines: string[]): void => {
  const first = qlines[0]?.trim() ?? '';
  const calloutMatch = first.match(/^\[!([\w]+)\]\s*(.*)?$/);
  const fs  = 10;
  const lh  = fs * 1.5;
  const pad = 10;

  if (calloutMatch) {
    const key       = calloutMatch[1]!.toUpperCase();
    const style     = CALLOUT_PDF_STYLES[key] ?? CALLOUT_PDF_STYLES['NOTE']!;
    const titleText = calloutMatch[2]?.trim() || style.label;
    const bodyText  = qlines.slice(1).join(' ').trim();
    const bodySegs  = bodyText ? parsePdfSegs(bodyText) : [];
    const bodyLines = bodyText ? pdfWrapSegs(ctx.doc, bodySegs, PDF_CW - 28, fs) : [];
    const totalH    = pad + lh + (bodyLines.length ? bodyLines.length * lh + 6 : 0) + pad;

    pdfRoom(ctx, totalH);

    ctx.doc.setFillColor(style.bg);
    ctx.doc.rect(PDF_ML, ctx.y, PDF_CW, totalH, 'F');
    ctx.doc.setFillColor(style.border);
    ctx.doc.rect(PDF_ML, ctx.y, 4, totalH, 'F');

    let ty = ctx.y + pad + fs * 0.85;
    ctx.doc.setFont('helvetica', 'bold');
    ctx.doc.setFontSize(fs);
    ctx.doc.setTextColor(style.color);
    ctx.doc.text(titleText, PDF_ML + 12, ty);
    ty += lh;

    if (bodyLines.length) {
      ty += 4;
      for (const wl of bodyLines) {
        pdfDrawLine(ctx.doc, wl, PDF_ML + 12, ty, fs, style.color);
        ty += lh;
      }
    }

    ctx.y += totalH + 10;
  } else {
    // Plain blockquote
    const segs   = parsePdfSegs(qlines.join(' '));
    const wlines = pdfWrapSegs(ctx.doc, segs, PDF_CW - 20, fs);
    const totalH = pad + wlines.length * lh + pad;

    pdfRoom(ctx, totalH);

    ctx.doc.setFillColor('#f5f3ff');
    ctx.doc.rect(PDF_ML, ctx.y, PDF_CW, totalH, 'F');
    ctx.doc.setFillColor('#c7d2fe');
    ctx.doc.rect(PDF_ML, ctx.y, 4, totalH, 'F');

    let ty = ctx.y + pad + fs * 0.85;
    for (const wl of wlines) {
      ctx.doc.setFont('helvetica', 'italic');
      pdfDrawLine(ctx.doc, wl, PDF_ML + 12, ty, fs, '#4b5563');
      ty += lh;
    }

    ctx.y += totalH + 8;
  }
};

/**
 * Download a document as a real, text-based PDF using jsPDF.
 * Uses standard built-in fonts (Helvetica, Courier) — no VFS, no font files needed.
 *
 * @param markdown  - Markdown content (from the generate_pdf tool)
 * @param title     - Document title
 * @param filename  - Output filename (.pdf appended if missing)
 */
export const downloadDocumentAsPdf = async (
  markdown: string | null | undefined,
  title:    string | null | undefined,
  filename: string,
): Promise<void> => {
  const safeMarkdown = markdown ?? '';
  const safeTitle    = title || filename.replace(/\.pdf$/i, '') || 'Document';
  const safeFilename = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;

  const { jsPDF } = await import('jspdf');
  const doc  = new jsPDF({ unit: 'pt', format: 'a4' });
  const ctx: PdfCtx = { doc, y: PDF_MT };

  // ── Document header ─────────────────────────────────────────────────────────

  const titleLineH = 20 * 1.25;
  pdfRoom(ctx, 80);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor('#1e1b4b');
  const titleWrapped = doc.splitTextToSize(safeTitle, PDF_CW) as string[];
  for (const tl of titleWrapped) {
    doc.text(tl, PDF_ML, ctx.y);
    ctx.y += titleLineH;
  }
  ctx.y += 4;

  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor('#6b7280');
  doc.text(dateStr, PDF_ML, ctx.y);
  ctx.y += 9 * 1.4 + 10;

  doc.setDrawColor('#4f46e5');
  doc.setLineWidth(2);
  doc.line(PDF_ML, ctx.y, PDF_ML + PDF_CW, ctx.y);
  ctx.y += 22;

  // ── Parse + render markdown ──────────────────────────────────────────────────

  const mdLines = safeMarkdown.split('\n');
  let i = 0;

  let tableBuf: string[]  = [];
  let quoteBuf: string[]  = [];

  type ListItem = {
    raw: string; type: 'ul' | 'ol'; indent: number;
    isTask: boolean; checked: boolean; num: number;
  };
  let listBuf: ListItem[] = [];
  const listCounters: Record<number, number> = {};

  const flushList = (): void => {
    if (!listBuf.length) return;
    pdfListItems(ctx, listBuf);
    listBuf = [];
    for (const k of Object.keys(listCounters)) delete listCounters[Number(k)];
    ctx.y += 6;
  };
  const flushTable = (): void => {
    if (!tableBuf.length) return;
    pdfTable(ctx, tableBuf);
    tableBuf = [];
  };
  const flushQuote = (): void => {
    if (!quoteBuf.length) return;
    pdfQuoteOrCallout(ctx, quoteBuf);
    quoteBuf = [];
  };
  const flushAll = (): void => { flushList(); flushTable(); flushQuote(); };

  while (i < mdLines.length) {
    const raw     = mdLines[i]!;
    const line    = raw.trimEnd();
    const trimmed = line.trim();

    // ── Fenced code block ──────────────────────────────────────────────────────
    if (trimmed.startsWith('```')) {
      flushAll();
      const lang = trimmed.slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < mdLines.length && !mdLines[i]!.trim().startsWith('```')) {
        codeLines.push(mdLines[i]!);
        i++;
      }
      i++; // skip closing ```
      pdfCodeBlock(ctx, codeLines, lang);
      continue;
    }

    // ── GFM table ─────────────────────────────────────────────────────────────
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushList(); flushQuote();
      tableBuf.push(trimmed);
      i++;
      continue;
    } else {
      flushTable();
    }

    // ── Blockquote / callout ──────────────────────────────────────────────────
    if (trimmed.startsWith('> ') || trimmed === '>') {
      flushList(); flushTable();
      quoteBuf.push(trimmed.replace(/^>\s?/, ''));
      i++;
      continue;
    } else {
      flushQuote();
    }

    // ── Headings ──────────────────────────────────────────────────────────────
    if      (trimmed.startsWith('### ')) { flushAll(); pdfHeading(ctx, trimmed.slice(4).trim(), 3); }
    else if (trimmed.startsWith('## '))  { flushAll(); pdfHeading(ctx, trimmed.slice(3).trim(), 2); }
    else if (trimmed.startsWith('# '))   { flushAll(); pdfHeading(ctx, trimmed.slice(2).trim(), 1); }

    // ── Task list ─────────────────────────────────────────────────────────────
    else if (/^(\s*)[-*] \[[ xX]\] /.test(line)) {
      flushTable(); flushQuote();
      const indent  = Math.floor((line.match(/^(\s*)/)?.[1]?.length ?? 0) / 2);
      const checked = /\[[xX]\]/.test(line);
      const text    = line.replace(/^\s*[-*] \[[ xX]\] /, '').trim();
      listBuf.push({ raw: text, type: 'ul', indent, isTask: true, checked, num: 0 });
    }

    // ── Bullet list ───────────────────────────────────────────────────────────
    else if (/^(\s*)[-*] /.test(line)) {
      flushTable(); flushQuote();
      const indent = Math.floor((line.match(/^(\s*)/)?.[1]?.length ?? 0) / 2);
      const text   = line.replace(/^\s*[-*] /, '').trim();
      listBuf.push({ raw: text, type: 'ul', indent, isTask: false, checked: false, num: 0 });
    }

    // ── Ordered list ──────────────────────────────────────────────────────────
    else if (/^(\s*)\d+\. /.test(line)) {
      flushTable(); flushQuote();
      const indent = Math.floor((line.match(/^(\s*)/)?.[1]?.length ?? 0) / 2);
      const text   = line.replace(/^\s*\d+\. /, '').trim();
      // Reset counters for deeper indents when we come back up
      for (const k of Object.keys(listCounters)) {
        if (Number(k) > indent) delete listCounters[Number(k)];
      }
      listCounters[indent] = (listCounters[indent] ?? 0) + 1;
      listBuf.push({ raw: text, type: 'ol', indent, isTask: false, checked: false, num: listCounters[indent]! });
    }

    // ── Horizontal rule ───────────────────────────────────────────────────────
    else if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushAll();
      pdfHR(ctx);
    }

    // ── Blank line ────────────────────────────────────────────────────────────
    else if (trimmed === '') {
      flushList();
      ctx.y += 4; // paragraph gap
    }

    // ── Paragraph ─────────────────────────────────────────────────────────────
    else {
      flushList(); flushQuote();
      const lh = 10 * 1.6;
      pdfParagraph(ctx, trimmed, 10, lh, '#374151');
      ctx.y += 2;
    }

    i++;
  }

  flushAll();

  doc.save(safeFilename);
};

