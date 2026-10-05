import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class FailureArtifactAuditTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.artifacts = self.root / 'artifacts'
        self.artifacts.mkdir()
        self.secrets = self.root / 'private.json'
        self.value = 'known-synthetic-credential-123456789'
        self.secrets.write_text(json.dumps({'synthetic': self.value}), encoding='utf-8')

    def scan(self, artifacts=None, secrets=None):
        return subprocess.run([
            sys.executable, str(Path(__file__).with_name('i18n_failure_artifact_audit.py')),
            '--artifacts', str(artifacts or self.artifacts), '--secrets', str(secrets or self.secrets),
        ], capture_output=True, text=True)

    def test_missing_directory_fails_before_scanning(self):
        result = self.scan(artifacts=self.root / 'missing')
        self.assertEqual(result.returncode, 2)
        self.assertIn('existing artifact directory', result.stderr)

    def test_empty_directory_is_not_a_clean_scan(self):
        result = self.scan()
        self.assertEqual(result.returncode, 2)
        self.assertIn('no text scan was performed', result.stderr)

    def test_media_only_directory_is_not_a_clean_text_scan(self):
        (self.artifacts / 'only.png').write_bytes(b'synthetic excluded media')
        result = self.scan()
        self.assertEqual(result.returncode, 2)
        self.assertIn('no text scan was performed', result.stderr)

    def test_empty_log_is_not_a_clean_text_scan(self):
        (self.artifacts / 'runner.log').write_bytes(b'')
        result = self.scan()
        self.assertEqual(result.returncode, 2)
        self.assertIn('no text scan was performed', result.stderr)

    def test_private_credentials_inside_upload_tree_are_rejected(self):
        result = self.scan(secrets=self.artifacts / 'private.json')
        self.assertEqual(result.returncode, 2)
        self.assertIn('outside artifact uploads', result.stderr)

    def test_known_leak_fails_without_printing_credential(self):
        (self.artifacts / 'runner.log').write_text(self.value, encoding='utf-8')
        result = self.scan()
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.value in result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['known_credential_matches'],
                         [{'file': 'runner.log', 'credential': 'synthetic'}])

    def test_real_nonempty_clean_log_passes_with_receipt(self):
        (self.artifacts / 'runner.log').write_text('HTTP 404 Cookie: [REDACTED]', encoding='utf-8')
        result = self.scan()
        self.assertEqual(result.returncode, 0)
        report = json.loads(result.stdout)
        self.assertEqual(len(report['files']), 1)
        self.assertEqual(report['known_credential_matches'], [])
        self.assertEqual(report['generic_pattern_matching_files'], [])

    def test_opaque_token_with_plus_slash_tilde_is_detected(self):
        (self.artifacts / 'runner.log').write_text('Bearer abc+def/ghi~jklmnop==', encoding='utf-8')
        result = self.scan()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['generic_pattern_matching_files'], ['runner.log'])

    def test_short_unknown_bearer_is_detected(self):
        (self.artifacts / 'runner.log').write_text('Authorization: Bearer abc+/~==', encoding='utf-8')
        result = self.scan()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)['generic_pattern_matching_files'], ['runner.log'])


if __name__ == '__main__':
    unittest.main()
