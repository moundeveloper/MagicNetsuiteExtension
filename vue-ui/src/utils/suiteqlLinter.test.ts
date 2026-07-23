import { describe, expect, it } from "vitest";
import {
  getSuiteQLReferencedFields,
  getSuiteQLReferencedTables,
  lintSuiteQL,
  type SuiteQLSchemaContext
} from "./suiteqlLinter";

const schema: SuiteQLSchemaContext = {
  tableIds: [
    "customer",
    "transaction",
    "transactionline",
    "vendor",
    "employee",
    "account"
  ],
  fieldsByTable: {
    customer: [
      "id",
      "entityid",
      "companyname",
      "email",
      "datecreated",
      "lastmodifieddate",
      "subsidiary",
      "isinactive"
    ],
    transaction: [
      "id",
      "entity",
      "type",
      "trandate",
      "tranid",
      "amount",
      "status",
      "memo",
      "subsidiary",
      "createdfrom"
    ],
    transactionline: [
      "id",
      "transaction",
      "item",
      "mainline",
      "netamount",
      "quantity",
      "subsidiary"
    ],
    vendor: ["id", "entityid", "companyname", "email", "subsidiary"],
    employee: ["id", "entityid", "email", "supervisor", "subsidiary"],
    account: ["id", "acctnumber", "fullname", "isinactive"]
  },
  fieldTypesByTable: {
    customer: {
      id: "integer",
      entityid: "text",
      datecreated: "datetime",
      lastmodifieddate: "datetime"
    },
    transaction: {
      id: "integer",
      entity: "integer",
      type: "text",
      trandate: "date",
      amount: "currency"
    }
  },
  runtimeFieldTypesByTable: {
    customer: {
      datecreated: "datetime",
      lastmodifieddate: "datetimetz"
    },
    transaction: {
      trandate: "date"
    }
  }
};

const codes = (sql: string, context = schema) =>
  lintSuiteQL(sql, context).issues.map((issue) => issue.code);

const expectNoErrors = (sql: string, context = schema) => {
  const result = lintSuiteQL(sql, context);
  expect(result.errors, result.errors.map((issue) => issue.message).join("\n")).toEqual(
    []
  );
  return result;
};

