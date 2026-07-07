#!/usr/bin/env node
'use strict';

/**
 * sdfDeploy — create NetSuite script records + deployments from a JSON spec
 * through the SuiteCloud CLI, using a self-scaffolded reusable SDF project
 * stored beside this tool ("sdf-project/").
 *
 * Commands
 *   deploy  <spec.json|->  [--no-deploy] [--no-validate] [--no-interactive-auth]
 *       spec.accountId selects the target account; it is resolved to a
 *       SuiteCloud authid (interactive browser login if unknown).
 *   cleanup <scriptId> [--inactivate] [--keep-file] [--account <id>]
 *   list
 *   resolve-account <accountId> [--no-interactive-auth]
 *   list-objects   --account <id> [--type <t...>] [--scriptid <id>]
 *       List account custom objects (type:scriptid) so the AI can pick what to edit.
 *   import-object  --account <id> --type <t> --scriptid <id...> [--no-template]
 *       Import an existing object's SDF XML from the account into the project and
 *       return it, so the AI can edit it and redeploy (update). Objects only —
 *       scripts have their own tooling.
 *
 * Contract: human logs -> STDERR. One JSON result -> STDOUT.
 * Exit codes: 0 ok, 1 bad input, 2 validation failed, 3 deploy failed, 4 auth failed.
 */

const fs = require('fs');
const path = require('path');
const { buildObjectXml } = require('./build');
const { buildCustomRecordXml, buildTemplateXml } = require('./customobjects');
const { ensureProject, bindAuth, scopeDeploy, ensureObjectDependencies, ensureFeatures, TAG_FEATURES } = require('./project');
const { resolveAccount } = require('./accounts');
const { suitecloud, log } = require('./runner');
const { projectDir, checkJava } = require('./env');

const out = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

function fail(msg, code, extra) {
    out({ ok: false, error: String(msg && msg.message ? msg.message : msg), ...(extra || {}) });
    process.exit(code || 1);
}

function readSpec(arg) {
    const raw = arg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');
    return JSON.parse(raw);
}

function hasFlag(args, name) { return args.includes(name); }
function flagValue(args, name) {
    const i = args.indexOf(name);
    return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
}
/** All values after a flag until the next --flag. */
function flagValues(args, name) {
    const i = args.indexOf(name);
    if (i === -1) return [];
    const out = [];
    for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(args[j]);
    return out;
}

/** Ensure java + project, resolve --account to an authid, bind it. Returns auth. */
async function prepareAccount(args) {
    checkJava();
    ensureProject();
    const account = flagValue(args, '--account');
    if (!account) throw new Error('--account <id> is required (e.g. 1964539 or 9937091_SB1)');
    const auth = await resolveAccount(account, { noInteractive: hasFlag(args, '--no-interactive-auth') });
    bindAuth(auth.authId);
    return auth;
}

/**
 * Raw SDF objects (templates, custom records, any object XML) passed through
 * the spec's `objects` array: { xml, template?: { content | localPath } }.
 * Returns [{ scriptId, tag, templateFile? }]. Throws on malformed XML.
 */
function parseRawObjects(objects) {
    return (objects || []).map((o, i) => {
        const xml = String(o.xml || '').trim();
        const m = xml.match(/^<([a-z][a-z0-9]*)\s[^>]*scriptid="([^"]+)"/i);
        if (!m) throw new Error(`objects[${i}]: xml must start with an SDF object root tag carrying a scriptid attribute`);
        return { xml, tag: m[1].toLowerCase(), scriptId: m[2], template: o.template };
    });
}

/**
 * Objects can reference each other ([scriptid=other.sub]); SDF applies them
 * in deploy.xml order, so topologically sort referenced objects first.
 */
function sortObjectsByRefs(parsed) {
    const ids = new Set(parsed.map(p => p.scriptId));
    const depsOf = (p) => {
        const deps = new Set();
        for (const m of p.xml.matchAll(/\[scriptid=([a-z0-9_]+?)(?:\.[a-z0-9_.]+)?\]/gi)) {
            const target = m[1];
            if (target !== p.scriptId && ids.has(target)) deps.add(target);
        }
        return deps;
    };
    const remaining = new Map(parsed.map(p => [p.scriptId, p]));
    const sorted = [];
    while (remaining.size) {
        let progressed = false;
        for (const [id, p] of remaining) {
            const unmet = [...depsOf(p)].some(d => remaining.has(d));
            if (!unmet) { sorted.push(p); remaining.delete(id); progressed = true; }
        }
        if (!progressed) { // circular refs: keep original order for the rest
            sorted.push(...remaining.values());
            break;
        }
    }
    return sorted;
}

