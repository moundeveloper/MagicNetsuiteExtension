export const rowIdentity = (row: Record<string, unknown>, key: string) =>
  JSON.stringify(row[key]);
export function reconcileSelection(
  rows: Record<string, unknown>[],
  value: any,
  key: string,
  multiple: boolean,
) {
  const selected = multiple
    ? Array.isArray(value)
      ? value
      : []
    : value
      ? [value]
      : [];
  const ids = new Set(
    selected.map((r: Record<string, unknown>) => rowIdentity(r, key)),
  );
  const current = rows.filter((row) => ids.has(rowIdentity(row, key)));
  return multiple ? current : (current[0] ?? null);
}
export function formatDashboardCell(
  value: unknown,
  column: Record<string, any>,
): string {
  if (column.labelField && value && typeof value === "object")
    value = (value as Record<string, unknown>)[column.labelField];
  if (value === undefined || value === null) return "—";
  if (column.format === "number" && Number.isFinite(Number(value)))
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: column.digits ?? 2,
    }).format(Number(value));
  if (["date", "datetime"].includes(column.format)) {
    const date = new Date(value as string);
    if (Number.isFinite(date.getTime()))
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        ...(column.format === "datetime"
          ? { timeStyle: "short" as const }
          : {}),
      }).format(date);
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function tableRows(
  rows: Record<string, any>[],
  columns: Record<string, any>[],
  query: string,
  filters: Record<string, string>,
  sortField: string,
  order: string,
) {
  const needle = query.toLowerCase();
  const filtered = rows.filter(
    (row) =>
      (!needle ||
        columns.some((col) =>
          formatDashboardCell(row[col.field], col)
            .toLowerCase()
            .includes(needle),
        )) &&
      Object.entries(filters).every(
        ([field, text]) =>
          !text ||
          String(row[field] ?? "")
            .toLowerCase()
            .includes(text.toLowerCase()),
      ),
  );
  if (!sortField) return filtered;
  return [...filtered].sort((a, b) => {
    const av = a[sortField],
      bv = b[sortField];
    const comparison =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
            numeric: true,
          });
    return order === "desc" ? -comparison : comparison;
  });
}
