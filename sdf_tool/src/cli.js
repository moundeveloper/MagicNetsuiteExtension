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
 *
 * Contract: human logs -> STDERR. One JSON result -> STDOUT.
 * Exit codes: 0 ok, 1 bad input, 2 validation failed, 3 deploy failed, 4 auth failed.
 */

const fs = require('fs');
const path = require('path');
const { buildObjectXml } = require('./build');
const { ensureProject, bindAuth, scopeDeploy, ensureObjectDependencies } = require('./project');
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

// ---------------------------------------------------------------- deploy
async function cmdDeploy(args) {
    const specArg = args.find(a => !a.startsWith('--'));
    if (!specArg) return fail('usage: deploy <spec.json|->', 1);

    let spec, built;
    try {
        spec = readSpec(specArg);
        built = buildObjectXml(spec);
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

    // Materialize script file.
    const filePath = path.join(proj, 'FileCabinet', built.cabinetPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (spec.scriptFile.localPath) {
        fs.copyFileSync(path.resolve(spec.scriptFile.localPath), filePath);
    } else if (typeof spec.scriptFile.content === 'string') {
        fs.writeFileSync(filePath, spec.scriptFile.content);
    } else if (!fs.existsSync(filePath)) {
        return fail('scriptFile needs localPath or content (no existing file at cabinetPath)', 1);
    }

    // Materialize object XML + scope deploy to it.
    const objPath = path.join(proj, 'Objects', `${built.scriptId}.xml`);
    fs.writeFileSync(objPath, built.xml);
    ensureObjectDependencies(built.referencedObjects);
    scopeDeploy(built.cabinetPath, built.scriptId);

    const result = {
        ok: true,
        accountId: auth.accountId,
        authId: auth.authId,
        scriptId: built.scriptId,
        scriptType: built.scriptType,
        objectFile: path.relative(proj, objPath),
        cabinetPath: built.cabinetPath,
        deployments: (spec.deployments || []).map(d => d.scriptId),
        validated: false,
        deployed: false
    };

    if (!hasFlag(args, '--no-validate')) {
        const v = suitecloud(['project:validate', '--server']);
        result.validated = v.code === 0;
        if (v.code !== 0) { out(result); process.exit(2); }
    }
    if (hasFlag(args, '--no-deploy')) { out(result); return; }

    const d = suitecloud(['project:deploy']);
    result.deployed = d.code === 0;
    if (d.code !== 0) { out(result); process.exit(3); }
    out(result);
}

// ---------------------------------------------------------------- cleanup
async function cmdCleanup(args) {
    const scriptIdArg = args.find(a => !a.startsWith('--'));
    if (!scriptIdArg) return fail('usage: cleanup <scriptId> [--inactivate] [--keep-file] [--account <id>]', 1);
    const id = scriptIdArg.startsWith('customscript_') ? scriptIdArg : `customscript_${scriptIdArg}`;

    const proj = ensureProject();
    const objPath = path.join(proj, 'Objects', `${id}.xml`);
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
        if (cabinetPath) scopeDeploy(cabinetPath, id);
        const d = suitecloud(['project:deploy']);
        result.inactivated = d.code === 0;
        if (d.code !== 0) { out(result); process.exit(3); }
    }

    fs.unlinkSync(objPath);
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
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.xml'));
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

// ---------------------------------------------------------------- main
(async () => {
    const [cmd, ...rest] = process.argv.slice(2);
    try {
        switch (cmd) {
            case 'deploy': await cmdDeploy(rest); break;
            case 'cleanup': await cmdCleanup(rest); break;
            case 'list': cmdList(); break;
            case 'resolve-account': await cmdResolveAccount(rest); break;
            default:
                log('commands: deploy <spec.json|-> | cleanup <scriptId> | list | resolve-account <accountId>');
                process.exit(1);
        }
    } catch (e) {
        fail(e, 1);
    }
})();
