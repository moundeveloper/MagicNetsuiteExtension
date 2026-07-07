'use strict';

const { SCHEMA, PARAM_FIELDS, resolveType } = require('./schema');

/** XML-escape a text node / attribute value. */
function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const bool = (v, dflt) => ((v === undefined ? dflt : v) ? 'T' : 'F');

/** Normalize a script id to a given prefix (customscript_ / customdeploy_ / custscript_). */
function normId(id, prefix) {
    let s = String(id || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!s) throw new Error(`empty id (expected ${prefix}...)`);
    if (!s.startsWith(prefix)) s = prefix + s.replace(/^_+/, '');
    return s;
}

/** Build one <scriptcustomfield> block from a parameter spec. */
function buildParam(p, indent) {
    const id = normId(p.scriptId, 'custscript_');
    const fieldType = (p.fieldType || 'TEXT').toUpperCase();
    const isSelect = fieldType === 'SELECT' || fieldType === 'MULTISELECT';
    // Reference objects: SELECT params carry NO_ACTION and wrap custom record /
    // custom list references as [scriptid=...] in selectrecordtype.
    let selectRecordType = p.selectRecordType ?? '';
    if (selectRecordType && /^(customrecord|customlist)[a-z0-9_]*$/i.test(selectRecordType)) {
        selectRecordType = `[scriptid=${selectRecordType}]`;
    }
    const vals = {
        accesslevel: p.accessLevel ?? 2,
        aidescription: p.aiDescription ?? '',
        applyformatting: bool(p.applyFormatting, false),
        checkspelling: bool(p.checkSpelling, false),
        defaultchecked: bool(p.defaultChecked, false),
        defaultselection: p.defaultSelection ?? '',
        defaultvalue: p.defaultValue ?? '',
        description: p.description ?? '',
        displayheight: p.displayHeight ?? '',
        displaytype: p.displayType ?? 'NORMAL',
        displaywidth: p.displayWidth ?? '',
        dynamicdefault: p.dynamicDefault ?? '',
        fieldtype: fieldType,
        help: p.help ?? '',
        isformula: bool(p.isFormula, false),
        ismandatory: bool(p.mandatory, false),
        label: p.label ?? id,
        linktext: p.linkText ?? '',
        maxlength: p.maxLength ?? '',
        maxvalue: p.maxValue ?? '',
        minvalue: p.minValue ?? '',
        onparentdelete: p.onParentDelete ?? (isSelect ? 'NO_ACTION' : ''),
        searchlevel: p.searchLevel ?? 2,
        selectrecordtype: selectRecordType,
        setting: p.setting ?? '',
        storevalue: bool(p.storeValue, true)
    };
    const lines = PARAM_FIELDS.map(f => `${indent}  <${f}>${esc(vals[f])}</${f}>`);
    return `${indent}<scriptcustomfield scriptid="${esc(id)}">\n${lines.join('\n')}\n${indent}</scriptcustomfield>`;
}

/** Build <recurrence> for scheduled / map-reduce deployments. */
function buildRecurrence(r, indent) {
    if (!r) return '';
    // Only the common "single" shape is templated; pass raw for advanced cadences.
    const type = (r.type || 'single').toLowerCase();
    const i2 = indent + '  ';
    const i3 = indent + '    ';
    if (type === 'single') {
        return [
            `${indent}<recurrence>`,
            `${i2}<single>`,
            `${i3}<repeat>${esc(r.repeat ?? '')}</repeat>`,
            `${i3}<startdate>${esc(r.startDate ?? '')}</startdate>`,
            `${i3}<starttime>${esc(r.startTime ?? '')}</starttime>`,
            `${i2}</single>`,
            `${indent}</recurrence>`
        ].join('\n');
    }
    throw new Error(`recurrence.type "${type}" not templated; only "single" is built-in`);
}

/** Resolve a deployment field's value from the deployment spec + schema type. */
function deployValue(field, d, typeKey, paramIds) {
    switch (field) {
        case 'allemployees': return bool(d.allEmployees, false);
        case 'allpartners': return bool(d.allPartners, false);
        case 'alllocalizationcontexts': return bool(d.allLocalizationContexts, true);
        case 'allroles': return bool(d.allRoles, typeKey === 'suitelet' || typeKey === 'restlet');
        case 'audslctrole': return (d.audienceRoles || []).join('|');
        case 'eventtype': return d.eventType ?? '';
        case 'executioncontext': return d.executionContext ?? '';
        case 'isdeployed': return bool(d.isDeployed, true);
        case 'isonline': return bool(d.isOnline, false);
        case 'loglevel': return d.logLevel ?? 'DEBUG';
        case 'recordtype': return d.recordType ?? '';
        // Always run as ADMINISTRATOR by default. Only types whose schema lists
        // the field emit it (suitelet, userevent, mapreduce); client scripts
        // always run as the current role and have no run-as option.
        case 'runasrole': return d.runAsRole ?? 'ADMINISTRATOR';
        case 'status': return d.status ?? (typeKey === 'scheduledscript' || typeKey === 'mapreducescript' ? 'NOTSCHEDULED' : 'RELEASED');
        case 'title': return d.title ?? '';
        case 'buffersize': return d.bufferSize ?? 1;
        case 'concurrencylimit': return d.concurrencyLimit ?? '';
        case 'queueallstagesatonce': return bool(d.queueAllStagesAtOnce, false);
        case 'yieldaftermins': return d.yieldAfterMins ?? '';
        default: return '';
    }
}

