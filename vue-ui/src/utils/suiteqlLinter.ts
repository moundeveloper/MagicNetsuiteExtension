import { Parser } from "node-sql-parser";

export type SuiteQLLintSeverity = "error" | "warning" | "suggestion";

export interface SuiteQLLintIssue {
  severity: SuiteQLLintSeverity;
  code: string;
  message: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface SuiteQLLintResult {
  ok: boolean;
  issues: SuiteQLLintIssue[];
  errors: SuiteQLLintIssue[];
  warnings: SuiteQLLintIssue[];
  suggestions: SuiteQLLintIssue[];
}

export interface SuiteQLSchemaContext {
  tableIds?: string[];
  fieldsByTable?: Record<string, string[]>;
  fieldTypesByTable?: Record<string, Record<string, string>>;
}

interface TableSource {
  table: string;
  alias: string | null;
  isCte: boolean;
}

interface ColumnRef {
  table: string | null;
  column: string;
}

interface FunctionRef {
  name: string;
}

interface SuiteQLAnalysisContext {
  sql: string;
  maskedSql: string;
  ast: unknown[];
  parseError: string | null;
  tableSources: TableSource[];
  aliasToTable: Map<string, string>;
  cteNames: Set<string>;
  selectAliases: Set<string>;
  columnRefs: ColumnRef[];
  functionRefs: FunctionRef[];
  schema: {
    tableIds: Set<string>;
    fieldsByTable: Map<string, Set<string>>;
    fieldTypesByTable: Map<string, Map<string, string>>;
  };
}

interface SuiteQLRule {
  id: string;
  check: (context: SuiteQLAnalysisContext) => SuiteQLLintIssue[];
}

const parser = new Parser();

const MUTATING_STATEMENTS = new Set([
  "alter",
  "call",
  "commit",
  "create",
  "delete",
  "drop",
  "exec",
  "execute",
  "grant",
  "insert",
  "merge",
  "revoke",
  "rollback",
  "truncate",
  "update",
  "upsert"
]);

const SPECIAL_COLUMNS = new Set(["*", "rownum"]);

const VALUE_COMPARISON_OPERATORS = new Set([
  "=",
  "!=",
  "<>",
  ">",
  ">=",
  "<",
  "<=",
  "LIKE",
  "NOT LIKE"
]);

const LIST_COMPARISON_OPERATORS = new Set(["IN", "NOT IN"]);

const offsetToLineColumn = (text: string, offset: number) => {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;

  for (let i = 0; i < safeOffset; i++) {
    if (text[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }

  return { line, column };
};

const makeIssue = (
  sql: string,
  severity: SuiteQLLintSeverity,
  code: string,
  message: string,
  start: number,
  end = start + 1
): SuiteQLLintIssue => {
  const position = offsetToLineColumn(sql, start);
  return {
    severity,
    code,
    message,
    start,
    end,
    line: position.line,
    column: position.column
  };
};

const uniqueIssues = (issues: SuiteQLLintIssue[]) => {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.code}:${issue.message}:${issue.line}:${issue.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeErrorText = (rawError: unknown) => {
  if (rawError === null || rawError === undefined) return "";
  if (typeof rawError === "string") return rawError;
  if (rawError instanceof Error) return rawError.message;

  try {
    const maybeMessage = (rawError as { message?: unknown }).message;
    if (typeof maybeMessage === "string") return maybeMessage;
    if (maybeMessage !== undefined) return JSON.stringify(maybeMessage);
    return JSON.stringify(rawError);
  } catch {
    return String(rawError);
  }
};

const maskStringsAndComments = (sql: string) => {
  const chars = sql.split("");
  const issues: SuiteQLLintIssue[] = [];
  let state: "normal" | "single" | "double" | "lineComment" | "blockComment" =
    "normal";
  let stateStart = 0;

  for (let i = 0; i < chars.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (state === "normal") {
      if (ch === "'") {
        chars[i] = " ";
        state = "single";
        stateStart = i;
      } else if (ch === '"') {
        chars[i] = " ";
        state = "double";
        stateStart = i;
      } else if (ch === "-" && next === "-") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i++;
        state = "lineComment";
        stateStart = i - 1;
      } else if (ch === "/" && next === "*") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i++;
        state = "blockComment";
        stateStart = i - 1;
      }
      continue;
    }

    if (state === "lineComment") {
      if (ch === "\n") {
        state = "normal";
      } else {
        chars[i] = " ";
      }
      continue;
    }

    if (state === "blockComment") {
      if (ch === "*" && next === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i++;
        state = "normal";
      } else if (ch !== "\n") {
        chars[i] = " ";
      }
      continue;
    }

    if (state === "single") {
      chars[i] = ch === "\n" ? "\n" : " ";
      if (ch === "'") {
        if (next === "'") {
          chars[i + 1] = " ";
          i++;
        } else {
          state = "normal";
        }
      }
      continue;
    }

    if (state === "double") {
      chars[i] = ch === "\n" ? "\n" : " ";
      if (ch === '"') {
        if (next === '"') {
          chars[i + 1] = " ";
          i++;
        } else {
          state = "normal";
        }
      }
    }
  }

  if (state === "single") {
    issues.push(
      makeIssue(sql, "error", "UNCLOSED_STRING", "Unclosed string literal.", stateStart, sql.length)
    );
  } else if (state === "double") {
    issues.push(
      makeIssue(sql, "error", "UNCLOSED_IDENTIFIER", "Unclosed quoted identifier.", stateStart, sql.length)
    );
  } else if (state === "blockComment") {
    issues.push(
      makeIssue(sql, "error", "UNCLOSED_COMMENT", "Unclosed block comment.", stateStart, sql.length)
    );
  }

  return { masked: chars.join(""), issues };
};

const identifierToString = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  if (typeof record.value === "string") return record.value;
  if (record.expr) return identifierToString(record.expr);
  if (Array.isArray(value)) {
    return value.map(identifierToString).filter(Boolean).join(".");
  }

  return null;
};

const functionNameToString = (node: Record<string, unknown>) => {
  const rawName = node.name;
  if (typeof rawName === "string") return rawName;
  if (!rawName || typeof rawName !== "object") return "";

  const nameObj = rawName as Record<string, unknown>;
  const schema = identifierToString(nameObj.schema);
  const nameParts = Array.isArray(nameObj.name)
    ? nameObj.name.map(identifierToString).filter(Boolean)
    : [identifierToString(nameObj.name)].filter(Boolean);

  return [schema, ...nameParts].filter(Boolean).join(".");
};

const walkAst = (node: unknown, visit: (node: Record<string, unknown>) => void) => {
  const seen = new WeakSet<object>();

  const walk = (current: unknown) => {
    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }

    const record = current as Record<string, unknown>;
    visit(record);
    Object.values(record).forEach(walk);
  };

