"""Source adapters. Preserve source facts; keep app projection separate from identity."""
import html
import json
import math
import re
import unicodedata
import xml.etree.ElementTree as ET
from datetime import date
from urllib.parse import urlparse

TABLES = ('grains', 'hops', 'yeasts', 'misc_ingredients')
BSMX = {'Grain': ('grains', 'G'), 'Hops': ('hops', 'H'), 'Yeast': ('yeasts', 'Y'), 'Misc': ('misc_ingredients', 'M')}
GRAIN = {'0': 'grain', '1': 'extract', '2': 'sugar', '3': 'adjunct', '4': 'dry extract', '5': 'fruit', '6': 'juice', '7': 'honey'}
HOP = {'0': 'bittering', '1': 'aroma', '2': 'aroma/bittering'}
FORM = {'0': 'pellet', '1': 'whole', '2': 'plug', '3': 'extract', '4': 'powder', '5': 'whole'}
YEAST = {'0': 'ale', '1': 'lager', '2': 'wine', '3': 'champagne', '4': 'wheat'}
YFORM = {'0': 'liquid', '1': 'dry', '2': 'slant', '3': 'culture'}
MISC = {'0': 'spice', '1': 'fining', '2': 'herb', '3': 'flavor', '4': 'other', '5': 'water_agent'}


def norm(value):
    value = html.unescape(str(value or '')).casefold().replace('™', '').replace('®', '').replace('+', ' plus ')
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode())


def number(value):
    if value in (None, ''):
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError('non-finite number')
    return result


def enum(value, mapping):
    if value in mapping:
        return mapping[value]
    known = {norm(v): v for v in mapping.values()}
    if norm(value) in known:
        return known[norm(value)]
    raise ValueError(f'unknown enumeration {value!r}')


def rounded(value, digits=6):
    return round(value, digits) if value is not None else None


def clean(value):
    return html.unescape(value).strip() if value else None


def parse_bsmx(data):
    # BeerSmith files are XML fragments with multiple roots and occasionally raw
    # ampersands in notes. Do not invoke an entity-expanding XML parser on them.
    text = data.decode('utf-8-sig')
    if '<!DOCTYPE' in text.upper() or '<!ENTITY' in text.upper():
        raise ValueError('DTD/entities are not supported')
    records, rejected = [], []
    for tag, (table, prefix) in BSMX.items():
        blocks, stack = [], []
        for token in re.finditer(r'</?' + tag + r'>', text):
            if token[0].startswith('</'):
                if not stack: raise ValueError(f'unbalanced {tag}')
                start = stack.pop(); block = text[start:token.start()]
                if '<' + tag + '>' not in block: blocks.append(block)
            else: stack.append(token.end())
        if stack: raise ValueError(f'truncated {tag} record')
        for index, block in enumerate(blocks):
            raw = {k: clean(v) for k, v in re.findall(r'<F_' + prefix + r'_([A-Z0-9_]+)>(.*?)</F_' + prefix + r'_\1>', block, re.S)}
            selector = {'table': table, 'name': raw.get('NAME'), 'producer': raw.get('LAB') if table == 'yeasts' else raw.get('SUPPLIER'), 'product_id': raw.get('PRODUCT_ID'), 'form': raw.get('FORM'), 'origin': raw.get('ORIGIN')}
            try:
                repairs = repair_optional_fields(table, raw)
                row = convert_fields(table, raw, fahrenheit=True)
                records.append({'table': table, 'data': row, 'source_record': selector, 'source_index': index, 'extra': extras(table, raw), 'repairs': repairs})
            except (ValueError, TypeError) as exc:
                rejected.append({'table': table, 'name': raw.get('NAME'), 'index': index, 'reason': str(exc)})
    if not records and not rejected:
        raise ValueError('no ingredient records found')
    return records, rejected


def repair_optional_fields(table, raw):
    repairs = []
    if table == 'grains':
        kind = enum(raw.get('TYPE'), GRAIN)
        if kind in ('sugar', 'honey', 'extract', 'dry extract', 'juice') and raw.get('RECOMMEND_MASH') in ('1', 'TRUE', 'true'):
            repairs.append({'field': 'must_mash', 'original': raw['RECOMMEND_MASH'], 'action': 'no enzymatic mash required for sugar, honey, juice or extract'})
            raw['RECOMMEND_MASH'] = '0'
    if table != 'yeasts': return repairs
    lo, hi = number(raw.get('MIN_ATTENUATION')), number(raw.get('MAX_ATTENUATION'))
    if any(v is not None and not 0 <= v <= 100 for v in (lo, hi)):
        repairs.append({'field': 'attenuation', 'original': [lo, hi], 'action': 'omit optional range outside supported schema'})
        raw['MIN_ATTENUATION'] = raw['MAX_ATTENUATION'] = None
    elif lo is not None and hi is not None and lo > hi:
        repairs.append({'field': 'attenuation', 'original': [lo, hi], 'action': 'sort reversed bounds'})
        raw['MIN_ATTENUATION'], raw['MAX_ATTENUATION'] = str(hi), str(lo)
    return repairs


