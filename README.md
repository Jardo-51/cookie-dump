# cookie-dump

A browser extension for dumping website cookies into files.

You pick a site and a file, and the extension keeps that file updated with the cookies the
browser would send to the site. The file contains a `Cookie` header value, so another program
(for example a coding agent running as a different Linux user) can reuse your logged-in browser
session:

```sh
curl -H "Cookie: $(cat /tmp/jira-cookies.txt)" https://jira.example.com/rest/api/2/myself
```

The file is rewritten whenever the site's cookies change, when the browser starts, and on demand.
Readers should read it on every request instead of caching it.

Supported browsers: Chromium-based browsers on Linux (Chrome, Chromium, Brave, Edge, Vivaldi).

## How it works

Browser extensions can't write files, so there are two parts:

- `extension/`: reads the cookies with the `chrome.cookies` API (including HttpOnly cookies) and
  sends them to the native helper.
- `native-host/cookie_dump_host.py`: a small Python 3 script the browser starts through
  [native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
  It writes each file atomically (a temporary file renamed over the old one), so readers never see
  a half-written file. Only this extension's ID may start it.

The manifest contains a fixed public `key`, which keeps the extension ID
(`pghmdhffgoipoeicdjlaflmkdbpnmhpp`) the same wherever the unpacked extension is loaded from.

## Install

Requires Python 3.8 or newer. Run the installer **as the user that runs the browser**:

```sh
python3 install.py            # every supported browser with a profile directory
python3 install.py chrome     # or name the browsers
```

It copies the extension and the helper to `~/.local/share/cookie-dump` and registers the helper
with each browser. The copy matters when other users can write to this repository: the installed
files run with the browser user's rights and access its cookies.

Then open the browser's extensions page (e.g. `chrome://extensions`), turn on Developer mode, click
**Load unpacked**, and choose `~/.local/share/cookie-dump/extension`.

After updating the repository, run the installer again and click the extension's reload button.
`python3 install.py --uninstall` removes the helper registration.

Snap and Flatpak browsers aren't supported: their sandbox restricts native helpers and gives them
a private `/tmp`.

## Use

Click the extension's toolbar icon to open its settings, then add a site:

- **Site URL**: the address whose cookies you want, e.g. `https://jira.example.com/`. A path
  narrows the cookies to those sent to that path.
- **File**: an absolute path, e.g. `/tmp/jira-cookies.txt`.
- **Mode**: the file's permissions. `644` lets every user on the machine read it, which is what
  you need when the reader is another user and the file is in `/tmp`. Prefer `640` in a directory
  whose group both users share, so other users can't read your session.

The browser asks for access to the site and its parent domains (e.g. `example.com` for
`jira.example.com`), because login cookies are often set on a parent domain.

Turning a site off stops updating its file and leaves the last contents in place. Removing a site
deletes its file and drops the site access it no longer needs.

When cookies expire, log into the site in the browser again; the file updates on its own.

Writing into `/tmp` fails with "Permission denied" if another user already owns a file with that
name, because `/tmp` only lets owners replace their files.

## Development

```sh
node --test tests/*.test.mjs
python3 -m unittest discover -s tests
```

`extension/rules.js` holds the logic that doesn't touch browser APIs, so it can be tested with
Node.

Supporting another browser family (e.g. Firefox) needs its own host manifest format and location
in `install.py` (Firefox uses `allowed_extensions` and `~/.mozilla/native-messaging-hosts`) and a
`browser_specific_settings.gecko.id` in the extension manifest.