  walk(node);
};

const indexOfRegex = (sql: string, regex: RegExp) => {
  const match = regex.exec(sql);
  return match?.index ?? 0;
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const addRegexIssues = (
  sql: string,
  masked: string,
  regex: RegExp,
  code: string,
  message: string,
  severity: SuiteQLLintSeverity = "error"
) => {
  const issues: SuiteQLLintIssue[] = [];
  for (const match of masked.matchAll(regex)) {
    if (match.index === undefined) continue;
    issues.push(
      makeIssue(
        sql,
        severity,
        code,
        message,
        match.index,
        match.index + match[0].length
      )
    );
  }
  return issues;
};

const columnRefKey = (ref: ColumnRef) =>
  [ref.table, ref.column].filter(Boolean).join(".").toLowerCase();

const expressionKey = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return `${typeof value}:${String(value).toLowerCase()}`;
  if (Array.isArray(value)) return `[${value.map(expressionKey).join(",")}]`;

  const node = value as Record<string, unknown>;
  const type = typeof node.type === "string" ? node.type.toLowerCase() : "";

  if (type === "column_ref") {
    const table = identifierToString(node.table);
    const column = identifierToString(node.column);
    return `column:${[table, column].filter(Boolean).join(".").toLowerCase()}`;
  }

  if (type === "star") return "star:*";

  if (type === "aggr_func") {
    return `aggregate:${String(node.name ?? "").toLowerCase()}(${expressionKey(node.args)})`;
  }

  if (type === "function") {
    return `function:${functionNameToString(node).toLowerCase()}(${expressionKey(node.args)})`;
  }

  if (type === "binary_expr") {
    return `binary:${expressionKey(node.left)}:${String(node.operator ?? "").toLowerCase()}:${expressionKey(node.right)}`;
  }

  const normalizedEntries = Object.entries(node)
    .filter(([key]) => !["as", "collate", "loc", "parentheses"].includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${key}:${expressionKey(child)}`);

  return `{${normalizedEntries.join(",")}}`;
};

const isStarExpression = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  return (
    (node.type === "star" && node.value === "*") ||
    (node.type === "column_ref" && identifierToString(node.column) === "*")
  );
};

const containsAggregateFunction = (value: unknown): boolean => {
  let found = false;
  walkAst(value, (node) => {
    if (node.type === "aggr_func") found = true;
  });
  return found;
};

const containsNestedAggregateFunction = (value: unknown): boolean => {
  let found = false;
  const seen = new WeakSet<object>();

  const visit = (current: unknown, aggregateDepth: number) => {
    if (!current || typeof current !== "object" || found) return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((child) => visit(child, aggregateDepth));
      return;
    }

    const node = current as Record<string, unknown>;
    const nextDepth = node.type === "aggr_func" ? aggregateDepth + 1 : aggregateDepth;
    if (nextDepth > 1) {
      found = true;
      return;
    }

    Object.values(node).forEach((child) => visit(child, nextDepth));
  };

  visit(value, 0);
  return found;
};

const collectNonAggregateColumnRefs = (value: unknown): ColumnRef[] => {
  const refs: ColumnRef[] = [];
  const seen = new WeakSet<object>();

  const visit = (current: unknown, insideAggregate: boolean) => {
    if (!current || typeof current !== "object") return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((child) => visit(child, insideAggregate));
      return;
    }

    const node = current as Record<string, unknown>;
    const nextInsideAggregate = insideAggregate || node.type === "aggr_func";

    if (!nextInsideAggregate && node.type === "column_ref") {
      const table = identifierToString(node.table);
      const column = identifierToString(node.column);
      if (column && column !== "*") refs.push({ table, column });
    }

    if (node.type === "aggr_func") return;
    Object.values(node).forEach((child) => visit(child, nextInsideAggregate));
  };

  visit(value, false);
  return refs;
};

const findExpressionStart = (sql: string, expr: unknown) => {
  if (!expr || typeof expr !== "object") return 0;
  const node = expr as Record<string, unknown>;

  if (isStarExpression(expr)) return indexOfRegex(sql, /\*/);

  if (node.type === "column_ref") {
    const table = identifierToString(node.table);
    const column = identifierToString(node.column);
    const pattern = table
      ? new RegExp(`\\b${escapeRegex(table)}\\s*\\.\\s*${escapeRegex(column ?? "")}\\b`, "i")
      : new RegExp(`\\b${escapeRegex(column ?? "")}\\b`, "i");
    return indexOfRegex(sql, pattern);
  }

  const firstRef = collectNonAggregateColumnRefs(expr)[0];
  if (firstRef) {
    const pattern = firstRef.table
      ? new RegExp(`\\b${escapeRegex(firstRef.table)}\\s*\\.\\s*${escapeRegex(firstRef.column)}\\b`, "i")
      : new RegExp(`\\b${escapeRegex(firstRef.column)}\\b`, "i");
    return indexOfRegex(sql, pattern);
  }

  return 0;
};

const describeColumnRefs = (refs: ColumnRef[]) => {
  const labels = refs.map((ref) => [ref.table, ref.column].filter(Boolean).join("."));
  return [...new Set(labels)].join(", ");
};

const columnRefFromNode = (value: unknown): ColumnRef | null => {
  if (!value || typeof value !== "object") return null;
  const node = value as Record<string, unknown>;
  if (node.type !== "column_ref") return null;

  const column = identifierToString(node.column);
  if (!column || column === "*") return null;

  return {
    table: identifierToString(node.table),
    column
  };
};

const isPlainUnqualifiedIdentifier = (ref: ColumnRef) =>
  !ref.table && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(ref.column);

const getReferencedTable = (context: SuiteQLAnalysisContext, ref: ColumnRef) =>
  ref.table ? context.aliasToTable.get(ref.table.toLowerCase()) ?? null : null;

const knownFieldTables = (context: SuiteQLAnalysisContext, ref: ColumnRef) => {
  const columnLower = ref.column.toLowerCase();
  const table = getReferencedTable(context, ref);

  if (table) {
    return context.schema.fieldsByTable.get(table.toLowerCase())?.has(columnLower)
      ? [table]
      : [];
  }

  return context.tableSources
    .filter((source) => !source.isCte)
    .filter((source) =>
      context.schema.fieldsByTable.get(source.table.toLowerCase())?.has(columnLower)
    )
    .map((source) => source.table);
};

const isKnownFieldRef = (context: SuiteQLAnalysisContext, ref: ColumnRef) =>
  knownFieldTables(context, ref).length > 0;

const isUnknownValueIdentifier = (
  context: SuiteQLAnalysisContext,
  ref: ColumnRef
) =>
  isPlainUnqualifiedIdentifier(ref) &&
  !context.aliasToTable.has(ref.column.toLowerCase()) &&
  !isKnownFieldRef(context, ref);

const fieldTypeForRef = (context: SuiteQLAnalysisContext, ref: ColumnRef) => {
  const tables = knownFieldTables(context, ref);
  for (const table of tables) {
    const fieldType = context.schema.fieldTypesByTable
      .get(table.toLowerCase())
      ?.get(ref.column.toLowerCase());
    if (fieldType) return fieldType;
  }
  return "";
};

const isDateLikeField = (context: SuiteQLAnalysisContext, ref: ColumnRef) => {
  const type = fieldTypeForRef(context, ref).toLowerCase();
  if (/\b(date|datetime|timestamp|time)\b/.test(type)) return true;
  return /date|time|period|created|modified|trandate|duedate|closedate|startdate|enddate/i.test(
    ref.column
  );
};

const isDateTimeLikeField = (context: SuiteQLAnalysisContext, ref: ColumnRef) => {
  const type = fieldTypeForRef(context, ref).toLowerCase();
  if (/\b(datetime|timestamp)\b/.test(type)) return true;
  return /createddate|lastmodified|modifieddate|lastmodifieddate|datecreated|time/i.test(
    ref.column
  );
};

const regexIndex = (text: string, regex: RegExp) => {
  const match = regex.exec(text);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length, text: match[0] };
};

const stringLiteralValue = (expr: unknown): string | null => {
  if (!expr || typeof expr !== "object") return null;
  const node = expr as Record<string, unknown>;
  if (
    node.type === "single_quote_string" ||
    node.type === "string" ||
    node.type === "double_quote_string"
  ) {
    return typeof node.value === "string" ? node.value : null;
  }
  return null;
};

const isDateOnlyText = (text: string) =>
  /^(?:\d{8}|\d{6}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}-[A-Za-z]{3,9}-\d{2,4}|[A-Za-z]{3,9}-\d{1,2}-\d{2,4})$/.test(
    text.trim()
  );

const dateOnlyLiteralTextFromExpression = (expr: unknown): string | null => {
  const literal = stringLiteralValue(expr);
  if (literal && isDateOnlyText(literal)) return literal;

  if (!expr || typeof expr !== "object") return null;
  const node = expr as Record<string, unknown>;
  if (node.type !== "function") return null;

  const functionName = functionNameToString(node).toUpperCase();
  if (!["TO_DATE", "TO_TIMESTAMP"].includes(functionName)) return null;

  const args = (node.args as Record<string, unknown> | undefined)?.value;
  if (!Array.isArray(args)) return null;

  const firstLiteral = stringLiteralValue(args[0]);
  return firstLiteral && isDateOnlyText(firstLiteral) ? firstLiteral : null;
};

const findLiteralStart = (sql: string, literal: string, fallbackExpr: unknown) => {
  const escaped = escapeRegex(literal);
  const quoted = regexIndex(sql, new RegExp(`'${escaped}'`, "i"));
  if (quoted) return quoted.start + 1;

  const bare = regexIndex(sql, new RegExp(`\\b${escaped}\\b`, "i"));
  return bare?.start ?? findExpressionStart(sql, fallbackExpr);
};

const flattenNumberChain = (
  value: unknown,
  operator: string
): number[] | null => {
  if (!value || typeof value !== "object") return null;
  const node = value as Record<string, unknown>;
  if (node.type === "number" && typeof node.value === "number") return [node.value];
  if (node.type !== "binary_expr" || node.operator !== operator) return null;

  const left = flattenNumberChain(node.left, operator);
  const right = flattenNumberChain(node.right, operator);
  if (!left || !right) return null;
  return [...left, ...right];
};

const nearestDateToken = (sql: string, maskedSql: string, expr: unknown) => {
  const anchor = findExpressionStart(sql, expr);
  const pattern =
    /\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}-[A-Za-z]{3,9}-\d{2,4}|[A-Za-z]{3,9}-\d{1,2}-\d{2,4})\b/g;
  const matches = [...maskedSql.matchAll(pattern)]
    .filter((match) => match.index !== undefined)
    .map((match) => ({
      start: match.index as number,
      end: (match.index as number) + match[0].length,
      text: sql.slice(match.index as number, (match.index as number) + match[0].length)
    }));
  if (matches.length === 0) return null;

  return matches.sort((left, right) => {
    const leftDistance =
      anchor >= left.start && anchor <= left.end
        ? 0
        : Math.min(Math.abs(anchor - left.start), Math.abs(anchor - left.end));
    const rightDistance =
      anchor >= right.start && anchor <= right.end
        ? 0
        : Math.min(Math.abs(anchor - right.start), Math.abs(anchor - right.end));
    return leftDistance - rightDistance;
  })[0];
};

const inferDateFormatMask = (text: string) => {
  if (/^\d{8}$/.test(text)) return "YYYYMMDD";
  if (/^\d{6}$/.test(text)) return "YYMMDD";
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) return "YYYY-MM-DD";
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text)) return "YYYY/MM/DD";
  if (/^\d{1,2}-[A-Za-z]{3,9}-\d{2,4}$/.test(text)) {
    const parts = text.split("-");
    const month = (parts[1]?.length ?? 0) > 3 ? "MONTH" : "MON";
    return parts[2]?.length === 2 ? `DD-${month}-YY` : `DD-${month}-YYYY`;
  }
  if (/^[A-Za-z]{3,9}-\d{1,2}-\d{2,4}$/.test(text)) {
    const parts = text.split("-");
    const month = (parts[0]?.length ?? 0) > 3 ? "MONTH" : "MON";
    return parts[2]?.length === 2 ? `${month}-DD-YY` : `${month}-DD-YYYY`;
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(text)) {
    const parts = text.split("/");
    const year = parts[2]?.length === 2 ? "YY" : "YYYY";
    return `${Number(parts[0]) > 12 ? "DD/MM" : "MM/DD"}/${year}`;
  }
  return "<matching format mask>";
};

const dateLikeExpressionInfo = (sql: string, maskedSql: string, expr: unknown) => {
  if (!expr || typeof expr !== "object") return null;
  const node = expr as Record<string, unknown>;

  for (const operator of ["-", "/"]) {
    const parts = flattenNumberChain(expr, operator);
    if (!parts || parts.length !== 3) continue;

    const separator = operator === "-" ? "-" : "/";
    const partPatterns = parts.map((part) => `0*${String(part)}`);
    const pattern = new RegExp(
      `\\b${partPatterns.join(`\\s*\\${separator}\\s*`)}\\b`
    );
    const match = regexIndex(sql, pattern);
    return {
      start: match?.start ?? findExpressionStart(sql, expr),
      end: match?.end ?? findExpressionStart(sql, expr) + 1,
      text: match?.text ?? parts.join(separator)
    };
  }

  if (node.type === "number" && typeof node.value === "number") {
    const text = String(node.value);
    if (/^\d{6}(\d{2})?$/.test(text)) {
      const match = regexIndex(sql, new RegExp(`\\b${text}\\b`));
      return {
        start: match?.start ?? findExpressionStart(sql, expr),
        end: match?.end ?? findExpressionStart(sql, expr) + text.length,
        text
      };
    }
  }

  const nearest = nearestDateToken(sql, maskedSql, expr);
  if (nearest) return nearest;

  return null;
};

const collectUnquotedLiteralNames = (context: SuiteQLAnalysisContext) => {
  const names = new Set<string>();

  const inspectValue = (field: ColumnRef | null, value: unknown) => {
    if (!field || !isKnownFieldRef(context, field)) return;
    const ref = columnRefFromNode(value);
    if (ref && isUnknownValueIdentifier(context, ref)) {
      names.add(ref.column.toLowerCase());
      return;
    }

    const dateInfo = dateLikeExpressionInfo(context.sql, context.maskedSql, value);
    const compactDate = dateInfo ? /^\d{6}(\d{2})?$/.test(dateInfo.text) : false;
    if (dateInfo && (!compactDate || isDateLikeField(context, field))) {
      collectNonAggregateColumnRefs(value)
        .filter((valueRef) => isUnknownValueIdentifier(context, valueRef))
        .forEach((valueRef) => names.add(valueRef.column.toLowerCase()));
    }
  };

  for (const statement of context.ast) {
    walkAst(statement, (node) => {
      if (node.type !== "binary_expr") return;
      const operator = String(node.operator ?? "").toUpperCase();

      if (VALUE_COMPARISON_OPERATORS.has(operator)) {
        const left = columnRefFromNode(node.left);
        const right = columnRefFromNode(node.right);
        inspectValue(left, node.right);
        inspectValue(right, node.left);
      } else if (LIST_COMPARISON_OPERATORS.has(operator) || operator === "BETWEEN") {
        const field = columnRefFromNode(node.left);
        const values = (node.right as Record<string, unknown> | undefined)?.value;
        if (field && Array.isArray(values)) values.forEach((value) => inspectValue(field, value));
      }
    });
  }

  return names;
};

const buildAnalysisContext = (
  sql: string,
  schemaContext: SuiteQLSchemaContext = {}
): SuiteQLAnalysisContext & { lexicalIssues: SuiteQLLintIssue[] } => {
  const { masked, issues: lexicalIssues } = maskStringsAndComments(sql);
  let ast: unknown[] = [];
  let parseError: string | null = null;

  try {
    const parsed = parser.astify(sql);
    ast = Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    parseError = normalizeErrorText(error);
  }

  const cteNames = new Set<string>();
  const tableSources: TableSource[] = [];
  const aliasToTable = new Map<string, string>();
  const selectAliases = new Set<string>();
  const columnRefs: ColumnRef[] = [];
  const functionRefs: FunctionRef[] = [];

  for (const statement of ast) {
    walkAst(statement, (node) => {
      if (Array.isArray(node.with)) {
        for (const cte of node.with) {
          const name = identifierToString((cte as Record<string, unknown>).name);
          if (name) cteNames.add(name.toLowerCase());
        }
      }
    });
  }

  for (const statement of ast) {
    walkAst(statement, (node) => {
      if (Array.isArray(node.columns)) {
        for (const column of node.columns) {
          const alias = identifierToString((column as Record<string, unknown>).as);
          if (alias) selectAliases.add(alias.toLowerCase());
        }
      }

      if (Array.isArray(node.from)) {
        for (const rawSource of node.from) {
          const source = rawSource as Record<string, unknown>;
          const table = identifierToString(source.table);
          if (!table) continue;

          const alias = identifierToString(source.as);
          const isCte = cteNames.has(table.toLowerCase());
          tableSources.push({ table, alias, isCte });
          aliasToTable.set(table.toLowerCase(), table);
          if (alias) aliasToTable.set(alias.toLowerCase(), table);
        }
      }

      if (node.type === "column_ref") {
        const table = identifierToString(node.table);
        const column = identifierToString(node.column);
        if (column) columnRefs.push({ table, column });
      }

      if (node.type === "function" || node.type === "aggr_func") {
        const name = functionNameToString(node);
        if (name) functionRefs.push({ name });
      }
    });
  }

  return {
    sql,
    maskedSql: masked,
    ast,
    parseError,
    tableSources,
    aliasToTable,
    cteNames,
    selectAliases,
    columnRefs,
    functionRefs,
    schema: {
      tableIds: new Set((schemaContext.tableIds ?? []).map((id) => id.toLowerCase())),
      fieldsByTable: new Map(
        Object.entries(schemaContext.fieldsByTable ?? {}).map(([table, fields]) => [
          table.toLowerCase(),
          new Set(fields.map((field) => field.toLowerCase()))
        ])
      ),
      fieldTypesByTable: new Map(
        Object.entries(schemaContext.fieldTypesByTable ?? {}).map(([table, fields]) => [
          table.toLowerCase(),
          new Map(
            Object.entries(fields).map(([field, type]) => [
              field.toLowerCase(),
              type.toLowerCase()
            ])
          )
        ])
      )
    },
    lexicalIssues
  };
};

const lexicalCompatibilityRules: SuiteQLRule[] = [
  {
    id: "NO_TOP",
    check: ({ sql, maskedSql }) =>
      addRegexIssues(
        sql,
        maskedSql,
        /\bSELECT\s+TOP\s+\d+\b/gi,
        "NO_TOP",
        "SuiteQL does not support SELECT TOP. Use the editor Limit control or WHERE ROWNUM <= N."
      )
  },
  {
    id: "NO_OFFSET_FETCH",
    check: ({ sql, maskedSql }) =>
      addRegexIssues(
        sql,
        maskedSql,
        /\bOFFSET\b|\bFETCH\s+FIRST\b/gi,
        "NO_OFFSET_FETCH",
        "SuiteQL does not support OFFSET/FETCH pagination. Use ROWNUM or the editor Limit control."
      )
  },
  {
    id: "NO_BACKTICKS",
    check: ({ sql, maskedSql }) =>
      addRegexIssues(
        sql,
        maskedSql,
        /`/g,
        "NO_BACKTICKS",
        "Backtick identifiers are not valid SuiteQL syntax. Use plain identifiers or double quotes."
      )
  },
  {
    id: "NO_SQUARE_BRACKETS",
    check: ({ sql, maskedSql }) =>
      addRegexIssues(
        sql,
        maskedSql,
        /\[[^\]]+\]/g,
        "NO_SQUARE_BRACKETS",
        "Square-bracket identifiers are not valid SuiteQL syntax. Use plain identifiers or double quotes."
      )
  },
  {
    id: "NO_ILIKE",
    check: ({ sql, maskedSql }) =>
      addRegexIssues(
        sql,
        maskedSql,
        /\bILIKE\b/gi,
        "NO_ILIKE",
        "SuiteQL does not support ILIKE. Use LOWER(field) LIKE LOWER('%value%') instead."
      )
  },
  {
    id: "NO_TRAILING_COMMA",
    check: ({ sql, maskedSql }) =>
      addRegexIssues(
        sql,
        maskedSql,
        /,\s*(FROM|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING)\b/gi,
        "NO_TRAILING_COMMA",
        "Remove the trailing comma before the next SQL clause."
      )
  },
  {
    id: "NO_TABLE_ALIAS_AS",
    check: ({ sql, maskedSql }) =>
      addRegexIssues(
        sql,
        maskedSql,
        /\b(?:FROM|JOIN)\s+[A-Za-z_][A-Za-z0-9_$]*\s+AS\s+[A-Za-z_][A-Za-z0-9_$]*/gi,
        "NO_TABLE_ALIAS_AS",
        "SuiteQL does not allow AS before table aliases. Use FROM table alias instead of FROM table AS alias."
      )
  }
];

