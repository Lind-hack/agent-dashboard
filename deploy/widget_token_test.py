import contextlib
import importlib.util
import io
from pathlib import Path
import stat
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("widget_token", Path(__file__).with_name("configure-widget-token.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TokenTest(unittest.TestCase):
    def test_private_idempotent_provisioning_preserves_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "env"
            env.write_text("OTHER=keep\nWIDGET_READ_TOKEN=\n")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertTrue(module.configure(env))
                original = env.read_text()
                self.assertFalse(module.configure(env))
            self.assertEqual(output.getvalue(), "")
            self.assertEqual(env.read_text(), original)
            self.assertTrue(original.startswith("OTHER=keep\n"))
            token = original.split("WIDGET_READ_TOKEN=")[1].strip()
            self.assertRegex(token, r"^[0-9a-f]{64}$")
            self.assertEqual(stat.S_IMODE(env.stat().st_mode), 0o600)

    def test_does_not_rotate_existing_custom_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "env"
            original = "OTHER=keep\nWIDGET_READ_TOKEN=custom-existing-value\n"
            env.write_text(original)
            with self.assertRaises(ValueError):
                module.configure(env)
            self.assertEqual(env.read_text(), original)
