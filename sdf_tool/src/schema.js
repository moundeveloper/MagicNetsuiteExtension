'use strict';

/**
 * Per-script-type SDF schema map.
 *
 * Derived from real objects imported from account 1964539 (CONSITEK DEV):
 *   suitelet        <- customscript_sl_script_filter
 *   clientscript    <- customscript_ctkc_fx_currency_update
 *   usereventscript <- customscript_ctkc_sh_ns_ue
 *   scheduledscript <- customscript_ctkc_sp_upload_ss
 *   mapreducescript <- customscriptctkc_netsuite_provider_mr
 *   restlet         <- customscriptctkc_mock_mcp_rs
 *
 * `body` / `deployment` arrays fix the element ORDER (SDF exports/validates
 * roughly alphabetically per type). The generator emits only the fields listed
 * here for the given type, so an app cannot inject an element the schema rejects.
 */

// Fields every script body carries, in export order.
// notifyuser is absent on scheduled + mapreduce.
const BODY_COMMON = ['description', 'isinactive', 'name', 'notifyadmins', 'notifyemails', 'notifyowner'];

const SCHEMA = {
    suitelet: {
        tag: 'suitelet',
        scriptType: 'SUITELET',              // maps back to NetSuite constant / MCP tool
        body: [...BODY_COMMON, 'notifyuser', 'scriptfile'],
        supportsParams: true,
        deployment: [
            'allemployees', 'allpartners', 'allroles', 'audslctrole', 'eventtype',
            'isdeployed', 'isonline', 'loglevel', 'runasrole', 'status', 'title'
        ],
        recurrence: false
    },
    restlet: {
        tag: 'restlet',
        scriptType: 'RESTLET',
        body: [...BODY_COMMON, 'notifyuser', 'scriptfile'],
        supportsParams: true,
        deployment: [
            'allemployees', 'allpartners', 'allroles', 'audslctrole',
            'isdeployed', 'loglevel', 'status', 'title'
        ],
        recurrence: false
    },
    clientscript: {
        tag: 'clientscript',
        scriptType: 'CLIENT',
        body: [...BODY_COMMON, 'notifyuser', 'scriptfile'],
        supportsParams: true,
        // recordtype + executioncontext = record-level (page-init) deployment
        deployment: [
            'allemployees', 'alllocalizationcontexts', 'allpartners', 'allroles', 'audslctrole',
            'eventtype', 'executioncontext', 'isdeployed', 'loglevel', 'recordtype', 'status'
        ],
        recurrence: false
    },
    usereventscript: {
        tag: 'usereventscript',
        scriptType: 'USEREVENT',
        body: [...BODY_COMMON, 'notifyuser', 'scriptfile'],
        supportsParams: true,
        deployment: [
            'allemployees', 'alllocalizationcontexts', 'allpartners', 'allroles', 'audslctrole',
            'eventtype', 'executioncontext', 'isdeployed', 'loglevel', 'recordtype', 'runasrole', 'status'
        ],
        recurrence: false
    },
    scheduledscript: {
        tag: 'scheduledscript',
        scriptType: 'SCHEDULED',
        body: [...BODY_COMMON, 'scriptfile'],   // no notifyuser
        supportsParams: true,
        deployment: ['isdeployed', 'loglevel', 'status', 'title'],
        recurrence: true                         // <recurrence> appended after params/base
    },
    mapreducescript: {
        tag: 'mapreducescript',
        scriptType: 'MAPREDUCE',
        body: [...BODY_COMMON, 'scriptfile'],    // no notifyuser
        supportsParams: true,
        deployment: [
            'buffersize', 'concurrencylimit', 'isdeployed', 'loglevel',
            'queueallstagesatonce', 'runasrole', 'status', 'title', 'yieldaftermins'
        ],
        recurrence: true
    }
};

// Custom-field (script parameter) element order, from real exports.
const PARAM_FIELDS = [
    'accesslevel', 'aidescription', 'applyformatting', 'checkspelling', 'defaultchecked',
    'defaultselection', 'defaultvalue', 'description', 'displayheight', 'displaytype',
    'displaywidth', 'dynamicdefault', 'fieldtype', 'help', 'isformula', 'ismandatory',
    'label', 'linktext', 'maxlength', 'maxvalue', 'minvalue', 'onparentdelete',
    'searchlevel', 'selectrecordtype', 'setting', 'storevalue'
];

// Aliases so callers can pass the friendly NetSuite name or the SDF tag.
const TYPE_ALIASES = {
    suitelet: 'suitelet', scriptlet: 'suitelet',
    restlet: 'restlet',
    client: 'clientscript', clientscript: 'clientscript',
    userevent: 'usereventscript', usereventscript: 'usereventscript', ue: 'usereventscript',
    scheduled: 'scheduledscript', scheduledscript: 'scheduledscript', ss: 'scheduledscript',
    mapreduce: 'mapreducescript', mapreducescript: 'mapreducescript', mr: 'mapreducescript'
};

function resolveType(t) {
    if (!t) throw new Error('scriptType is required');
    const key = TYPE_ALIASES[String(t).toLowerCase()];
    if (!key) throw new Error(`Unknown scriptType "${t}". Allowed: ${Object.keys(SCHEMA).join(', ')}`);
    return key;
}

module.exports = { SCHEMA, PARAM_FIELDS, TYPE_ALIASES, resolveType };