const astRules: SuiteQLRule[] = [
  {
    id: "PARSE_ERROR",
    check: ({ sql, parseError }) =>
      parseError
        ? [
            makeIssue(
              sql,
              "error",
              "PARSE_ERROR",
              `SQL parser could not parse this query: ${parseError}`,
              0,
              Math.min(sql.length, 1)
            )
          ]
        : []
  },
  {
    id: "ONE_STATEMENT",
    check: ({ sql, ast }) =>
      ast.length > 1
        ? [
            makeIssue(
              sql,
              "error",
              "ONE_STATEMENT",
              "Only one SuiteQL statement can be executed at a time.",
              indexOfRegex(sql, /;/),
              indexOfRegex(sql, /;/) + 1
            )
          ]
        : []
  },
  {
    id: "READ_ONLY_SELECT",
    check: ({ sql, ast }) =>
      ast.flatMap((statement) => {
        const type = String((statement as Record<string, unknown>).type ?? "").toLowerCase();
        if (!type || type === "select") return [];

        const isMutating = MUTATING_STATEMENTS.has(type);
        return [
          makeIssue(
            sql,
            "error",
            isMutating ? "READ_ONLY_SELECT" : "UNSUPPORTED_STATEMENT",
            isMutating
              ? `SuiteQL editor only runs read-only SELECT queries. "${type.toUpperCase()}" is not allowed.`
              : `SuiteQL editor expects a SELECT query. Found "${type.toUpperCase()}" instead.`,
            indexOfRegex(sql, new RegExp(`\\b${type}\\b`, "i")),
            indexOfRegex(sql, new RegExp(`\\b${type}\\b`, "i")) + type.length
          )
        ];
      })
  },
  {
    id: "NO_LIMIT",
    check: ({ sql, ast, maskedSql }) => {
      const hasAstLimit = ast.some((statement) => {
        const limit = (statement as Record<string, unknown>).limit;
        if (!limit) return false;
        const value = (limit as Record<string, unknown>).value;
        return !Array.isArray(value) || value.length > 0;
      });
      if (!hasAstLimit && !/\bLIMIT\b/i.test(maskedSql)) return [];

      return [
        makeIssue(
          sql,
          "error",
          "NO_LIMIT",
          "SuiteQL does not support LIMIT. Use the editor Limit control or add WHERE ROWNUM <= N.",
          indexOfRegex(sql, /\bLIMIT\b/i),
          indexOfRegex(sql, /\bLIMIT\b/i) + "LIMIT".length
        )
      ];
    }
  },
  {
    id: "NO_PARAMETER_MARKERS",
    check: ({ sql, maskedSql, ast }) => {
      let hasParameter = /\?/.test(maskedSql);
      if (!hasParameter) {
        walkAst(ast, (node) => {
          if (node.type === "origin" && node.value === "?") hasParameter = true;
        });
      }
      if (!hasParameter) return [];
      return [
        makeIssue(
          sql,
          "error",
          "NO_PARAMETER_MARKERS",
          "The SuiteQL editor does not bind ? parameters. Inline literal values before running.",
          indexOfRegex(maskedSql, /\?/),
          indexOfRegex(maskedSql, /\?/) + 1
        )
      ];
    }
  },
  {
    id: "NO_UNKNOWN_BUILTIN",
    check: ({ sql, functionRefs }) =>
      functionRefs
        .filter((fn) => fn.name.toUpperCase() === "BUILTIN.OF")
        .map(() =>
          makeIssue(
            sql,
            "error",
            "NO_UNKNOWN_BUILTIN",
            "BUILTIN.OF is not a known SuiteQL function. If you wanted display text, use BUILTIN.DF(field).",
            indexOfRegex(sql, /\bBUILTIN\.OF\b/i),
            indexOfRegex(sql, /\bBUILTIN\.OF\b/i) + "BUILTIN.OF".length
          )
        )
  },
  {
    id: "UNQUOTED_COMPARISON_LITERALS",
    check: (context) => {
      const { sql } = context;
      const issues: SuiteQLLintIssue[] = [];

      const makeTextIssue = (field: ColumnRef, value: ColumnRef, expr: unknown) => {
        const start = findExpressionStart(sql, expr);
        const fieldName = [field.table, field.column].filter(Boolean).join(".");
        issues.push(
          makeIssue(
            sql,
            "error",
            "UNQUOTED_TEXT_LITERAL",
            `"${value.column}" is being parsed as a field name. If you meant the value ${value.column}, wrap it in single quotes: ${fieldName} = '${value.column}'.`,
            start,
            start + value.column.length
          )
        );
      };

      const makeDateIssue = (field: ColumnRef, expr: unknown) => {
        const info = dateLikeExpressionInfo(sql, context.maskedSql, expr);
        if (!info) return;

        const compactDate = /^\d{6}(\d{2})?$/.test(info.text);
        if (compactDate && !isDateLikeField(context, field)) return;

        issues.push(
          makeIssue(
            sql,
            "error",
            "UNQUOTED_DATE_LITERAL",
            `Date value ${info.text} is unquoted. SuiteQL parses that as arithmetic, not as a date. Use a date function such as TO_DATE('${info.text}', '${inferDateFormatMask(info.text)}').`,
            info.start,
            info.end
          )
        );
      };

      const inspectValue = (field: ColumnRef | null, value: unknown) => {
        if (!field || !isKnownFieldRef(context, field)) return;

        const valueRef = columnRefFromNode(value);
        if (valueRef && isUnknownValueIdentifier(context, valueRef)) {
          makeTextIssue(field, valueRef, value);
          return;
        }

        makeDateIssue(field, value);
      };

      for (const statement of context.ast) {
        walkAst(statement, (node) => {
          if (node.type !== "binary_expr") return;

          const operator = String(node.operator ?? "").toUpperCase();
          if (VALUE_COMPARISON_OPERATORS.has(operator)) {
            const left = columnRefFromNode(node.left);
            const right = columnRefFromNode(node.right);

            inspectValue(left, node.right);
            inspectValue(right, node.left);
          } else if (
            LIST_COMPARISON_OPERATORS.has(operator) ||
            operator === "BETWEEN"
          ) {
            const field = columnRefFromNode(node.left);
            const values = (node.right as Record<string, unknown> | undefined)?.value;
            if (Array.isArray(values)) {
              values.forEach((value) => inspectValue(field, value));
            }
          }
        });
      }

      return issues;
    }
  },
  {
    id: "DATETIME_DATE_EQUALITY",
    check: (context) => {
      const { sql } = context;
      const issues: SuiteQLLintIssue[] = [];

      const inspectEquality = (field: ColumnRef | null, expr: unknown) => {
        if (!field || !isKnownFieldRef(context, field)) return;
        if (!isDateTimeLikeField(context, field)) return;

        const literal = dateOnlyLiteralTextFromExpression(expr);
        if (!literal) return;

        const fieldName = [field.table, field.column].filter(Boolean).join(".");
        const mask = inferDateFormatMask(literal);
        const start = findLiteralStart(sql, literal, expr);
        issues.push(
          makeIssue(
            sql,
            "warning",
            "DATETIME_DATE_EQUALITY",
            `${fieldName} looks like a datetime/timestamp field. Equality to date-only value '${literal}' only matches rows exactly at midnight. Prefer ${fieldName} >= TO_DATE('${literal}', '${mask}') and ${fieldName} < TO_DATE('<next day>', '${mask}'), or compare TRUNC(${fieldName}) to TO_DATE('${literal}', '${mask}').`,
            start,
            start + literal.length
          )
        );
      };

      for (const statement of context.ast) {
        walkAst(statement, (node) => {
          if (node.type !== "binary_expr" || node.operator !== "=") return;

          inspectEquality(columnRefFromNode(node.left), node.right);
          inspectEquality(columnRefFromNode(node.right), node.left);
        });
      }

      return issues;
    }
  },
  {
    id: "AGGREGATE_QUERY_REFERENCES",
    check: ({ sql, ast }) =>
      ast.flatMap((statement) => {
        const selectStatement = statement as Record<string, unknown>;
        if (String(selectStatement.type ?? "").toLowerCase() !== "select") return [];

        const groupBy = selectStatement.groupby as Record<string, unknown> | null;
        const groupExpressions = Array.isArray(groupBy?.columns)
          ? groupBy.columns
          : [];

        const selectColumns = Array.isArray(selectStatement.columns)
          ? selectStatement.columns
          : [];
        const selectExpressions = selectColumns.map((column) =>
          (column as Record<string, unknown>).expr ?? column
        );
        const orderByExpressions = Array.isArray(selectStatement.orderby)
          ? selectStatement.orderby.map((rawOrderBy) => {
              const orderBy = rawOrderBy as Record<string, unknown>;
              return orderBy.expr ?? rawOrderBy;
            })
          : [];
        const havingExpression = selectStatement.having
          ? [selectStatement.having]
          : [];
        const whereExpression = selectStatement.where
          ? [selectStatement.where]
          : [];
        const localSelectAliases = new Set(
          selectColumns
            .map((column) => identifierToString((column as Record<string, unknown>).as))
            .filter((alias): alias is string => Boolean(alias))
            .map((alias) => alias.toLowerCase())
        );
        const groupExpressionKeys = new Set(groupExpressions.map(expressionKey));
        const groupColumnKeys = new Set(
          groupExpressions
            .flatMap((expr) => collectNonAggregateColumnRefs(expr))
            .map(columnRefKey)
        );
        const groupByColumns = describeColumnRefs(
          groupExpressions.flatMap((expr) => collectNonAggregateColumnRefs(expr))
        );

        const selectedExpressionKeys = new Set(selectExpressions.map(expressionKey));
        const hasPostWhereAggregate = [
          ...selectExpressions,
          ...havingExpression,
          ...orderByExpressions
        ].some(containsAggregateFunction);
        const isGroupedQuery = groupExpressions.length > 0;
        const isAggregateQuery = isGroupedQuery || hasPostWhereAggregate;

        const makeMissingGroupIssue = (
          code: string,
          clause: string,
          expr: unknown,
          refs: ColumnRef[]
        ) => {
          const missingLabel = describeColumnRefs(refs);
          const start = findExpressionStart(sql, expr);
          const groupContext = groupByColumns
            ? `groups by ${groupByColumns}`
            : "has no GROUP BY fields";
          return makeIssue(
            sql,
            "error",
            code,
            `${clause} references ${missingLabel}, but this aggregate query ${groupContext}. Fields used outside aggregate functions must be present in GROUP BY or wrapped in an aggregate function.`,
            start,
            start + Math.max(1, missingLabel.length)
          );
        };

        const checkGroupedExpression = (
          code: string,
          clause: string,
          expr: unknown,
          options: { allowSelectAliases?: boolean } = {}
        ) => {
          if (groupExpressionKeys.has(expressionKey(expr))) return [];

          const missingColumns = collectNonAggregateColumnRefs(expr).filter((ref) => {
            if (
              options.allowSelectAliases &&
              !ref.table &&
              localSelectAliases.has(ref.column.toLowerCase())
            ) {
              return false;
            }
            return !groupColumnKeys.has(columnRefKey(ref));
          });

          if (missingColumns.length === 0) return [];
          return [makeMissingGroupIssue(code, clause, expr, missingColumns)];
        };

        const checkSelectAliasMisuse = (
          clause: string,
          code: string,
          expressions: unknown[]
        ) =>
          expressions.flatMap((expr) =>
            collectNonAggregateColumnRefs(expr)
              .filter(
                (ref) =>
                  !ref.table && localSelectAliases.has(ref.column.toLowerCase())
              )
              .map((ref) => {
                const start = findExpressionStart(sql, expr);
                return makeIssue(
                  sql,
                  "error",
                  code,
                  `${clause} references select-list alias "${ref.column}". Oracle/SuiteQL aliases can be used in ORDER BY, but not in ${clause}. Repeat the original expression or move this query into a subquery.`,
                  start,
                  start + ref.column.length
                );
              })
          );

        const placementIssues = [
          ...whereExpression.flatMap((expr) =>
            containsAggregateFunction(expr)
              ? [
                  makeIssue(
                    sql,
                    "error",
                    "AGGREGATE_IN_WHERE",
                    "WHERE is evaluated before grouping, so it cannot contain aggregate functions. Move aggregate filters to HAVING.",
                    findExpressionStart(sql, expr),
                    findExpressionStart(sql, expr) + 1
                  )
                ]
              : []
          ),
          ...groupExpressions.flatMap((expr) =>
            containsAggregateFunction(expr)
              ? [
                  makeIssue(
                    sql,
                    "error",
                    "AGGREGATE_IN_GROUP_BY",
                    "GROUP BY defines the groups, so it cannot contain aggregate functions such as COUNT, SUM, MIN, MAX, or AVG.",
                    findExpressionStart(sql, expr),
                    findExpressionStart(sql, expr) + 1
                  )
                ]
              : []
          ),
          ...[...selectExpressions, ...havingExpression, ...orderByExpressions].flatMap((expr) =>
            containsNestedAggregateFunction(expr)
              ? [
                  makeIssue(
                    sql,
                    "error",
                    "NESTED_AGGREGATE",
                    "Aggregate functions cannot be nested directly. Put the inner aggregate in a subquery, then aggregate the outer result.",
                    findExpressionStart(sql, expr),
                    findExpressionStart(sql, expr) + 1
                  )
                ]
              : []
          ),
          ...checkSelectAliasMisuse("WHERE", "SELECT_ALIAS_IN_WHERE", whereExpression),
          ...checkSelectAliasMisuse("GROUP BY", "SELECT_ALIAS_IN_GROUP_BY", groupExpressions),
          ...checkSelectAliasMisuse("HAVING", "SELECT_ALIAS_IN_HAVING", havingExpression)
        ];

        const distinctOrderByIssues =
          selectStatement.distinct && orderByExpressions.length > 0
            ? orderByExpressions.flatMap((expr) => {
                const refs = collectNonAggregateColumnRefs(expr);
                const firstRef = refs[0];
                const isAllowedAlias =
                  refs.length === 1 &&
                  firstRef !== undefined &&
                  !firstRef.table &&
                  localSelectAliases.has(firstRef.column.toLowerCase());
                const isOrdinal =
                  typeof (expr as Record<string, unknown>)?.type === "string" &&
                  (expr as Record<string, unknown>).type === "number";
                if (
                  selectedExpressionKeys.has(expressionKey(expr)) ||
                  isAllowedAlias ||
                  isOrdinal
                ) {
                  return [];
                }

                return [
                  makeIssue(
                    sql,
                    "error",
                    "DISTINCT_ORDER_BY_NOT_SELECTED",
                    "ORDER BY expressions in a SELECT DISTINCT query must also appear in the SELECT list.",
                    findExpressionStart(sql, expr),
                    findExpressionStart(sql, expr) + 1
                  )
                ];
              })
            : [];

        if (!isAggregateQuery) {
          return [...placementIssues, ...distinctOrderByIssues];
        }

        const selectIssues = selectColumns.flatMap((rawColumn) => {
          const selectColumn = rawColumn as Record<string, unknown>;
          const expr = selectColumn.expr ?? rawColumn;
          const start = findExpressionStart(sql, expr);

          if (isStarExpression(expr)) {
            return [
              makeIssue(
                sql,
                "error",
                "GROUP_BY_SELECT_STAR",
                isGroupedQuery
                  ? `SELECT * is invalid with GROUP BY. The query groups by ${groupByColumns || "specific expression(s)"}, but * expands to every other field too; those fields are neither grouped nor aggregated. Select only grouped columns and aggregate functions, for example ${groupByColumns || "the grouped field"}, COUNT(*).`
                  : "SELECT * is invalid with aggregate functions unless every selected value is grouped or aggregated. Select aggregate functions only, or add the non-aggregate fields to GROUP BY.",
                start,
                start + 1
              )
            ];
          }

          return checkGroupedExpression(
            "GROUP_BY_NON_GROUPED_COLUMN",
            "SELECT",
            expr
          );
        });

        const havingIssues = selectStatement.having
          ? checkGroupedExpression(
              "GROUP_BY_HAVING_COLUMN",
              "HAVING",
              selectStatement.having
            )
          : [];
        const orderByIssues = Array.isArray(selectStatement.orderby)
          ? selectStatement.orderby.flatMap((rawOrderBy) => {
              const orderBy = rawOrderBy as Record<string, unknown>;
              return checkGroupedExpression(
                "GROUP_BY_ORDER_BY_COLUMN",
                "ORDER BY",
                orderBy.expr ?? rawOrderBy,
                { allowSelectAliases: true }
              );
            })
          : [];

        return [
          ...selectIssues,
          ...havingIssues,
          ...orderByIssues,
          ...placementIssues,
          ...distinctOrderByIssues
        ];
      })
  }
];