// ---------------------------------------------------------------- deploy
async function cmdDeploy(args) {
    const specArg = args.find(a => !a.startsWith('--'));
    if (!specArg) return fail('usage: deploy <spec.json|->', 1);

    let spec, built = null, rawObjects;
    try {
        spec = readSpec(specArg);
        const hasScript = spec.scriptType || spec.scriptFile || spec.deployments;
        if (hasScript) built = buildObjectXml(spec);
        // Structured, schema-driven builders (preferred) + raw XML pass-through.
        const generated = [
            ...(spec.customRecords || []).map(buildCustomRecordXml),
            ...(spec.templates || []).map(buildTemplateXml)
        ];
        rawObjects = sortObjectsByRefs([...generated, ...parseRawObjects(spec.objects)]);
        if (!built && !rawObjects.length) {
            throw new Error('spec must contain a script definition (scriptType/scriptFile/deployments), customRecords, templates, and/or an objects array');
        }
    } catch (e) { return fail(e, 1); }

    if (!spec.accountId) return fail('spec.accountId is required (e.g. "1964539" or "9937091_SB1")', 1);

    try { checkJava(); } catch (e) { return fail(e, 4); }

    const proj = ensureProject();
    log(`project: ${proj}`);

    // Resolve account -> authid (may open interactive login).
    let auth;
    try {
        auth = await resolveAccount(spec.accountId, {
            noInteractive: hasFlag(args, '--no-interactive-auth')
        });
    } catch (e) { return fail(e, 4); }
    bindAuth(auth.authId);
    log(`account ${auth.accountId} -> authid ${auth.authId}`);

    const cabinetPaths = [];
    const objectIds = [];
    const features = [];

    // Materialize the script (structured spec), if present.
    if (built) {
        const filePath = path.join(proj, 'FileCabinet', built.cabinetPath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        if (spec.scriptFile.localPath) {
            fs.copyFileSync(path.resolve(spec.scriptFile.localPath), filePath);
        } else if (typeof spec.scriptFile.content === 'string') {
            fs.writeFileSync(filePath, spec.scriptFile.content);
        } else if (!fs.existsSync(filePath)) {
            return fail('scriptFile needs localPath or content (no existing file at cabinetPath)', 1);
        }
        fs.writeFileSync(path.join(proj, 'Objects', `${built.scriptId}.xml`), built.xml);
        cabinetPaths.push(built.cabinetPath);
        objectIds.push(built.scriptId);
    }

    // Materialize raw objects (custom records, templates, ...), if present.
    for (const o of rawObjects) {
        fs.writeFileSync(path.join(proj, 'Objects', `${o.scriptId}.xml`), o.xml.endsWith('\n') ? o.xml : o.xml + '\n');
        if (o.template) {
            // Sidecar convention: <scriptid>.template.xml beside the object
            // (advanced PDF/HTML template source).
            const sidecar = path.join(proj, 'Objects', `${o.scriptId}.template.xml`);
            if (o.template.localPath) fs.copyFileSync(path.resolve(o.template.localPath), sidecar);
            else if (typeof o.template.content === 'string') fs.writeFileSync(sidecar, o.template.content);
            else return fail(`objects entry ${o.scriptId}: template needs content or localPath`, 1);
        }
        if (TAG_FEATURES[o.tag]) features.push(TAG_FEATURES[o.tag]);
        objectIds.push(o.scriptId);
    }

    // Refs to account objects not in this batch must be manifest dependencies.
    const batchIds = new Set(rawObjects.map(o => o.scriptId).concat(built ? [built.scriptId] : []));
    const externalRefs = new Set();
    for (const o of rawObjects) {
        for (const m of o.xml.matchAll(/\[scriptid=((?:customrecord|customlist)[a-z0-9_]*)(?:\.[a-z0-9_.]+)?\]/gi)) {
            if (!batchIds.has(m[1])) externalRefs.add(m[1].toLowerCase());
        }
    }
    ensureObjectDependencies([...externalRefs]);

    ensureFeatures(features);
    scopeDeploy(cabinetPaths, objectIds);

    const result = {
        ok: true,
        accountId: auth.accountId,
        authId: auth.authId,
        scriptId: built ? built.scriptId : undefined,
        scriptType: built ? built.scriptType : undefined,
        objects: objectIds,
        cabinetPath: built ? built.cabinetPath : undefined,
        deployments: built ? (spec.deployments || []).map(d => d.scriptId) : [],
        validated: false,
        deployed: false
    };

    // Pull the meaningful failure lines out of suitecloud output for the caller.
    const failureDetail = (output) => {
        const lines = output.split(/\r?\n/).map(l => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\[[0-9;]*[A-Za-z]/g, '').trim());
        const picked = lines.filter(l => /error|failed|details:|file:|object:/i.test(l) && l);
        return (picked.length ? picked.join('\n') : output).slice(-1500);
    };

    if (!hasFlag(args, '--no-validate')) {
        const v = suitecloud(['project:validate', '--server']);
        result.validated = v.code === 0;
        if (v.code !== 0) {
            result.ok = false;
            result.error = 'server validation failed';
            result.detail = failureDetail(v.output);
            out(result); process.exit(2);
        }
    }
    if (hasFlag(args, '--no-deploy')) { out(result); return; }

    const d = suitecloud(['project:deploy']);
    result.deployed = d.code === 0;
    if (d.code !== 0) {
        result.ok = false;
        result.error = 'deploy failed';
        result.detail = failureDetail(d.output);
        out(result); process.exit(3);
    }
    out(result);
}

// ---------------------------------------------------------------- cleanup
async function cmdCleanup(args) {
    const scriptIdArg = args.find(a => !a.startsWith('--'));
    if (!scriptIdArg) return fail('usage: cleanup <scriptId> [--inactivate] [--keep-file] [--account <id>]', 1);

    const proj = ensureProject();
    // Accept any SDF object id (customscript_, custtmpl_, customrecord_, ...);
    // fall back to the customscript_ prefix for bare script ids.
    let id = scriptIdArg;
    let objPath = path.join(proj, 'Objects', `${id}.xml`);
    if (!fs.existsSync(objPath) && !id.includes('_')) {
        id = `customscript_${id}`;
        objPath = path.join(proj, 'Objects', `${id}.xml`);
    }
    if (!fs.existsSync(objPath)) {
        if (!scriptIdArg.startsWith('customscript_')) {
            const alt = path.join(proj, 'Objects', `customscript_${scriptIdArg}.xml`);
            if (fs.existsSync(alt)) { id = `customscript_${scriptIdArg}`; objPath = alt; }
        }
    }
    if (!fs.existsSync(objPath)) return fail(`no such object in project: ${id}.xml`, 1);

    const result = { ok: true, scriptId: id, inactivated: false, removedObject: false, removedFile: false };
    const xml = fs.readFileSync(objPath, 'utf8');
    const m = xml.match(/<scriptfile>\[\/(.+?)\]<\/scriptfile>/);
    const cabinetPath = m ? m[1] : null;

    if (hasFlag(args, '--inactivate')) {
        try { checkJava(); } catch (e) { return fail(e, 4); }
        const account = flagValue(args, '--account');
        if (account) {
            let auth;
            try {
                auth = await resolveAccount(account, { noInteractive: hasFlag(args, '--no-interactive-auth') });
            } catch (e) { return fail(e, 4); }
            bindAuth(auth.authId);
        }
        let disabled = xml.replace(/<isinactive>F<\/isinactive>/, '<isinactive>T</isinactive>');
        disabled = disabled.replace(/<isdeployed>T<\/isdeployed>/g, '<isdeployed>F</isdeployed>');
        fs.writeFileSync(objPath, disabled);
        scopeDeploy(cabinetPath ? [cabinetPath] : [], [id]);
        const d = suitecloud(['project:deploy']);
        result.inactivated = d.code === 0;
        if (d.code !== 0) { out(result); process.exit(3); }
    }

    fs.unlinkSync(objPath);
    const sidecar = path.join(proj, 'Objects', `${id}.template.xml`);
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
    result.removedObject = true;
    if (!hasFlag(args, '--keep-file') && cabinetPath) {
        const fp = path.join(proj, 'FileCabinet', cabinetPath);
        if (fs.existsSync(fp)) { fs.unlinkSync(fp); result.removedFile = true; result.cabinetPath = cabinetPath; }
    }
    result.note = 'Local project cleaned. SDF cannot hard-delete script records on the account; use --inactivate to disable them there.';
    out(result);
}

// ---------------------------------------------------------------- list
function cmdList() {
    const proj = ensureProject();
    const dir = path.join(proj, 'Objects');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.xml') && !f.endsWith('.template.xml'));
    const objects = files.map(f => {
        const xml = fs.readFileSync(path.join(dir, f), 'utf8');
        return {
            file: f,
            type: (xml.match(/^<(\w+)\s/) || [])[1] || '',
            name: (xml.match(/<name>(.*?)<\/name>/) || [])[1] || '',
            deployments: (xml.match(/<scriptdeployment scriptid="/g) || []).length
        };
    });
    out({ ok: true, project: proj, count: objects.length, objects });
}

// ---------------------------------------------------------------- resolve-account
async function cmdResolveAccount(args) {
    const account = args.find(a => !a.startsWith('--'));
    if (!account) return fail('usage: resolve-account <accountId>', 1);
    try { checkJava(); } catch (e) { return fail(e, 4); }
    ensureProject();
    try {
        const auth = await resolveAccount(account, { noInteractive: hasFlag(args, '--no-interactive-auth') });
        out({ ok: true, ...auth });
    } catch (e) { return fail(e, 4); }
}

// Script object types are handled by the dedicated script tooling; the
// import/edit/update workflow here is for every OTHER SDF object.
const SCRIPT_TYPES = new Set([
    'suitelet', 'restlet', 'clientscript', 'usereventscript',
    'scheduledscript', 'mapreducescript', 'portlet', 'massupdatescript',
    'workflowactionscript', 'bundleinstallationscript', 'customglplugin',
    'sdfinstallationscript', 'emailcaptureplugin', 'consolidatedrateadjustorplugin'
]);

// ---------------------------------------------------------------- list-objects
async function cmdListObjects(args) {
    let auth;
    try { auth = await prepareAccount(args); }
    catch (e) { return fail(e, /required/.test(e.message) ? 1 : 4); }

    const types = flagValues(args, '--type');
    const scriptId = flagValue(args, '--scriptid');
    const cmd = ['object:list'];
    if (types.length) cmd.push('--type', ...types);
    if (scriptId) cmd.push('--scriptid', scriptId);

    const res = suitecloud(cmd);
    if (res.code !== 0) { out({ ok: false, error: 'object:list failed', accountId: auth.accountId }); process.exit(3); }

    const objects = res.output
        .split(/\r?\n/)
        .map(l => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\[[0-9;]*[A-Za-z]/g, '').trim())
        .map(l => { const m = l.match(/^([a-z][a-z0-9]+):([A-Za-z0-9_.]+)$/); return m ? { type: m[1], scriptId: m[2] } : null; })
        .filter(Boolean);

    out({ ok: true, accountId: auth.accountId, count: objects.length, objects });
}

// ---------------------------------------------------------------- import-object
async function cmdImportObject(args) {
    const type = flagValue(args, '--type');
    const scriptIds = flagValues(args, '--scriptid');
    if (!type || !scriptIds.length) {
        return fail('usage: import-object --account <id> --type <t> --scriptid <id...> [--no-template]', 1);
    }
    if (SCRIPT_TYPES.has(type.toLowerCase())) {
        return fail(`type "${type}" is a script type; use the script deploy/upload tooling instead of import-object (objects only).`, 1);
    }

    let auth, proj;
    try { auth = await prepareAccount(args); proj = projectDir(); }
    catch (e) { return fail(e, /required/.test(e.message) ? 1 : 4); }

    const cmd = ['object:import', '--type', type, '--scriptid', ...scriptIds, '--destinationfolder', '/Objects', '--excludefiles'];
    const res = suitecloud(cmd);
    if (res.code !== 0 || /failed with reason/i.test(res.output)) {
        out({ ok: false, error: 'object:import failed', accountId: auth.accountId, detail: res.output.slice(-800) });
        process.exit(3);
    }

    const objectsDir = path.join(proj, 'Objects');
    const includeTemplate = !hasFlag(args, '--no-template');
    const imported = scriptIds.map(id => {
        const xmlPath = path.join(objectsDir, `${id}.xml`);
        if (!fs.existsSync(xmlPath)) return { scriptId: id, imported: false };
        const entry = { scriptId: id, imported: true, type, xml: fs.readFileSync(xmlPath, 'utf8') };
        const tpl = path.join(objectsDir, `${id}.template.xml`);
        if (includeTemplate && fs.existsSync(tpl)) entry.templateXml = fs.readFileSync(tpl, 'utf8');
        return entry;
    });

    out({
        ok: true,
        accountId: auth.accountId,
        note: 'Edit the returned xml (and templateXml if present), then call deploy with an objects[] entry ' +
              '{ xml, template? } using the same scriptid to update it on the account.',
        objects: imported
    });
}

// ---------------------------------------------------------------- main
(async () => {
    const [cmd, ...rest] = process.argv.slice(2);
    try {
        switch (cmd) {
            case 'deploy': await cmdDeploy(rest); break;
            case 'cleanup': await cmdCleanup(rest); break;
            case 'list': cmdList(); break;
            case 'resolve-account': await cmdResolveAccount(rest); break;
            case 'list-objects': await cmdListObjects(rest); break;
            case 'import-object': await cmdImportObject(rest); break;
            default:
                log('commands: deploy <spec.json|-> | cleanup <scriptId> | list | resolve-account <accountId> | list-objects | import-object');
                process.exit(1);
        }
    } catch (e) {
        fail(e, 1);
    }
})();
