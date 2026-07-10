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
const LOGIN_LOCK_FILE = (accountId) => path.join(baseDir(), `auth-login-${normalizeAccountId(accountId)}.lock`);
const LOGIN_LOCK_MAX_AGE_MS = 10 * 60 * 1000;

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

function processIsAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; }
    catch (_) { return false; }
}

/**
 * Only one companion process may open an account:setup console for an account.
 * MCP clients often time out/retry tool calls, and several MCP server processes
 * may be running at once; without this cross-process lock every retry opens a
 * new, apparently empty terminal.
 */
function acquireLoginLock(accountId) {
    const lockPath = LOGIN_LOCK_FILE(accountId);
    const payload = { pid: process.pid, accountId: normalizeAccountId(accountId), createdAt: Date.now() };
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = fs.openSync(lockPath, 'wx');
            fs.writeFileSync(fd, JSON.stringify(payload));
            fs.closeSync(fd);
            return { owned: true, lockPath };
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            let existing = null;
            try { existing = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch (_) { /* stale/broken */ }
            const stale = !existing || !processIsAlive(Number(existing.pid)) ||
                Date.now() - Number(existing.createdAt || 0) > LOGIN_LOCK_MAX_AGE_MS;
            if (!stale) return { owned: false, lockPath, ownerPid: existing.pid };
            try { fs.unlinkSync(lockPath); } catch (_) { return { owned: false, lockPath }; }
        }
    }
    return { owned: false, lockPath };
}

function launchInteractiveConsole(accountId) {
    // `start "" ...` supplies the mandatory empty title argument. The old
    // windowsVerbatimArguments + nested `cmd /k` command was parsed
    // inconsistently and left behind blank consoles. /wait keeps the detached
    // launcher alive only as long as the real SuiteCloud login process.
    const child = spawn('cmd.exe', [
        '/d', '/c', 'start', '', '/wait',
        nodeBin(), suitecloudEntry(), 'account:setup'
    ], { cwd: projectDir(), detached: true, stdio: 'ignore' });
    child.unref();
    log(`SuiteCloud login prompt opened for account ${normalizeAccountId(accountId)} (launcher pid ${child.pid}).`);
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
    const lock = acquireLoginLock(wanted);

    if (lock.owned) {
        log(`No authid for account ${wanted}. Opening one SuiteCloud login console...`);
        launchInteractiveConsole(wanted);
    } else {
        log(`SuiteCloud login for account ${wanted} is already pending in another process${lock.ownerPid ? ` (${lock.ownerPid})` : ''}; waiting without opening another console...`);
    }

    try {
        const deadline = Date.now() + (timeoutMs || 5 * 60 * 1000);
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 3000));
            // Re-resolve all known authids rather than only IDs created after
            // this process started. This also lets lock waiters observe the
            // auth/cache written by the lock owner.
            const hit = findAuthId(wanted);
            if (hit) return hit;
        }
        throw new Error(
            `Timed out waiting for SuiteCloud login for account ${wanted}. ` +
            `Complete the open "suitecloud account:setup" login and retry.`
        );
    } finally {
        if (lock.owned) {
            try {
                const current = JSON.parse(fs.readFileSync(lock.lockPath, 'utf8'));
                if (Number(current.pid) === process.pid) fs.unlinkSync(lock.lockPath);
            } catch (_) { /* already removed */ }
        }
    }
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
