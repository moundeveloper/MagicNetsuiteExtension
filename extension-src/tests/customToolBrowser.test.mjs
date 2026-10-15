import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import fs from 'node:fs';
import { build } from '../../vue-ui/node_modules/esbuild/lib/main.js';
import { JSDOM } from '../../vue-ui/node_modules/jsdom/lib/api.js';

const bundle = await build({ entryPoints: [new URL('../customToolBrowser.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')], bundle: true, write: false, platform: 'node', format: 'cjs' });
function fixture() {
  const stored = {}, tabs = new Map(), alarms = new Map(), removed = [];
  const dom = new JSDOM('<div class="results">Found data <a href="/record">Record</a></div><input id="field">', { url: 'https://example.test/page' });
  let nextId = 100;
  const chrome = {
    runtime: { id: 'extension-id', getURL: path => 'chrome-extension://extension-id/' + path },
    storage: { session: {
      get: async key => structuredClone(key === null ? stored : { [key]: stored[key] }),
      set: async entries => Object.assign(stored, structuredClone(entries)),
      remove: async key => { delete stored[key]; }
    } },
    alarms: { create: async (name, info) => alarms.set(name, info), clear: async name => alarms.delete(name) },
    tabs: {
      create: async options => { const tab = { id: nextId++, url: options.url, status: 'complete', title: 'Test' }; tabs.set(tab.id, tab); return tab; },
      get: async id => { if (!tabs.has(id)) throw new Error('Tab missing'); return tabs.get(id); },
      update: async (id, options) => Object.assign(tabs.get(id), options),
      remove: async id => { removed.push(id); tabs.delete(id); }
    },
    scripting: { executeScript: async ({ func, args }) => {
      const context = vm.createContext({ document: dom.window.document, location: dom.window.location, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, Event: dom.window.Event, setTimeout });
      context.args = args;
      return [{ result: await vm.runInContext(`(${func.toString()})(...args)`, context) }];
    } }
  };
  const context = vm.createContext({ exports: {}, module: { exports: {} }, chrome, crypto: { randomUUID: () => 'token-' + nextId++ }, URL, console, setTimeout });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const owner = { id: 'extension-id', url: 'https://123.app.netsuite.com/app/home', tab: { id: 1 } };
  const call = (operation, args = {}, token = 'token-100', sender = owner) => context.module.exports.handleCustomToolBrowser({ operation, args, token, risk: args.risk }, sender);
  return { call, owner, stored, tabs, removed, alarms, dom };
}

test('read tool opens, extracts, and cleans up only its temporary tabs', async () => {
  const f = fixture();
  const { token } = await f.call('begin');
  const tab = await f.call('openTab', { url: 'https://example.test' }, token);
  const keep = await f.call('openView', { route: '/custom-tools', keepOpen: true }, token);
  assert.match(keep.url, /index\.html#\/custom-tools$/);
  const text = await f.call('extract', { tabId: tab.id, selector: '.results' }, token);
  assert.match(text.content, /Found data/);
  const links = await f.call('extract', { tabId: tab.id, selector: '.results', format: 'links' }, token);
  assert.equal(links.content[0].url, 'https://example.test/record');
  await assert.rejects(f.call('click', { tabId: tab.id, selector: '.results' }, token), /risk: write/);
  await assert.rejects(f.call('getTab', { tabId: 1 }, token), /only access tabs/);
  await assert.rejects(f.call('getTab', { tabId: tab.id }, token, { ...f.owner, tab: { id: 2 } }), /another tab/);
  await assert.rejects(f.call('openTab', { url: 'chrome://settings' }, token), /HTTP/);
  await assert.rejects(f.call('openView', { route: '/made-up' }, token), /Unknown/);
  await f.call('dispose', {}, token);
  assert.ok(f.removed.includes(tab.id));
  assert.ok(f.tabs.has(keep.id));
  assert.equal(f.alarms.size, 0);
  await assert.rejects(f.call('getTab', { tabId: keep.id }, token), /expired/);
});

test('write tools fill and click, sessions reject expired or non-NetSuite senders', async () => {
  const f = fixture();
  const { token } = await f.call('begin', { risk: 'write' });
  const tab = await f.call('openTab', { url: 'https://example.test' }, token);
  await f.call('fill', { tabId: tab.id, selector: '#field', value: 'hello' }, token);
  assert.equal(f.dom.window.document.querySelector('#field').value, 'hello');
  assert.equal((await f.call('click', { tabId: tab.id, selector: '#field' }, token)).clicked, true);
  f.stored['customToolBrowser:' + token].expires = 0;
  await assert.rejects(f.call('getTab', { tabId: tab.id }, token), /expired/);
  await assert.rejects(f.call('begin', {}, token, { ...f.owner, url: 'https://evil.test' }), /NetSuite/);
  await f.call('begin'); // sweeps expired sessions
  assert.ok(f.removed.includes(tab.id));
});

test('page helper round-trips RPC and disposes on success and tool errors', async () => {
  const listeners = new Set(), operations = [];
  const origin = 'https://123.app.netsuite.com';
  const window = {
    location: { origin },
    addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn); },
    removeEventListener: (type, fn) => listeners.delete(fn),
    postMessage: message => {
      if (message.type !== 'CUSTOM_TOOL_BROWSER_REQUEST') return;
      operations.push(message.operation);
      const result = message.operation === 'openTab' ? { id: 5 } : { content: 'scraped' };
      queueMicrotask(() => {
        for (const fn of listeners) fn({ source: window, origin, data: { ...message, type: 'CUSTOM_TOOL_BROWSER_RESPONSE', result } });
      });
    }
  };
  const context = vm.createContext({ window, location: window.location, console, crypto: { randomUUID: () => String(operations.length) }, setTimeout, clearTimeout, queueMicrotask });
  vm.runInContext(fs.readFileSync(new URL('../../src/netsuiteApi/sandboxCode.js', import.meta.url), 'utf8'), context);
  const result = await window.runQuickScript({}, { code: "const tab = await __customToolBrowser.openTab({url:'https://example.test'}); return await __customToolBrowser.extract(tab.id);", browserSession: 'session', bridgeCapability: 'cap' });
  assert.equal(result.result.content, 'scraped');
  assert.deepEqual(operations, ['openTab', 'extract', 'dispose']);
  const failure = await window.runQuickScript({}, { code: "throw new Error('tool failed');", browserSession: 'session', bridgeCapability: 'cap' });
  assert.equal(failure.error, 'tool failed');
  assert.equal(operations.at(-1), 'dispose');
  assert.equal(listeners.size, 0);
});
