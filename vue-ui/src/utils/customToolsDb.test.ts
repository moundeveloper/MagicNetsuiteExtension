import { describe, expect, it, vi } from 'vitest';
vi.mock('./api', () => ({ callApi: vi.fn() }));
import { buildCustomToolExecutionCode, type CustomToolRecord } from './customToolsDb';

const tool: CustomToolRecord = {
  id: 'browser-test', name: 'scrape_page', displayName: 'Scrape page', description: 'Read results',
  tags: [], modules: [], domain: 'client', inputSchema: { type: 'object' },
  code: 'const tab = await context.browser.openTab({url:input.url}); return await context.browser.extract(tab.id);',
  status: 'draft', risk: 'read', enabled: true, testInput: {}, createdAt: '', updatedAt: ''
};

describe('custom tool browser context', () => {
  it('passes the browser helper and safely serialized input into a client tool', async () => {
    const browser = { openTab: vi.fn(async () => ({ id: 123 })), extract: vi.fn(async () => ({ content: 'results' })) };
    const url = 'https://example.test/?q="quoted"';
    const run = new Function('__customToolBrowser', buildCustomToolExecutionCode(tool, { url }));
    expect(await run(browser)).toEqual({ content: 'results' });
    expect(browser.openTab).toHaveBeenCalledWith({ url });
    expect(browser.extract).toHaveBeenCalledWith(123);
  });

  it('server tools do not reference the page helper', () => {
    const code = buildCustomToolExecutionCode({ ...tool, domain: 'server', code: 'return {hasBrowser: !!context.browser};' }, {});
    expect(new Function(code)()).toEqual({ hasBrowser: false });
    expect(code).not.toContain('__customToolBrowser');
  });
});
