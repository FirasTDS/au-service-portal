#!/usr/bin/env python3
"""Aggregate visitor ratings from the linked Google Sheet into ratings.json.

The public form posts every star rating into the same sheet that feeds the
suggestions inbox. This script reads that sheet (public gviz CSV endpoint, no
credentials), groups ratings per place and writes an average snapshot that the
portal loads like the exchange-rate snapshot.

Rules:
  * A row counts as a rating only when نوع المشاركة contains "تقييم" and التقييم
    is an integer 1..5.
  * Identified ratings keep one latest vote per browser receipt and place.
  * Legacy rows without receipts use the old correction-value heuristic; their
    authors cannot be reliably distinguished retroactively.
  * Rows are applied in sheet order, which is submission order.
"""
import json
import re
import sys
import urllib.request

SHEET_ID = '1owergoyNbXTjGCDw6Va0EWXCAIEw15K7lEeZl63CFiI'
CSV_URL = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/gviz/tq?tqx=out:csv'
OUT_PATH = 'ratings.json'
EDIT_RE = re.compile(r'\[تعديل تقييم\].*?من\s*(\d)\s*إلى\s*(\d)')
RECEIPT_RE = re.compile(r'\[تقييم:([a-f0-9-]{36})\]')


def parse_csv(text):
    """RFC4180 parser: quotes may be doubled inside a field."""
    rows, row, field, quoted = [], [], '', False
    i = 0
    while i < len(text):
        ch = text[i]
        if quoted:
            if ch == '"':
                if text[i + 1:i + 2] == '"':
                    field += '"'
                    i += 1
                else:
                    quoted = False
            else:
                field += ch
        elif ch == '"':
            quoted = True
        elif ch == ',':
            row.append(field)
            field = ''
        elif ch in '\r\n':
            if ch == '\r' and text[i + 1:i + 2] == '\n':
                i += 1
            row.append(field)
            rows.append(row)
            row, field = [], ''
        else:
            field += ch
        i += 1
    if field or row:
        row.append(field)
        rows.append(row)
    return rows


def rating_value(raw):
    match = re.fullmatch(r'\s*([1-5])\s*', str(raw or ''))
    return int(match.group(1)) if match else None


def aggregate(rows):
    """rows: iterable of dicts with type/name/phone/rating/notes. Returns {key: {avg, count}}."""
    values = {}
    identified = {}
    for item in rows:
        if 'تقييم' not in (item.get('type') or ''):
            continue
        if '[بلاغ' in (item.get('notes') or ''):
            continue
        stars = rating_value(item.get('rating'))
        if not stars:
            continue
        key = (item.get('phone') or item.get('name') or '').strip()
        if not key:
            continue
        name = (item.get('name') or '').strip()
        if name:
            key += '\n' + name
        receipt = RECEIPT_RE.search(item.get('notes') or '')
        if receipt:
            identified.setdefault(key, {})[receipt.group(1)] = stars
            continue
        bucket = values.setdefault(key, [])
        edit = EDIT_RE.search(item.get('notes') or '')
        # A marked correction replaces the user's own earlier rating instead of counting twice.
        if edit and edit.group(2) == str(stars):
            previous = int(edit.group(1))
            for index in range(len(bucket) - 1, -1, -1):
                if bucket[index] == previous:
                    bucket[index] = stars
                    break
            else:
                bucket.append(stars)
        else:
            bucket.append(stars)
    for key, votes in identified.items():
        values.setdefault(key, []).extend(votes.values())
    return {key: {'avg': round(sum(v) / len(v), 2), 'count': len(v)}
            for key, v in values.items() if v}


def build_snapshot(rows):
    places = aggregate(rows)
    return {
        'source': 'google-sheet',
        'sheet_id': SHEET_ID,
        'fetched_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(timespec='seconds'),
        'total_ratings': sum(p['count'] for p in places.values()),
        'places': places,
    }


