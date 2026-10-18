# Regression audit — 2026-10-18

Run the automated suite from the project root:

```sh
node --test tests/*.test.cjs
python scripts/update-ratings.py --selftest
```

Browser smoke checks (read-only, using real directory and Sheet data):
- Category overview, category targets, phone search and no-results search.
- Open-now filtering excludes unknown hours.
- Report opening/closing; structured hours and multiple-period round trips.
- Admin inbox kinds, independent rating column, hidden-row bulk selection clearing.
- Report layout at 360, 768 and 1280 pixels, in light and dark themes: no horizontal overflow.
- External links use noopener; telephone links contain valid dialing targets.

Regressions covered by automated tests:
- Corrected/removed directory numbers must not survive in stale favorites.
- New rating revisions win even if an older request arrives later.
- Superseded queued votes cannot be retried or falsely acknowledged.
- Noon time conversion, overnight periods and split shifts.
- PWA manifest, offline cached launch, installation fallback paths.
- Structured corrections reject ambiguous targets, stale bases and unsafe fields.

Limits: no synthetic submissions were sent to the live form and no administrative
edits were published during browser tests. Native Android/iOS installation needs
physical-device testing. Google, GitHub availability and scheduled-job delays are
external dependencies. Anonymous voting cannot enforce one human across devices,
and old votes without identity receipts cannot be reliably attributed retroactively.
