import { describe, expect, test } from "vitest";
import {
  createSuiteQLTracePlan,
  getSuiteQLTraceMultiplication,
} from "./suiteqlTrace";

describe("createSuiteQLTracePlan", () => {
  test("isolates source filters and builds a cumulative join stage", () => {
    const plan = createSuiteQLTracePlan(`
      SELECT t.id, ts.tranType, t.status, t.type
      FROM transaction t
      INNER JOIN TransactionStatus ts ON t.status = ts.id
      WHERE t.id = 548
        AND t.type = 'CustInvc'
        AND ts.friendlykey = 'paidInFull'
    `);

    expect(plan.stages.map((stage) => stage.kind)).toEqual([
      "source",
      "source",
      "join",
      "final",
    ]);
    expect(plan.stages[0]?.sql).toContain("t.id = 548");
    expect(plan.stages[0]?.sql).toContain("t.type = 'CustInvc'");
    expect(plan.stages[0]?.sql).not.toContain("friendlykey");
    expect(plan.stages[1]?.sql).toContain("ts.friendlykey = 'paidInFull'");
    expect(plan.stages[2]?.sql).toContain("INNER JOIN TransactionStatus AS ts");
    expect(plan.stages[2]?.sql).toContain("t.status = ts.id");
    expect(plan.stages[2]?.inputStageIds).toEqual(["source-1", "source-2"]);
  });

  test("shows independent and correlated subqueries differently", () => {
    const independent = createSuiteQLTracePlan(`
      SELECT t.id FROM transaction t
      WHERE t.id IN (
        SELECT tl.transaction FROM transactionline tl WHERE tl.mainline = 'T'
      )
    `);
    expect(independent.stages[0]?.kind).toBe("subquery");
    expect(independent.stages[0]?.executable).toBe(true);

    const correlated = createSuiteQLTracePlan(`
      SELECT t.id,
        (SELECT MAX(tl.id) FROM transactionline tl WHERE tl.transaction = t.id) maxline
      FROM transaction t
    `);
    expect(correlated.stages[0]?.kind).toBe("subquery");
    expect(correlated.stages[0]?.executable).toBe(false);
    expect(correlated.stages[0]?.status).toBe("skipped");
  });

  test("calculates join row multiplication from the left input", () => {
    const plan = createSuiteQLTracePlan(
      "SELECT * FROM transaction t JOIN transactionstatus ts ON ts.id = t.status",
    );
    const left = plan.stages.find((stage) => stage.id === "source-1")!;
    const join = plan.stages.find((stage) => stage.kind === "join")!;
    left.rowCount = 1;
    join.rowCount = 3;
    expect(getSuiteQLTraceMultiplication(plan, join)).toBe(3);
  });
});
