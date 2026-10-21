import {
  DEFAULT_MODE,
  NATIVE_HOST,
  formatMode,
  hostPermissionPatterns,
  parseFilePath,
  parseMode,
  parseSiteUrl,
  patternsInUse,
} from "./rules.js";

const rulesBody = document.getElementById("rules");
const emptyHint = document.getElementById("empty");
const addForm = document.getElementById("add-form");
const addError = document.getElementById("add-error");
const helperStatus = document.getElementById("helper-status");

// Snapshot from the last render, for checks that must stay synchronous so a
// following `chrome.permissions.request` still counts as a user gesture.
let currentRules = [];
const statusCells = new Map();

async function loadRules() {
  const { rules = [] } = await chrome.storage.local.get("rules");
  return rules;
}

async function saveRules(rules) {
  await chrome.storage.local.set({ rules });
}

async function updateRule(id, patch) {
  const rules = await loadRules();
  await saveRules(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
}

async function deleteFile(path) {
  const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: "delete", path });
  if (!response?.ok) throw new Error(response?.error ?? "No response from the native helper.");
}

/** Drops host grants no remaining rule needs, so removing a site revokes its access. */
async function revokeUnusedPermissions(rules) {
  const inUse = patternsInUse(rules.filter((rule) => rule.enabled));
  const { origins = [] } = await chrome.permissions.getAll();
  const unused = origins.filter((origin) => !inUse.has(origin));
  if (unused.length > 0) await chrome.permissions.remove({ origins: unused });
}

async function checkHelper() {
  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: "ping" });
    helperStatus.textContent = `Native helper connected (version ${response.version}).`;
    helperStatus.classList.remove("error");
  } catch (error) {
    helperStatus.textContent =
      `Native helper unavailable: ${error.message} ` +
      "Run install.py from the cookie-dump repository as this browser's user, then reopen this page.";
    helperStatus.classList.add("error");
  }
}

function showStatus(statusCell, status) {
  statusCell.className = "status";
  if (!status) {
    statusCell.textContent = "Waiting…";
    return;
  }
  const time = new Date(status.at).toLocaleString();
  if (status.ok) {
    const noun = status.cookieCount === 1 ? "cookie" : "cookies";
    statusCell.textContent = `Wrote ${status.cookieCount} ${noun} at ${time}`;
    statusCell.classList.add("ok");
  } else {
    statusCell.textContent = `${status.error} (${time})`;
    statusCell.classList.add("error");
  }
}

function pathTakenByOtherRule(path, ruleId) {
  return currentRules.some((rule) => rule.path === path && rule.id !== ruleId);
}

function cell(...children) {
  const td = document.createElement("td");
  td.append(...children);
  return td;
}

function renderRule(rule, status) {
  const row = document.createElement("tr");

  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = rule.enabled;
  enabled.addEventListener("change", async () => {
    if (enabled.checked) {
      // Must run before any await so the click still counts as a user gesture.
      const granted = await chrome.permissions.request({ origins: hostPermissionPatterns(rule.url) });
      if (!granted) {
        enabled.checked = false;
        return;
      }
      await updateRule(rule.id, { enabled: true });
    } else {
      await updateRule(rule.id, { enabled: false });
      await revokeUnusedPermissions(await loadRules());
    }
  });

  const url = cell(rule.url);
  url.className = "url";

  const path = document.createElement("input");
  path.name = "path";
  path.value = rule.path;
  path.addEventListener("change", async () => {
    let newPath;
    try {
      newPath = parseFilePath(path.value);
    } catch (error) {
      alert(error.message);
      path.value = rule.path;
      return;
    }
    if (newPath === rule.path) return;
    if (pathTakenByOtherRule(newPath, rule.id)) {
      alert(`Another site already writes to ${newPath}.`);
      path.value = rule.path;
      return;
    }
    await updateRule(rule.id, { path: newPath });
    try {
      await deleteFile(rule.path);
    } catch (error) {
      alert(`Could not delete the old file ${rule.path}: ${error.message}`);
    }
  });

  const mode = document.createElement("input");
  mode.name = "mode";
  mode.value = formatMode(rule.mode);
  mode.addEventListener("change", async () => {
    try {
      await updateRule(rule.id, { mode: parseMode(mode.value) });
    } catch (error) {
      alert(error.message);
      mode.value = formatMode(rule.mode);
    }
  });

  const statusCell = document.createElement("td");
  if (rule.enabled) {
    showStatus(statusCell, status);
  } else {
    statusCell.className = "status";
    statusCell.textContent = "Off. The file keeps its last contents.";
  }
  statusCells.set(rule.id, statusCell);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove";
  remove.addEventListener("click", async () => {
    if (!confirm(`Stop saving cookies for ${rule.url} and delete ${rule.path}?`)) return;
    const rules = (await loadRules()).filter((r) => r.id !== rule.id);
    await saveRules(rules);
    await chrome.storage.local.remove(`status:${rule.id}`);
    await chrome.storage.session.remove(`last:${rule.id}`);
    await revokeUnusedPermissions(rules);
    try {
      await deleteFile(rule.path);
    } catch (error) {
      alert(`The rule was removed, but ${rule.path} could not be deleted: ${error.message}`);
    }
  });

  row.append(cell(enabled), url, cell(path), cell(mode), statusCell, cell(remove));
  return row;
}

async function render() {
  const rules = await loadRules();
  currentRules = rules;
  statusCells.clear();
  const statuses = await chrome.storage.local.get(rules.map((rule) => `status:${rule.id}`));
  rulesBody.replaceChildren(...rules.map((rule) => renderRule(rule, statuses[`status:${rule.id}`])));
  emptyHint.hidden = rules.length > 0;
}

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  addError.hidden = true;
  const data = new FormData(addForm);
  let rule;
  try {
    rule = {
      id: crypto.randomUUID(),
      enabled: true,
      url: parseSiteUrl(String(data.get("url"))),
      path: parseFilePath(String(data.get("path"))),
      mode: parseMode(String(data.get("mode") || formatMode(DEFAULT_MODE))),
    };
  } catch (error) {
    addError.textContent = error.message;
    addError.hidden = false;
    return;
  }

  if (pathTakenByOtherRule(rule.path, rule.id)) {
    addError.textContent = `Another site already writes to ${rule.path}.`;
    addError.hidden = false;
    return;
  }

  // Must run before any await so the submit still counts as a user gesture.
  const granted = await chrome.permissions.request({ origins: hostPermissionPatterns(rule.url) });
  if (!granted) {
    addError.textContent = "Site access was not granted, so the cookies can't be read.";
    addError.hidden = false;
    return;
  }

  await saveRules([...(await loadRules()), rule]);
  addForm.reset();
});

document.getElementById("sync-now").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "syncNow" });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.rules) {
    render();
    return;
  }
  // Status-only updates patch their cell so typing in a row isn't interrupted.
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith("status:")) continue;
    const ruleId = key.slice("status:".length);
    const statusCell = statusCells.get(ruleId);
    if (statusCell && currentRules.find((rule) => rule.id === ruleId)?.enabled) {
      showStatus(statusCell, change.newValue);
    }
  }
});

checkHelper();
render();
