import { describe, expect, it } from "vitest";
import {
  createTemplateDesignSession,
  normalizeTemplateSessionStore
} from "./sessionStore";

describe("Template Studio session store", () => {
  it("creates a committed brief without inventing FreeMarker", () => {
    const session = createTemplateDesignSession({
      name: "Invoice refresh",
      prompt: "Match the supplied invoice reference.",
      contextMode: "transaction",
      recordType: "invoice",
      recordId: "42"
    });

    expect(session.name).toBe("Invoice refresh");
    expect(session.status).toBe("brief_ready");
    expect(session.freemarker).toBe("");
    expect(session.sourceVersion).toBe(0);
    expect(session.recordType).toBe("invoice");
    expect(session.recordId).toBe("42");
  });

  it("repairs an invalid current-session pointer", () => {
    const first = createTemplateDesignSession({
      name: "First",
      prompt: "First design"
    });
    const normalized = normalizeTemplateSessionStore({
      schemaVersion: 1,
      currentSessionId: "missing",
      sessions: [first],
      updatedAt: ""
    });

    expect(normalized.currentSessionId).toBe(first.id);
    expect(normalized.sessions).toHaveLength(1);
  });

  it("migrates an existing FreeMarker session to a source version", () => {
    const normalized = normalizeTemplateSessionStore({
      schemaVersion: 1,
      currentSessionId: "legacy",
      sessions: [
        {
          id: "legacy",
          name: "Legacy",
          prompt: "Keep this source",
          freemarker: "<pdf><body>Existing</body></pdf>"
        }
      ],
      updatedAt: ""
    });

    expect(normalized.sessions[0]?.sourceVersion).toBe(1);
  });
});