def selftest():
    def vote(receipt, stars, notes=''):
        return {'type': 'تقييم خدمة موجودة حالياً', 'phone': '0990000000', 'rating': str(stars),
                'notes': f'[تقييم:{receipt}]' + notes}
    a, b = 'a' * 36, 'b' * 36
    assert aggregate([vote(a, 5), vote(b, 5), vote(a, 2), vote(a, 2)]) == {
        '0990000000': {'avg': 3.5, 'count': 2}}
    assert aggregate([vote(a, 5, '[بلاغ خطأ]')]) == {}
    assert aggregate([dict(vote(a, 5), name='A'), dict(vote(a, 1), name='B')]) == {
        '0990000000\nA': {'avg': 5.0, 'count': 1},
        '0990000000\nB': {'avg': 1.0, 'count': 1}}
    rows = [
        {'type': 'تقييم خدمة موجودة حالياً', 'name': 'مطعم الشام', 'phone': '0991111111', 'rating': '5', 'notes': ''},
        {'type': 'تقييم خدمة موجودة حالياً', 'name': 'مطعم الشام', 'phone': '0991111111', 'rating': '3', 'notes': ''},
        {'type': 'تقييم خدمة موجودة حالياً', 'name': 'مطعم الشام', 'phone': '0991111111', 'rating': '4', 'notes': '[تعديل تقييم]: من 3 إلى 4 نجوم — تحديث لتقييم سابق وليس تقييماً مستقلاً'},
        {'type': 'تقييم خدمة موجودة حالياً', 'name': 'بقالة النور', 'phone': '0922222222', 'rating': '2', 'notes': ''},
        {'type': 'تقييم خدمة موجودة حالياً', 'name': 'بقالة النور', 'phone': '0922222222', 'rating': '1', 'notes': '[تعديل تقييم]: من 5 إلى 1 نجوم — لا يوجد تقييم سابق مطابق'},
        {'type': 'اقتراح إضافة رقم أو خدمة جديدة', 'name': 'محل جديد', 'phone': '0933333333', 'rating': '', 'notes': ''},
        {'type': 'تقييم خدمة موجودة حالياً', 'name': 'بلا قيمة', 'phone': '0944444444', 'rating': '9', 'notes': ''},
    ]
    places = aggregate(rows)
    # 5 and 3 where the 3 was corrected to 4: [5, 4]
    assert places['0991111111\nمطعم الشام'] == {'avg': 4.5, 'count': 2}, places
    # a correction whose previous value never occurred still counts once: [2, 1]
    assert places['0922222222\nبقالة النور'] == {'avg': 1.5, 'count': 2}, places
    assert '0933333333' not in places and '0944444444' not in places
    parsed = parse_csv('a,b\n"x,1","say ""hi"""\n')
    assert parsed[0] == ['a', 'b'] and parsed[1] == ['x,1', 'say "hi"'], parsed
    snapshot = build_snapshot(rows)
    assert snapshot['total_ratings'] == 4 and snapshot['source'] == 'google-sheet'
    assert rating_value(' 3 ') == 3 and rating_value('ثلاثة') is None and rating_value('') is None
    print('ratings selftest OK')


def main():
    if '--selftest' in sys.argv:
        selftest()
        return 0
    request = urllib.request.Request(CSV_URL, headers={'User-Agent': 'au-portal-ratings'})
    with urllib.request.urlopen(request, timeout=30) as response:
        rows = parse_csv(response.read().decode('utf-8-sig'))
    # Header: Timestamp | نوع المشاركة | التصنيف | المحافظة | الاسم | الهاتف | التقييم | ملاحظات
    entries = []
    for row in rows[1:]:
        if len(row) < 8 or not (row[4] or '').strip():
            continue
        entries.append({'type': row[1], 'name': row[4], 'phone': row[5], 'rating': row[6], 'notes': row[7] if len(row) > 7 else ''})
    snapshot = build_snapshot(entries)
    with open(OUT_PATH, 'w', encoding='utf-8') as handle:
        json.dump(snapshot, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    print(f"ratings: {snapshot['total_ratings']} across {len(snapshot['places'])} places")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
