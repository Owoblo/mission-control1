"""OS network denial for the isolated Linux evaluation image; never production."""
import ctypes
import errno
import socket
import sys
from pathlib import Path


def verify_denial():
    for family in (socket.AF_INET, socket.AF_INET6):
        try:
            probe = socket.socket(family, socket.SOCK_STREAM)
        except PermissionError:
            continue
        probe.close()
        raise RuntimeError('OS socket denial missing')
    if sys.platform == 'linux':
        status = Path('/proc/self/status').read_text()
        if 'NoNewPrivs:\t1' not in status or 'Seccomp:\t2' not in status:
            raise RuntimeError('Inherited seccomp/no-new-privileges missing')


def deny_linux_network():
    if sys.platform != 'linux':
        raise RuntimeError('Linux staging entrypoint required')
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0):
        raise OSError(ctypes.get_errno(), 'PR_SET_NO_NEW_PRIVS')
    lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    context = lib.seccomp_init(0x7fff0000)  # ALLOW default, explicit socket denial.
    if not context:
        raise RuntimeError('seccomp_init failed')
    try:
        for name in ('socket', 'socketpair', 'connect', 'bind', 'listen', 'accept',
                     'accept4', 'sendto', 'sendmsg', 'sendmmsg', 'io_uring_setup',
                     'io_uring_enter', 'io_uring_register'):
            number = lib.seccomp_syscall_resolve_name(name.encode())
            if number < 0 or lib.seccomp_rule_add(context, 0x50000 | errno.EPERM, number, 0):
                raise RuntimeError('Cannot deny syscall: ' + name)
        if lib.seccomp_load(context):
            raise RuntimeError('seccomp_load failed')
    finally:
        lib.seccomp_release(context)
    verify_denial()


def process_prefix():
    if sys.platform == 'darwin':
        return ['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)(deny network*)']
    if sys.platform == 'linux':
        verify_denial()  # Refuse ordinary Linux launches without inherited OS isolation.
        return []
    raise RuntimeError('No verified OS isolation for this platform')
