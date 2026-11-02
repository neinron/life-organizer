# Development and verification

From the repository root:

```sh
node --test mobile-widget/worker.test.mjs mobile-widget/scriptable.test.mjs
python3 -m unittest discover -s organizer/scripts -p 'test_*.py'
```

Python tests require `organizer/requirements.txt`. PDF isolation tests additionally require host macOS isolation; restricted execution may reject nested isolation. Scanner integration tests also require ClamAV and fresh signatures under `organizer/runtime/security/clamav`, initialized with `python3 organizer/scripts/update-mail-security.py`. Run relevant tests on the host rather than weakening the checks.

For the source collector:

```sh
cd collector
npm ci
npm test
npm run type-check
npm run build
```

For calendar sync:

```sh
cd calendar-sync
npm ci
npm run test:worker
npm run typecheck
```

The mobile suite validates authentication, payload/action boundaries, native calendar matching and mocked widget rendering. It does not reproduce iOS layout, OS permissions or phone delivery. Validate those on the device. Übersicht JSX must also compile before a UI change is shipped.

Canonical planning code lives in `organizer/lib/planning_engine.py`; scripts import it from there. Do not maintain copied implementations under script directories.

Preview assets in `docs/images` use only invented content. Their source is `docs/previews.html`; retain the mockup label when reusing them. Update screenshots when the presentation changes.
