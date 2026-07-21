export type SuiteQLQueryNode = {
  table: string;
  alias: string;
  role: "source" | "join";
};

export type SuiteQLQueryFieldPair = {
  leftAlias: string;
  leftField: string;
  rightAlias: string;
  rightField: string;
};

export type SuiteQLQueryEdge = {
  sourceAlias: string;
  targetAlias: string;
  sourceTable: string;
  targetTable: string;
  joinType: string;
  condition: string;
  fieldPairs: SuiteQLQueryFieldPair[];
  hasCondition: boolean;
};

export type SuiteQLQueryStructure = {
  nodes: SuiteQLQueryNode[];
  edges: SuiteQLQueryEdge[];
};

const RESERVED_ALIAS_WORDS = new Set([
  "cross",
  "full",
  "group",
  "having",
  "inner",
  "join",
  "left",
  "on",
  "order",
  "right",
  "where"
]);

const maskLiteralsAndComments = (sql: string) => {
  let result = "";
  let index = 0;
  while (index < sql.length) {
    if (sql[index] === "'" || sql[index] === '"') {
      const quote = sql[index]!;
      result += " ";
      index++;
      while (index < sql.length) {
        result += sql[index] === "\n" ? "\n" : " ";
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            result += " ";
            index += 2;
            continue;
          }
          index++;
          break;
        }
        index++;
      }
      continue;
    }
    if (sql[index] === "-" && sql[index + 1] === "-") {
      while (index < sql.length && sql[index] !== "\n") {
        result += " ";
        index++;
      }
      continue;
    }
    if (sql[index] === "/" && sql[index + 1] === "*") {
      result += "  ";
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) {
        result += sql[index] === "\n" ? "\n" : " ";
        index++;
      }
      if (index < sql.length) {
        result += "  ";
        index += 2;
      }
      continue;
    }
    result += sql[index];
    index++;
  }
  return result;
};

const normalizeAlias = (alias: string | undefined, table: string) => {
  if (!alias || RESERVED_ALIAS_WORDS.has(alias.toLowerCase())) return table;
  return alias;
};

const parseFieldPairs = (condition: string): SuiteQLQueryFieldPair[] => {
  const pairs: SuiteQLQueryFieldPair[] = [];
  const pairPattern = /\b([a-z_][\w$]*)\.([a-z_][\w$]*)\s*=\s*([a-z_][\w$]*)\.([a-z_][\w$]*)\b/gi;
  for (const match of condition.matchAll(pairPattern)) {
    pairs.push({
      leftAlias: match[1]!,
      leftField: match[2]!,
      rightAlias: match[3]!,
      rightField: match[4]!
    });
  }
  return pairs;
};

export const parseSuiteQLQueryStructure = (
  sql: string
): SuiteQLQueryStructure => {
  const masked = maskLiteralsAndComments(sql ?? "");
  const sourceMatch = /\bFROM\s+([a-z_][\w$]*)(?:\s+(?:AS\s+)?((?!(?:WHERE|JOIN|LEFT|RIGHT|FULL|INNER|CROSS|GROUP|HAVING|ORDER)\b)[a-z_][\w$]*))?/i.exec(masked);
  if (!sourceMatch) return { nodes: [], edges: [] };

  const sourceTable = sourceMatch[1]!;
  const sourceAlias = normalizeAlias(sourceMatch[2], sourceTable);
  const nodes: SuiteQLQueryNode[] = [
    { table: sourceTable, alias: sourceAlias, role: "source" }
  ];
  const aliasToTable = new Map<string, string>([
    [sourceAlias.toLowerCase(), sourceTable]
  ]);
  const edges: SuiteQLQueryEdge[] = [];

  const joinPattern = /\b(?:(LEFT|RIGHT|FULL|INNER|CROSS)(?:\s+OUTER)?\s+)?JOIN\s+([a-z_][\w$]*)(?:\s+(?:AS\s+)?((?!(?:ON|WHERE|JOIN|LEFT|RIGHT|FULL|INNER|CROSS|GROUP|HAVING|ORDER)\b)[a-z_][\w$]*))?(?:\s+ON\s+([\s\S]*?))?(?=\s*(?:\b(?:(?:LEFT|RIGHT|FULL|INNER|CROSS)(?:\s+OUTER)?\s+)?JOIN\b|\bWHERE\b|\bGROUP\s+BY\b|\bHAVING\b|\bORDER\s+BY\b|\bFETCH\b|\bOFFSET\b|$))/gi;

  for (const match of masked.matchAll(joinPattern)) {
    const joinType = (match[1] || "INNER").toUpperCase();
    const targetTable = match[2]!;
    const targetAlias = normalizeAlias(match[3], targetTable);
    const condition = (match[4] ?? "").trim().replace(/\s+/g, " ");
    const fieldPairs = parseFieldPairs(condition);
    const pairWithTarget = fieldPairs.find(
      (pair) =>
        pair.leftAlias.toLowerCase() === targetAlias.toLowerCase() ||
        pair.rightAlias.toLowerCase() === targetAlias.toLowerCase()
    );
    const sourceEdgeAlias = pairWithTarget
      ? pairWithTarget.leftAlias.toLowerCase() === targetAlias.toLowerCase()
        ? pairWithTarget.rightAlias
        : pairWithTarget.leftAlias
      : nodes[nodes.length - 1]!.alias;
    const resolvedSourceTable =
      aliasToTable.get(sourceEdgeAlias.toLowerCase()) ?? nodes[nodes.length - 1]!.table;

    nodes.push({ table: targetTable, alias: targetAlias, role: "join" });
    aliasToTable.set(targetAlias.toLowerCase(), targetTable);
    edges.push({
      sourceAlias: sourceEdgeAlias,
      targetAlias,
      sourceTable: resolvedSourceTable,
      targetTable,
      joinType,
      condition,
      fieldPairs,
      hasCondition: Boolean(condition) || joinType === "CROSS"
    });
  }

  return { nodes, edges };
};
