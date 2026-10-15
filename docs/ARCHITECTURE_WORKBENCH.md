# Architecture Workbench

Open **Architecture Workbench** from Features/navigation, at `/architecture-workbench`. It now edits and executes real AMD SuiteScript source in a local QuickJS/WASM worker.

## Where to put script code

1. Choose **SDF folder** and select your SuiteCloud project, or import source files.
2. Select a source module, its SDF script record, or a deployment in the explorer.
3. Open **Code & Run**. Paste/edit code in Monaco. **New SuiteScript** creates a starter for a Scheduled Script, RESTlet, Suitelet, User Event, or Map/Reduce script.
4. Choose **Defaults for selected script**, or **Import scenario**. Scenarios describe input, records, files, parameters, context, user/role and API responses.
5. Click **Run locally**. Inspect Output, Logs, Record diffs, Tasks and Diagnostics. Switch to Architecture to step through the captured trace and inspect governance.
6. **Download code** exports edited JavaScript. **Export** saves the whole workbench, including sources/scenario, as JSON. **Export run**, inside the Scenario tab, saves execution output, records, files, tasks and diagnostics.

Edits autosave in this browser workspace; they do not overwrite original files. Download code to transfer an edit back into your project. Each run starts from a fresh scenario snapshot. Script records and deployments remain separate from source modules; creating a source file does not generate deployable SDF XML.

## AI Agents scenarios

Import the AI Agents SuiteCloud folder, select the indicated module, then import its JSON below. Scenarios contain synthetic account data and explicit fixture responses, not credentials or copied source.

| Source module | Scenario | Expected result |
| --- | --- | --- |
| `ctkc_mock_mcp_rs.js` | [MCP addition](architecture-scenarios/ctkc_mock_mcp_rs.scenario.json) | JSON-RPC sum 42 |
| `ctkc_dtp_requeue_ss.js` | [Requeue](architecture-scenarios/ctkc_dtp_requeue_ss.scenario.json) | Two record diffs; 14 modeled units |
| `ctkc_suiteql_schema_upsert_mr.js` | [Schema upsert](architecture-scenarios/ctkc_suiteql_schema_upsert_mr.scenario.json) | One create, one update, staged file removed |
| `ctkc_netsuite_provider_sl.js` | [Model listing](architecture-scenarios/ctkc_netsuite_provider_sl.scenario.json) | Model list through the real local library |
| `ctkc_netsuite_provider_sl.js` | [Agent launch](architecture-scenarios/ctkc_netsuite_provider_sl-launch.scenario.json) | Session/event records and queued scheduled task |

## Architecture and persistence

The canvas shows architectural artifacts, not every source file. Imported standalone scripts appear as Script nodes; when SDF script/deployment objects already represent their source, the duplicate source node is hidden. Library modules, built-in N/ APIs and unresolved module references are hidden. Record/integration references from shared libraries are attributed to their owning scripts with the original evidence retained. All sources remain available in the explorer and Code & Run. Selecting hidden source highlights/centers its architectural representative, and trace filtering uses the same mapping.

The domain model is independent of Vue Flow. Sources, SDF scripts, deployments, schemas and traces share artifact IDs. The explorer/canvas/inspector expose configuration, fields/parameters, notes, source locations and relationship provenance. Babel discovers literal AMD dependencies; other semantic references use conservative heuristics and retain `Inferred` provenance. Dynamic references are not automatically resolved. Duplicate SDF definitions produce diagnostics and the shortest path wins.

Projects support validated JSON import/export, browser-local autosave, draggable positions, filtering, neighbor focus and recorded-event replay. Replay changes the displayed event, not interpreter/database state. Source edits/reindexing clear the old trace. The example trace is illustrative; runtime observations describe local execution, not real-account behavior.

## Execution contract and limits

- A fresh QuickJS realm runs inside a dedicated worker. No DOM, host filesystem, fetch, extension API or live NetSuite connection is exposed. WASM is bundled locally. Stop terminates the worker.
- Fixed scenario clock, seeded randomness, 64 MB interpreter memory, 512 KB stack, five-second execution deadline and 15-second outer worker deadline. Trace timestamps are logical sequence offsets, not measured API latency.
- AMD define/require, relative resolution, module caching and async entry points work. `inspect` loads modules and lists exports without invoking an entry point. Importing alone never executes source. TypeScript is indexed but requires transpilation to JavaScript before execution.
- RESTlet methods, Scheduled execute, Suitelet onRequest, sequential Map/Reduce pipeline and selected-script User Event submit lifecycles run locally. UE supports create/edit/xedit/delete, sparse xedit data, read-only oldRecord/afterSubmit and commit ordering. beforeLoad and client event chains are not implemented.
- Standard record CRUD, selected sublist operations, virtual files, runtime parameters/context, logs, errors, basic searches and captured Suitelet responses are provided. record.save checks imported mandatory fields, not all account constraints.
- SuiteQL fixtures match whitespace-normalized SQL and exact parameters. HTTP fixtures match method and URL. apiFixtures explicitly supply results/errors for otherwise unsupported callable APIs; repeated calls consume successive matching fixtures. selectOptions maps recordType/fieldId/value/text. These fixtures do not imply an SQL engine, network requests, cryptography or LLM inference.
- Modeled API costs and budgets live in `local-server-2026.2-v1`. Record costs distinguish custom records, a limited common-transaction catalog and other standard records. Target release is metadata; selecting a release does not switch behavior packs.
- Selected deployments apply parameters and basic deployed/context/event/record-type/testing filters. Roles/users are contextual metadata; permissions/audiences are not enforced. Direct module execution bypasses deployment matching.
- Submitted tasks remain PENDING; run targets separately. Dispatch, concurrency, retries and busy deployments are not modeled. Map/Reduce reuses one module instance and sequential stages, without restarts, soft yields or full persisted-data limits.
- Results are APPROXIMATE. Reaching an unsupported adapter marks UNIMPLEMENTED even if source catches its error. Completed means the local invocation completed, not real-account conformance. Inspect script error logs too.

See [the AI Agents audit](ARCHITECTURE_WORKBENCH_AI_AGENTS_AUDIT.md) for evidence, research and remaining gaps.

## Reproduce verification

```powershell
cd C:\Projects\MagicNetsuiteExtension\vue-ui
$env:MAGIC_NETSUITE_TEST_PROJECT = 'C:/Users/AbdelmounaimSabri/OneDrive - CONSITEK/Documenti/Netsuite-Projects/AI/AI Agents'
pnpm exec vitest run src/features/architecture src/router/routesMap.test.ts
pnpm run check
pnpm exec vite build --outDir "$env:TEMP/magic-netsuite-workbench-build"
```

Without the project variable, seven real-project integration cases are explicitly skipped. Optional MAGIC_NETSUITE_AUDIT_EXPORT writes a local importable project snapshot; optional MAGIC_NETSUITE_SCENARIO_EXPORT writes the synthetic scenarios used by integration tests. Source snapshots belong locally and are not committed here.
