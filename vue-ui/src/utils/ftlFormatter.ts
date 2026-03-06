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

const SELF_CLOSING_FTL = new Set([
  "assign",
  "setting",
  "outputformat",
  "autoesc"
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

export interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: "error" | "warning";
}

interface TokenWithPos {
  text: string;
  start: number;
  line: number;
}

function tokenizeWithPos(input: string): TokenWithPos[] {
  const tokens: TokenWithPos[] = [];
  let i = 0;
  const len = input.length;

  const getLineNumber = (pos: number): number => {
    let line = 1;
    for (let j = 0; j < pos && j < input.length; j++) {
      if (input[j] === "\n") line++;
    }
    return line;
  };

  while (i < len) {
    if (input.startsWith("<?", i)) {
      const end = input.indexOf("?>", i) + 2;
      tokens.push({
        text: input.slice(i, end),
        start: i,
        line: getLineNumber(i)
      });
      i = end;
      continue;
    }
    if (input.startsWith("<!", i) && !input.startsWith("<!--", i)) {
      const end = input.indexOf(">", i) + 1;
      tokens.push({
        text: input.slice(i, end),
        start: i,
        line: getLineNumber(i)
      });
      i = end;
      continue;
    }
    if (input.startsWith("<!--", i) || input.startsWith("<#--", i)) {
      const end = input.indexOf("-->", i) + 3;
      tokens.push({
        text: input.slice(i, end),
        start: i,
        line: getLineNumber(i)
      });
      i = end;
      continue;
    }
    if (input[i] === "<") {
      let j = i + 1;
      while (j < len) {
        if (input[j] === '"' || input[j] === "'") {
          const q = input[j];
          j++;
          while (j < len && input[j] !== q) j++;
          j++;
        } else if (input[j] === ">") {
          j++;
          break;
        } else {
          j++;
        }
      }
      tokens.push({
        text: input.slice(i, j),
        start: i,
        line: getLineNumber(i)
      });
      i = j;
      continue;
    }
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
      tokens.push({
        text: input.slice(i, j),
        start: i,
        line: getLineNumber(i)
      });
      i = j;
      continue;
    }
    let j = i;
    while (j < len && input[j] !== "<" && !input.startsWith("${", j)) j++;
    const text = input.slice(i, j).trim();
    if (text) {
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (t) {
          const lineStart = i + text.indexOf(line);
          tokens.push({
            text: t,
            start: lineStart,
            line: getLineNumber(lineStart)
          });
        }
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

export function validateFtlXml(input: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const tokens = tokenizeWithPos(input);
  const tagStack: { name: string; line: number }[] = [];

  const getLineStart = (lineNum: number): number => {
    let pos = 0;
    for (let i = 1; i < lineNum && pos < input.length; pos++) {
      if (input[pos] === "\n") i++;
    }
    return pos;
  };

  const getColumn = (start: number, lineNum: number): number => {
    const lineStart = getLineStart(lineNum);
    return start - lineStart + 1;
  };

  for (const token of tokens) {
    const { text: t, start: tokenStart, line: lineNum } = token;

    if (!t) continue;

    if (FTL_BLOCK_MID.test(t)) {
      continue;
    }

    if (FTL_BLOCK_CLOSE.test(t)) {
      const tag = t.match(/^<\/#([a-zA-Z]+)/)?.[1]?.toLowerCase();
      if (tag) {
        if (
          tagStack.length === 0 ||
          tagStack[tagStack.length - 1]!.name !== tag
        ) {
          const opening = [...tagStack]
            .reverse()
            .find((item) => item.name === tag);
          if (opening) {
            errors.push({
              line: lineNum,
              column: getColumn(tokenStart, lineNum),
              message: `Unexpected closing tag </${tag}>. Expected </${tagStack[tagStack.length - 1]!.name}>`,
              severity: "error"
            });
          } else {
            errors.push({
              line: lineNum,
              column: getColumn(tokenStart, lineNum),
              message: `Closing tag </${tag}> has no matching opening tag`,
              severity: "error"
            });
          }
        } else {
          tagStack.pop();
        }
      }
      continue;
    }

    if (isHtmlClose(t)) {
      const tag = getTagName(t);
      if (HTML_BLOCK_TAGS.has(tag)) {
        if (
          tagStack.length === 0 ||
          tagStack[tagStack.length - 1]!.name !== tag
        ) {
          const opening = [...tagStack]
            .reverse()
            .find((item) => item.name === tag);
          if (opening) {
            errors.push({
              line: lineNum,
              column: getColumn(tokenStart, lineNum),
              message: `Unexpected closing tag </${tag}>. Expected </${tagStack[tagStack.length - 1]!.name}>`,
              severity: "error"
            });
          } else {
            errors.push({
              line: lineNum,
              column: getColumn(tokenStart, lineNum),
              message: `Closing tag </${tag}> has no matching opening tag`,
              severity: "error"
            });
          }
        } else {
          tagStack.pop();
        }
      }
      continue;
    }

    if (FTL_BLOCK_OPEN.test(t)) {
      const tag = t.match(/^<#([a-zA-Z]+)/)?.[1];
      if (tag && !t.endsWith("/>") && !SELF_CLOSING_FTL.has(tag)) {
        tagStack.push({ name: tag, line: lineNum });
      }
      continue;
    }

    const tag = getTagName(t);
    if (tag && !isSelfClosing(t)) {
      if (HTML_BLOCK_TAGS.has(tag)) {
        tagStack.push({ name: tag, line: lineNum });
      }
    }
  }

  if (tagStack.length > 0) {
    const unclosed = tagStack[tagStack.length - 1]!;
    errors.push({
      line: unclosed.line,
      column: 1,
      message: `Unclosed tag <${unclosed.name}>. This tag is never closed`,
      severity: "error"
    });
  }

  return errors;
}

export function formatFtl(input: string): string {
  const tokens = tokenizeWithPos(input.trim());
  const lines: string[] = [];
  let depth = 0;
  const ind = () => INDENT.repeat(Math.max(0, depth));

  for (const token of tokens) {
    const t = token.text.trim();
    if (!t) continue;

    if (FTL_BLOCK_MID.test(t)) {
      depth = Math.max(0, depth - 1);
      lines.push(ind() + t);
      depth++;
      continue;
    }

    if (FTL_BLOCK_CLOSE.test(t)) {
      depth = Math.max(0, depth - 1);
      lines.push(ind() + t);
      continue;
    }

    if (isHtmlClose(t)) {
      const tag = getTagName(t);
      if (HTML_BLOCK_TAGS.has(tag)) depth = Math.max(0, depth - 1);
      lines.push(ind() + t);
      continue;
    }

    lines.push(ind() + t);

    if (FTL_BLOCK_OPEN.test(t)) {
      const tag = t.match(/^<#([a-zA-Z]+)/)?.[1];
      if (!t.endsWith("/>") && !(tag && SELF_CLOSING_FTL.has(tag))) {
        depth++;
      }
      continue;
    }

    const tag = getTagName(t);
    if (tag && HTML_BLOCK_TAGS.has(tag) && !isSelfClosing(t)) {
      depth++;
    }
  }

  return lines.join("\n");
}
