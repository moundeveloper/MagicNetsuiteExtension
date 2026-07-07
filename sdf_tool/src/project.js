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
 * Ensure account custom objects referenced by [scriptid=...] (e.g. select
 * record types on script parameters) are declared in the manifest
 * <dependencies><objects> list, otherwise server validation rejects them.
 */
function ensureObjectDependencies(scriptIds) {
    if (!scriptIds || !scriptIds.length) return;
    const manifestPath = path.join(projectDir(), 'manifest.xml');
    let xml = fs.readFileSync(manifestPath, 'utf8');

    const existing = new Set(
        [...xml.matchAll(/<object>([^<]+)<\/object>/g)].map(m => m[1].trim().toLowerCase())
    );
    const missing = scriptIds.map(s => s.toLowerCase()).filter(s => !existing.has(s));
    if (!missing.length) return;

    const entries = missing.map(s => `            <object>${s}</object>`).join('\n');
    if (/<objects>/.test(xml)) {
        xml = xml.replace(/<objects>/, `<objects>\n${entries}`);
    } else if (/<\/features>/.test(xml)) {
        xml = xml.replace(/<\/features>/, `</features>\n        <objects>\n${entries}\n        </objects>`);
    } else {
        xml = xml.replace(/<\/dependencies>/, `    <objects>\n${entries}\n        </objects>\n    </dependencies>`);
    }
    fs.writeFileSync(manifestPath, xml);
}

/** Scope deploy.xml to exactly one object + its script file. */
function scopeDeploy(cabinetPath, scriptId) {
    const xml =
        `<deploy>\n` +
        `    <files>\n` +
        `        <path>~/FileCabinet/${cabinetPath}</path>\n` +
        `    </files>\n` +
        `    <objects>\n` +
        `        <path>~/Objects/${scriptId}.xml</path>\n` +
        `    </objects>\n` +
        `</deploy>\n`;
    fs.writeFileSync(path.join(projectDir(), 'deploy.xml'), xml);
}

module.exports = { ensureProject, bindAuth, scopeDeploy, ensureObjectDependencies };
