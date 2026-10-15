# AI Agents compatibility audit

Date: 2026-09-25. Target: the user's local AI/AI Agents SuiteCloud project, read without changing its source. The v0.1 spec served as product requirements, not authorization for unrelated actions. The root credentials file was not read/imported. This describes a tested subset, not completion of the entire simulator specification.

## Findings and implemented changes

The initial architecture view had no code editor or runtime. That blocked the central requested workflow. Code & Run now provides Monaco editing, script starters, scenarios, isolated execution, API adapters, output/logs/diffs/tasks and traces linked to architecture IDs.

The actual project needs relative AMD libraries, SDF fields/parameters/deployments, HTML templates, SuiteQL, record mutation, select-field text, virtual files, Map/Reduce stages and external AI services. Changes made while testing include Babel literal dependency analysis, cabinet-path normalization, field schemas, duplicate-object diagnostics, virtual HTML files, exact SQL fixtures, explicit select mappings and deterministic stages.

## Measured inventory

Before temporary UI test scripts: **14 JavaScript sources, 68 artifacts, 130 relationships and 118 fields/script parameters**. Sources comprise four Suitelets, two RESTlets, three Scheduled Scripts, two Map/Reduce scripts and three libraries, based on their annotations.

All 14 source modules loaded successfully in inspect mode and all literal local AMD dependencies resolved. Initialization success does not prove branch coverage or full API support.

| Source | Type | Evidence |
| --- | --- | --- |
| ctkc_agent_console_sl.js | Suitelet | AMD initialization only; dashboard/browser behavior not certified |
| ctkc_agent_llm_lib.js | Library | Initialization plus actual provider listing/launch helper calls |
| ctkc_agent_mcp_rs.js | Restlet | Initialization only; tool/database/auth paths need scenarios |
| ctkc_agent_session_watchdog_ss.js | ScheduledScript | Initialization only; watchdog query/update paths untested |
| ctkc_claude_provider_sl.js | Suitelet | Initialization only; external provider/auth/orchestration fixture-dependent |
| ctkc_crypto_lib.js | Library | Initialization only; crypto operations unimplemented |
| ctkc_dtp_requeue_ss.js | ScheduledScript | Actual retryable/exhausted branches and record writes |
| ctkc_mock_mcp_rs.js | Restlet | Actual tools/list, tools/call/addNumbers and browser execution |
| ctkc_netsuite_provider_mr.js | MapReduceScript | Initialization only; agent-processing paths need scenarios |
| ctkc_netsuite_provider_sl.js | Suitelet | Actual model listing and agent launch through local library |
| ctkc_netsuite_provider_ss.js | ScheduledScript | Initialization only; LLM/tool loops untested |
| ctkc_suiteql_schema_upsert_mr.js | MapReduceScript | Actual getInputData/map/reduce/summarize and file cleanup |
| ns_oauth_2.js | Library | Initialization only; OAuth signing/requests unimplemented |
| ctkc_dev_scratchpad_sl.js | Suitelet | Initialization only; broad API imports do not prove support |

Duplicate SDF object: customscript_ctkc_claude_provider occurs in both src/Objects/customscript_ctkc_claude_provider.xml and src/Objects/src/Objects/customscript_ctkc_claude_provider.xml. The importer retains the shorter path and reports the ignored copy; neither original file was changed.

Four custom records have source references but no imported SDF definition: customrecord_ctkc_ai_requirements, customrecord_ctkc_ai_req_section, customrecord_ctkc_api_key and customrecord_ctkc_agent_session_event. Standard folder/scriptdeployment references also lack local schemas, as expected. Missing local definitions do not establish absence from the actual account; they limit validation.

Only four script records have local SDF definitions: agent console, Claude provider, DTP requeue and schema upsert. Other sources run directly, but their account deployment configuration cannot be inferred from JavaScript.

## Executed scenarios

1. MCP RESTlet: tools/list returns six tools; addNumbers(20,22) returns JSON-RPC text containing sum 42.
2. DTP requeue: two synthetic records become retryable status 1 and exhausted status 4. The retryable thread is cleared. Two record diffs, 14 modeled units, no script error logs.
3. Schema upsert MR: reads staging file 77, creates customer schema, updates salesorder schema, deletes staging file and logs summarize totals created=1, updated=1, error=0. Queries use explicit fixtures.
4. Provider model listing: actual Suitelet and actual relative LLM library return the scenario's model enum. No inference occurs.
5. Provider launch: exact configuration SQL fixture and explicit status/event select IDs allow the actual source to persist session/event, submit a scheduled task and store its ID. The application's queued=false means submission succeeded; the simulator task remains PENDING and is not dispatched.

Browser verification also created a starter, replaced code through Monaco and received answer=43 plus an audit log from the edited source. Original SuiteCloud files were unchanged. The production Vite build bundles worker/WASM. Automated tests additionally cover deterministic time/random, inaccessible host globals, CPU interruption, async AMD, caught unsupported errors, governance exhaustion, CRUD diffs, sparse xedit/read-only records, nested UE suppression, dynamic-mode rejection, MR stages and missing-query rejection.

## Research and decisions

Oracle's AMD rules informed dependency loading before factories and rejection of API calls during initialization. Static literal dependencies retain source evidence; heuristic references are not presented as runtime observations. [Oracle define](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4387811519.html)

QuickJS/WASM provides separate runtimes, memory/stack limits, interruption and promise-job processing. The implementation supplies JSON snapshots with no host function bridges. This is a practical isolation boundary, not formal sandbox certification. [QuickJS Emscripten](https://github.com/justjake/quickjs-emscripten), [QuickJS](https://www.bellard.org/quickjs/)

Oracle differentiates record API costs across custom records, standard nontransaction records and transactions. The pack implements these categories for a limited transaction catalog. [API governance](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157072844224.html), [submitFields](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4267283788.html)

Map/Reduce stage budgets are modeled independently. Processor concurrency, restarts, soft yielding and persisted-data limits require additional platform behavior; sequential staging validates the imported schema-upsert logic but cannot certify production scheduling. [Oracle MR governance](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4480364878.html)

User Event tests target documented standard-mode records, sparse inline-edit data, read-only afterSubmit and chaining restrictions. Full cross-deployment propagation, sourcing and permissions remain outside scope. [beforeSubmit](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4407992070.html), [afterSubmit](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4407992281.html), [UE execution](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1512409310.html)

N/llm.generateText has documented governance of 100 units. The adapter consumes a scenario response at that modeled cost. Offline execution cannot establish service latency, AI allowance, model availability or output quality. [Oracle llm.generateText](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_1014032554.html)

## Remaining gaps

The full AI Agents system is not certified end to end. Live provider/OAuth/crypto paths, query semantics, AI output, permissions, console UI and async orchestration require further adapters, scenarios and real-account comparison. SQL uses exact fixtures; tasks require separate target runs. Unsupported adapter errors remain visible even when caught by source.

Outstanding v0.1 specification features include account conformance capture/comparison, full dynamic record sourcing, workflows/client events, cross-script dispatch, task retries/concurrency, release pack switching, breakpoints/interpreter rewind, complete schema validation and broader SDF semantics. The code-editor and real-source execution workflows are implemented; their outputs now derive from executing the user's code rather than illustrative traces.
