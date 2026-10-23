"""Conservative, repeatable field cleanup. Never guesses numbers, hours or locations."""
import argparse
import copy
import json
import re
from pathlib import Path
from urllib.parse import urlparse


def entries(data):
    for category, items in data['services'].items():
        for index, item in enumerate(items):
            yield f'services/{category}/{index}', item
    for gi, group in enumerate(data['transport']):
        for index, item in enumerate(group['items']):
            yield f'transport/{gi}/items/{index}', item


def cleanup(data):
    changes = []
    for path, item in entries(data):
        before = copy.deepcopy(item)
        link = item.get('link', '')
        url = urlparse(link)
        if url.hostname in ('www.google.com', 'google.com') and url.path.startswith('/maps/'):
            # Keep the old rating identity when changing the main contact field.
            item.setdefault('rating_contact', item.get('phone') or link)
            item.setdefault('map_url', link)
            item.setdefault('phone', '')
            del item['link']
        parts = []
        for part in item.get('note', '').split(' · '):
            if not item.get('address') and part.startswith('العنوان: '):
                item['address'] = part[len('العنوان: '):].strip()
            elif not item.get('address') and re.match(r'^[23456789CFGHJMPQRVWX]{4}\+[23456789CFGHJMPQRVWX]{2,3}', part):
                item['address'] = part
            elif part:
                parts.append(part)
        if before.get('note'):
            item['note'] = ' · '.join(parts)
        name = item['name']
        if name == 'STAR CITY' and '📞' in item.get('note', ''):
            text, phone_text = item['note'].split('📞', 1)
            numbers = re.findall(r'09\d{8}', phone_text)
            if numbers and 'الموقع:' in text:
                description, address = text.split('الموقع:', 1)
                item['phone'] = ' / '.join(dict.fromkeys(numbers))
                item['address'] = address.strip()
                item['note'] = description.strip()
                if item.get('link'):
                    item.setdefault('rating_contact', item['link'])
                    item['website'] = item.pop('link')
        if name == 'Friends  cafe' and item.get('note', '').startswith('الموقع:'):
            item['address'] = item.pop('note')[len('الموقع:'):].strip()
        if name == 'سوبر ماركت رامي' and item.get('note') == 'الموقع: الاستراد_ مقابل مفرق مطعم نايا_خدمة ٢٤ ساعة':
            item['address'] = 'الاستراد_ مقابل مفرق مطعم نايا'
            item.setdefault('hours', {'allday': True})
            item.pop('note')
        if name == 'سوبر ماركت Golden' and item.get('note', '').startswith('24/7 '):
            item.setdefault('hours', {'allday': True})
            item['note'] = item['note'][5:]
        if name == 'مكتبة عمار' and item.get('note') == 'متوفر من 8 صباحا حتى 4 عصرا والجمعة عطلة':
            item.setdefault('hours', {'open': '08:00', 'close': '16:00', 'days': [0, 1, 2, 3, 4, 6]})
            item.pop('note')
        for expected_name, address in [('مكتبة سما', 'مكان الفؤاد سابقاً مقابل الهرم تقريباً'), ('مجموعة طنجور للعقارات', 'المكتب قرب الكراجات')]:
            if name == expected_name and item.get('note') == address:
                item['address'] = item.pop('note')
        if name == 'مشفى الأندلس الجامعي' and ' · ' in item.get('note', ''):
            description, address = item['note'].rsplit(' · ', 1)
            if address.startswith('طرطوس - بانياس'):
                item['address'] = address
                item['note'] = description
        delivery = item.get('delivery', {})
        if delivery:
            redundant = {f'{label}: {delivery[key]}' for key, label in [('areas', 'مناطق التوصيل'), ('fee', 'أجرة التوصيل'), ('kind', 'نوع الطلبات')] if key in delivery}
            item['note'] = '\n'.join(line for line in item.get('note', '').splitlines() if line not in redundant)
        if item.get('note') == '':
            item.pop('note', None)
        if item != before:
            changes.append({'path': path, 'before': before, 'after': copy.deepcopy(item)})
    return changes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--data', default='data.json')
    parser.add_argument('--log', default='tests/directory-field-changes.json')
    args = parser.parse_args()
    path = Path(args.data)
    data = json.loads(path.read_text(encoding='utf-8-sig'))
    changes = cleanup(data)
    print(json.dumps({'entries': sum(1 for _ in entries(data)), 'changed': len(changes), 'names': [c['after']['name'] for c in changes]}, ensure_ascii=False))
    if args.apply and changes:
        Path(args.log).write_text(json.dumps(changes, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


if __name__ == '__main__':
    main()