describe("query scopes and correlated subqueries", () => {
  it("does not mix the outer table with an IN subquery", () => {
    const result = expectNoErrors(`
      SELECT customer.id, customer.entityid
      FROM customer
      WHERE id IN (
        SELECT entity
        FROM transaction
        WHERE type = 'CustInvc'
      )
    `);
    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ code: "AMBIGUOUS_FIELD" })
    );
  });

  it("does not turn the outer query into an aggregate query because of a scalar subquery", () => {
    const result = expectNoErrors(`
      SELECT
        customer.id,
        customer.entityid,
        (
          SELECT MAX(sales_transaction.trandate)
          FROM transaction sales_transaction
          WHERE sales_transaction.entity = customer.id
            AND sales_transaction.type = 'CustInvc'
        ) AS latest_invoice_date
      FROM customer
      WHERE EXISTS (
        SELECT 1
        FROM transaction customer_transaction
        WHERE customer_transaction.entity = customer.id
          AND customer_transaction.type = 'CustInvc'
      )
      ORDER BY latest_invoice_date DESC
    `);
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      "GROUP_BY_NON_GROUPED_COLUMN"
    );
  });

  it("reports only the two real mainline errors for the original reported query", () => {
    const result = lintSuiteQL(`
      SELECT
        customer.id,
        customer.entityid,
        (
          SELECT MAX(sales_transaction.trandate)
          FROM transaction sales_transaction
          WHERE sales_transaction.entity = customer.id
            AND sales_transaction.type = 'CustInvc'
            AND sales_transaction.mainline = 'T'
        ) AS latest_invoice_date
      FROM customer
      WHERE EXISTS (
        SELECT 1
        FROM transaction customer_transaction
        WHERE customer_transaction.entity = customer.id
          AND customer_transaction.type = 'CustInvc'
          AND customer_transaction.mainline = 'T'
      )
      ORDER BY latest_invoice_date DESC
    `, schema);

    expect(result.errors.map((issue) => issue.code)).toEqual([
      "UNKNOWN_FIELD",
      "UNKNOWN_FIELD"
    ]);
    expect(
      result.errors.map((issue) =>
        result.errors.length ? issue.message.match(/mainline/i)?.[0] : null
      )
    ).toEqual(["mainline", "mainline"]);
  });

  it("resolves qualified correlated references through parent scopes", () => {
    expectNoErrors(`
      SELECT c.id
      FROM customer c
      WHERE EXISTS (
        SELECT 1
        FROM transaction t
        WHERE t.entity = c.id
      )
    `);
  });

  it("resolves an unqualified correlated reference only when the local scope cannot", () => {
    expectNoErrors(`
      SELECT c.id
      FROM customer c
      WHERE EXISTS (
        SELECT 1
        FROM account a
        WHERE id = c.subsidiary
      )
    `);
  });

  it("keeps sibling aliases independent", () => {
    expectNoErrors(`
      SELECT c.id
      FROM customer c
      WHERE EXISTS (
        SELECT 1 FROM transaction x WHERE x.entity = c.id
      )
      AND EXISTS (
        SELECT 1 FROM transaction x WHERE x.createdfrom = c.id
      )
    `);
  });

  it("lets a local alias shadow an outer alias", () => {
    expectNoErrors(`
      SELECT t.id
      FROM transaction t
      WHERE EXISTS (
        SELECT 1
        FROM transactionline t
        WHERE t.transaction = 10
      )
    `);
  });

  it("reports an alias that exists only in a sibling scope", () => {
    expect(
      codes(`
        SELECT c.id
        FROM customer c
        WHERE EXISTS (SELECT 1 FROM transaction t WHERE t.entity = c.id)
          AND EXISTS (SELECT 1 FROM account a WHERE t.id = a.id)
      `)
    ).toContain("UNKNOWN_ALIAS");
  });

  it("reports unknown aliases even before field metadata is loaded", () => {
    expect(codes(`SELECT missing.id FROM customer`, {})).toContain(
      "UNKNOWN_ALIAS"
    );
  });

  it("reports ambiguity only among sources in the same scope", () => {
    expect(
      codes(`
        SELECT id
        FROM customer c
        JOIN vendor v ON v.id = c.id
      `)
    ).toContain("AMBIGUOUS_FIELD");
  });

  it("rejects duplicate aliases in one scope", () => {
    expect(
      codes(`
        SELECT x.id
        FROM customer x
        JOIN vendor x ON x.id = x.id
      `)
    ).toContain("DUPLICATE_TABLE_ALIAS");
  });

  it("rejects JOIN without ON or USING", () => {
    expect(codes(`SELECT c.id FROM customer c JOIN vendor v`)).toContain(
      "MISSING_JOIN_CONDITION"
    );
  });

  it("treats each UNION branch as an independent scope", () => {
    expectNoErrors(`
      SELECT entityid FROM customer
      UNION ALL
      SELECT entityid FROM vendor
    `);
  });

  it("rejects mismatched UNION projections", () => {
    expect(
      codes(`
        SELECT id, entityid FROM customer
        UNION ALL
        SELECT id FROM vendor
      `)
    ).toContain("SET_OPERATION_COLUMN_COUNT");
  });
});

