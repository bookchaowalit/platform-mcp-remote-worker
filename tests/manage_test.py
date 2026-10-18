"""Regression checks for preservation of local client config and secret boundaries."""

import importlib.util
import io
import json
from pathlib import Path
import tempfile
import tomllib
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "manage.py"
spec = importlib.util.spec_from_file_location("remote_mcp_manage", MODULE)
manage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manage)


class ConfigurationTests(unittest.TestCase):
    def test_preserves_unrelated_client_config_and_contains_no_token_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.toml"
            original = '# user settings\nmodel = "existing-model"\n[mcp_servers.local]\ncommand = "node"\n'
            path.write_text(original)
            with patch("sys.stdout", io.StringIO()):
                manage.configure("https://mcp.example.com/mcp", path)
            configured = path.read_text()
            self.assertTrue(configured.startswith(original.rstrip()))
            data = tomllib.loads(configured)
            self.assertEqual(data["model"], "existing-model")
            self.assertEqual(data["mcp_servers"]["local"]["command"], "node")
            remote = data["mcp_servers"]["solo-empire-remote"]
            self.assertEqual(
                remote["env"]["MCP_REMOTE_URL"], "https://mcp.example.com/mcp"
            )
            self.assertNotIn("SOLO_MCP_REMOTE_TOKEN", configured)
            with patch("sys.stdout", io.StringIO()):
                manage.configure("https://mcp.example.com/mcp", path)
            self.assertEqual(path.read_text(), configured)

    def test_rejects_endpoint_credentials_and_does_not_overwrite_other_remote_config(
        self,
    ):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.toml"
            original = '[mcp_servers.solo-empire-remote]\ncommand = "other"\n'
            path.write_text(original)
            for url in [
                "http://mcp.example.com/mcp",
                "https://user:pass@mcp.example.com/mcp",
                "https://mcp.example.com/mcp?token=private",
                "https://mcp.example.com/wrong",
            ]:
                with self.assertRaises(RuntimeError):
                    manage.configure(url, path)
            with self.assertRaisesRegex(
                RuntimeError, "existing_remote_config_requires_review"
            ):
                manage.configure("https://mcp.example.com/mcp", path)
            self.assertEqual(path.read_text(), original)

    def test_worker_receives_hash_not_raw_mcp_token(self):
        def secret(name, path, required=False):
            return (
                "unit-test-private-credential"
                if name == "SOLO_MCP_REMOTE_TOKEN"
                else None
            )

        with patch.object(manage, "resolve", side_effect=secret):
            payload = manage.worker_secrets()
        self.assertEqual(len(payload["MCP_TOKEN_SHA256"]), 64)
        self.assertNotIn("unit-test-private-credential", json.dumps(payload))
        self.assertEqual(set(payload), {"MCP_TOKEN_SHA256"})

    def test_owner_mcp_token_is_forwarded_only_when_infisical_has_it(self):
        requested = []

        def secret(name, path, required=False):
            requested.append((name, path))
            if name == "SOLO_MCP_REMOTE_TOKEN":
                return "unit-test-private-credential"
            if name == "EMPIRE_AUTOMATION_TOKEN_OWNER_MCP":
                return "unit-test-owner-mcp-jwt"
            return None

        with patch.object(manage, "resolve", side_effect=secret):
            payload = manage.worker_secrets()
        self.assertIn(
            ("EMPIRE_AUTOMATION_TOKEN_OWNER_MCP", "/empire-platform"), requested
        )
        self.assertEqual(payload["EMPIRE_OWNER_MCP_TOKEN"], "unit-test-owner-mcp-jwt")
        self.assertEqual(set(payload), {"MCP_TOKEN_SHA256", "EMPIRE_OWNER_MCP_TOKEN"})

    def test_deploy_skips_owner_mcp_token_when_absent_and_never_prints_values(self):
        def secret(name, path, required=False):
            if name == "SOLO_MCP_REMOTE_TOKEN":
                return "unit-test-private-credential"
            if name in ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"):
                return "unit-test-cloudflare-" + name.lower()
            return None

        runs = []

        def fake_command(args, **kwargs):
            runs.append((args, kwargs.get("input")))
            return manage.subprocess.CompletedProcess(args, 0, "", "")

        with tempfile.TemporaryDirectory() as directory:
            wrangler = Path(directory) / "node_modules/wrangler/bin/wrangler.js"
            wrangler.parent.mkdir(parents=True)
            wrangler.write_text("")
            out = io.StringIO()
            with (
                patch.object(manage, "HERE", Path(directory)),
                patch.object(manage, "resolve", side_effect=secret),
                patch.object(
                    manage, "public_origin", return_value="https://mcp.example.com"
                ),
                patch.object(manage, "fixed_command", side_effect=fake_command),
                patch("sys.stdout", out),
            ):
                manage.deploy()
        bulk = json.loads(runs[1][1])
        self.assertNotIn("EMPIRE_OWNER_MCP_TOKEN", bulk)
        self.assertEqual(set(bulk), {"MCP_TOKEN_SHA256"})
        printed = out.getvalue()
        self.assertNotIn("unit-test", printed)
        self.assertEqual(json.loads(printed)["secret_names"], ["MCP_TOKEN_SHA256"])

    def test_provider_command_output_is_never_exposed_on_failure(self):
        failure = manage.subprocess.CompletedProcess(
            ["test"], 1, "private-value", "private-error"
        )
        with patch.object(manage.subprocess, "run", return_value=failure):
            with self.assertRaisesRegex(RuntimeError, "^provider_command_failed$"):
                manage.fixed_command(["test"])


if __name__ == "__main__":
    unittest.main()
