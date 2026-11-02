#!/usr/bin/env python3
"""Fetch an identified public PDF into private staging, without cookies or credentials.

Only explicit public HTTPS hostnames from profile.mail_documents.public_pdf_hosts are allowed.
Mail/R2/Gmail attachments are instead obtained through the connected read-only tools.
"""
import argparse
import json
import os
import sys
import tempfile
import urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lib'))
import mail_documents as docs


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def allowed(url, hosts):
    p = urlsplit(url)
    if (p.scheme != 'https' or p.hostname not in hosts or p.username or p.password
            or p.port not in (None, 443) or p.query or p.fragment):
        raise ValueError('Public PDF URL/redirect outside approved HTTPS hosts')


def fetch(url, staging, hosts):
    url = docs.canonical_link(url)
    original = url
    # No proxy configuration, cookie jar, authorization headers or ambient URL credentials.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    for _ in range(6):
        allowed(url, hosts)
        try:
            response = opener.open(urllib.request.Request(url, headers={'User-Agent': 'LifeOrganizer/1.0 (PDF filing)'}), timeout=30)
            break
        except urllib.error.HTTPError as exc:
            if exc.code not in (301, 302, 303, 307, 308):
                raise ValueError(f'Public PDF HTTP {exc.code}') from None
            url = urljoin(url, exc.headers.get('Location', ''))
            exc.close()
    else:
        raise ValueError('Too many PDF redirects')
    docs.checked_path(staging)
    staging.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='mail-link-', suffix='.pdf', dir=staging)
    try:
        from pdf_security import quarantine
        quarantine(tmp)
        with response, os.fdopen(fd, 'wb') as out:
            length = response.headers.get('Content-Length')
            if length and int(length) > docs.MAX_BYTES:
                raise ValueError('Public PDF exceeds 25 MiB')
            size = 0
            while block := response.read(128 * 1024):
                size += len(block)
                if size > docs.MAX_BYTES:
                    raise ValueError('Public PDF exceeds 25 MiB')
                out.write(block)
            out.flush()
            os.fsync(out.fileno())
        if length is not None and int(length) != size:
            raise ValueError('Incomplete HTTP response')
        pdf = docs.inspect_pdf(tmp)
        sha = docs.sync.digest(Path(tmp))
        destination = staging / (sha + '.pdf')
        docs.checked_path(destination)
        try:
            # Hard-link is exclusive and atomic; an existing original is never replaced.
            os.link(tmp, destination)
        except FileExistsError:
            if docs.sync.digest(destination) != sha:
                raise ValueError('Staging collision')
        return {'url': original, 'local_path': str(destination), 'size': size, 'sha256': sha, 'pages': pdf['pages']}
    finally:
        Path(tmp).unlink(missing_ok=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--url', required=True)
    args = ap.parse_args()
    profile = json.loads((ROOT / 'profile.json').read_text())
    print(json.dumps(fetch(args.url, ROOT / 'runtime/staging/mail-links',
                           profile.get('mail_documents', {}).get('public_pdf_hosts', []))))
