import { describe, expect, it } from "vitest";
import {
  buildSystemNoteQuery,
  buildSystemNoteStreamsQuery,
  formatSystemNoteField,
  getSystemNoteStreams,
  groupSystemNotes,
  normalizeSystemNoteRows,
  normalizeSystemNoteStreams
} from "./systemNoteHistory";

const response = {
  message: {
    results: [
      {
        id: 12,
        recordid: 315,
        recordtypeid: -105,
        record: "Apr 2023",
        date: "28 May, 2026",
        field: "ACCOUNTINGPERIOD.PCP_LOCK_AP",
        oldvalue: "Unlocked",
        newvalue: "In Progress",
        changedby: "Francesco",
        rolename: "Controller",
        context: null,
        type: 4
      },
      {
        id: 11,
        recordid: 315,
        recordtypeid: 2048,
        record: "315",
        date: "13 May, 2026",
        field: "CUSTRECORD_CTK_STATUS",
        oldvalue: null,
        newvalue: "Complete",
        changedby: "Rosita",
        rolename: "Administrator",
        context: "MPR",
        type: 2
      }
    ]
  }
};

describe("systemNoteHistory", () => {
  it("builds a bounded, newest-first SystemNote query", () => {
    const sql = buildSystemNoteQuery("315", 250, "-105");
    expect(sql).toContain("FROM SystemNote sn");
    expect(sql).toContain("sn.recordId = 315");
    expect(sql).toContain("sn.recordTypeId = -105");
    expect(sql).toContain("ROWNUM <= 250");
    expect(sql).toMatch(/ORDER BY date DESC, id DESC$/);
    expect(() => buildSystemNoteQuery("315 OR 1=1")).toThrow();
    expect(() => buildSystemNoteQuery("315", 250, "x")).toThrow();
    expect(buildSystemNoteStreamsQuery("315")).toContain(
      "GROUP BY sn.recordTypeId"
    );
  });

  it("normalizes NetSuite lowercase mapped-result keys", () => {
    const rows = normalizeSystemNoteRows(response);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 12,
      recordId: "315",
      recordTypeId: "-105",
      changedBy: "Francesco",
      context: "Unknown context"
    });
    expect(rows[1]?.oldValue).toBe("");
  });

  it("separates colliding internal IDs by NetSuite record-type stream", () => {
    const rows = normalizeSystemNoteRows(response);
    expect(
      getSystemNoteStreams(rows)
        .map((stream) => stream.key)
        .sort()
    ).toEqual(["-105", "2048"]);
    expect(
      normalizeSystemNoteStreams({
        message: {
          results: [
            {
              recordtypeid: -105,
              record: "Apr 2023",
              notecount: 9
            }
          ]
        }
      })
    ).toEqual([
      {
        key: "-105",
        recordTypeId: "-105",
        record: "Apr 2023",
        count: 9
      }
    ]);
  });

  it("groups related notes and formats raw field identifiers", () => {
    const rows = normalizeSystemNoteRows(response);
    expect(groupSystemNotes(rows)).toHaveLength(2);
    expect(formatSystemNoteField("CUSTOMER.COMPANY_NAME")).toBe("Company Name");
    expect(formatSystemNoteField("CUSTBODY_APPROVAL_STATUS")).toBe(
      "Approval Status"
    );
  });
});
