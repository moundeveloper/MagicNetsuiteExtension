import { DASHBOARD_LAUNCH_KEY, matchesDashboardShortcut, type DashboardLaunchPreferences } from '../../../shared/dashboardLaunch';
import { DASHBOARDS_STORAGE_KEY } from '../../../shared/dashboards';
import { installDashboardWheel, preferredWheelItems, DEFAULT_DASHBOARD_WHEEL_SHORTCUT, type DashboardWheelItem } from '../../../shared/dashboardWheel';
import { openDashboardWidget, hasDashboardWidget } from '../ui/widgets/dashboard';
let initialized = false;
export const setupKeyboardShortcuts = () => {
  if (initialized || window.top !== window || !location.hostname.endsWith('.app.netsuite.com')) return;
  initialized = true;
  chrome.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message.type === 'NAVIGATOR_WIDGET_EXISTS') { sendResponse({exists: hasDashboardWidget()}); return; }
    if (message.type === 'OPEN_NAVIGATOR_WIDGET') {
      try { openDashboardWidget(message.path, message.label); sendResponse({ok: true}); }
      catch (error) { sendResponse({ok: false, error: error instanceof Error ? error.message : String(error)}); }
      return;
    }
    if (message.type !== 'NAVIGATOR_PAGE_VISIBLE') return;
    const frame = document.getElementById('magic-netsuite-frame') as HTMLIFrameElement | null;
    const style = frame && getComputedStyle(frame);
    const execution = frame && new URL(frame.src).searchParams.has('magicExecutionSurface');
    sendResponse({ visible: Boolean(frame && !execution && style?.display !== 'none' && style?.visibility !== 'hidden'
      && style?.pointerEvents !== 'none' && Number(style?.opacity) > 0 && frame.getBoundingClientRect().width > 0) });
  });
  let preferences: DashboardLaunchPreferences = {};
  let validIds = new Set<string>();
  let wheelItems: DashboardWheelItem[] = [];
  let wheelShortcut = DEFAULT_DASHBOARD_WHEEL_SHORTCUT;
  const refresh = async () => {
    const [stored, synced] = await Promise.all([
      chrome.storage.local.get([DASHBOARD_LAUNCH_KEY, DASHBOARDS_STORAGE_KEY]),
      chrome.storage.sync.get('magic_netsuite_settings'),
    ]);
    preferences = stored[DASHBOARD_LAUNCH_KEY] || {};
    validIds = new Set((stored[DASHBOARDS_STORAGE_KEY] || []).map(d => d.id));
    const account = location.hostname.split('.')[0].toUpperCase().replace(/-/g, '_');
    const settings = synced.magic_netsuite_settings as { dashboardWheelShortcut?: string; preferredFeatures?: string[] } | undefined;
    wheelItems = [...preferredWheelItems(settings?.preferredFeatures), ...(stored[DASHBOARDS_STORAGE_KEY] || []).filter(d => !d.account || d.account.toUpperCase().replace(/-/g, '_') === account)
      .map(d => ({ id: d.id, title: d.title, mode: d.mode, account: d.account, pinned: Boolean(preferences[d.id]?.pinned) }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned))];
    const configured = settings?.dashboardWheelShortcut;
    wheelShortcut = configured ?? DEFAULT_DASHBOARD_WHEEL_SHORTCUT;
  };
  void refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'local' && (changes[DASHBOARD_LAUNCH_KEY] || changes[DASHBOARDS_STORAGE_KEY])) || (area === 'sync' && changes.magic_netsuite_settings)) void refresh();
  });
  let launching = false;
  function launch(id: string, path?: string) {
    if (launching) return;
    launching = true;
    chrome.runtime.sendMessage(path ? { type: 'OPEN_PREFERRED_VIEW', path } : { type: 'OPEN_SAVED_DASHBOARD', dashboardId: id })
      .then(response => { if (!response?.ok) throw new Error(response?.error || 'Could not open dashboard.'); })
      .catch(error => {
        document.getElementById('magic-dashboard-shortcut-error')?.remove();
        const notice = document.createElement('div');
        notice.id = 'magic-dashboard-shortcut-error';
        notice.setAttribute('role', 'alert');
        notice.textContent = error.message;
        notice.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:420px;padding:14px 18px;border-radius:8px;background:#242b39;color:white;font:13px/1.5 system-ui;box-shadow:0 5px 24px #0005';
        document.body.appendChild(notice);
        setTimeout(() => notice.remove(), 8000);
      }).finally(() => { launching = false; });
  }
  installDashboardWheel({ shortcut: () => wheelShortcut, items: () => wheelItems, open: item => launch(item.id, item.kind === 'view' ? item.path : undefined) });
  document.addEventListener('keydown', e => {
    if (e.repeat || e.isComposing || e.defaultPrevented) return;
    const match = Object.entries(preferences).find(([id, pref]) => validIds.has(id) && matchesDashboardShortcut(e, pref.shortcut || ''));
    if (!match) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    launch(match[0]);
  }, true);
};