def convert_fields(table, raw, fahrenheit=False):
    if not raw.get('NAME'):
        raise ValueError('missing ingredient name')
    row = {'name': raw['NAME'], 'notes': raw.get('NOTES')}
    num = lambda key: number(raw.get(key))
    if table == 'grains':
        kind = enum(raw.get('TYPE'), GRAIN)
        # A grain is only called base malt when the name identifies a base style.
        base = bool(re.search(r'\b(pale|pils(?:en|ner)?|lager|ale malt|2.row|6.row|vienna|munich|maris otter|golden promise)\b', row['name'], re.I))
        # Pale chocolate and caramel Munich are specialty products even though
        # their names also contain a base-malt style.
        if re.search(r'crystal|chocolat|caramel|roast|black|biscuit', row['name'], re.I):
            base = False
        gt = {'grain': 'base' if base else 'specialty', 'extract': 'liquid_extract', 'dry extract': 'dry_extract'}.get(kind, kind)
        mash = raw.get('RECOMMEND_MASH')
        if mash not in ('0', '1', 'TRUE', 'FALSE', 'true', 'false'):
            raise ValueError('missing/invalid mash recommendation')
        row.update(grain_type=gt, color_ebc=rounded(num('COLOR') * 1.97) if num('COLOR') is not None else None,
                   extract_potential=rounded(num('YIELD') / 100) if num('YIELD') is not None else None,
                   must_mash=mash in ('1', 'TRUE', 'true'), origin=raw.get('ORIGIN'))
    elif table == 'hops':
        row.update(alpha_acid_percent=num('ALPHA'), beta_acid_percent=num('BETA'), hop_type=enum(raw.get('TYPE'), HOP), form=enum(raw.get('FORM'), FORM), origin=raw.get('ORIGIN'))
    elif table == 'yeasts':
        lo, hi = num('MIN_ATTENUATION'), num('MAX_ATTENUATION')
        if lo is not None and hi is not None and lo > hi:
            raise ValueError('reversed attenuation range')
        row.update(yeast_type=enum(raw.get('TYPE'), YEAST), form=enum(raw.get('FORM'), YFORM), laboratory=raw.get('LAB'), product_id=raw.get('PRODUCT_ID'), attenuation_percent=rounded((lo + hi) / 2) if lo is not None and hi is not None else lo if lo is not None else hi)
        # Narrow, name-based refinements; blends remain the source's type.
        if re.match(r'^(brettanomyces|brett\b)', row['name'], re.I): row['yeast_type'] = 'brett'
        if re.match(r'^(lactobacillus|pediococcus|oenococcus)', row['name'], re.I): row['yeast_type'] = 'bacteria'
        for field, key in [('temperature_range_min', 'MIN_TEMP'), ('temperature_range_max', 'MAX_TEMP')]:
            value = num(key)
            row[field] = rounded((value - 32) * 5 / 9 if fahrenheit and value is not None else value)
    else:
        row['ingredient_type'] = enum(raw.get('TYPE'), MISC)
    validate(table, row)
    return row


def validate(table, row):
    enums = {
        'grain_type': {'base', 'specialty', 'adjunct', 'sugar', 'liquid_extract', 'dry_extract', 'fruit', 'juice', 'honey'},
        'hop_type': set(HOP.values()),
        'yeast_type': set(YEAST.values()) | {'brett', 'bacteria', 'other'},
        'ingredient_type': set(MISC.values()) | {'wood', 'yeast_nutrient', 'wine_making', 'preservative', 'bottling', 'color'},
    }
    if not isinstance(row.get('name'), str) or not row['name'].strip(): raise ValueError('invalid name')
    for field in ('notes', 'origin', 'laboratory', 'product_id'):
        if row.get(field) is not None and not isinstance(row[field], str): raise ValueError(f'invalid {field}')
    for field, values in enums.items():
        if field in row and row[field] not in values: raise ValueError(f'invalid {field}')
    if table == 'grains' and not isinstance(row.get('must_mash'), bool): raise ValueError('invalid must_mash')
    if table in ('hops', 'yeasts') and row.get('form') not in (set(FORM.values()) if table == 'hops' else set(YFORM.values())): raise ValueError('invalid form')
    ranges = {'alpha_acid_percent': (0, 100), 'beta_acid_percent': (0, 100), 'color_ebc': (0, 10000), 'extract_potential': (0, 1), 'attenuation_percent': (0, 100), 'temperature_range_min': (-20, 100), 'temperature_range_max': (-20, 100)}
    required = {'grains': ('color_ebc', 'extract_potential'), 'hops': ('alpha_acid_percent',)}.get(table, ())
    for field in required:
        if row.get(field) is None: raise ValueError(f'missing {field}')
    for field, (lo, hi) in ranges.items():
        v = row.get(field)
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi):
            raise ValueError(f'invalid {field}: {v}')
    lo, hi = row.get('temperature_range_min'), row.get('temperature_range_max')
    if lo is not None and hi is not None and lo > hi: raise ValueError('reversed temperature range')


