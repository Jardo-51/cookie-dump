import json
import os
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOST = Path(__file__).resolve().parent.parent / "native-host" / "cookie_dump_host.py"


def frame(message):
    data = json.dumps(message).encode("utf-8")
    return struct.pack("=I", len(data)) + data


def run_host(*messages):
    """Sends messages the way the browser does and returns the decoded replies."""
    result = subprocess.run(
        [sys.executable, str(HOST)],
        input=b"".join(frame(m) for m in messages),
        stdout=subprocess.PIPE,
        check=True,
    )
    replies, out = [], result.stdout
    while out:
        (length,) = struct.unpack("=I", out[:4])
        replies.append(json.loads(out[4 : 4 + length]))
        out = out[4 + length :]
    return replies


class NativeHostTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "cookies.txt")

    def tearDown(self):
        self.dir.cleanup()

    def test_ping(self):
        (reply,) = run_host({"type": "ping"})
        self.assertTrue(reply["ok"])
        self.assertIn("version", reply)

    def test_write_replaces_file_with_mode_and_leaves_no_temp_files(self):
        replies = run_host(
            {"type": "write", "path": self.path, "content": "a=1", "mode": 0o600},
            {"type": "write", "path": self.path, "content": "a=2; b=3", "mode": 0o644},
        )
        self.assertEqual(replies, [{"ok": True}, {"ok": True}])
        self.assertEqual(Path(self.path).read_text(), "a=2; b=3")
        self.assertEqual(stat.S_IMODE(os.stat(self.path).st_mode), 0o644)
        self.assertEqual(os.listdir(self.dir.name), ["cookies.txt"])

    def test_write_replaces_symlink_instead_of_following_it(self):
        target = os.path.join(self.dir.name, "target.txt")
        Path(target).write_text("keep")
        os.symlink(target, self.path)
        (reply,) = run_host({"type": "write", "path": self.path, "content": "a=1", "mode": 0o600})
        self.assertTrue(reply["ok"])
        self.assertFalse(os.path.islink(self.path))
        self.assertEqual(Path(target).read_text(), "keep")

    def test_delete_is_idempotent(self):
        Path(self.path).write_text("a=1")
        replies = run_host({"type": "delete", "path": self.path}, {"type": "delete", "path": self.path})
        self.assertEqual(replies, [{"ok": True}, {"ok": True}])
        self.assertFalse(os.path.exists(self.path))

    def test_rejects_invalid_requests(self):
        replies = run_host(
            {"type": "write", "path": "relative.txt", "content": "", "mode": 0o600},
            {"type": "write", "path": self.path, "content": "", "mode": 0o7777},
            {"type": "write", "path": self.path, "content": 5, "mode": 0o600},
            {"type": "write", "path": os.path.join(self.dir.name, "missing", "c.txt"), "content": "", "mode": 0o600},
            {"type": "nope"},
        )
        self.assertTrue(all(not reply["ok"] and reply["error"] for reply in replies))
        self.assertEqual(os.listdir(self.dir.name), [])


if __name__ == "__main__":
    unittest.main()
