# Directory field audit

Reviewed all **181 directory entries** against the latest remote data on 2026-10-24.
This checks field placement and syntax, not whether businesses still operate or own their listed numbers.

## Corrections

- 42 existing Google Maps links moved from the primary contact into `map_url`.
- 59 addresses moved from notes into `address`, preserving the exact supplied location text.
- STAR CITY's two explicitly supplied numbers moved from its note into `phone`; its Facebook link moved to `website` and its location to `address`.
- Three explicit schedules moved into structured hours: Rami and Golden (24 hours), and مكتبة عمار (08:00–16:00, Friday closed).
- Removed delivery-note duplicates only where the same information already existed in structured delivery fields.
- Preserved rating identity when a primary contact field changed. Neither shared 0951460666 listing was removed.
- Full before/after records: `tests/directory-field-changes.json`. Repeatable migration: `scripts/audit-directory-fields.py` (dry run by default).

## Needs owner confirmation — not changed

- STAR CITY: saved 02:00–14:00; confirm whether this actually means 14:00–02:00.
- Sugar bar: saved 08:00–12:00; noon vs midnight is not established by the data.
- كراج الحفة: `0900000000` resembles a placeholder; 07:00–06:00 is also ambiguous.
- Jafra Pharma: `0113315212` uses a Damascus landline prefix despite the local listing; ownership is unverified.
- Possible duplicate names such as مرعي / سوبرماركت مرعي and the Amal pharmacy listings need confirmation before merging.
- Descriptive names containing location text (e.g. مكتب الكاسر العقاري…) were not renamed automatically: the actual business name is unknown and renaming could affect rating identity.
- Locality strings such as Baniyas in imported addresses were retained verbatim, not guessed or replaced.
