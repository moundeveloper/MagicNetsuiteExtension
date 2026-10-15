// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { indexFiles } from "../model";
import { executeSuiteScript } from "./engine";
import { defaultScenario, type Scenario } from "./types";

async function run(source: string, changes: Partial<Scenario> = {}) {
  const project = indexFiles([
    { path: "SuiteScripts/test.js", content: source },
  ]);
  return executeSuiteScript({
    project,
    artifactId: "file:SuiteScripts/test.js",
    scenario: { ...defaultScenario(), ...changes },
  });
}
describe("isolated SuiteScript execution", () => {
  it("executes real AMD source with deterministic time/random and captured logs", async () => {
    const source = `define(['N/log'], log => ({ execute: () => { log.audit('running', 1); return [Date.now(), Math.random(), typeof fetch, typeof process, typeof window, typeof Worker]; } }));`;
    const a = await run(source),
      b = await run(source);
    expect(a.status).toBe("completed");
    expect(a.value).toEqual(b.value);
    expect((a.value as any[]).slice(2)).toEqual([
      "undefined",
      "undefined",
      "undefined",
      "undefined",
    ]);
    expect(a.logs[0]?.title).toBe("running");
  });
  it("interrupts an infinite loop", async () => {
    const project = indexFiles([
      {
        path: "loop.js",
        content: "define([], () => ({ execute: () => { while(true) {} } }));",
      },
    ]);
    await expect(
      executeSuiteScript(
        { project, artifactId: "file:loop.js", scenario: defaultScenario() },
        40,
      ),
    ).rejects.toThrow();
  });
  it("resolves relative dependencies and awaits asynchronous entrypoints", async () => {
    const project = indexFiles([
      {
        path: "SuiteScripts/a.js",
        content:
          "define(['./lib/b'], b => ({ execute: async () => b.value + await Promise.resolve(1) }));",
      },
      {
        path: "SuiteScripts/lib/b.js",
        content: "define([], () => ({ value: 41 }));",
      },
    ]);
    const r = await executeSuiteScript({
      project,
      artifactId: "file:SuiteScripts/a.js",
      scenario: defaultScenario(),
    });
    expect(r.value).toBe(42);
  });
  it("captures missing adapters even when source catches the error", async () => {
    const r = await run(
      "define(['N/crypto'], crypto => ({ execute: () => { try { crypto.createCipher({}); } catch(e) {} return 'caught'; } }));",
    );
    expect(r.status).toBe("unsupported");
    expect(r.diagnostics.join()).toContain("N/crypto.createCipher");
  });
  it("denies unconfigured HTTP and never exposes host APIs through Function", async () => {
    const r = await run(
      "define(['N/https'], https => ({ execute: () => { if (Function('return typeof fetch')() !== 'undefined') throw Error('escape'); return https.get({url:'https://example.invalid'}); } }));",
    );
    expect(r.status).toBe("unsupported");
    expect(r.diagnostics.join()).toContain("Network denied");
  });
  it("executes standard record CRUD with category governance and diffs", async () => {
    const r = await run(
      "define(['N/record'], record => ({ execute: () => { const r = record.create({type:'customrecord_test'}); r.setValue({fieldId:'name',value:'Created'}); const id=r.save(); record.submitFields({type:'customrecord_test',id,values:{name:'Updated'}}); return id; } }));",
    );
    expect(r.status).toBe("completed");
    expect(r.records[0]?.fields.name).toBe("Updated");
    expect(r.trace.reduce((n, e) => n + e.units, 0)).toBe(8);
    expect(r.diffs).toHaveLength(2);
  });
  it("enforces governance and preserves its failure if the script catches it", async () => {
    const r = await run(
      "define(['N/record'], record => ({ execute: () => { try { for(let i=0;i<101;i++) record.load({type:'salesorder',id:1}); }catch(e){} } }));",
      { records: [{ type: "salesorder", id: 1, fields: {} }] },
    );
    expect(r.status).toBe("failed");
    expect(r.diagnostics.join()).toContain("Governance");
  });
  it("models sparse xedit then commit, and read-only afterSubmit", async () => {
    const source =
      "define([],()=>({ beforeSubmit:c=>{ if(c.newRecord.getValue({fieldId:'untouched'})!==null) throw Error('not sparse'); c.newRecord.setValue({fieldId:'memo',value:'changed'}); }, afterSubmit:c=>c.newRecord.setValue({fieldId:'memo',value:'bad'}) }));";
    const r = await run(source, {
      entryPoint: "userEvent",
      input: {
        recordType: "customrecord_test",
        id: 1,
        eventType: "xedit",
        values: { memo: "edit" },
      },
      records: [
        {
          type: "customrecord_test",
          id: 1,
          fields: { untouched: "kept", memo: "old" },
        },
      ],
    });
    expect(r.status).toBe("failed");
    expect(r.records[0]?.fields).toEqual({
      untouched: "kept",
      memo: "changed",
    });
    expect(r.error).toContain("read-only");
  });
  it("suppresses nested user events before execution", async () => {
    const r = await run(
      "define([],()=>({beforeSubmit:()=>{throw Error('should not run')}}));",
      { entryPoint: "userEvent", context: "USEREVENT" },
    );
    expect(r.status).toBe("filtered");
  });
  it("rejects dynamic record mode explicitly", async () => {
    const r = await run(
      "define(['N/record'],r=>({execute:()=>r.create({type:'customer',isDynamic:true})}));",
    );
    expect(r.status).toBe("unsupported");
  });
  it("runs map/shuffle/reduce/summarize as separate invocations", async () => {
    const r = await run(
      "define(['N/runtime'],rt=>({getInputData:()=>[1,2,3],map:c=>c.write({key:'sum',value:JSON.parse(c.value)}),reduce:c=>c.write({key:c.key,value:c.values.reduce((a,b)=>a+Number(b),0)}),summarize:s=>{if(rt.getCurrentScript().getRemainingUsage()!==10000)throw Error('budget')}}));",
      { entryPoint: "pipeline" },
    );
    expect(r.status).toBe("completed");
    expect((r.value as any).output).toEqual([["sum", "6"]]);
    expect(r.trace.filter((e) => e.label === "Enter map")).toHaveLength(3);
  });
  it("does not silently return empty rows for unknown SQL", async () => {
    const r = await run(
      "define(['N/query'],q=>({execute:()=>q.runSuiteQL({query:'SELECT id FROM customer'}).asMappedResults()}));",
    );
    expect(r.status).toBe("unsupported");
  });
});
