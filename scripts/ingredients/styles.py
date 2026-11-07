"""Download BJCP prose separately from the redistributable style metadata."""
import json
from pathlib import Path
import re
import unicodedata

FIELDS = {'impression': 'overall_impression', 'aroma': 'aroma', 'appearance': 'appearance',
          'flavor': 'flavor', 'mouthfeel': 'mouthfeel', 'comments': 'comments',
          'history': 'history', 'ingredients': 'characteristic_ingredients',
          'comparison': 'style_comparison', 'examples': 'commercial_examples',
          'entryinstructions': 'entry_instructions', 'tags': 'tags',
          'Currently Defined Types': 'currentlydefinedtypes', 'Strength classifications': 'strengthclassifications'}


def name_key(name):
    text = unicodedata.normalize('NFKD', name.lower().replace('specialty ipa:', ''))
    return re.sub('[^a-z0-9]', '', text)


def parse_styles(data, targets):
    guide = json.loads(data)['styleguide']
    if guide['version'] != '2021':
        raise ValueError('unexpected style guideline version')
    indexed = {}
    for category in guide['category']:
        for row in category['subcategory']:
            indexed.setdefault(name_key(row['name']), []).append(row)
    result = []
    for target in targets:
        matches = indexed.get(name_key(target['name']), [])
        if len(matches) != 1:
            raise ValueError('missing or ambiguous style: ' + target['number'])
        source = matches[0]
        row = {'number': target['number'], 'name': target['name'], 'style_guide': 'BJCP 2021'}
        for source_field, field in FIELDS.items():
            value = source.get(source_field)
            if value is not None:
                if source_field in ('tags', 'examples') and isinstance(value, list) and all(isinstance(item, str) for item in value):
                    value = ', '.join(value)
                if not isinstance(value, str) or len(value) > 50000:
                    raise ValueError('invalid style description')
                row[field] = value.strip()
        if not row.get('overall_impression'):
            raise ValueError('style has no description')
        result.append(row)
    return result


def download_styles(config, cache, offline, base, deadline):
    from .pipeline import artifact
    errors = []
    for location in config['locations']:
        try:
            data, transport = artifact(location, Path(cache), offline, base, deadline)
            rows = parse_styles(data, config['targets'])
            return rows, {'id': 'bjcp-2021-styles', 'status': 'loaded', 'records': len(rows), 'transport': transport}
        except (OSError, ValueError, KeyError, TypeError) as exc:
            errors.append(str(exc))
    return [], {'id': 'bjcp-2021-styles', 'status': 'unavailable', 'errors': errors}
