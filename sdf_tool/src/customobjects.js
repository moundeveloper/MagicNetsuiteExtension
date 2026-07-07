'use strict';

/**
 * Structured builders for non-script SDF objects, so callers (AI) never
 * hand-write object XML:
 *   - buildCustomRecordXml: customrecordtype + fields + subtabs
 *   - buildTemplateXml: advancedpdftemplate + template source sidecar
 *
 * Element names, order, and defaults are modeled 1:1 on real SDF exports from
 * account 1964539 (customrecord_m_testing_requirements / _req_section and
 * custtmpl_m_testing_suitecloud).
 */

const { esc } = require('./build');

function bool(v, dflt) { return ((v === undefined ? dflt : v) ? 'T' : 'F'); }

function normId(id, prefix) {
    let s = String(id || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!s) throw new Error(`empty id (expected ${prefix}...)`);
    if (!s.startsWith(prefix)) s = prefix + s.replace(/^_+/, '');
    return s;
}

/** Wrap custom record / list script ids as [scriptid=...]; pass raw refs through. */
function refWrap(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    if (/^\[scriptid=/.test(s) || /^-?\d+$/.test(s)) return s;
    if (/^(customrecord|customlist)[a-z0-9_]*(\.[a-z0-9_]+)?$/i.test(s)) return `[scriptid=${s.toLowerCase()}]`;
    return s;
}

// Common alias -> SDF customrecordcustomfield fieldtype.
const FIELDTYPE_ALIASES = {
    FREEFORMTEXT: 'TEXT',
    LONGTEXT: 'CLOBTEXT',
    DECIMAL: 'FLOAT',
    LIST: 'SELECT',
    DATETIME: 'DATETIMETZ'
};

function normFieldType(t) {
    const up = String(t || 'TEXT').toUpperCase();
    return FIELDTYPE_ALIASES[up] || up;
}

// customrecordtype body element order (from reference export).
const RECORD_BODY = [
    'accesstype', 'allowattachments', 'allowinlinedeleting', 'allowinlinedetaching',
    'allowinlineediting', 'allowmobileaccess', 'allownumberingoverride', 'allowquickadd',
    'allowquicksearch', 'allowuiaccess', 'description', 'enablekeywords', 'enablenumbering',
    'enableoptimisticlocking', 'enablesystemnotes', 'hierarchical', 'icon', 'iconbuiltin',
    'iconindex', 'includeinsearchmenu', 'includename', 'isinactive', 'isordered',
    'numberinginit', 'numberingmindigits', 'numberingprefix', 'numberingsuffix',
    'recordname', 'showcreationdate', 'showcreationdateonlist', 'showid',
    'showlastmodified', 'showlastmodifiedonlist', 'shownotes', 'showowner',
    'showownerallowchange', 'showowneronlist'
];

// customrecordcustomfield element order (from reference export).
const FIELD_ORDER = [
    'accesslevel', 'allowquickadd', 'applyformatting', 'checkspelling', 'defaultchecked',
    'defaultselection', 'defaultvalue', 'description', 'displayheight', 'displaytype',
    'displaywidth', 'dynamicdefault', 'encryptatrest', 'fieldtype', 'globalsearch',
    'help', 'isformula', 'ismandatory', 'isparent', 'label', 'linktext', 'maxlength',
    'maxvalue', 'minvalue', 'onparentdelete', 'parentsubtab', 'rolerestrict',
    'searchcomparefield', 'searchdefault', 'searchlevel', 'selectrecordtype',
    'showinlist', 'sourcefilterby', 'sourcefrom', 'sourcelist', 'storevalue', 'subtab'
];

function buildRecordField(f, indent) {
    const id = normId(f.scriptId, 'custrecord_');
    const fieldType = normFieldType(f.fieldType);
    const isSelect = fieldType === 'SELECT' || fieldType === 'MULTISELECT';
    const vals = {
        accesslevel: f.accessLevel ?? 2,
        allowquickadd: bool(f.allowQuickAdd, false),
        applyformatting: bool(f.applyFormatting, false),
        checkspelling: bool(f.checkSpelling, false),
        defaultchecked: bool(f.defaultChecked, false),
        defaultselection: f.defaultSelection ?? '',
        defaultvalue: f.defaultValue ?? '',
        description: f.description ?? '',
        displayheight: f.displayHeight ?? '',
        displaytype: f.displayType ?? 'NORMAL',
        displaywidth: f.displayWidth ?? '',
        dynamicdefault: f.dynamicDefault ?? '',
        encryptatrest: bool(f.encryptAtRest, false),
        fieldtype: fieldType,
        globalsearch: bool(f.globalSearch, false),
        help: f.help ?? '',
        isformula: bool(f.isFormula, false),
        ismandatory: bool(f.mandatory, false),
        isparent: bool(f.isParent, false),
        label: f.label ?? id,
        linktext: f.linkText ?? '',
        maxlength: f.maxLength ?? '',
        maxvalue: f.maxValue ?? '',
        minvalue: f.minValue ?? '',
        onparentdelete: f.onParentDelete ?? (isSelect ? 'NO_ACTION' : ''),
        parentsubtab: refWrap(f.parentSubtab),
        rolerestrict: bool(f.roleRestrict, false),
        searchcomparefield: f.searchCompareField ?? '',
        searchdefault: f.searchDefault ?? '',
        searchlevel: f.searchLevel ?? 2,
        selectrecordtype: refWrap(f.selectRecordType),
        showinlist: bool(f.showInList, true),
        sourcefilterby: f.sourceFilterBy ?? '',
        sourcefrom: f.sourceFrom ?? '',
        sourcelist: f.sourceList ?? '',
        storevalue: bool(f.storeValue, true),
        subtab: refWrap(f.subtab)
    };
    const lines = FIELD_ORDER.map(k => `${indent}  <${k}>${esc(vals[k])}</${k}>`);
    return `${indent}<customrecordcustomfield scriptid="${esc(id)}">\n${lines.join('\n')}\n${indent}</customrecordcustomfield>`;
}

/**
 * Build a customrecordtype object from a structured spec:
 * { scriptId, name, description?, includeNameField?, showId?, hierarchical?,
 *   inactive?, enableNumbering?, numberingPrefix?, ...,
 *   fields: [{ scriptId, label, fieldType, mandatory?, selectRecordType?,
 *              isParent?, parentSubtab?, defaultValue?, help?, ... }],
 *   subtabs?: [{ scriptId, title, parent? }] }
 * Returns { xml, scriptId, tag }.
 */
function buildCustomRecordXml(spec) {
    const scriptId = normId(spec.scriptId, 'customrecord_');
    if (!spec.name && !spec.recordName) throw new Error('customRecords entry needs name (recordname)');

    const vals = {
        accesstype: spec.accessType ?? 'CUSTRECORDENTRYPERM',
        allowattachments: bool(spec.allowAttachments, true),
        allowinlinedeleting: bool(spec.allowInlineDeleting, false),
        allowinlinedetaching: bool(spec.allowInlineDetaching, true),
        allowinlineediting: bool(spec.allowInlineEditing, true),
        allowmobileaccess: bool(spec.allowMobileAccess, false),
        allownumberingoverride: bool(spec.allowNumberingOverride, false),
        allowquickadd: bool(spec.allowQuickAdd, true),
        allowquicksearch: bool(spec.allowQuickSearch, false),
        allowuiaccess: bool(spec.allowUiAccess, true),
        description: spec.description ?? '',
        enablekeywords: bool(spec.enableKeywords, true),
        enablenumbering: bool(spec.enableNumbering, false),
        enableoptimisticlocking: bool(spec.enableOptimisticLocking, true),
        enablesystemnotes: bool(spec.enableSystemNotes, true),
        hierarchical: bool(spec.hierarchical, false),
        icon: spec.icon ?? '',
        iconbuiltin: bool(spec.iconBuiltIn, true),
        iconindex: spec.iconIndex ?? '',
        includeinsearchmenu: bool(spec.includeInSearchMenu, true),
        includename: bool(spec.includeNameField, true),
        isinactive: bool(spec.inactive, false),
        isordered: bool(spec.isOrdered, false),
        numberinginit: spec.numberingInit ?? '',
        numberingmindigits: spec.numberingMinDigits ?? '',
        numberingprefix: spec.numberingPrefix ?? '',
        numberingsuffix: spec.numberingSuffix ?? '',
        recordname: spec.name ?? spec.recordName,
        showcreationdate: bool(spec.showCreationDate, false),
        showcreationdateonlist: bool(spec.showCreationDateOnList, false),
        showid: bool(spec.showId, false),
        showlastmodified: bool(spec.showLastModified, false),
        showlastmodifiedonlist: bool(spec.showLastModifiedOnList, false),
        shownotes: bool(spec.showNotes, true),
        showowner: bool(spec.showOwner, false),
        showownerallowchange: bool(spec.showOwnerAllowChange, false),
        showowneronlist: bool(spec.showOwnerOnList, false)
    };

    let xml = `<customrecordtype scriptid="${esc(scriptId)}">\n` +
        RECORD_BODY.map(k => `  <${k}>${esc(vals[k])}</${k}>`).join('\n') + '\n';

    const fields = spec.fields || [];
    if (fields.length) {
        xml += '  <customrecordcustomfields>\n' +
            fields.map(f => buildRecordField(f, '    ')).join('\n') +
            '\n  </customrecordcustomfields>\n';
    }

    const subtabs = spec.subtabs || [];
    if (subtabs.length) {
        xml += '  <subtabs>\n' +
            subtabs.map(t => {
                const tid = normId(t.scriptId, 'custrecordtab_');
                return `    <subtab scriptid="${esc(tid)}">\n` +
                    `      <tabparent>${esc(refWrap(t.parent))}</tabparent>\n` +
                    `      <tabtitle>${esc(t.title ?? tid)}</tabtitle>\n` +
                    `    </subtab>`;
            }).join('\n') +
            '\n  </subtabs>\n';
    }

    xml += '</customrecordtype>\n';
    return { xml, scriptId, tag: 'customrecordtype' };
}

/**
 * Build an advancedpdftemplate object from a structured spec:
 * { scriptId, title, standard, content? | localPath?, description?,
 *   preferred?, displaySourceCode?, inactive? }
 * `standard` is the base transaction template id, e.g. STDTMPLCUSTINVC.
 * Returns { xml, scriptId, tag, template } (template = sidecar source spec).
 */
function buildTemplateXml(spec) {
    const scriptId = normId(spec.scriptId, 'custtmpl_');
    if (!spec.title) throw new Error('templates entry needs title');
    if (!spec.standard) throw new Error('templates entry needs standard (e.g. STDTMPLCUSTINVC for invoice)');
    if (!spec.content && !spec.localPath) throw new Error('templates entry needs content or localPath (FreeMarker source)');

    const xml =
        `<advancedpdftemplate scriptid="${esc(scriptId)}" standard="${esc(String(spec.standard).toUpperCase())}">\n` +
        `  <description>${esc(spec.description ?? '')}</description>\n` +
        `  <displaysourcecode>${bool(spec.displaySourceCode, true)}</displaysourcecode>\n` +
        `  <isinactive>${bool(spec.inactive, false)}</isinactive>\n` +
        `  <preferred>${bool(spec.preferred, false)}</preferred>\n` +
        `  <title>${esc(spec.title)}</title>\n` +
        `</advancedpdftemplate>\n`;

    return {
        xml,
        scriptId,
        tag: 'advancedpdftemplate',
        template: spec.content !== undefined ? { content: spec.content } : { localPath: spec.localPath }
    };
}

module.exports = { buildCustomRecordXml, buildTemplateXml, refWrap };
