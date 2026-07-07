'use strict';

/**
 * Environment resolution for the SDF deploy tool.
 *
 * Works in two modes:
 *  - packaged: running as sdfDeploy.exe (vercel/pkg). baseDir = folder of the exe.
 *    Expects siblings:  runtime/node.exe  and  node_modules/@oracle/suitecloud-cli
 *  - dev: running via `node src/cli.js`. baseDir = sdf_tool root. Uses PATH node
 *    and local/global suitecloud-cli.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const IS_PKG = typeof process.pkg !== 'undefined';

function baseDir() {
    return IS_PKG ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
}

/** Folder holding the reusable SDF project (created on demand). */
function projectDir() {
    return path.join(baseDir(), 'sdf-project');
}

/** node.exe used to run the SuiteCloud CLI. */
function nodeBin() {
    const bundled = path.join(baseDir(), 'runtime', 'node.exe');
    if (fs.existsSync(bundled)) return bundled;
    if (!IS_PKG) return process.execPath;   // dev: the node running us
    return 'node';                          // last resort: PATH
}

/** Entry JS of @oracle/suitecloud-cli. */
function suitecloudEntry() {
    const candidates = [
        path.join(baseDir(), 'node_modules', '@oracle', 'suitecloud-cli', 'src', 'suitecloud.js')
    ];
    try {
        // dev / global fallbacks
        candidates.push(require.resolve('@oracle/suitecloud-cli/src/suitecloud.js'));
    } catch (_) { /* not installed locally */ }
    try {
        const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true }).trim();
        candidates.push(path.join(globalRoot, '@oracle', 'suitecloud-cli', 'src', 'suitecloud.js'));
    } catch (_) { /* npm not available */ }

    for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
    }
    throw new Error(
        'SuiteCloud CLI not found. Expected node_modules/@oracle/suitecloud-cli beside the exe ' +
        '(bundled) or installed locally/globally.'
    );
}

/** The SuiteCloud CLI SDK is a Java jar: verify a JVM is reachable. */
function checkJava() {
    try {
        execFileSync('java', ['-version'], { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
        return true;
    } catch (_) {
        throw new Error(
            'Java (JDK 17+) not found on PATH. The SuiteCloud CLI requires it. ' +
            'Install a JDK or add it to PATH, then retry.'
        );
    }
}

module.exports = { IS_PKG, baseDir, projectDir, nodeBin, suitecloudEntry, checkJava };