const metadataRules: SuiteQLRule[] = [
  {
    id: "UNKNOWN_TABLE",
    check: ({ sql, schema, tableSources }) => {
      if (schema.tableIds.size === 0) return [];
      return tableSources
        .filter((source) => !source.isCte)
        .filter((source) => !schema.tableIds.has(source.table.toLowerCase()))
        .map((source) =>
          makeIssue(
            sql,
            "error",
            "UNKNOWN_TABLE",
            `Unknown SuiteQL table "${source.table}". Check the exact table ID in the Tables tab.`,
            indexOfRegex(sql, new RegExp(`\\b${escapeRegex(source.table)}\\b`, "i")),
            indexOfRegex(sql, new RegExp(`\\b${escapeRegex(source.table)}\\b`, "i")) + source.table.length
          )
        );
    }
  },
  {
    id: "UNKNOWN_ALIAS_OR_FIELD",
    check: (context) => {
      const { sql, schema, tableSources, aliasToTable, selectAliases, columnRefs } = context;
      if (schema.fieldsByTable.size === 0) return [];

      const realTables = tableSources.filter((source) => !source.isCte);
      const unquotedLiteralNames = collectUnquotedLiteralNames(context);
      const issues: SuiteQLLintIssue[] = [];

      for (const ref of columnRefs) {
        const columnLower = ref.column.toLowerCase();
        if (SPECIAL_COLUMNS.has(columnLower)) continue;
        if (!ref.table && selectAliases.has(columnLower)) continue;
        if (!ref.table && unquotedLiteralNames.has(columnLower)) continue;

        if (ref.table) {
          const table = aliasToTable.get(ref.table.toLowerCase());
          if (!table) {
            issues.push(
              makeIssue(
                sql,
                "error",
                "UNKNOWN_ALIAS",
                `Alias "${ref.table}" is referenced in "${ref.table}.${ref.column}" but is not defined in a FROM or JOIN clause.`,
                indexOfRegex(sql, new RegExp(`\\b${escapeRegex(ref.table)}\\.${escapeRegex(ref.column)}\\b`, "i")),
                indexOfRegex(sql, new RegExp(`\\b${escapeRegex(ref.table)}\\.${escapeRegex(ref.column)}\\b`, "i")) + `${ref.table}.${ref.column}`.length
              )
            );
            continue;
          }

          const fields = schema.fieldsByTable.get(table.toLowerCase());
          if (fields && !fields.has(columnLower)) {
            issues.push(
              makeIssue(
                sql,
                "error",
                "UNKNOWN_FIELD",
                `Unknown field "${ref.column}" on table "${table}" from reference "${ref.table}.${ref.column}". Check the Fields tab for the exact field ID.`,
                indexOfRegex(sql, new RegExp(`\\b${escapeRegex(ref.table)}\\.${escapeRegex(ref.column)}\\b`, "i")),
                indexOfRegex(sql, new RegExp(`\\b${escapeRegex(ref.table)}\\.${escapeRegex(ref.column)}\\b`, "i")) + `${ref.table}.${ref.column}`.length
              )
            );
          }
          continue;
        }

        const loadedTables = realTables.filter((source) =>
          schema.fieldsByTable.has(source.table.toLowerCase())
        );
        if (loadedTables.length === 0) continue;

        const matchingTables = loadedTables.filter((source) =>
          schema.fieldsByTable.get(source.table.toLowerCase())?.has(columnLower)
        );

        if (matchingTables.length === 0) {
          issues.push(
            makeIssue(
              sql,
              "error",
              "UNKNOWN_FIELD",
              `Unknown unqualified field "${ref.column}" on the loaded query table(s): ${loadedTables.map((source) => source.table).join(", ")}.`,
              indexOfRegex(sql, new RegExp(`\\b${escapeRegex(ref.column)}\\b`, "i")),
              indexOfRegex(sql, new RegExp(`\\b${escapeRegex(ref.column)}\\b`, "i")) + ref.column.length
            )
          );
        } else if (matchingTables.length > 1) {
          issues.push(
            makeIssue(
              sql,
              "warning",
              "AMBIGUOUS_FIELD",
              `Unqualified field "${ref.column}" exists on multiple joined tables (${matchingTables.map((source) => source.table).join(", ")}). Qualify it with a table alias.`,
              indexOfRegex(sql, new RegExp(`\\b${escapeRegex(ref.column)}\\b`, "i")),
              indexOfRegex(sql, new RegExp(`\\b${escapeRegex(ref.column)}\\b`, "i")) + ref.column.length
            )
          );
        }
      }

      return issues;
    }
  },
  {
    id: "METADATA_NOT_LOADED",
    check: ({ sql, schema, tableSources }) => {
      const missing = tableSources
        .filter((source) => !source.isCte)
        .filter((source) => !schema.fieldsByTable.has(source.table.toLowerCase()))
        .map((source) => source.table);

      if (missing.length === 0) return [];
      return [
        makeIssue(
          sql,
          "suggestion",
          "METADATA_NOT_LOADED",
          `Field-level validation was skipped for table(s) without loaded metadata: ${[...new Set(missing)].join(", ")}.`,
          0,
          Math.min(sql.length, 1)
        )
      ];
    }
  }
];

