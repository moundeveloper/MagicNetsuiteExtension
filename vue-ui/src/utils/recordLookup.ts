export type RecordLookupRow = {
  id: string;
  label: string;
  meta: string;
};

const TRANSACTION_TYPES: Record<string, string> = {
  salesorder: "SalesOrd",
  invoice: "CustInvc",
  purchaseorder: "PurchOrd",
  vendorbill: "VendBill",
  estimate: "Estimate",
  creditmemo: "CustCred",
  journalentry: "Journal",
  itemfulfillment: "ItemShip",
  cashsale: "CashSale"
};

export const SEARCH_ONLY_RECORD_TYPES = new Set(["lead", "prospect"]);

const ENTITY_SUITEQL_TYPES = new Set([
  "customer",
  "contact",
  "vendor",
  "partner"
]);

const escapeSuiteQL = (value: string) => value.replace(/'/g, "''");
const isNumeric = (value: string) => /^\d+$/.test(value.trim());

export const buildRecordLookupQueries = (
  recordType: string,
  searchText: string
) => {
  const cleanType = recordType.replace(/[^a-z0-9_]/gi, "");
  const cleanQuery = searchText.trim();

  if (!cleanType) return [];

  if (TRANSACTION_TYPES[cleanType]) {
    const conditions = [`type = '${TRANSACTION_TYPES[cleanType]}'`];
    if (cleanQuery) {
      const search = escapeSuiteQL(cleanQuery);
      conditions.push(
        isNumeric(cleanQuery)
          ? `(id = ${Number(cleanQuery)} OR LOWER(tranid) LIKE LOWER('%${search}%'))`
          : `LOWER(tranid) LIKE LOWER('%${search}%')`
      );
    }
    return [
      `SELECT id, tranid, BUILTIN.DF(entity) AS entity, trandate FROM transaction WHERE ${conditions.join(" AND ")} ORDER BY id DESC`
    ];
  }

  if (ENTITY_SUITEQL_TYPES.has(cleanType)) {
    const conditions: string[] = [];
    if (cleanQuery) {
      const search = escapeSuiteQL(cleanQuery);
      conditions.push(
        isNumeric(cleanQuery)
          ? `(id = ${Number(cleanQuery)} OR LOWER(entityid) LIKE LOWER('%${search}%') OR LOWER(altname) LIKE LOWER('%${search}%'))`
          : `(LOWER(entityid) LIKE LOWER('%${search}%') OR LOWER(altname) LIKE LOWER('%${search}%'))`
      );
    }
    return [
      `SELECT id, entityid, altname FROM ${cleanType}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY id DESC`
    ];
  }

  if (cleanType === "script") {
    const conditions: string[] = [];
    if (cleanQuery) {
      const search = escapeSuiteQL(cleanQuery);
      conditions.push(
        isNumeric(cleanQuery)
          ? `(id = ${Number(cleanQuery)} OR LOWER(name) LIKE LOWER('%${search}%') OR LOWER(scriptid) LIKE LOWER('%${search}%'))`
          : `(LOWER(name) LIKE LOWER('%${search}%') OR LOWER(scriptid) LIKE LOWER('%${search}%'))`
      );
    }
    return [
      `SELECT id, name, scriptid, scripttype FROM script${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY id DESC`
    ];
  }

  const where = (fields: string[]) => {
    if (!cleanQuery) return "";
    const search = escapeSuiteQL(cleanQuery);
    const matches = fields.map(
      (field) => `LOWER(${field}) LIKE LOWER('%${search}%')`
    );
    if (isNumeric(cleanQuery)) matches.unshift(`id = ${Number(cleanQuery)}`);
    return `WHERE (${matches.join(" OR ")})`;
  };

  return [
    `SELECT id, name FROM ${cleanType} ${where(["name"])} ORDER BY id DESC`,
    `SELECT id, entityid, altname FROM ${cleanType} ${where(["entityid", "altname"])} ORDER BY id DESC`,
    `SELECT id, scriptid, name FROM ${cleanType} ${where(["scriptid", "name"])} ORDER BY id DESC`,
    !cleanQuery
      ? `SELECT id FROM ${cleanType} ORDER BY id DESC`
      : isNumeric(cleanQuery)
        ? `SELECT id FROM ${cleanType} WHERE id = ${Number(cleanQuery)} ORDER BY id DESC`
        : ""
  ].filter(Boolean);
};

export const normalizeRecordLookupRows = (
  payload: unknown
): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload;
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { results?: unknown }).results)
  ) {
    return (payload as { results: Record<string, unknown>[] }).results;
  }
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { rows?: unknown }).rows)
  ) {
    return (payload as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
};

export const normalizeRecordLookupRow = (
  row: Record<string, unknown>
): RecordLookupRow => {
  const id = String(row.id ?? "");
  const label = String(
    row.name ??
      row.companyname ??
      row.altname ??
      row.entityid ??
      row.tranid ??
      row.scriptid ??
      row.displayname ??
      `#${id}`
  ).trim();
  const meta = [
    row.tranid,
    row.entityid,
    row.entity,
    row.trandate,
    row.scriptid,
    row.scripttype,
    row.email
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" · ");
  return { id, label, meta };
};
