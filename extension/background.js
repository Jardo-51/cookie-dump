import { NATIVE_HOST, cookieAffectsSite, formatCookieHeader, hostPermissionPatterns } from "./rules.js";

// Cookies often change in bursts (several Set-Cookie headers per response).
const DEBOUNCE_MS = 500;

const debounceTimers = new Map();
const ruleQueues = new Map();

async function loadRules() {
  const { rules = [] } = await chrome.storage.local.get("rules");
  return rules;
}

async function setStatus(ruleId, status) {
  await chrome.storage.local.set({ [`status:${ruleId}`]: { ...status, at: Date.now() } });
}

async function writeRuleFile(rule, force) {
  if (!rule.enabled) return;

  const granted = await chrome.permissions.contains({
    origins: hostPermissionPatterns(rule.url),
  });
  if (!granted) {
    await setStatus(rule.id, { ok: false, error: "Site access not granted. Turn the rule off and on." });
    return;
  }

  const cookies = await chrome.cookies.getAll({ url: rule.url });
  const content = formatCookieHeader(cookies);

  // Skip identical writes so the file's mtime reflects real changes. Session
  // storage is cleared when the browser exits, so every file is rewritten once
  // per browser session (which also restores files in a wiped /tmp).
  const lastKey = `last:${rule.id}`;
  const { [lastKey]: last } = await chrome.storage.session.get(lastKey);
  if (!force && last && last.path === rule.path && last.mode === rule.mode && last.content === content) {
    return;
  }

  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      type: "write",
      path: rule.path,
      mode: rule.mode,
      content,
    });
    if (!response?.ok) throw new Error(response?.error ?? "No response from the native helper.");
  } catch (error) {
    await chrome.storage.session.remove(lastKey);
    await setStatus(rule.id, { ok: false, error: error.message });
    return;
  }

  await chrome.storage.session.set({ [lastKey]: { path: rule.path, mode: rule.mode, content } });
  await setStatus(rule.id, { ok: true, cookieCount: cookies.length });
}

/** Runs one write per rule at a time so overlapping triggers can't interleave. */
function enqueue(rule, force) {
  const previous = ruleQueues.get(rule.id) ?? Promise.resolve();
  const next = previous
    .then(() => writeRuleFile(rule, force))
    .catch((error) => console.error(`cookie-dump: rule ${rule.url} failed`, error));
  ruleQueues.set(rule.id, next);
  return next;
}

async function syncAll(force = false) {
  const rules = await loadRules();
  await Promise.all(rules.map((rule) => enqueue(rule, force)));
}

chrome.runtime.onStartup.addListener(() => syncAll());
chrome.runtime.onInstalled.addListener(() => syncAll());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.rules) syncAll();
});

chrome.cookies.onChanged.addListener(async ({ cookie }) => {
  const rules = await loadRules();
  for (const rule of rules) {
    if (!rule.enabled || !cookieAffectsSite(cookie, rule.url)) continue;
    clearTimeout(debounceTimers.get(rule.id));
    debounceTimers.set(
      rule.id,
      setTimeout(async () => {
        debounceTimers.delete(rule.id);
        // Re-read so an edit made during the debounce window wins.
        const current = (await loadRules()).find((r) => r.id === rule.id);
        if (current) enqueue(current, false);
      }, DEBOUNCE_MS),
    );
  }
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "syncNow") {
    syncAll(true).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