describe("derived tables and CTE output schemas", () => {
  it("validates fields exported by a derived table", () => {
    expectNoErrors(`
      SELECT x.customer_id
      FROM (
        SELECT c.id AS customer_id
        FROM customer c
      ) x
      WHERE x.customer_id > 0
    `);
  });

  it("rejects fields not exported by a derived table", () => {
    expect(
      codes(`
        SELECT x.entityid
        FROM (SELECT c.id FROM customer c) x
      `)
    ).toContain("UNKNOWN_FIELD");
  });

  it("validates fields exported by a CTE", () => {
    expectNoErrors(`
      WITH recent AS (
        SELECT t.entity, MAX(t.trandate) AS latest
        FROM transaction t
        GROUP BY t.entity
      )
      SELECT c.id, r.latest
      FROM customer c
      JOIN recent r ON r.entity = c.id
    `);
  });

  it("rejects fields not exported by a CTE", () => {
    expect(
      codes(`
        WITH ids AS (SELECT c.id FROM customer c)
        SELECT ids.entityid FROM ids
      `)
    ).toContain("UNKNOWN_FIELD");
  });

  it("rejects the explicit CTE column-list form unsupported by SuiteQL", () => {
    expect(
      codes(`
        WITH ids(customer_id) AS (SELECT c.id FROM customer c)
        SELECT ids.customer_id FROM ids
      `)
    ).toContain("CTE_COLUMN_LIST_UNSUPPORTED");
  });

  it("does not claim unknown fields for SELECT * derived output", () => {
    const result = lintSuiteQL(
      `SELECT x.entityid FROM (SELECT * FROM customer) x`,
      schema
    );
    expect(result.errors.map((issue) => issue.code)).not.toContain("UNKNOWN_FIELD");
  });
});

describe("aliases and metadata", () => {
  it("accepts an ORDER BY select alias", () => {
    expectNoErrors(`
      SELECT c.entityid AS customer_name
      FROM customer c
      ORDER BY customer_name
    `);
  });

  it("reports select aliases used in WHERE with a dedicated error", () => {
    const resultCodes = codes(`
      SELECT c.entityid AS missing_field
      FROM customer c
      WHERE missing_field = 'x'
    `);
    expect(resultCodes).toContain("SELECT_ALIAS_IN_WHERE");
    expect(resultCodes).not.toContain("UNKNOWN_FIELD");
  });

  it("treats a base-table qualifier as unavailable after aliasing", () => {
    expect(
      codes(`SELECT customer.id FROM customer c`)
    ).toContain("UNKNOWN_ALIAS");
  });

  it("reports an account field absent from transaction but present on transactionline", () => {
    const sql = `
      SELECT t.id
      FROM transaction t
      WHERE t.mainline = 'T'
    `;
    const result = lintSuiteQL(sql, schema);
    const issue = result.errors.find((entry) => entry.code === "UNKNOWN_FIELD");
    expect(issue?.message).toContain('table "transaction"');
    expect(sql.slice(issue!.start, issue!.end)).toBe("t.mainline");
  });

  it("keeps exact locations with leading whitespace and CRLF line endings", () => {
    const sql =
      "\r\n    SELECT c.id\r\n    FROM customer c\r\n    WHERE c.not_a_field = 1";
    const issue = lintSuiteQL(sql, schema).errors.find(
      (entry) => entry.code === "UNKNOWN_FIELD"
    );
    expect(issue).toBeDefined();
    expect(issue?.line).toBe(4);
    expect(sql.slice(issue!.start, issue!.end)).toBe("c.not_a_field");
  });

  it("accepts transactionline.mainline", () => {
    expectNoErrors(`
      SELECT tl.id
      FROM transactionline tl
      WHERE tl.mainline = 'T'
    `);
  });

  it("reports unknown tables at their actual occurrence", () => {
    const sql = `SELECT c.id FROM customer c
UNION ALL
SELECT z.id FROM nonexistent z`;
    const issue = lintSuiteQL(sql, schema).errors.find(
      (entry) => entry.code === "UNKNOWN_TABLE"
    );
    expect(issue).toBeDefined();
    expect(issue?.line).toBe(3);
    expect(sql.slice(issue!.start, issue!.end)).toContain("nonexistent");
  });

  it("defers field validation when a source schema is missing", () => {
    const result = lintSuiteQL(`SELECT mystery FROM customrecord_demo`, {
      tableIds: ["customrecord_demo"]
    });
    expect(result.errors.map((issue) => issue.code)).not.toContain("UNKNOWN_FIELD");
    expect(result.suggestions.map((issue) => issue.code)).toContain(
      "METADATA_NOT_LOADED"
    );
  });
});