/** Build one <scriptdeployment>. */
function buildDeployment(d, typeKey, paramIds, indent) {
    const cfg = SCHEMA[typeKey];
    const id = normId(d.scriptId, 'customdeploy_');
    const i2 = indent + '  ';
    const lines = [];

    for (const f of cfg.deployment) {
        lines.push(`${i2}<${f}>${esc(deployValue(f, d, typeKey, paramIds))}</${f}>`);
    }
    // Parameter VALUES on the deployment (empty element per param, set value if provided).
    const pv = d.parameterValues || {};
    for (const pid of paramIds) {
        lines.push(`${i2}<${pid}>${esc(pv[pid] ?? '')}</${pid}>`);
    }
    let inner = lines.join('\n');
    if (cfg.recurrence && d.recurrence) {
        inner += '\n' + buildRecurrence(d.recurrence, i2);
    }
    return `${indent}<scriptdeployment scriptid="${esc(id)}">\n${inner}\n${indent}</scriptdeployment>`;
}

/**
 * Build the full object XML for a script + its deployments.
 * Returns { xml, scriptId, typeKey, tag, cabinetPath }.
 */
function buildObjectXml(spec) {
    const typeKey = resolveType(spec.scriptType);
    const cfg = SCHEMA[typeKey];
    const scriptId = normId(spec.scriptId, 'customscript_');

    if (!spec.scriptFile || !spec.scriptFile.cabinetPath) {
        throw new Error('scriptFile.cabinetPath is required (path under FileCabinet, e.g. "SuiteScripts/MyTool/foo.js")');
    }
    const cabinetPath = spec.scriptFile.cabinetPath.replace(/^\/+/, '');

    const params = (spec.parameters || []).map(p => ({ ...p, _id: normId(p.scriptId, 'custscript_') }));
    const paramIds = params.map(p => p._id);

    // Custom objects referenced via [scriptid=...] must be declared as manifest
    // dependencies (they live on the account, not in this project).
    const referencedObjects = [...new Set(
        params
            .map(p => p.selectRecordType || '')
            .filter(v => /^(customrecord|customlist)[a-z0-9_]*$/i.test(v))
            .map(v => v.toLowerCase())
    )];

    const deployments = spec.deployments || [];
    if (!deployments.length) throw new Error('at least one deployment is required');

    // ---- body fields ----
    const bodyVals = {
        description: spec.description ?? '',
        isinactive: bool(spec.inactive, false),
        name: spec.name ?? scriptId,
        notifyadmins: bool(spec.notifyAdmins, false),
        notifyemails: spec.notifyEmails ?? '',
        notifyowner: bool(spec.notifyOwner, true),
        notifyuser: bool(spec.notifyUser, false),
        scriptfile: `[/${cabinetPath}]`
    };
    const bodyLines = cfg.body.map(f => `  <${f}>${esc(bodyVals[f])}</${f}>`);

    // ---- params ----
    let paramBlock = '';
    if (params.length) {
        if (!cfg.supportsParams) throw new Error(`${typeKey} does not support script parameters`);
        const inner = params.map(p => buildParam(p, '    ')).join('\n');
        paramBlock = `  <scriptcustomfields>\n${inner}\n  </scriptcustomfields>\n`;
    }

    // ---- deployments ----
    const depInner = deployments.map(d => buildDeployment(d, typeKey, paramIds, '    ')).join('\n');
    const depBlock = `  <scriptdeployments>\n${depInner}\n  </scriptdeployments>`;

    const xml =
        `<${cfg.tag} scriptid="${esc(scriptId)}">\n` +
        bodyLines.join('\n') + '\n' +
        paramBlock +
        depBlock + '\n' +
        `</${cfg.tag}>\n`;

    return { xml, scriptId, typeKey, tag: cfg.tag, cabinetPath, scriptType: cfg.scriptType, referencedObjects };
}

module.exports = { buildObjectXml, buildParam, esc, normId };
