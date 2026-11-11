import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import unittest
from scripts.market_map.offline_guard import OfflineGuard


class GuardTests(unittest.TestCase):
    def test_real_io_is_denied_before_execution(self):
        guard = globals()['OFFLINE_GUARD']
        actions = [lambda: socket.getaddrinfo('never-contact.invalid', 443),
                   lambda: socket.socket(), lambda: subprocess.run(['true']),
                   lambda: Path(__file__).write_text('must not write'),
                   lambda: sqlite3.connect('/not-allowed-production.sqlite'),
                   lambda: sqlite3.connect('file:/not-allowed-production.sqlite?mode=ro', uri=True),
                   lambda: os.system('true')]
        for action in actions:
            with self.subTest(action=action), guard.expected_denial(), self.assertRaises(PermissionError):
                action()

    def test_caught_unexpected_denial_still_marks_run_failed(self):
        guard = OfflineGuard(tempfile.gettempdir())
        try:
            guard.audit('socket.connect', ())
        except PermissionError:
            pass
        self.assertEqual(guard.violations, ['socket.connect'])

    def test_tmp_files_and_database_are_permitted(self):
        with sqlite3.connect(Path(':memory:')) as db:
            db.execute('create table memory_fixture (value text)')
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / 'sample.txt'
            p.write_text('fixture')
            self.assertEqual(p.read_text(), 'fixture')
            with sqlite3.connect(str(Path(directory) / 'fixture.db')) as db:
                db.execute('create table fixture (value text)')

    def test_paths_do_not_escape_by_parent_or_symlink(self):
        guard = globals()['OFFLINE_GUARD']
        self.assertFalse(guard.allowed_path(guard.root / '..' / 'elsewhere'))
        with guard.expected_denial(), self.assertRaises(PermissionError):
            os.symlink(Path(__file__).parent, guard.root / 'outside-link')
    def test_descriptor_access_stays_scoped_to_temp(self):
        guard=globals()['OFFLINE_GUARD']
        with tempfile.TemporaryDirectory() as directory:
            fd=os.open(str(Path(directory)/'key'),os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            self.assertTrue(guard.allowed_path(fd))
            with os.fdopen(fd,'wb') as stream:stream.write(b'fixture')
        with open(__file__,'rb') as source:self.assertFalse(guard.allowed_path(source.fileno()))