def extras(table, raw):
    # No prices, stock, recipe amounts or account metadata leave the converter.
    keys = {'grains': ('SUPPLIER', 'PROTEIN', 'MOISTURE', 'DIASTATIC_POWER', 'COARSE_FINE_DIFF', 'MAX_IN_BATCH'),
            'hops': ('HSI', 'SUBSTITUTES'), 'yeasts': ('MIN_ATTENUATION', 'MAX_ATTENUATION', 'TOLERANCE', 'BEST_FOR', 'FLOCCULATION'),
            'misc_ingredients': ('USE_FOR',)}[table]
    return {key: raw[key] for key in keys if raw.get(key) is not None}


def parse_beerxml(data):
    if b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper(): raise ValueError('DTD/entities are not supported')
    root = ET.fromstring(data)
    records, rejected = [], []
    for tag, table in [('FERMENTABLE', 'grains'), ('HOP', 'hops'), ('YEAST', 'yeasts'), ('MISC', 'misc_ingredients')]:
        for index, element in enumerate(root.iter(tag)):
            raw = {child.tag: clean(child.text) for child in element}
            raw['TYPE'] = {'both': 'aroma/bittering', 'wateragent': 'water_agent'}.get(norm(raw.get('TYPE')), raw.get('TYPE'))
            raw['FORM'] = {'leaf': 'whole'}.get(norm(raw.get('FORM')), raw.get('FORM'))
            raw['RECOMMEND_MASH'] = raw.get('RECOMMEND_MASH', 'FALSE')
            raw['LAB'] = raw.get('LABORATORY')
            raw['MIN_TEMP'] = raw.get('MIN_TEMPERATURE')
            raw['MAX_TEMP'] = raw.get('MAX_TEMPERATURE')
            raw['MIN_ATTENUATION'] = raw['MAX_ATTENUATION'] = raw.get('ATTENUATION')
            try:
                repairs = repair_optional_fields(table, raw)
                row = convert_fields(table, raw)
                records.append({'table': table, 'data': row, 'source_record': {'table': table, 'name': row['name'], 'producer': raw.get('LAB') or raw.get('SUPPLIER'), 'product_id': raw.get('PRODUCT_ID'), 'form': raw.get('FORM'), 'origin': raw.get('ORIGIN')}, 'source_index': index, 'extra': extras(table, raw), 'repairs': repairs})
            except (ValueError, TypeError) as exc:
                rejected.append({'table': table, 'name': raw.get('NAME'), 'index': index, 'reason': str(exc)})
    if not records and not rejected: raise ValueError('no ingredient records found')
    return records, rejected


