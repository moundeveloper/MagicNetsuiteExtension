'use strict';

/** Spawn the SuiteCloud CLI (bundled node + suitecloud.js) inside the SDF project. */

const { spawnSync } = require('child_process');
const { nodeBin, suitecloudEntry, projectDir } = require('./env');

const log = (...a) => process.stderr.write(a.join(' ') + '\n');

/**
 * Run `suitecloud <args>` with cwd = project dir.
 * Returns { code, output } (stdout+stderr combined). Output is streamed to stderr.
 */
function suitecloud(args, opts) {
    const options = opts || {};
    const cwd = options.cwd || projectDir();
    const cmd = [suitecloudEntry(), ...args];
    log(`$ suitecloud ${args.join(' ')}`);
    const res = spawnSync(nodeBin(), cmd, {
        cwd,
        encoding: 'utf8',
        windowsHide: true,
        timeout: options.timeoutMs || 10 * 60 * 1000
    });
    const output = [res.stdout, res.stderr].filter(Boolean).join('\n');
    log(output);
    if (res.error) return { code: 1, output: output + '\n' + res.error.message };
    return { code: res.status ?? 1, output };
}

module.exports = { suitecloud, log };
