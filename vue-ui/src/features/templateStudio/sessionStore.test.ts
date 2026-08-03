import { describe, expect, it } from "vitest";
import {
  createTemplateDesignSession,
  deleteTemplateDesignSession,
  makeTemplateFeedback,
  makeTemplateImageAsset,
  makeTemplateReferenceImage,
  templateImageAssetPlaceholder,
  normalizeTemplateSessionStore,
} from "./sessionStore";

describe("Template Studio session store", () => {
  it("creates a committed brief without inventing FreeMarker", () => {
    const session = createTemplateDesignSession({
      name: "Invoice refresh",
      prompt: "Match the supplied invoice reference.",
      contextMode: "transaction",
      recordType: "invoice",
      recordId: "42",
    });

    expect(session.name).toBe("Invoice refresh");
    expect(session.status).toBe("brief_ready");
    expect(session.freemarker).toBe("");
    expect(session.sourceVersion).toBe(0);
    expect(session.recordType).toBe("invoice");
    expect(session.recordId).toBe("42");
    expect(session.assetToolsEnabled).toBe(true);
  });

  it("allows an image-led session without a title or description", () => {
    const reference = makeTemplateReferenceImage(
      "invoice.png",
      "image/png",
      "data:image/png;base64,AAAA",
    );
    const session = createTemplateDesignSession({
      referenceImages: [reference],
    });

    expect(session.name).toBe("Untitled template");
    expect(session.prompt).toBe("");
    expect(session.referenceImages).toEqual([reference]);
    expect(session.status).toBe("brief_ready");
  });

  it("starts an imported template as an editable first revision", () => {
    const freemarker = "<pdf><body>Imported</body></pdf>";
    const session = createTemplateDesignSession({
      templateFileName: "existing-invoice.xml",
      freemarker,
    });

    expect(session.name).toBe("existing-invoice");
    expect(session.prompt).toBe("");
    expect(session.templateFileName).toBe("existing-invoice.xml");
    expect(session.freemarker).toBe(freemarker);
    expect(session.status).toBe("designing");
    expect(session.sourceVersion).toBe(1);
    expect(session.revisions[0]).toMatchObject({
      actor: "user",
      summary: "Imported from existing-invoice.xml",
      freemarker,
    });
  });

  it("repairs an invalid current-session pointer", () => {
    const first = createTemplateDesignSession({
      name: "First",
      prompt: "First design",
    });
    const normalized = normalizeTemplateSessionStore({
      schemaVersion: 1,
      currentSessionId: "missing",
      sessions: [first],
      updatedAt: "",
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
          freemarker: "<pdf><body>Existing</body></pdf>",
        },
      ],
      updatedAt: "",
    });

    expect(normalized.sessions[0]?.sourceVersion).toBe(1);
    expect(normalized.sessions[0]?.assetToolsEnabled).toBe(true);
  });

  it("preserves a session-level AI asset tooling opt-out", () => {
    const session = createTemplateDesignSession({
      name: "Native layout only",
      assetToolsEnabled: false,
    });
    const normalized = normalizeTemplateSessionStore({
      schemaVersion: 1,
      currentSessionId: session.id,
      sessions: [session],
      updatedAt: "",
    });

    expect(normalized.sessions[0]?.assetToolsEnabled).toBe(false);
  });

  it("deletes a session and selects the nearest remaining session", () => {
    const first = createTemplateDesignSession({ name: "First" });
    const second = createTemplateDesignSession({ name: "Second" });
    const third = createTemplateDesignSession({ name: "Third" });
    const result = deleteTemplateDesignSession(
      {
        schemaVersion: 1,
        currentSessionId: second.id,
        sessions: [first, second, third],
        updatedAt: "",
      },
      second.id,
    );

    expect(result.sessions.map((session) => session.id)).toEqual([
      first.id,
      third.id,
    ]);
    expect(result.currentSessionId).toBe(third.id);
  });

  it("keeps the current selection when deleting another session", () => {
    const first = createTemplateDesignSession({ name: "First" });
    const second = createTemplateDesignSession({ name: "Second" });
    const result = deleteTemplateDesignSession(
      {
        schemaVersion: 1,
        currentSessionId: first.id,
        sessions: [first, second],
        updatedAt: "",
      },
      second.id,
    );

    expect(result.currentSessionId).toBe(first.id);
    expect(result.sessions).toHaveLength(1);
  });

  it("clears the current selection when deleting the final session", () => {
    const only = createTemplateDesignSession({ name: "Only" });
    const result = deleteTemplateDesignSession(
      {
        schemaVersion: 1,
        currentSessionId: only.id,
        sessions: [only],
        updatedAt: "",
      },
      only.id,
    );

    expect(result.currentSessionId).toBe("");
    expect(result.sessions).toEqual([]);
  });

  it("creates unchecked fix-request todos and preserves checked history", () => {
    const todo = makeTemplateFeedback("Move the total to the right.");
    expect(todo.checked).toBe(false);

    const normalized = normalizeTemplateSessionStore({
      schemaVersion: 1,
      currentSessionId: "feedback",
      sessions: [
        {
          id: "feedback",
          name: "Feedback",
          prompt: "Review",
          feedback: [
            todo,
            {
              id: "done",
              text: "Increase the logo.",
              status: "addressed",
              checked: true,
              response: "Logo width increased.",
            },
          ],
        },
      ],
      updatedAt: "",
    });

    expect(normalized.sessions[0]?.feedback[0]?.checked).toBe(false);
    expect(normalized.sessions[0]?.feedback[1]?.checked).toBe(true);
    expect(normalized.sessions[0]?.feedback[1]?.checkedAt).toBeTruthy();
  });

  it("creates formatter-safe opaque image placeholders", () => {
    const asset = makeTemplateImageAsset({
      name: "mark.svg",
      kind: "svg",
      mimeType: "image/svg+xml",
      originalMimeType: "image/svg+xml",
      source: "ai_svg",
      width: 120,
      height: 40,
      byteSize: 64,
      svgSource:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"></svg>',
    });

    expect(asset.placeholder).toBe(templateImageAssetPlaceholder(asset.id));
    expect(asset.placeholder).toMatch(/^mns-asset:\/\/asset_[a-z0-9_]+$/i);
    expect(asset.placeholder).not.toContain("${");
  });

  it("preserves SVG source and raster bytes in storage while repairing metadata", () => {
    const normalized = normalizeTemplateSessionStore({
      schemaVersion: 1,
      currentSessionId: "assets",
      sessions: [
        {
          id: "assets",
          imageAssets: [
            {
              id: "asset_vector",
              name: "vector.svg",
              placeholder: "unsafe-placeholder",
              dataUrl: "data:image/png;base64,ignored",
              svgSource: "<svg></svg>",
              width: 80,
              height: 20,
            },
            {
              id: "asset_raster",
              name: "photo.png",
              dataUrl: "data:image/png;base64,AAAA",
              width: 20,
              height: 20,
            },
            {
              id: "asset_jpeg",
              name: "photo.jpg",
              dataUrl: "data:image/jpeg;base64,BBBB",
              width: 40,
              height: 30,
            },
          ],
        },
      ],
    });

    const [vector, raster, jpeg] = normalized.sessions[0]!.imageAssets;
    expect(vector?.kind).toBe("svg");
    expect(vector?.mimeType).toBe("image/svg+xml");
    expect(vector?.svgSource).toBe("<svg></svg>");
    expect(vector?.placeholder).toBe("mns-asset://asset_vector");
    expect(raster?.kind).toBe("raster");
    expect(raster?.dataUrl).toBe("data:image/png;base64,AAAA");
    expect(jpeg?.mimeType).toBe("image/jpeg");
    expect(jpeg?.dataUrl).toBe("data:image/jpeg;base64,BBBB");
  });
});
