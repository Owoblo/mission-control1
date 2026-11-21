"""Python audit boundary for trusted offline tests; not an OS/native-code sandbox."""
import contextlib
import os
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit


class OfflineGuard:
    def __init__(self, writable_root):
        self.root = Path(writable_root).resolve()
        self.violations = []
        self.expected = False

    def allowed_path(self, path, dir_fd=None):
        if isinstance(path, int):
            try:
                if sys.platform == 'darwin':
                    import fcntl
                    path=os.fsdecode(fcntl.fcntl(path,50,b'\0'*1024).split(b'\0')[0])
                else:path=os.readlink('/proc/self/fd/'+str(path))
            except (OSError,ValueError):return False
        try:
            if dir_fd not in (None, -1) and not os.path.isabs(path):
                if sys.platform == 'darwin':
                    import fcntl
                    directory = os.fsdecode(fcntl.fcntl(dir_fd, 50, b'\0' * 1024).split(b'\0')[0])  # F_GETPATH
                else:
                    directory = os.readlink('/proc/self/fd/' + str(dir_fd))
                path = os.path.join(directory, os.fsdecode(path))
            return Path(os.fsdecode(path)).resolve().is_relative_to(self.root)
        except (TypeError, ValueError, OSError):
            return False

    def deny(self, event):
        if not self.expected:
            self.violations.append(event)
        raise PermissionError('offline guard blocked ' + event)

    def audit(self, event, args):
        if event.startswith(('socket.', 'subprocess.', 'os.exec', 'os.spawn', 'os.posix_spawn')) or event in {'os.system', 'os.fork', 'os.forkpty', 'pty.spawn'}:
            self.deny(event)
        if event == 'open':
            path, mode, flags = args
            writing = (mode and any(c in mode for c in 'wax+')) or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND)
            if writing and not self.allowed_path(path):
                self.deny(event)
        paths = None
        if event in {'os.remove', 'os.rmdir'}:
            paths = [(args[0], args[1])]
        elif event in {'os.mkdir', 'os.chmod'}:
            paths = [(args[0], args[2])]
        elif event in {'os.rename', 'os.link'}:
            paths = [(args[0], args[2]), (args[1], args[3])]
        elif event == 'os.symlink':
            paths = [(args[0], None), (args[1], args[2])]
        elif event in {'os.chown', 'os.truncate', 'os.utime'}:
            paths = [(args[0], None)]  # Conservatively reject unsupported relative-fd forms.
        if paths is not None and not all(self.allowed_path(p, fd) for p, fd in paths):
            self.deny(event)
        if event == 'sqlite3.connect' and os.fsdecode(args[0]) != ':memory:':
            path = os.fsdecode(args[0])
            if path.startswith('file:'):
                uri = urlsplit(path)
                if uri.netloc:
                    self.deny(event)
                path = unquote(uri.path)
            if not self.allowed_path(path):
                self.deny(event)

    def install(self):
        sys.dont_write_bytecode = True
        sys.addaudithook(self.audit)

    @contextlib.contextmanager
    def expected_denial(self):
        """For explicit guard self-tests only; unexpected denials remain fatal."""
        old = self.expected
        self.expected = True
        try:
            yield
        finally:
            self.expected = old