def parse_reviewed_json(data):
    """Load a small, source-linked factual supplement in app units.

    This format is deliberately strict: a damaged bundled supplement must fail
    as a unit, rather than silently shipping a partially reviewed catalogue.
    """
    document = json.loads(data)
    if not isinstance(document, dict) or document.get('version') != 1:
        raise ValueError('unsupported reviewed supplement version')
    if not isinstance(document.get('records'), list) or not document['records']:
        raise ValueError('reviewed supplement needs records')
    fields = {
        'grains': {'grain_type', 'color_ebc', 'extract_potential', 'must_mash', 'origin'},
        'hops': {'alpha_acid_percent', 'beta_acid_percent', 'hop_type', 'form', 'origin'},
        'yeasts': {'yeast_type', 'form', 'laboratory', 'product_id', 'attenuation_percent', 'temperature_range_min', 'temperature_range_max'},
        'misc_ingredients': {'ingredient_type'},
    }
    records = []
    for index, item in enumerate(document['records']):
        if not isinstance(item, dict) or set(item) - {'table', 'data', 'extra', 'evidence', 'reviewed_on', 'reason'}:
            raise ValueError('invalid reviewed supplement record')
        table = item.get('table')
        if table not in TABLES: raise ValueError('unknown supplement table')
        allowed = fields[table] | {'name', 'notes'}
        raw = item.get('data')
        if not isinstance(raw, dict) or set(raw) - allowed:
            raise ValueError('unexpected supplement data fields')
        row = {field: raw.get(field) for field in allowed}
        validate(table, row)
        evidence = item.get('evidence')
        if not isinstance(evidence, list) or not evidence or not all(
            isinstance(url, str) and urlparse(url).scheme == 'https' and urlparse(url).hostname
            and urlparse(url).username is None and urlparse(url).password is None
            for url in evidence
        ): raise ValueError('supplement requires HTTPS evidence URLs')
        try: date.fromisoformat(item.get('reviewed_on', ''))
        except (ValueError, TypeError): raise ValueError('supplement requires a review date') from None
        if not isinstance(item.get('reason'), str) or not item['reason'].strip():
            raise ValueError('supplement requires a review reason')
        extra = item.get('extra', {})
        if not isinstance(extra, dict) or extra != extras(table, extra) or any(not isinstance(v, str) for v in extra.values()):
            raise ValueError('unexpected supplement extra fields')
        text_extra = {'SUPPLIER', 'SUBSTITUTES', 'BEST_FOR', 'USE_FOR'}
        for field, value in extra.items():
            if field in text_extra: continue
            numeric = number(value)
            upper = 10000 if field == 'DIASTATIC_POWER' else 100
            if numeric is None or not 0 <= numeric <= upper:
                raise ValueError(f'invalid supplement numeric extra {field}')
        if table == 'yeasts':
            lo, hi = number(extra.get('MIN_ATTENUATION')), number(extra.get('MAX_ATTENUATION'))
            if (lo is None) != (hi is None) or (lo is not None and not 0 <= lo <= hi <= 100):
                raise ValueError('invalid supplement attenuation range')
            if lo is not None and row['attenuation_percent'] != rounded((lo + hi) / 2):
                raise ValueError('supplement attenuation midpoint disagrees with range')
        records.append({'table': table, 'data': row, 'source_index': index, 'extra': extra,
                        'repairs': [], 'review': {k: item[k] for k in ('evidence', 'reviewed_on', 'reason')}})
    return records, []


def beerjson_record(table, row, extra):
    unit = lambda value, name: {'value': value, 'unit': name}
    result = {'name': row['name']}
    if row.get('notes'): result['notes'] = row['notes']
    if row.get('origin'): result['origin'] = row['origin']
    if table == 'grains':
        kind = row['grain_type']
        result.update(type={'base': 'grain', 'specialty': 'grain', 'adjunct': 'grain', 'liquid_extract': 'extract', 'dry_extract': 'dry extract'}.get(kind, kind), color=unit(row['color_ebc'], 'EBC'))
        result['yield'] = {'fine_grind': unit(rounded(row['extract_potential'] * 100), '%')}
        if kind in ('base', 'specialty', 'adjunct'): result['grain_group'] = kind
        result['recommend_mash'] = row['must_mash']
        if extra.get('SUPPLIER'): result['producer'] = extra['SUPPLIER']
        for src, dest, units in [('PROTEIN', 'protein', '%'), ('MOISTURE', 'moisture', '%'), ('DIASTATIC_POWER', 'diastatic_power', 'Lintner'), ('MAX_IN_BATCH', 'max_in_batch', '%')]:
            # Many packs copy barley defaults onto honey, juice and sugar. Keep
            # those raw properties in provenance, not in a misleading export.
            if kind not in ('base', 'specialty', 'adjunct'): continue
            try: value = number(extra.get(src))
            except ValueError: continue
            if value is not None and value >= 0 and (units != '%' or value <= 100): result[dest] = unit(value, units)
    elif table == 'hops':
        result.update(form={'whole': 'leaf'}.get(row['form'], row['form']), type=row['hop_type'], alpha_acid=unit(row['alpha_acid_percent'], '%'))
        if row.get('beta_acid_percent') is not None: result['beta_acid'] = unit(row['beta_acid_percent'], '%')
        if extra.get('SUBSTITUTES'): result['substitutes'] = extra['SUBSTITUTES']
    elif table == 'yeasts':
        result.update(type={'wheat': 'ale'}.get(row['yeast_type'], row['yeast_type']), form=row['form'])
        for src, dest in [('laboratory', 'producer'), ('product_id', 'product_id')]:
            if row.get(src): result[dest] = row[src]
        for dest, lo, hi, units in [('temperature_range', row.get('temperature_range_min'), row.get('temperature_range_max'), 'C'), ('attenuation_range', number(extra.get('MIN_ATTENUATION')), number(extra.get('MAX_ATTENUATION')), '%')]:
            if lo is not None and hi is not None: result[dest] = {'minimum': unit(lo, units), 'maximum': unit(hi, units)}
        if extra.get('BEST_FOR'): result['best_for'] = extra['BEST_FOR']
    else:
        result['type'] = {'water_agent': 'water agent', 'yeast_nutrient': 'other', 'wine_making': 'other', 'preservative': 'other', 'bottling': 'other', 'color': 'other'}.get(row['ingredient_type'], row['ingredient_type'])
        if extra.get('USE_FOR'): result['use_for'] = extra['USE_FOR']
    return result