describe("aggregate semantics", () => {
  it("accepts a conventional grouped aggregate", () => {
    expectNoErrors(`
      SELECT t.entity, MAX(t.trandate) AS latest
      FROM transaction t
      GROUP BY t.entity
      ORDER BY latest DESC
    `);
  });

  it("rejects a non-grouped selected field", () => {
    expect(
      codes(`
        SELECT t.entity, t.tranid, MAX(t.trandate)
        FROM transaction t
        GROUP BY t.entity
      `)
    ).toContain("GROUP_BY_NON_GROUPED_COLUMN");
  });

  it("accepts an exact grouped expression", () => {
    expectNoErrors(`
      SELECT UPPER(c.entityid), COUNT(*)
      FROM customer c
      GROUP BY UPPER(c.entityid)
    `);
  });

  it("rejects direct aggregates in WHERE", () => {
    expect(
      codes(`SELECT COUNT(*) FROM customer c WHERE COUNT(*) > 1`)
    ).toContain("AGGREGATE_IN_WHERE");
  });

  it("does not treat an aggregate inside a WHERE subquery as direct", () => {
    expectNoErrors(`
      SELECT c.id
      FROM customer c
      WHERE c.id = (
        SELECT MAX(t.entity) FROM transaction t
      )
    `);
  });

  it("rejects directly nested aggregate functions", () => {
    expect(
      codes(`SELECT MAX(COUNT(*)) FROM customer c`)
    ).toContain("NESTED_AGGREGATE");
  });

  it("allows one aggregate query inside another query block", () => {
    const result = lintSuiteQL(`
      SELECT MAX(x.invoice_count)
      FROM (
        SELECT t.entity, COUNT(*) AS invoice_count
        FROM transaction t
        GROUP BY t.entity
      ) x
    `, schema);
    expect(result.errors.map((issue) => issue.code)).not.toContain(
      "NESTED_AGGREGATE"
    );
  });

  it("does not treat analytic functions as GROUP BY aggregates", () => {
    expectNoErrors(`
      SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.id) AS rn
      FROM customer c
    `);
  });

  it("allows an analytic function over a grouped aggregate", () => {
    expectNoErrors(`
      SELECT
        t.entity,
        SUM(COUNT(*)) OVER (ORDER BY t.entity) AS running_count
      FROM transaction t
      GROUP BY t.entity
    `);
  });

  it("checks HAVING fields against GROUP BY", () => {
    expect(
      codes(`
        SELECT t.entity, COUNT(*)
        FROM transaction t
        GROUP BY t.entity
        HAVING t.status = 'Open'
      `)
    ).toContain("GROUP_BY_HAVING_COLUMN");
  });

  it("rejects select aliases in GROUP BY and HAVING as live SuiteQL does", () => {
    expect(
      codes(`
        SELECT t.entity AS customer_id, COUNT(*) AS n
        FROM transaction t
        GROUP BY customer_id
      `)
    ).toContain("SELECT_ALIAS_IN_GROUP_BY");
    expect(
      codes(`
        SELECT t.entity AS customer_id, COUNT(*) AS n
        FROM transaction t
        GROUP BY t.entity
        HAVING n > 1
      `)
    ).toContain("SELECT_ALIAS_IN_HAVING");
  });

  it("allows aggregate-only queries without GROUP BY", () => {
    expectNoErrors(`SELECT COUNT(*), MAX(t.trandate) FROM transaction t`);
  });

  it("enforces DISTINCT ORDER BY projection", () => {
    expect(
      codes(`SELECT DISTINCT c.entityid FROM customer c ORDER BY c.id`)
    ).toContain("DISTINCT_ORDER_BY_NOT_SELECTED");
  });

  it("rejects an ORDER BY ordinal outside the projection", () => {
    expect(codes(`SELECT c.id FROM customer c ORDER BY 2`)).toContain(
      "ORDER_BY_ORDINAL_OUT_OF_RANGE"
    );
  });
});

