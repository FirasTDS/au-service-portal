"""One-time owner confirmations and researched corrections, with reversible merge history."""
import copy
import datetime
import json
from pathlib import Path
import uuid

path = Path('data.json')
data = json.loads(path.read_text(encoding='utf-8-sig'))
changes = []

star = next(item for item in data['services']['gaming'] if item['name'] == 'STAR CITY')
if star['hours'] == {'open': '02:00', 'close': '14:00'}:
    before = copy.deepcopy(star)
    star['hours'] = {'open': '14:00', 'close': '02:00'}
    changes.append({'reason': 'Owner confirmed 14:00–02:00', 'before': before, 'after': copy.deepcopy(star)})

stores = data['services']['supermarkets']
source = next((item for item in stores if item['name'] == 'سوبرماركت مرعي'), None)
target = next(item for item in stores if item['name'] == 'مرعي')
if source:
    before = copy.deepcopy(target)
    target['map_url'] = source['map_url']
    target['address'] = source['address']
    key = (source.get('rating_contact') or source.get('phone') or source['name']) + '\n' + source['name']
    target['rating_key_aliases'] = list(dict.fromkeys(target.get('rating_key_aliases', []) + [key]))
    position = stores.index(source)
    data.setdefault('trash', []).append({
        'id': str(uuid.uuid4()), 'type': 'service', 'category': 'supermarkets', 'city': None,
        'position': position, 'deleted_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'item': copy.deepcopy(source),
        'merge': {'before': before, 'after': json.dumps(target, ensure_ascii=False, separators=(',', ':'))}
    })
    stores.remove(source)
    changes.append({'reason': 'Owner confirmed duplicate: مرعي / سوبرماركت مرعي', 'before': [before, source], 'after': copy.deepcopy(target)})

jafra = next(item for item in data['services']['pharmacies'] if item['name'] == 'Jafra Pharma')
if jafra.get('phone') == '0113315212':
    before = copy.deepcopy(jafra)
    jafra.setdefault('contact_history', []).append({
        'phone': jafra['phone'],
        'reason': 'الرقم منشور لمستودع جفرا فارما في دمشق؛ لم يثبت أنه للصيدلية المحلية.',
        'sources': ['https://www.facebook.com/jafrapharma/', 'https://shofey.com/directory/jafra-pharma/']
    })
    jafra.setdefault('rating_contact', jafra['phone'])
    jafra['phone'] = ''
    jafra['note'] = 'الرقم غير متوفر — هوية هذا الإدخال المحلي بحاجة للتحقق؛ الرقم السابق يخص مستودع جفرا فارما في دمشق.'
    changes.append({'reason': 'Damascus warehouse number not verified for local pharmacy', 'before': before, 'after': copy.deepcopy(jafra)})

if changes:
    Path('tests/confirmed-directory-updates.json').write_text(json.dumps(changes, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(f'{len(changes)} confirmed/researched updates applied')
