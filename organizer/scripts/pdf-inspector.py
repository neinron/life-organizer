#!/usr/bin/env python3
"""Run only through pdf_security's isolated subprocess. No viewer or active PDF actions."""
import json
import logging
import resource
import sys
from pathlib import Path


def inspect(path):
    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    logging.disable(logging.CRITICAL)
    # macOS does not reliably accept/enforce RLIMIT_AS; the parent monitors actual RSS.
    from pypdf import PdfReader
    import pypdf.filters as filters
    from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject
    # Bound decompression in addition to CPU/address-space limits and parent wall-clock timeout.
    for attr in ('ZLIB_MAX_OUTPUT_LENGTH', 'LZW_MAX_OUTPUT_LENGTH', 'RUN_LENGTH_MAX_OUTPUT_LENGTH',
                 'JBIG2_MAX_OUTPUT_LENGTH', 'MAX_DECLARED_STREAM_LENGTH', 'MAX_ARRAY_BASED_STREAM_OUTPUT_LENGTH'):
        if hasattr(filters, attr):
            setattr(filters, attr, 20 * 1024 * 1024)
    path = Path(path)
    size = path.stat().st_size
    if not 0 < size <= 25 * 1024 * 1024:
        raise ValueError('PDF size limit')
    with path.open('rb') as stream:
        if stream.read(5) != b'%PDF-':
            raise ValueError('Not a PDF')
        stream.seek(max(0, size - 2048))
        if b'%%EOF' not in stream.read():
            raise ValueError('Incomplete PDF')
        stream.seek(0)
        pdf = PdfReader(stream, strict=True)
        if pdf.is_encrypted or not 0 < len(pdf.pages) <= 2000:
            raise ValueError('Encrypted/empty/excessive-page PDF')
        # Walk every referenced object, including object streams; string searches miss encoded names.
        forbidden_keys = {'/JS', '/JavaScript', '/OpenAction', '/AA', '/EmbeddedFiles', '/EF',
                          '/XFA', '/RichMediaContent', '/RichMediaSettings'}
        forbidden_actions = {'/JavaScript', '/Launch', '/SubmitForm', '/ImportData', '/GoToR', '/GoToE',
                             '/Rendition', '/Movie', '/Sound'}
        seen = set()
        stack = [(pdf.trailer, 0)]
        count = 0
        while stack:
            obj, depth = stack.pop()
            count += 1
            if count > 100000 or depth > 100:
                raise ValueError('PDF object graph limit')
            if isinstance(obj, IndirectObject):
                identity = (obj.idnum, obj.generation)
                if identity in seen:
                    continue
                seen.add(identity)
                obj = obj.get_object()
            if isinstance(obj, DictionaryObject):
                if forbidden_keys.intersection(obj.keys()) or str(obj.get('/S', '')) in forbidden_actions:
                    raise ValueError('Active/embedded PDF content')
                if str(obj.get('/Subtype', '')) in {'/RichMedia', '/FileAttachment', '/3D'}:
                    raise ValueError('Interactive attachment/3D PDF content')
                stack.extend((v, depth + 1) for v in obj.values())
            elif isinstance(obj, ArrayObject):
                stack.extend((v, depth + 1) for v in obj)
        text = '\n'.join((pdf.pages[i].extract_text() or '')[:4000] for i in range(min(3, len(pdf.pages))))
        return {'pages': len(pdf.pages), 'title': str((pdf.metadata or {}).get('/Title', ''))[:500], 'text': text}


if __name__ == '__main__':
    print(json.dumps(inspect(sys.argv[1]), ensure_ascii=False))