describe("literals, dates, and lexical compatibility", () => {
  it("explains unquoted text values without also reporting an unknown field", () => {
    const result = lintSuiteQL(
      `SELECT t.id FROM transaction t WHERE t.type = CustInvc`,
      schema
    );
    expect(result.errors.map((issue) => issue.code)).toContain(
      "UNQUOTED_TEXT_LITERAL"
    );
    expect(result.errors.map((issue) => issue.code)).not.toContain("UNKNOWN_FIELD");
  });

  it("accepts quoted text values", () => {
    expectNoErrors(
      `SELECT t.id FROM transaction t WHERE t.type = 'CustInvc'`
    );
  });

  it("detects arithmetic-looking unquoted dates", () => {
    expect(
      codes(`
        SELECT t.id
        FROM transaction t
        WHERE t.trandate >= 2026-01-31
      `)
    ).toContain("UNQUOTED_DATE_LITERAL");
  });

  it("does not attach a date token to an unrelated numeric comparison", () => {
    const result = lintSuiteQL(`
      SELECT t.id
      FROM transaction t
      WHERE t.amount = 1
        AND t.trandate >= 2026-01-31
    `, schema);
    const dateIssues = result.errors.filter(
      (issue) => issue.code === "UNQUOTED_DATE_LITERAL"
    );
    expect(dateIssues).toHaveLength(1);
    expect(result.issues.some((issue) => issue.message.includes("amount"))).toBe(
      false
    );
  });

  it("warns when a datetime is compared to a date-only midnight", () => {
    expect(
      codes(`
        SELECT c.id
        FROM customer c
        WHERE c.datecreated = TO_DATE('2026-01-31', 'YYYY-MM-DD')
      `)
    ).toContain("DATETIME_DATE_EQUALITY");
  });

  it("rejects equality and inequality comparisons with NULL", () => {
    expect(codes(`SELECT c.id FROM customer c WHERE c.email = NULL`)).toContain(
      "NULL_COMPARISON"
    );
    expect(
      codes(`SELECT c.id FROM customer c WHERE c.email IS NULL`)
    ).not.toContain("NULL_COMPARISON");
  });

  it.each([
    ["NO_TOP", `SELECT TOP 10 id FROM customer`],
    ["NO_LIMIT", `SELECT id FROM customer LIMIT 10`],
    ["NO_OFFSET_FETCH", `SELECT id FROM customer OFFSET 2 ROWS`],
    ["NO_BACKTICKS", "SELECT `id` FROM customer"],
    ["NO_SQUARE_BRACKETS", "SELECT [id] FROM customer"],
    ["NO_ILIKE", "SELECT id FROM customer WHERE entityid ILIKE '%a%'"]
  ])("detects %s", (code, sql) => {
    expect(codes(sql)).toContain(code);
  });

  it("accepts AS before table aliases because live SuiteQL accepts it", () => {
    expectNoErrors(`SELECT c.id FROM customer AS c`);
  });

  it("ignores compatibility keywords inside strings and comments", () => {
    const result = lintSuiteQL(`
      SELECT c.id, 'LIMIT TOP ILIKE' AS note
      FROM customer c
      -- LIMIT 10
      WHERE c.entityid = 'value with [brackets]'
    `, schema);
    expect(result.issues.map((issue) => issue.code)).not.toEqual(
      expect.arrayContaining([
        "NO_LIMIT",
        "NO_TOP",
        "NO_ILIKE",
        "NO_SQUARE_BRACKETS"
      ])
    );
  });

  it("rejects mutations and multiple statements", () => {
    expect(codes(`DELETE FROM customer`)).toContain("READ_ONLY_SELECT");
    expect(codes(`SELECT id FROM customer; SELECT id FROM vendor`)).toContain(
      "ONE_STATEMENT"
    );
  });

  it("rejects mixing ANSI JOIN with Oracle (+) syntax", () => {
    expect(
      codes(`
        SELECT c.id
        FROM customer c
        JOIN transaction t ON t.entity = c.id
        WHERE c.id = t.entity(+)
      `)
    ).toContain("MIXED_JOIN_SYNTAX");
  });

  it("reports malformed SQL", () => {
    expect(codes(`SELECT FROM WHERE`)).toContain("PARSE_ERROR");
  });
});

