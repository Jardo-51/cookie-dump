import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cookieAffectsSite,
  formatCookieHeader,
  hostPermissionPatterns,
  parseFilePath,
  parseMode,
  parseSiteUrl,
  patternsInUse,
} from "../extension/rules.js";

test("parseSiteUrl keeps origin and path, drops query and hash", () => {
  assert.equal(parseSiteUrl(" https://jira.example.com/browse?x=1#y "), "https://jira.example.com/browse");
  assert.throws(() => parseSiteUrl("jira.example.com"), /full URL/);
  assert.throws(() => parseSiteUrl("ftp://example.com/"), /http and https/);
});

test("parseFilePath requires an absolute path", () => {
  assert.equal(parseFilePath(" /tmp/jira-cookies.txt "), "/tmp/jira-cookies.txt");
  assert.throws(() => parseFilePath("jira-cookies.txt"), /absolute/);
});

test("parseMode reads octal", () => {
  assert.equal(parseMode("644"), 0o644);
  assert.equal(parseMode("0600"), 0o600);
  assert.throws(() => parseMode("888"), /octal/);
});

test("hostPermissionPatterns covers the host and its parent domains", () => {
  assert.deepEqual(hostPermissionPatterns("https://jira.corp.example.com/"), [
    "*://jira.corp.example.com/*",
    "*://corp.example.com/*",
    "*://example.com/*",
  ]);
  assert.deepEqual(hostPermissionPatterns("http://localhost:8080/"), ["*://localhost/*"]);
  assert.deepEqual(hostPermissionPatterns("http://10.0.0.5/"), ["*://10.0.0.5/*"]);
});

test("patternsInUse merges shared parent domains", () => {
  const inUse = patternsInUse([{ url: "https://jira.example.com/" }, { url: "https://wiki.example.com/" }]);
  assert.deepEqual([...inUse].sort(), ["*://example.com/*", "*://jira.example.com/*", "*://wiki.example.com/*"]);
});

test("cookieAffectsSite matches host-only and domain cookies", () => {
  const site = "https://jira.example.com/";
  assert.equal(cookieAffectsSite({ domain: "jira.example.com", hostOnly: true }, site), true);
  assert.equal(cookieAffectsSite({ domain: "example.com", hostOnly: true }, site), false);
  assert.equal(cookieAffectsSite({ domain: ".example.com", hostOnly: false }, site), true);
  assert.equal(cookieAffectsSite({ domain: ".other.com", hostOnly: false }, site), false);
  assert.equal(cookieAffectsSite({ domain: ".ample.com", hostOnly: false }, site), false);
});

test("formatCookieHeader orders longer paths first", () => {
  const header = formatCookieHeader([
    { name: "a", value: "1", path: "/" },
    { name: "b", value: "2", path: "/jira" },
    { name: "", value: "bare", path: "/" },
  ]);
  assert.equal(header, "b=2; a=1; bare");
  assert.equal(formatCookieHeader([]), "");
});