const suiteqlRules: SuiteQLRule[] = [
  ...lexicalCompatibilityRules,
  ...astRules,
  ...metadataRules
];

export const lintSuiteQL = (
  sql: string,
  schemaContext: SuiteQLSchemaContext = {}
): SuiteQLLintResult => {
  const source = sql ?? "";
  const context = buildAnalysisContext(source, schemaContext);
  const issues = [
    ...context.lexicalIssues,
    ...(!context.maskedSql.trim()
      ? [
          makeIssue(
            source,
            "error",
            "EMPTY_QUERY",
            "Enter a SuiteQL query before running it.",
            0,
            0
          )
        ]
      : []),
    ...suiteqlRules.flatMap((rule) => rule.check(context))
  ];

  const sortedIssues = uniqueIssues(issues).sort(
    (a, b) => a.start - b.start || a.code.localeCompare(b.code)
  );
  const errors = sortedIssues.filter((issue) => issue.severity === "error");
  const warnings = sortedIssues.filter((issue) => issue.severity === "warning");
  const suggestions = sortedIssues.filter(
    (issue) => issue.severity === "suggestion"
  );

  return {
    ok: errors.length === 0,
    issues: sortedIssues,
    errors,
    warnings,
    suggestions
  };
};

const formatIssueLine = (issue: SuiteQLLintIssue) =>
  `[${issue.code}] ${issue.line}:${issue.column} ${issue.message}`;