describe("field extraction and generated query corpus", () => {
  it("extracts only real tables, excluding CTE and derived aliases", () => {
    expect(
      getSuiteQLReferencedTables(`
        WITH tx AS (
          SELECT t.entity FROM transaction t
        )
        SELECT c.id
        FROM customer c
        JOIN tx ON tx.entity = c.id
        WHERE EXISTS (
          SELECT 1 FROM (SELECT id FROM vendor) v WHERE v.id = c.id
        )
      `)
    ).toEqual(["transaction", "customer", "vendor"]);
  });

  it("extracts real fields across correlated scopes without leaking aliases", () => {
    const refs = getSuiteQLReferencedFields(
      `
        SELECT c.id, (
          SELECT MAX(t.trandate)
          FROM transaction t
          WHERE t.entity = c.id
        ) AS latest
        FROM customer c
        ORDER BY latest
      `,
      schema
    );
    expect(refs).toEqual(
      expect.arrayContaining([
        { table: "customer", field: "id", source: "qualified" },
        { table: "transaction", field: "trandate", source: "qualified" },
        { table: "transaction", field: "entity", source: "qualified" }
      ])
    );
    expect(refs.some((ref) => ref.field === "latest")).toBe(false);
  });

  it("accepts a matrix of valid query shapes", () => {
    const tables = [
      ["customer", "c", "entityid"],
      ["vendor", "v", "entityid"],
      ["employee", "e", "entityid"],
      ["account", "a", "fullname"]
    ] as const;
    const predicates = [
      (alias: string) => `${alias}.id > 0`,
      (alias: string) => `${alias}.id IS NOT NULL`,
      (alias: string) => `(${alias}.id = 1 OR ${alias}.id = 2)`,
      (alias: string) => `${alias}.id BETWEEN 1 AND 10`
    ];

    for (const [table, alias, textField] of tables) {
      for (const predicate of predicates) {
        expectNoErrors(`
          SELECT ${alias}.id, ${alias}.${textField}
          FROM ${table} ${alias}
          WHERE ${predicate(alias)}
          ORDER BY ${alias}.id
        `);
      }
    }
  });

  it("survives deeply nested, convoluted but valid query blocks", () => {
    expectNoErrors(`
      SELECT c.id,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM transaction t
            WHERE t.entity = c.id
              AND t.amount > (
                SELECT MAX(t2.amount)
                FROM transaction t2
                WHERE t2.entity = c.id
              )
          )
          THEN 'Y'
          ELSE 'N'
        END AS has_large_invoice
      FROM customer c
      WHERE c.id IN (
        SELECT x.entity
        FROM (
          SELECT t3.entity, MAX(t3.trandate) AS latest
          FROM transaction t3
          WHERE t3.type = 'CustInvc'
          GROUP BY t3.entity
        ) x
        WHERE x.latest IS NOT NULL
      )
      ORDER BY has_large_invoice, c.id
    `);
  });
});
