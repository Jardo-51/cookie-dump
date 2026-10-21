#!/usr/bin/env python3
"""Installs Cookie Dump for the current user.

Copies the extension and the native helper into the user's data directory and
registers the helper with Chromium-based browsers. Run it as the user that runs
the browser.
"""

import argparse
import base64
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

HOST_NAME = "cookie_dump"
REPO = Path(__file__).resolve().parent
HOME = Path.home()
CONFIG_HOME = Path(os.environ.get("XDG_CONFIG_HOME") or HOME / ".config")
DATA_HOME = Path(os.environ.get("XDG_DATA_HOME") or HOME / ".local" / "share")
INSTALL_DIR = DATA_HOME / "cookie-dump"

# Linux profile directories of Chromium-based browsers. Each looks for native
# host manifests in a `NativeMessagingHosts` folder inside it. Other browser
# families (e.g. Firefox) use a different manifest format and location.
CHROMIUM_BROWSERS = {
    "chrome": CONFIG_HOME / "google-chrome",
    "chrome-beta": CONFIG_HOME / "google-chrome-beta",
    "chromium": CONFIG_HOME / "chromium",
    "brave": CONFIG_HOME / "BraveSoftware" / "Brave-Browser",
    "edge": CONFIG_HOME / "microsoft-edge",
    "vivaldi": CONFIG_HOME / "vivaldi",
}


def extension_id(manifest_path):
    """Derives the ID Chromium assigns from the manifest's public `key`."""
    key = json.loads(manifest_path.read_text())["key"]
    digest = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
    return "".join(chr(ord("a") + int(char, 16)) for char in digest)


def host_manifest_path(browser):
    return CHROMIUM_BROWSERS[browser] / "NativeMessagingHosts" / "{}.json".format(HOST_NAME)


def install(browsers):
    # Copy instead of pointing at the repository, so whoever can write to the
    # repository can't change code that runs as the browser's user.
    # Only file contents are copied: the repository's group bits and ACLs must
    # not carry over.
    if INSTALL_DIR.exists():
        shutil.rmtree(INSTALL_DIR)
    extension_dir = INSTALL_DIR / "extension"
    extension_dir.mkdir(parents=True)
    INSTALL_DIR.chmod(0o755)
    extension_dir.chmod(0o755)
    for source in (REPO / "extension").iterdir():
        target = extension_dir / source.name
        shutil.copyfile(source, target)
        target.chmod(0o644)
    host_path = INSTALL_DIR / "cookie_dump_host.py"
    shutil.copyfile(REPO / "native-host" / "cookie_dump_host.py", host_path)
    host_path.chmod(0o755)

    manifest = {
        "name": HOST_NAME,
        "description": "Writes cookie files for the Cookie Dump extension",
        "path": str(host_path),
        "type": "stdio",
        "allowed_origins": ["chrome-extension://{}/".format(extension_id(extension_dir / "manifest.json"))],
    }
    for browser in browsers:
        path = host_manifest_path(browser)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(manifest, indent=2) + "\n")
        print("Registered the native helper for {}: {}".format(browser, path))

    print()
    print("Next steps:")
    print("  1. Open the browser's extensions page (e.g. chrome://extensions).")
    print("  2. Turn on Developer mode and click 'Load unpacked'. Choose:")
    print("       {}".format(extension_dir))
    print("     If it is already loaded, click its reload button instead.")
    print("  3. Click the extension's toolbar icon to add sites.")


def uninstall(browsers):
    for browser in browsers:
        path = host_manifest_path(browser)
        if path.exists():
            path.unlink()
            print("Unregistered the native helper for {}".format(browser))
    if not any(host_manifest_path(browser).exists() for browser in CHROMIUM_BROWSERS):
        shutil.rmtree(INSTALL_DIR, ignore_errors=True)
        print("Removed {}".format(INSTALL_DIR))
    print("Remove the extension itself from the browser's extensions page.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "browsers",
        nargs="*",
        metavar="BROWSER",
        help="browsers to set up: {} (default: every one with a profile directory)".format(
            ", ".join(sorted(CHROMIUM_BROWSERS))
        ),
    )
    parser.add_argument("--uninstall", action="store_true", help="remove the native helper registration")
    args = parser.parse_args()
    unknown = sorted(set(args.browsers) - set(CHROMIUM_BROWSERS))
    if unknown:
        parser.error("unknown browser: {}".format(", ".join(unknown)))

    browsers = args.browsers or [name for name, path in CHROMIUM_BROWSERS.items() if path.is_dir()]
    if not browsers:
        sys.exit("No supported browser profile found. Name the browser explicitly, e.g. install.py chrome")

    if args.uninstall:
        uninstall(browsers)
    else:
        install(browsers)


if __name__ == "__main__":
    main()
