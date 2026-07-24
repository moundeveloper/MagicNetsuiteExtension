import { describe, expect, it } from "vitest";
import {
  buildRecordLookupQueries,
  normalizeRecordLookupRow,
  normalizeRecordLookupRows
} from "./recordLookup";

describe("record lookup", () => {
  it("searches script records by internal ID, name, and script ID", () => {
    const [sql] = buildRecordLookupQueries("script", "42");

    expect(sql).toContain("id = 42");
    expect(sql).toContain("LOWER(name)");
    expect(sql).toContain("LOWER(scriptid)");
  });

  it("escapes names before placing them in SuiteQL", () => {
    const [sql] = buildRecordLookupQueries("customer", "O'Reilly");

    expect(sql).toContain("O''Reilly");
    expect(sql).not.toContain("O'Reilly");
  });

  it("does not return an unfiltered ID-only fallback for name searches", () => {
    const queries = buildRecordLookupQueries("customrecord_example", "Alpha");

    expect(queries).toHaveLength(3);
    expect(queries.every((sql) => !/^SELECT id FROM/i.test(sql))).toBe(true);
  });

  it("normalizes wrapped rows into labeled records", () => {
    const rows = normalizeRecordLookupRows({
      results: [{ id: 7, entityid: "ACME", altname: "Acme Ltd" }]
    });

    expect(normalizeRecordLookupRow(rows[0]!)).toEqual({
      id: "7",
      label: "Acme Ltd",
      meta: "ACME"
    });
  });
});
