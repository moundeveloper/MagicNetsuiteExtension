'use strict';

/**
 * Account resolution: map a NetSuite account id (as the extension knows it,
 * e.g. "1964539" or "9937091_SB1") to a SuiteCloud CLI authid.
 *
 * Sources, in order:
 *   1. accounts.json cache beside the tool ({ authId: { accountId } })
 *   2. `suitecloud account:manageauth --list` + `--info <authid>` (then cached)
 *   3. interactive `suitecloud account:setup` in a visible console window,
 *      waiting for the user to complete browser login.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { baseDir, projectDir, nodeBin, suitecloudEntry } = require('./env');
const { suitecloud, log } = require('./runner');

const CACHE_FILE = () => path.join(baseDir(), 'accounts.json');

/** Canonical form: uppercase, hyphens to underscores. "9937091-sb1" -> "9937091_SB1" */
function normalizeAccountId(id) {
    return String(id || '').trim().toUpperCase().replace(/-/g, '_');
}

function readCache() {
    try { return JSON.parse(fs.readFileSync(CACHE_FILE(), 'utf8')); }
    catch (_) { return {}; }
}

function writeCache(cache) {
    fs.writeFileSync(CACHE_FILE(), JSON.stringify(cache, null, 2) + '\n');
}

/** Parse `account:manageauth --list` -> [authId, ...] */
function listAuthIds() {
    const res = suitecloud(['account:manageauth', '--list'], { cwd: projectDir() });
    if (res.code !== 0) return [];
    return res.output
        .split(/\r?\n/)
        .map(l => l.replace(/\[[0-9;]*[A-Za-z]/g, '').trim()) // strip ANSI
        .filter(l => l.includes('|'))
        .map(l => l.split('|')[0].trim())
        .filter(Boolean);
}

/** `account:manageauth --info <authid>` -> normalized account id or null. */
function accountIdOf(authId) {
    const res = suitecloud(['account:manageauth', '--info', authId], { cwd: projectDir() });
    if (res.code !== 0) return null;
    const m = res.output.match(/Account ID:\s*(\S+)/i);
    return m ? normalizeAccountId(m[1]) : null;
}

/**
 * Resolve accountId -> authid. Returns { authId, accountId } or null.
 * Refreshes the cache for authids it has not seen.
 */
function findAuthId(accountId) {
    const wanted = normalizeAccountId(accountId);
    const cache = readCache();
    const authIds = listAuthIds();

    // Drop cache entries whose authid no longer exists.
    for (const id of Object.keys(cache)) {
        if (!authIds.includes(id)) delete cache[id];
    }

    // Cached hit first.
    for (const id of authIds) {
        if (cache[id] && cache[id].accountId === wanted) { writeCache(cache); return { authId: id, accountId: wanted }; }
    }
    // Probe unknown authids.
    for (const id of authIds) {
        if (cache[id]) continue;
        const acct = accountIdOf(id);
        if (acct) cache[id] = { accountId: acct };
        if (acct === wanted) { writeCache(cache); return { authId: id, accountId: wanted }; }
    }
    writeCache(cache);
    return null;
}

/**
 * Launch interactive `suitecloud account:setup` in a visible console and wait
 * (poll) until an authid for the wanted account appears. The user completes
 * browser login there.
 */
async function interactiveSetup(accountId, timeoutMs) {
    const wanted = normalizeAccountId(accountId);
    const before = new Set(listAuthIds());

    log(`No authid for account ${wanted}. Opening SuiteCloud login console...`);
    // Visible window: cmd /k keeps it open so the user can see prompts/errors.
    const child = spawn('cmd.exe', [
        '/c', 'start', `"SuiteCloud Login - account ${wanted}"`, 'cmd', '/k',
        `"${nodeBin()}" "${suitecloudEntry()}" account:setup`
    ], { cwd: projectDir(), windowsVerbatimArguments: true, detached: true, stdio: 'ignore' });
    child.unref();

    const deadline = Date.now() + (timeoutMs || 5 * 60 * 1000);
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 5000));
        const now = listAuthIds();
        const fresh = now.filter(id => !before.has(id));
        for (const id of fresh) {
            const acct = accountIdOf(id);
            if (acct) {
                const cache = readCache();
                cache[id] = { accountId: acct };
                writeCache(cache);
                if (acct === wanted) return { authId: id, accountId: wanted };
                log(`New authid "${id}" is for account ${acct}, not ${wanted}; still waiting...`);
            }
        }
    }
    throw new Error(
        `Timed out waiting for SuiteCloud login for account ${wanted}. ` +
        `Complete "suitecloud account:setup" for that account and retry.`
    );
}

/** Full resolution: existing authid or interactive login. */
async function resolveAccount(accountId, opts) {
    const options = opts || {};
    const hit = findAuthId(accountId);
    if (hit) return hit;
    if (options.noInteractive) {
        throw new Error(`No SuiteCloud authid found for account ${normalizeAccountId(accountId)} and interactive login is disabled.`);
    }
    return interactiveSetup(accountId, options.timeoutMs);
}

module.exports = { normalizeAccountId, findAuthId, resolveAccount, listAuthIds, accountIdOf };
