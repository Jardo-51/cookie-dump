// Pure helpers shared by the background worker and the options page.
// Kept free of `chrome.*` calls so they can be unit-tested with Node.

/** Must match the `name` in the native host manifest written by install.py. */
export const NATIVE_HOST = "cookie_dump";

export const DEFAULT_MODE = 0o644;

/** Normalizes a user-entered site URL to `origin + path`, or throws. */
export function parseSiteUrl(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a full URL, e.g. https://jira.example.com/");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https URLs are supported.");
  }
  return url.origin + url.pathname;
}

export function parseFilePath(input) {
  const path = input.trim();
  if (!path.startsWith("/")) {
    throw new Error("The file path must be absolute, e.g. /tmp/jira-cookies.txt");
  }
  return path;
}

/** Parses an octal permission string such as "644" or "0600". */
export function parseMode(input) {
  const text = input.trim();
  if (!/^[0-7]{3,4}$/.test(text)) {
    throw new Error("The file mode must be octal, e.g. 644 or 600.");
  }
  return parseInt(text, 8);
}

export function formatMode(mode) {
  return mode.toString(8).padStart(3, "0");
}

/**
 * Host permissions needed to read every cookie sent to `siteUrl`.
 *
 * Chromium checks a cookie against the extension's host permissions using the
 * cookie's own domain, so a cookie set on `.example.com` is hidden unless the
 * extension may access `example.com` itself. We therefore request the site's
 * host plus each parent domain (exact hosts, not their subdomains).
 */
export function hostPermissionPatterns(siteUrl) {
  const { hostname } = new URL(siteUrl);
  const isIp = /^[\d.]+$/.test(hostname) || hostname.startsWith("[");
  const labels = hostname.split(".");
  if (isIp || labels.length < 2) {
    return [`*://${hostname}/*`];
  }
  const patterns = [];
  for (let i = 0; i < labels.length - 1; i++) {
    patterns.push(`*://${labels.slice(i).join(".")}/*`);
  }
  return patterns;
}

/** Whether a change to `cookie` can affect the cookies sent to `siteUrl`. */
export function cookieAffectsSite(cookie, siteUrl) {
  const { hostname } = new URL(siteUrl);
  const domain = cookie.domain.replace(/^\./, "");
  if (cookie.hostOnly) {
    return hostname === domain;
  }
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/** Formats cookies as a `Cookie` request header value. */
export function formatCookieHeader(cookies) {
  // Browsers send cookies with longer paths first.
  return [...cookies]
    .sort((a, b) => b.path.length - a.path.length)
    .map((cookie) => (cookie.name ? `${cookie.name}=${cookie.value}` : cookie.value))
    .join("; ");
}

/** Host patterns still needed by `rules`; used to drop unused grants. */
export function patternsInUse(rules) {
  return new Set(rules.flatMap((rule) => hostPermissionPatterns(rule.url)));
}
