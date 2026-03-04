const INDENT = "  ";

const SELF_CLOSING_TAGS = new Set([
  "br",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "area",
  "base",
  "col",
  "embed",
  "param",
  "source",
  "track",
  "wbr",
  "barcode",
  "pagenumber",
  "totalpages"
]);

const HTML_BLOCK_TAGS = new Set([
  "html",
  "head",
  "body",
  "div",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "li",
  "ul",
  "ol",
  "select",
  "form",
  "macrolist",
  "macro",
  "style",
  "pdf",
  "b",
  "strong",
  "em",
  "i",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "section",
  "article",
  "header",
  "footer",
  "nav",
  "main",
  "aside",
  "figure",
  "figcaption",
  "blockquote",
  "pre",
  "code",
  "script",
  "noscript",
  "template"
]);

const FTL_BLOCK_OPEN =
  /^<#(if|list|items|sep|noparse|attempt|recover|compress|escape|noescape|switch|macro|function|transform|visit|recurse|fallback|assign|local|global|setting|outputformat|autoesc)\b/;
const FTL_BLOCK_CLOSE =
  /^<\/#(if|list|items|noparse|attempt|compress|escape|noescape|switch|macro|function|transform|outputformat|autoesc)>/;
const FTL_BLOCK_MID = /^<#(elseif|else|case|default|sep|recover)\b/;

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    // XML declaration
    if (input.startsWith("<?", i)) {
      const end = input.indexOf("?>", i) + 2;
      tokens.push(input.slice(i, end));
      i = end;
      continue;
    }
    // DOCTYPE
    if (input.startsWith("<!", i) && !input.startsWith("<!--", i)) {
      const end = input.indexOf(">", i) + 1;
      tokens.push(input.slice(i, end));
      i = end;
      continue;
    }
    // HTML/FTL comments
    if (input.startsWith("<!--", i) || input.startsWith("<#--", i)) {
      const end = input.indexOf("-->", i) + 3;
      tokens.push(input.slice(i, end));
      i = end;
      continue;
    }
    // Any tag — scan carefully past quoted attributes
    if (input[i] === "<") {
      let j = i + 1;
      while (j < len) {
        if (input[j] === '"' || input[j] === "'") {
          const q = input[j];
          j++;
          while (j < len && input[j] !== q) j++;
          j++; // closing quote
        } else if (input[j] === ">") {
          j++;
          break;
        } else {
          j++;
        }
      }
      tokens.push(input.slice(i, j));
      i = j;
      continue;
    }
    // FTL interpolation ${...}  (may nest braces)
    if (input.startsWith("${", i)) {
      let depth = 0;
      let j = i;
      while (j < len) {
        if (input[j] === "{") depth++;
        else if (input[j] === "}") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
        j++;
      }
      tokens.push(input.slice(i, j));
      i = j;
      continue;
    }
    // Plain text up to next tag or interpolation
    let j = i;
    while (j < len && input[j] !== "<" && !input.startsWith("${", j)) j++;
    const text = input.slice(i, j).trim();
    if (text) {
      // split on newlines so CSS blocks don't become one giant token
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (t) tokens.push(t);
      }
    }
    i = j;
  }

  return tokens;
}

function getTagName(token: string): string {
  const match = token.match(/^<[/#@]?([a-zA-Z][a-zA-Z0-9._-]*)/);
  return match ? match[1]!.toLowerCase() : "";
}

function isHtmlClose(token: string): boolean {
  return token.startsWith("</");
}

function isSelfClosing(token: string): boolean {
  return token.endsWith("/>") || SELF_CLOSING_TAGS.has(getTagName(token));
}

export function formatFtl(input: string): string {
  const tokens = tokenize(input.trim());
  const lines: string[] = [];
  let depth = 0;
  const ind = () => INDENT.repeat(Math.max(0, depth));

  for (const token of tokens) {
    const t = token.trim();
    if (!t) continue;

    // ── FTL mid-block (else / elseif / case) ──
    if (FTL_BLOCK_MID.test(t)) {
      depth = Math.max(0, depth - 1);
      lines.push(ind() + t);
      depth++;
      continue;
    }

    // ── FTL closing directive ──
    if (FTL_BLOCK_CLOSE.test(t)) {
      depth = Math.max(0, depth - 1);
      lines.push(ind() + t);
      continue;
    }

    // ── HTML closing tag ──
    if (isHtmlClose(t)) {
      const tag = getTagName(t);
      if (HTML_BLOCK_TAGS.has(tag)) depth = Math.max(0, depth - 1);
      lines.push(ind() + t);
      continue;
    }

    // ── Print current token ──
    lines.push(ind() + t);

    // ── FTL opening directive ──
    if (FTL_BLOCK_OPEN.test(t)) {
      depth++;
      continue;
    }

    // ── HTML opening tag ──
    const tag = getTagName(t);
    if (tag && HTML_BLOCK_TAGS.has(tag) && !isSelfClosing(t)) {
      depth++;
    }
  }

  return lines.join("\n");
}
