'use strict';

/**
 * SDF project lifecycle: check the reusable project exists beside the tool,
 * scaffold it if not, and bind it to an authid. Objects accumulate in it
 * across runs until cleaned up.
 */

const fs = require('fs');
const path = require('path');
const { projectDir } = require('./env');

const MANIFEST = `<manifest projecttype="ACCOUNTCUSTOMIZATION">
    <projectname>Magic Netsuite SDF Deploys</projectname>
    <frameworkversion>1.0</frameworkversion>
    <dependencies>
        <features>
            <feature required="true">SERVERSIDESCRIPTING</feature>
            <feature required="false">CRM</feature>
        </features>
    </dependencies>
</manifest>
`;

/** Create the project skeleton if missing; returns the project path. */
function ensureProject() {
    const dir = projectDir();
    const src = {
        manifest: path.join(dir, 'manifest.xml'),
        deploy: path.join(dir, 'deploy.xml'),
        objects: path.join(dir, 'Objects'),
        cabinet: path.join(dir, 'FileCabinet', 'SuiteScripts')
    };
    fs.mkdirSync(src.objects, { recursive: true });
    fs.mkdirSync(src.cabinet, { recursive: true });
    if (!fs.existsSync(src.manifest)) {
        fs.writeFileSync(src.manifest, MANIFEST);
    } else {
        // Upgrade manifests scaffolded by older versions: CRM must be declared
        // (optional) because deployment audience fields depend on it.
        let xml = fs.readFileSync(src.manifest, 'utf8');
        if (!/>CRM</.test(xml)) {
            xml = xml.replace(
                /(<feature required="true">SERVERSIDESCRIPTING<\/feature>)/,
                `$1\n            <feature required="false">CRM</feature>`
            );
            fs.writeFileSync(src.manifest, xml);
        }
    }
    if (!fs.existsSync(src.deploy)) {
        // placeholder; every deploy run rewrites this scoped to one object
        fs.writeFileSync(src.deploy, '<deploy>\n</deploy>\n');
    }
    return dir;
}

/** Bind the project to an authid (project.json). */
function bindAuth(authId) {
    const p = path.join(projectDir(), 'project.json');
    fs.writeFileSync(p, JSON.stringify({ defaultAuthId: authId }, null, 4) + '\n');
}

/**
 * Rewrite the manifest <dependencies><objects> list from scratch: account
 * custom objects referenced by [scriptid=...] anywhere in the project's
 * Objects/ that are NOT themselves project objects. Recomputing each run keeps
 * the list in sync when project objects are added or cleaned up (stale
 * dependency entries fail validation with "not in the account").
 */
function ensureObjectDependencies(extraScriptIds) {
    const objectsDir = path.join(projectDir(), 'Objects');
    const files = fs.existsSync(objectsDir)
        ? fs.readdirSync(objectsDir).filter(f => f.endsWith('.xml') && !f.endsWith('.template.xml'))
        : [];
    const projectIds = new Set(files.map(f => f.replace(/\.xml$/, '').toLowerCase()));

    const refs = new Set((extraScriptIds || []).map(s => s.toLowerCase()));
    for (const f of files) {
        const xml = fs.readFileSync(path.join(objectsDir, f), 'utf8');
        for (const m of xml.matchAll(/\[scriptid=((?:customrecord|customlist)[a-z0-9_]*)(?:\.[a-z0-9_.]+)?\]/gi)) {
            refs.add(m[1].toLowerCase());
        }
    }
    const wanted = [...refs].filter(r => !projectIds.has(r)).sort();

    const manifestPath = path.join(projectDir(), 'manifest.xml');
    let xml = fs.readFileSync(manifestPath, 'utf8');
    const original = xml;

    // Drop any existing <objects> block, then re-add if needed.
    xml = xml.replace(/\s*<objects>[\s\S]*?<\/objects>/, '');
    if (wanted.length) {
        const entries = wanted.map(s => `            <object>${s}</object>`).join('\n');
        xml = xml.replace(/<\/features>/, `</features>\n        <objects>\n${entries}\n        </objects>`);
    }
    if (xml !== original) fs.writeFileSync(manifestPath, xml);
}

/**
 * Scope deploy.xml to exactly this run's objects + files.
 * cabinetPaths: paths under FileCabinet/. objectIds: scriptids in Objects/.
 * Template sidecars (<scriptid>.template.xml) are included automatically.
 */
function scopeDeploy(cabinetPaths, objectIds) {
    const files = (Array.isArray(cabinetPaths) ? cabinetPaths : [cabinetPaths]).filter(Boolean);
    const objects = (Array.isArray(objectIds) ? objectIds : [objectIds]).filter(Boolean);
    const objectPaths = [];
    for (const o of objects) {
        objectPaths.push(`~/Objects/${o}.xml`);
        if (fs.existsSync(path.join(projectDir(), 'Objects', `${o}.template.xml`))) {
            objectPaths.push(`~/Objects/${o}.template.xml`);
        }
    }
    let xml = '<deploy>\n';
    if (files.length) {
        xml += '    <files>\n' +
            files.map(f => `        <path>~/FileCabinet/${f}</path>`).join('\n') +
            '\n    </files>\n';
    }
    xml += '    <objects>\n' +
        objectPaths.map(p => `        <path>${p}</path>`).join('\n') +
        '\n    </objects>\n</deploy>\n';
    fs.writeFileSync(path.join(projectDir(), 'deploy.xml'), xml);
}

// SDF object root tag -> account feature that must be declared in the manifest.
const TAG_FEATURES = {
    customrecordtype: 'CUSTOMRECORDS',
    advancedpdftemplate: 'ADVANCEDPRINTING'
};

/** Ensure required features are declared in the manifest exactly once. */
function ensureFeatures(features) {
    const manifestPath = path.join(projectDir(), 'manifest.xml');
    let xml = fs.readFileSync(manifestPath, 'utf8');
    const original = xml;

    // Heal any duplicated feature lines (SDF rejects double declarations).
    const seen = new Set();
    xml = xml.replace(/^\s*<feature required="(?:true|false)">([A-Z]+)<\/feature>\r?\n/gm, (line, feat) => {
        if (seen.has(feat)) return '';
        seen.add(feat);
        return line;
    });

    const wanted = [...new Set((features || []).filter(Boolean))];
    const missing = wanted.filter(f => !seen.has(f));
    if (missing.length) {
        const entries = missing.map(f => `            <feature required="true">${f}</feature>`).join('\n');
        xml = xml.replace(/(<feature required="true">SERVERSIDESCRIPTING<\/feature>)/, `$1\n${entries}`);
    }
    if (xml !== original) fs.writeFileSync(manifestPath, xml);
}

module.exports = { ensureProject, bindAuth, scopeDeploy, ensureObjectDependencies, ensureFeatures, TAG_FEATURES };
