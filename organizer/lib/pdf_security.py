"""Fail-closed local PDF checks. A clean verdict is not a guarantee of harmlessness."""
import hashlib
import json
import os
import site
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECURITY = ROOT / 'runtime/security'
DB = SECURITY / 'clamav'
POLICY = 1


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def quarantine(path):
    """Retain downloaded-file metadata; never strip an existing macOS quarantine flag."""
    if sys.platform != 'darwin':
        raise ValueError('macOS PDF security required')
    check = subprocess.run(['/usr/bin/xattr', '-p', 'com.apple.quarantine', str(path)], capture_output=True, timeout=5)
    if check.returncode:
        tagged = subprocess.run(['/usr/bin/xattr', '-w', 'com.apple.quarantine',
                                 f'0081;{int(time.time()):x};Life Organizer;', str(path)], capture_output=True, timeout=5)
        if tagged.returncode:
            raise ValueError('Cannot retain macOS quarantine metadata; PDF not released')


def database_version():
    files = sorted([*DB.glob('*.cvd'), *DB.glob('*.cld')])
    daily = [p for p in files if p.stem == 'daily']
    if not daily or time.time() - max(p.stat().st_mtime for p in daily) > 3 * 86400:
        raise ValueError('Malware signatures missing/stale; run update-mail-security.py on host')
    return hashlib.sha256(json.dumps([(p.name, p.stat().st_size, p.stat().st_mtime_ns) for p in files]).encode()).hexdigest()


def isolated(command, readable, writable=(), timeout=60):
    """Seatbelt denies network and all writes except a dedicated scanner scratch directory.

    Read only the original, code/dependencies and signature DB; no home/mail/credential access.
    Fail closed if nested macOS sandbox creation is unavailable; host retry is explicit.
    """
    literal = lambda p: '(literal ' + json.dumps(str(Path(p).resolve())) + ')'
    subpath = lambda p: '(subpath ' + json.dumps(str(Path(p).resolve())) + ')'
    read_rules = [subpath(ROOT / 'lib'), subpath(ROOT / 'scripts'), subpath(DB), subpath(site.getusersitepackages())]
    read_rules += [literal(p) for p in readable]
    read_rules += [literal('/dev/null'), literal('/dev/random'), literal('/dev/urandom')]
    # macOS/Python require system runtime/cache reads beyond their binary directories. Deny
    # personal volumes/temp roots explicitly, then admit only this input and trusted code/DB.
    profile = '(version 1)(allow default)(deny network*)'
    profile += '(deny file-read* (subpath "/Users") (subpath "/Volumes") (subpath "/private/var/folders") (subpath "/private/tmp"))'
    profile += '(allow file-read-metadata)'
    profile += '(allow file-read* ' + ' '.join(read_rules) + ')'
    profile += '(deny file-write*)'
    if writable:
        profile += '(allow file-write* ' + ' '.join(subpath(p) for p in writable) + ')'
    profile += '(deny process-fork)'
    try:
        import psutil
    except ImportError:
        raise ValueError('Memory watchdog unavailable; PDF not released') from None
    child = subprocess.Popen(['/usr/bin/sandbox-exec', '-p', profile, *command],
                             env={'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8'},
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline = time.monotonic() + timeout
    try:
        watched = psutil.Process(child.pid)
        while True:
            try:
                stdout, stderr = child.communicate(timeout=0.2)
                return subprocess.CompletedProcess(command, child.returncode, stdout, stderr)
            except subprocess.TimeoutExpired as exc:
                if time.monotonic() >= deadline:
                    raise ValueError('Security inspection timed out; PDF not released')
                if len(exc.output or b'') + len(exc.stderr or b'') > 100000:
                    raise ValueError('Security inspection output limit; PDF not released')
                try:
                    if watched.memory_info().rss > 1536 * 1024 * 1024:
                        raise ValueError('Security inspection memory limit; PDF not released')
                except psutil.NoSuchProcess:
                    pass
    finally:
        if child.poll() is None:
            child.kill()
        child.communicate()


def assess(path):
    path = Path(path).resolve()
    if not 0 < path.stat().st_size <= 25 * 1024 * 1024:
        raise ValueError('PDF size outside security policy')
    quarantine(path)
    digest = sha256(path)
    version = database_version()
    cache = SECURITY / 'verdicts' / (digest + '.json')
    if cache.exists():
        prior = json.loads(cache.read_text())
        if (prior.get('policy') == POLICY and prior.get('database') == version
                and time.time() - prior.get('checked_at', 0) < 86400):
            return prior
    scanner = Path('/opt/homebrew/bin/clamscan')
    if not scanner.is_file():
        raise ValueError('Local malware scanner unavailable; PDF not released')
    scratch = SECURITY / 'scan-tmp'
    scratch.mkdir(parents=True, exist_ok=True, mode=0o700)
    cmd = [str(scanner), '--database=' + str(DB), '--tempdir=' + str(scratch),
           '--no-summary', '--scan-archive=no', '--max-filesize=100M', '--max-scansize=250M',
           '--max-scantime=30000', '--max-recursion=16', '--alert-exceeds-max=yes',
           '--alert-encrypted=yes', '--alert-broken=yes', str(path)]
    scanned = isolated(cmd, [path], [scratch], timeout=90)
    if scanned.returncode != 0 or ' OK' not in scanned.stdout:
        # Do not print scanned content, paths, or potential secret-bearing parser diagnostics.
        why = 'Malware/suspicious-file alert' if scanned.returncode == 1 else 'Malware scan failed (host isolation/signatures required)'
        raise ValueError(why + '; PDF not released')
    parsed = isolated(inspector_command(path), [path], timeout=45)
    if parsed.returncode:
        raise ValueError('PDF active content, parser limit or isolation failure; PDF not released')
    verdict = {'policy': POLICY, 'database': version, 'sha256': digest,
               'checked_at': time.time(), 'scanner': 'ClamAV', 'status': 'passed',
               'pdf': json.loads(parsed.stdout)}
    if sha256(path) != digest:
        raise ValueError('PDF changed during security inspection')
    cache.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Cached verdicts are local trusted state, keyed by bytes, policy and signature revision.
    temp = cache.with_suffix('.tmp')
    temp.write_text(json.dumps(verdict, ensure_ascii=False))
    os.replace(temp, cache)
    return verdict


def inspector_command(path):
    # -I prevents ambient Python paths; admit only the installed dependency directory explicitly.
    bootstrap = ('import sys,runpy;sys.path.insert(0,' + repr(site.getusersitepackages()) + ');'
                 'runpy.run_path(' + repr(str(ROOT / 'scripts/pdf-inspector.py')) + ',run_name="__main__")')
    return [sys.executable, '-I', '-B', '-c', bootstrap, str(path)]
