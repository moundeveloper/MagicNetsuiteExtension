import { navigationViews } from '../shared/navigationViews';

const TYPE = 'CUSTOM_TOOL_BROWSER';
const PREFIX = 'customToolBrowser:';
const TTL = 10 * 60 * 1000;
type Session = { owner: number; risk: string; expires: number; tabs: Record<string, boolean> };
const key = (token: string) => PREFIX + token;
const webUrl = (value: string) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) page URLs are supported.');
  return url.href;
};
const tabResult = (tab: { id?: number; url?: string; pendingUrl?: string; title?: string }) => ({ id: tab.id, url: tab.url || tab.pendingUrl, title: tab.title });

async function dispose(token: string, session: Session) {
  await chrome.storage.session.remove(key(token));
  await chrome.alarms.clear(key(token));
  await Promise.all(Object.entries(session.tabs).filter(([, keep]) => !keep)
    .map(([id]) => chrome.tabs.remove(Number(id)).catch(() => {})));
}

// Fixed operations only: tool source is never evaluated in the extension worker.
export async function handleCustomToolBrowser(message: any, sender: { id?: string; url?: string; tab?: { id?: number } }) {
  const owner = sender.tab?.id;
  if (sender.id !== chrome.runtime.id || !owner ||
      !/^https?:\/\/[^/]+\.app\.netsuite\.com\//.test(sender.url || '')) throw new Error('Browser bridge requires a NetSuite content script.');
  if (message.operation === 'begin') {
    const stored = await chrome.storage.session.get(null);
    for (const [entry, session] of Object.entries(stored)) {
      if (entry.startsWith(PREFIX) && (session as Session).expires < Date.now()) await dispose(entry.slice(PREFIX.length), session as Session);
    }
    const token = crypto.randomUUID();
    const session: Session = { owner, risk: message.risk === 'write' ? 'write' : 'read', expires: Date.now() + TTL, tabs: {} };
    await chrome.storage.session.set({ [key(token)]: session });
    await chrome.alarms.create(key(token), { when: session.expires });
    return { token };
  }
  const token = String(message.token || '');
  const session = (await chrome.storage.session.get(key(token)))[key(token)] as Session;
  if (!session || session.owner !== owner || session.expires < Date.now()) throw new Error('Browser session expired or belongs to another tab.');
  const args = message.args || {};
  const operation = message.operation;
  if (operation === 'dispose') { await dispose(token, session); return { closed: true }; }
  if (operation === 'openTab' || operation === 'openView') {
    if (Object.keys(session.tabs).length >= 10) throw new Error('A tool can own at most 10 tabs.');
    let url: string;
    if (operation === 'openView') {
      const route = String(args.route || '/');
      if (!Object.hasOwn(navigationViews, route)) throw new Error('Unknown extension view route.');
      url = chrome.runtime.getURL('dist/vue-ui/index.html') + '#' + route;
    } else url = webUrl(String(args.url));
    const tab = await chrome.tabs.create({ url, active: args.active === true });
    session.tabs[String(tab.id)] = args.keepOpen === true;
    await chrome.storage.session.set({ [key(token)]: session });
    return tabResult(tab);
  }
  const tabId = Number(args.tabId);
  if (!Object.hasOwn(session.tabs, String(tabId))) throw new Error('Tools may only access tabs opened by this execution.');
  if (operation === 'closeTab') {
    await chrome.tabs.remove(tabId);
    delete session.tabs[String(tabId)];
    await chrome.storage.session.set({ [key(token)]: session });
    return { closed: true };
  }
  if (operation === 'getTab') return tabResult(await chrome.tabs.get(tabId));
  if (operation === 'navigate') {
    return tabResult(await chrome.tabs.update(tabId, { url: webUrl(String(args.url)) }));
  }
  if (!['waitForSelector', 'extract', 'click', 'fill'].includes(operation)) throw new Error('Unsupported browser operation.');
  if (['click', 'fill'].includes(operation) && session.risk !== 'write') throw new Error('Click and fill require risk: write.');
  const loadDeadline = Date.now() + 30000;
  let current = await chrome.tabs.get(tabId);
  while (current.status !== 'complete' && Date.now() < loadDeadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    current = await chrome.tabs.get(tabId);
  }
  if (current.status !== 'complete') throw new Error('Page did not finish loading within 30 seconds.');
  webUrl(current.url || current.pendingUrl || '');
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (operation, args) => {
      const selector = String(args.selector || 'body');
      const timeout = Math.min(30000, Math.max(0, Number(args.timeoutMs) || 10000));
      const end = Date.now() + timeout;
      let element = document.querySelector(selector);
      while (!element && Date.now() < end) {
        await new Promise(resolve => setTimeout(resolve, 100));
        element = document.querySelector(selector);
      }
      if (!element) throw new Error('Selector not found: ' + selector);
      if (operation === 'waitForSelector') return { found: true };
      if (operation === 'click') { (element as HTMLElement).click(); return { clicked: true }; }
      if (operation === 'fill') {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error('Fill requires an input or textarea.');
        const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, String(args.value ?? ''));
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { filled: true };
      }
      const format = args.format || 'text';
      if (!['text', 'html', 'links'].includes(format)) throw new Error('Extraction format must be text, html, or links.');
      const limit = Math.min(200000, Math.max(1, Number(args.maxChars) || 50000));
      const content = format === 'links'
        ? Array.from(element.querySelectorAll('a[href]')).slice(0, 500).map(a => ({ text: (a.textContent || '').slice(0, 1000), url: (a as HTMLAnchorElement).href }))
        : (format === 'html' ? element.outerHTML : (element as HTMLElement).innerText || element.textContent || '').slice(0, limit);
      return { url: location.href, title: document.title, content };
    },
    args: [operation, args]
  });
  return result?.result;
}

export function registerCustomToolBrowser() {
  // Serialize session mutations so concurrent tool calls cannot lose tab ownership.
  const queues = new Map<string, Promise<void>>();
  const enqueue = (token: string, work: () => Promise<void>) => {
    const next = (queues.get(token) || Promise.resolve()).then(work).catch(console.error);
    queues.set(token, next);
    void next.then(() => { if (queues.get(token) === next) queues.delete(token); });
  };
  chrome.alarms.onAlarm.addListener(alarm => {
    if (!alarm.name.startsWith(PREFIX)) return;
    enqueue(alarm.name.slice(PREFIX.length), async () => {
      const session = (await chrome.storage.session.get(alarm.name))[alarm.name];
      if (session) await dispose(alarm.name.slice(PREFIX.length), session);
    });
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type !== TYPE) return;
    enqueue(String(message.token || 'begin'), async () => {
      try { respond({ result: await handleCustomToolBrowser(message, sender) }); }
      catch (error) { respond({ error: String(error?.message || error) }); }
    });
    return true;
  });
  chrome.tabs.onRemoved.addListener(owner => {
    void (async () => {
      const stored = await chrome.storage.session.get(null);
      for (const [entry, session] of Object.entries(stored)) {
        if (entry.startsWith(PREFIX) && (session as Session).owner === owner) enqueue(entry.slice(PREFIX.length), async () => {
          const latest = (await chrome.storage.session.get(entry))[entry];
          if (latest) await dispose(entry.slice(PREFIX.length), latest);
        });
      }
    })().catch(console.error);
  });
}