export const formatSuiteQLLintIssues = (issues: SuiteQLLintIssue[]) =>
  issues.map(formatIssueLine).join("\n");

const formatIssueBlock = (label: string, issues: SuiteQLLintIssue[]) => {
  if (issues.length === 0) return "";
  return `${label}:\n${issues.map((issue) => `- ${formatIssueLine(issue)}`).join("\n")}`;
};

export const explainSuiteQLError = (
  sql: string,
  rawError: unknown,
  schemaContext: SuiteQLSchemaContext = {}
) => {
  const errorText = normalizeErrorText(rawError);
  const lintResult = lintSuiteQL(sql, schemaContext);
  const isGenericSearchError =
    /invalid or unsupported search|search error occurred/i.test(errorText);
  const isLocalValidationError = /not sent to NetSuite/i.test(errorText);

  const blocks =
    lintResult.errors.length > 0
      ? [formatIssueBlock("Errors", lintResult.errors)].filter(Boolean)
      : [formatIssueBlock("Warnings", lintResult.warnings)].filter(Boolean);

  const parts: string[] = [];
  if (blocks.length > 0) {
    parts.push(`SuiteQL analysis found known issue(s):\n${blocks.join("\n\n")}`);
  } else if (isGenericSearchError) {
    parts.push(
      "SuiteQL analysis found no known rule violations. NetSuite still rejected the query, so this is likely an unsupported SuiteQL construct outside the current rule set, a permission/feature limitation, or metadata that has not been loaded yet."
    );
  }

  const shouldIncludeRawError =
    errorText &&
    !isLocalValidationError &&
    !(isGenericSearchError && lintResult.errors.length > 0);

  if (shouldIncludeRawError) {
    parts.push(`NetSuite returned:\n${errorText}`);
  }

  return parts.join("\n\n") || "Query execution failed.";
};
