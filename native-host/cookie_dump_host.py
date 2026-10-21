#!/usr/bin/env python3
"""Native messaging host that writes cookie files for the Cookie Dump extension.

The browser starts this process as the browser's user and talks to it over
stdin/stdout using the native messaging framing: a 4-byte length in native
byte order followed by that many bytes of UTF-8 JSON. Only extensions listed in
the host manifest's `allowed_origins` can start it.
"""

import json
import os
import struct
import sys
import tempfile

VERSION = "0.1.0"

# Chromium caps messages sent to a host at 64 MiB.
MAX_MESSAGE_BYTES = 64 * 1024 * 1024


def read_message(stream):
    header = stream.read(4)
    if len(header) < 4:
        return None
    (length,) = struct.unpack("=I", header)
    if length > MAX_MESSAGE_BYTES:
        raise ValueError("message too large")
    return json.loads(stream.read(length).decode("utf-8"))


def send_message(stream, message):
    data = json.dumps(message).encode("utf-8")
    stream.write(struct.pack("=I", len(data)))
    stream.write(data)
    stream.flush()


def write_file(path, content, mode):
    """Replaces `path` atomically so readers never see a partial file."""
    fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".cookie-dump-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as temp_file:
            os.fchmod(temp_file.fileno(), mode)
            temp_file.write(content)
        # Replaces a symlink at `path` rather than writing through it. In a
        # sticky directory such as /tmp this fails if another user owns `path`.
        os.replace(temp_path, path)
    except BaseException:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise


def delete_file(path):
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass


def require_path(message):
    path = message.get("path")
    if not isinstance(path, str) or not os.path.isabs(path):
        raise ValueError("path must be an absolute path")
    return path


def handle(message):
    kind = message.get("type")
    if kind == "ping":
        return {"ok": True, "version": VERSION}
    if kind == "write":
        path = require_path(message)
        content = message.get("content")
        mode = message.get("mode")
        if not isinstance(content, str):
            raise ValueError("content must be a string")
        if not isinstance(mode, int) or isinstance(mode, bool) or not 0 <= mode <= 0o777:
            raise ValueError("mode must be an integer between 0 and 0o777")
        write_file(path, content, mode)
        return {"ok": True}
    if kind == "delete":
        delete_file(require_path(message))
        return {"ok": True}
    raise ValueError("unknown message type: {!r}".format(kind))


def main():
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    while True:
        try:
            message = read_message(stdin)
        except Exception as error:
            send_message(stdout, {"ok": False, "error": "invalid message: {}".format(error)})
            return
        if message is None:
            return
        try:
            response = handle(message)
        except Exception as error:
            response = {"ok": False, "error": str(error)}
        send_message(stdout, response)


if __name__ == "__main__":
    main()
