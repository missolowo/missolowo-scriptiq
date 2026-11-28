#!/usr/bin/env python3
"""The three homepage samples are the documents we audited, and they have
titles.

    python3 tools/verify-sample-pdfs.py

WHY THIS FILE EXISTS

These three PDFs are the only Missolowo Slate output a filmmaker can read
without an account. They are a promise about what Slate produces, so two
things must stay true:

1. The page content is EXACTLY what was audited before publishing. The
   text hashes below are recorded from those audited files. Stamping
   titles onto them must not change a single character of a document —
   and if the samples are ever regenerated from a new run, this fails
   loudly, so whoever regenerated them has to audit the new ones and
   update these constants deliberately, not silently.

2. Each has a title, an author, and still names jsPDF as its producer.
   A PDF with no /Title is headed in a search result by its filename.
"""
import sys
import hashlib
import pikepdf
import pdfplumber

# Recorded from the files audited on 28 November 2026, run d8cbe3 of
# WHEN LOVE FINDS YOU. sha256 of every page's extracted text, joined by
# a NUL, first 16 hex characters.
EXPECTED = {
    'docs/sample-script-breakdown.pdf':  (6, '26b91f95d36529cb'),
    'docs/sample-shooting-schedule.pdf': (7, '6b48524be144661e'),
    'docs/sample-call-sheet.pdf':        (5, 'd70b2128d8f5a2ea'),
}

fails = []


def check(cond, what, detail=''):
    if cond:
        print('  PASS  ' + what)
    else:
        fails.append(what)
        print('  FAIL  ' + what + ('  -> ' + detail if detail else ''))


for path, (want_pages, want_sha) in EXPECTED.items():
    print('\n' + path)
    try:
        with pdfplumber.open(path) as d:
            pages = [p.extract_text() or '' for p in d.pages]
    except Exception as e:                      # noqa: BLE001
        check(False, 'opens as a PDF', str(e))
        continue

    got_sha = hashlib.sha256(
        '\n\x00\n'.join(pages).encode()).hexdigest()[:16]

    check(len(pages) == want_pages, f'{want_pages} pages', str(len(pages)))
    check(got_sha == want_sha,
          'page content is the audited document, unchanged',
          f'{got_sha} != {want_sha} — if the samples were regenerated, '
          f'audit the new ones and update EXPECTED')

    with pikepdf.open(path) as pdf:
        info = {str(k): str(v) for k, v in pdf.docinfo.items()}
        xmp = str(pdf.open_metadata())

    title = info.get('/Title', '')
    check(bool(title.strip()), 'has a title', 'none — it will be headed '
                                              'by its filename in search')
    check('Missolowo Slate' in title, '  ...naming Missolowo Slate', title)
    check('(Sample)' in title, '  ...and saying it is a sample', title)
    check(info.get('/Author', '') == 'Missolowo Slate', 'has an author',
          info.get('/Author', 'none'))
    check(bool(info.get('/Subject', '').strip()), 'has a description')
    check(info.get('/Producer', '') == 'jsPDF 2.5.1',
          'still names jsPDF as producer',
          info.get('/Producer', 'none') + ' — writing XMP drops docinfo '
          'keys it has no field for; stamp-sample-pdfs.py puts them back')
    check(title in xmp, 'the XMP carries the same title')

print()
if fails:
    print(f'{len(fails)} failed\n')
    sys.exit(1)
print('All three samples are the audited documents, and all three have '
      'titles.\n')
