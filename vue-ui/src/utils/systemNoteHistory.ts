export type SystemNoteRow = {
  id: number;
  recordId: string;
  recordTypeId: string;
  record: string;
  date: string;
  timestamp: number | null;
  field: string;
  oldValue: string;
  newValue: string;
  changedBy: string;
  role: string;
  context: string;
  type: string;
  lineId: string;
  lineTransactionId: string;
};

export type SystemNoteStream = {
  key: string;
  recordTypeId: string;
  record: string;
  count: number;
};

export type SystemNoteEvent = {
  key: string;
  date: string;
  timestamp: number | null;
  changedBy: string;
  role: string;
  context: string;
  changes: SystemNoteRow[];
};

type ApiLikeResponse = {
  status?: string;
  message?: unknown;
};

const rowsFromResponse = (
  response: ApiLikeResponse
): Record<string, unknown>[] => {
  const message = response?.message;
  const payload =
    typeof message === "string"
      ? (() => {
          try {
            return JSON.parse(message);
          } catch {
            return message;
          }
        })()
      : message;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { results?: unknown[] } | null)?.results)
      ? ((payload as { results: unknown[] }).results ?? [])
      : [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row)
  );
};

const valueFrom = (
  row: Record<string, unknown>,
  ...keys: string[]
): unknown => {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
    const lowerKey = key.toLowerCase();
    const matchedKey = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === lowerKey
    );
    if (matchedKey) return row[matchedKey];
  }
  return undefined;
};

const textFrom = (row: Record<string, unknown>, ...keys: string[]) => {
  const value = valueFrom(row, ...keys);
  return value === null || value === undefined ? "" : String(value);
};

const numberFrom = (row: Record<string, unknown>, ...keys: string[]) => {
  const value = Number(valueFrom(row, ...keys));
  return Number.isFinite(value) ? value : 0;
};

export const parseSystemNoteDate = (value: string): number | null => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const normalizeSystemNoteRows = (
  response: ApiLikeResponse
): SystemNoteRow[] => {
  return rowsFromResponse(response).map((row) => {
      const date = textFrom(row, "date");
      return {
        id: numberFrom(row, "id"),
        recordId: textFrom(row, "recordId"),
        recordTypeId: textFrom(row, "recordTypeId"),
        record: textFrom(row, "record") || "Unnamed record",
        date,
        timestamp: parseSystemNoteDate(date),
        field: textFrom(row, "field") || "Record",
        oldValue: textFrom(row, "oldValue"),
        newValue: textFrom(row, "newValue"),
        changedBy: textFrom(row, "changedBy") || "System",
        role: textFrom(row, "roleName", "role"),
        context: textFrom(row, "context") || "Unknown context",
        type: textFrom(row, "type"),
        lineId: textFrom(row, "lineId"),
        lineTransactionId: textFrom(row, "lineTransactionId")
      };
    });
};

export const buildSystemNoteQuery = (
  recordId: string,
  limit = 1000,
  recordTypeId?: string
): string => {
  const cleanId = recordId.trim();
  if (!/^\d+$/.test(cleanId)) {
    throw new Error("Record internal ID must be a positive number.");
  }
  const cleanRecordTypeId = recordTypeId?.trim();
  if (cleanRecordTypeId && !/^-?\d+$/.test(cleanRecordTypeId)) {
    throw new Error("Invalid NetSuite system-note record stream.");
  }
  const safeLimit = Math.min(5000, Math.max(1, Math.trunc(limit)));
  return `
    SELECT *
    FROM (
      SELECT
        sn.id,
        sn.recordId,
        sn.recordTypeId,
        sn.record,
        sn.date,
        sn.field,
        sn.oldValue,
        sn.newValue,
        BUILTIN.DF(sn.name) AS changedBy,
        BUILTIN.DF(sn.role) AS roleName,
        sn.context,
        sn.type,
        sn.lineId,
        sn.lineTransactionId
      FROM SystemNote sn
      WHERE sn.recordId = ${Number(cleanId)}
        ${cleanRecordTypeId ? `AND sn.recordTypeId = ${Number(cleanRecordTypeId)}` : ""}
      ORDER BY sn.date DESC, sn.id DESC
    )
    WHERE ROWNUM <= ${safeLimit}
    ORDER BY date DESC, id DESC
  `.replace(/\s+/g, " ").trim();
};

export const buildSystemNoteStreamsQuery = (recordId: string): string => {
  const cleanId = recordId.trim();
  if (!/^\d+$/.test(cleanId)) {
    throw new Error("Record internal ID must be a positive number.");
  }
  return `
    SELECT *
    FROM (
      SELECT
        sn.recordTypeId,
        MAX(sn.record) AS record,
        COUNT(*) AS noteCount,
        MAX(sn.date) AS latestDate
      FROM SystemNote sn
      WHERE sn.recordId = ${Number(cleanId)}
      GROUP BY sn.recordTypeId
      ORDER BY MAX(sn.date) DESC
    )
    WHERE ROWNUM <= 100
    ORDER BY latestDate DESC
  `.replace(/\s+/g, " ").trim();
};

export const normalizeSystemNoteStreams = (
  response: ApiLikeResponse
): SystemNoteStream[] =>
  rowsFromResponse(response)
    .map((row) => ({
      key: textFrom(row, "recordTypeId"),
      recordTypeId: textFrom(row, "recordTypeId"),
      record: textFrom(row, "record") || "Unnamed record",
      count: numberFrom(row, "noteCount")
    }))
    .filter((stream) => stream.recordTypeId)
    .sort((a, b) => b.count - a.count || a.record.localeCompare(b.record));

export const getSystemNoteStreams = (
  rows: SystemNoteRow[]
): SystemNoteStream[] => {
  const streams = new Map<string, SystemNoteStream>();
  for (const row of rows) {
    const key = row.recordTypeId;
    const current = streams.get(key);
    if (current) current.count += 1;
    else {
      streams.set(key, {
        key,
        recordTypeId: row.recordTypeId,
        record: row.record,
        count: 1
      });
    }
  }
  return [...streams.values()].sort(
    (a, b) => b.count - a.count || a.record.localeCompare(b.record)
  );
};

export const groupSystemNotes = (
  rows: SystemNoteRow[]
): SystemNoteEvent[] => {
  const events = new Map<string, SystemNoteEvent>();
  for (const row of rows) {
    const key = [
      row.date,
      row.changedBy,
      row.role,
      row.context,
      row.recordTypeId
    ].join("::");
    const current = events.get(key);
    if (current) current.changes.push(row);
    else {
      events.set(key, {
        key,
        date: row.date,
        timestamp: row.timestamp,
        changedBy: row.changedBy,
        role: row.role,
        context: row.context,
        changes: [row]
      });
    }
  }
  return [...events.values()].sort((a, b) => {
    if (a.timestamp !== null && b.timestamp !== null) {
      return b.timestamp - a.timestamp;
    }
    return Math.max(...b.changes.map((row) => row.id)) -
      Math.max(...a.changes.map((row) => row.id));
  });
};

export const formatSystemNoteField = (field: string): string => {
  const leaf = field.split(".").pop() || field;
  return leaf
    .replace(/^CUST(?:BODY|ENTITY|ITEM|RECORD|COL|EVENT|JOB|PAGE)_/i, "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
};
