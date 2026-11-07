"""Manifest resolution, deterministic identity, priority merging and output."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tarfile
import tempfile
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from xml.etree.ElementTree import ParseError as ETParseError
import uuid
from contextlib import closing, contextmanager

from .converters import TABLES, norm, number, parse_bsmx, parse_beerxml, parse_reviewed_json, validate, beerjson_record

NAMESPACE = uuid.UUID('84758151-5365-57ec-8600-fbf083806184')
PARSERS = {'bsmx': parse_bsmx, 'beerxml': parse_beerxml, 'reviewed-json': parse_reviewed_json}
MAX_DOWNLOAD = 64 * 1024 * 1024
MAX_MEMBER = 8 * 1024 * 1024
COUNTRIES = {'us': 'unitedstates', 'usa': 'unitedstates', 'unitedstatesofamerica': 'unitedstates', 'uk': 'unitedkingdom', 'england': 'unitedkingdom', 'nz': 'newzealand', 'newzealandcanterbury': 'newzealand', 'german': 'germany', 'belgian': 'belgium', 'czech': 'czechrepublic', 'czechia': 'czechrepublic', 'czechrebublic': 'czechrepublic', 'southafrican': 'southafrica', 'sloevnia': 'slovenia', 'scotlanduk': 'scotland'}
COUNTRIES.update({'usychhops': 'unitedstatesychhops', 'usgermany': 'unitedstatesgermany', 'japansourcedinus': 'japanunitedstates', 'yugoslaviaserbia': 'yugoslavia'})
PRODUCERS = {'wyeastlabs': 'wyeast', 'wyeastlaboratories': 'wyeast', 'theyeastbay': 'yeastbay', 'dclfermentis': 'fermentis', 'lallemanddanstar': 'lallemand', 'danstar': 'lallemand', 'mangrovejack': 'mangrovejacks', 'eastcosatyeast': 'eastcoastyeast', 'whclabs': 'whclab', 'whclaboratory': 'whclab', 'gladfieldmalt': 'gladfield', 'castlemalting': 'castle'}


def dumps(value):
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + '\n'


def digest(data): return hashlib.sha256(data).hexdigest()
def country(value): return COUNTRIES.get(norm(value), norm(value))
def producer(value): return PRODUCERS.get(norm(value), norm(value))


def fingerprint(record):
    row, table = record['data'], record['table']
    parts = [table, norm(row['name'])]
    if table in ('hops', 'grains'): parts.append(country(row.get('origin')))
    if table == 'grains': parts.append(producer(record.get('extra', {}).get('SUPPLIER')))
    if table == 'yeasts': parts.extend([producer(row.get('laboratory')), norm(row.get('product_id'))])
    if table in ('hops', 'yeasts'): parts.append(row['form'])
    return '|'.join(parts)


def ingredient_id(key): return str(uuid.uuid5(NAMESPACE, key))


def read_json(path): return json.loads(Path(path).read_text())


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name)
    try:
        with os.fdopen(fd, 'wb') as handle: handle.write(data)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)


def artifact(candidate, cache, offline, base, deadline=None):
    expected = candidate['sha256']
    if not re.fullmatch('[a-f0-9]{64}', expected): raise ValueError('invalid SHA-256')
    cached = cache / expected
    if cached.exists():
        data = cached.read_bytes()
        if digest(data) == expected: return data, 'cache'
        # Never use a damaged cache; a network retry may recover it.
    if 'path' in candidate:
        data = (base / candidate['path']).read_bytes()
    else:
        if offline: raise ValueError('not in verified cache (offline)')
        remaining = deadline - time.monotonic() if deadline is not None else 25
        if remaining <= 0: raise ValueError('download time budget exhausted; retry to fetch remaining sources')
        url = candidate['url']
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.username or parsed.password: raise ValueError('sources must use credential-free HTTPS')
        with urlopen(Request(url, headers={'User-Agent': 'Brewey-Catalog/1'}), timeout=min(25, remaining)) as response:
            if urlparse(response.url).scheme != 'https': raise ValueError('insecure redirect')
            data = response.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD: raise ValueError('source exceeds size limit')
    if digest(data) != expected: raise ValueError('checksum mismatch; source changed and needs review')
    atomic_write(cached, data)
    return data, 'download' if 'url' in candidate else 'file'


@contextmanager
def archive_reader(data):
    """Older Python runtimes need the packaged zstd CLI for Debian zstd members."""
    try:
        archive = tarfile.open(fileobj=io.BytesIO(data), mode='r:*')
    except tarfile.ReadError:
        if not data.startswith(b'\x28\xb5\x2f\xfd'):
            raise
        # Stream decompressed data; never extract paths or execute package contents.
        with tempfile.TemporaryFile() as compressed:
            compressed.write(data); compressed.seek(0)
            try:
                process = subprocess.Popen(['zstd', '--decompress', '--stdout', '--quiet'], stdin=compressed, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            except FileNotFoundError as exc:
                raise ValueError('This Python version requires the zstd executable to read this source.') from exc
            try:
                with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
                    yield archive
            finally:
                process.stdout.close()
                if process.poll() is None: process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
        return
    with archive:
        yield archive


def deb_member(data, member):
    """Read a single regular data.tar member in memory. Never extract or execute."""
    if not data.startswith(b'!<arch>\n'): raise ValueError('invalid Debian archive')
    position = 8
    while position + 60 <= len(data):
        header = data[position:position + 60]
        if header[58:60] != b'`\n': raise ValueError('invalid ar header')
        size = int(header[48:58]); name = header[:16].decode().strip().rstrip('/')
        if size < 0 or position + 60 + size > len(data): raise ValueError('truncated archive')
        body = data[position + 60:position + 60 + size]
        position += 60 + size + size % 2
        if name.startswith('data.tar'):
            with archive_reader(body) as archive:
                for entry in archive:
                    if entry.name.removeprefix('./') == member:
                        if not entry.isfile() or entry.size > MAX_MEMBER: raise ValueError('invalid archive member')
                        return archive.extractfile(entry).read(MAX_MEMBER + 1)
    raise ValueError('archive member not found')


def load_sources(manifest, cache, offline=False, base=Path('.'), progress=None, deadline=None):
    cache = Path(cache); cache.mkdir(parents=True, exist_ok=True)
    records, statuses, rejected = [], [], []
    if manifest.get('version') != 1: raise ValueError('unsupported manifest version')
    source_ids = set()
    for order, source in enumerate(manifest['sources']):
        sid = source['id']
        if sid in source_ids: raise ValueError('duplicate source id')
        source_ids.add(sid)
        if source['format'] not in PARSERS: raise ValueError('unsupported source format')
        errors = []
        for candidate in source['locations']:
            try:
                data, transport = artifact(candidate, cache, offline, base, deadline)
                if candidate.get('member'):
                    data = deb_member(data, candidate['member'])
                    if digest(data) != candidate['member_sha256']: raise ValueError('member checksum mismatch')
                parsed, bad = PARSERS[source['format']](data)
                if not parsed: raise ValueError('all records rejected')
                for record in parsed:
                    record.update(source=sid, priority=source['priority'], order=order, source_sha256=digest(data))
                records.extend(parsed)
                rejected.extend(dict(row, source=sid) for row in bad)
                statuses.append({'id': sid, 'status': 'loaded', 'location': candidate.get('url') or candidate.get('path'), 'transport': transport, 'sha256': digest(data), 'records': len(parsed), 'rejected': len(bad), 'fallback_errors': errors})
                break
            except (OSError, ValueError, KeyError, tarfile.TarError, ETParseError) as exc:
                errors.append(str(exc))
        else:
            statuses.append({'id': sid, 'status': 'unavailable', 'errors': errors})
            if source.get('required', False): raise ValueError(f'required source {sid} unavailable: {errors}')
        if progress: progress({'phase': 'sources', 'completed': len(statuses), 'total': len(manifest['sources']), 'loaded': sum(s['status'] == 'loaded' for s in statuses), 'current': sid})
    return records, statuses, rejected


def merge(records, registry):
    if registry.get('version') != 1: raise ValueError('unsupported registry version')
    if registry.get('namespace', str(NAMESPACE)) != str(NAMESPACE): raise ValueError('identity namespace cannot change')
    aliases = registry.get('aliases', {})
    overrides = registry.get('overrides', {})
    excluded = registry.get('excluded', {})
    groups, skipped = {}, []
    for record in records:
        fp = fingerprint(record)
        if fp in excluded:
            skipped.append({'source': record['source'], 'name': record['data']['name'], 'fingerprint': fp, 'reason': excluded[fp]}); continue
        key = aliases.get(fp, fp)
        groups.setdefault(key, []).append(record)
    catalog = {t: [] for t in TABLES}
    provenance, conflicts, identity_map, unregistered = {}, [], {}, []
    for key, entries in sorted(groups.items()):
        entries.sort(key=lambda r: (r['priority'], r['order'], r['source_index']))
        table = entries[0]['table']
        if any(r['table'] != table for r in entries): raise ValueError('identity crosses ingredient tables')
        row, extra, field_sources = {}, {}, {}
        extra_sources = {}
        for record in entries:
            fp = fingerprint(record)
            identity_map[fp] = ingredient_id(key)
            if fp not in aliases: unregistered.append(fp)
            for field, value in record['data'].items():
                if value is None or value == '': continue
                if row.get(field) is None:
                    row[field] = value; field_sources[field] = record['source']
                elif row[field] != value:
                    conflicts.append({'id': ingredient_id(key), 'field': field, 'chosen': row[field], 'chosen_source': field_sources[field], 'alternative': value, 'alternative_source': record['source']})
            # Keep bounds with the source that actually supplied the midpoint.
            # A preferred source can supply only a midpoint; do not attach a
            # different source's range to it merely because that range exists.
            if field_sources.get('attenuation_percent') == record['source'] and row.get('attenuation_percent') == record['data'].get('attenuation_percent') and 'MIN_ATTENUATION' not in extra and 'MAX_ATTENUATION' not in extra:
                for field in ('MIN_ATTENUATION', 'MAX_ATTENUATION'):
                    if field in record.get('extra', {}):
                        extra[field] = record['extra'][field]; extra_sources[field] = record['source']
            for field, value in record.get('extra', {}).items():
                if field not in ('MIN_ATTENUATION', 'MAX_ATTENUATION') and field not in extra:
                    extra[field] = value; extra_sources[field] = record['source']
        for field in entries[0]['data']: row.setdefault(field, None)
        for field, value in overrides.get(key, {}).get('fields', {}).items():
            if field not in row: raise ValueError(f'unknown override field {field}')
            row[field] = value; field_sources[field] = 'reviewed override'
        for field, value in overrides.get(key, {}).get('extra_fields', {}).items():
            # Reviewed percentage properties retained only in the BeerJSON
            # projection must agree with corrections to the app description.
            permitted = {'grains': {'MAX_IN_BATCH', 'MOISTURE', 'PROTEIN'},
                         'yeasts': {'MIN_ATTENUATION', 'MAX_ATTENUATION'}}
            if field not in permitted.get(table, set()):
                raise ValueError(f'unsupported extra override field {field}')
            if isinstance(value, bool) or number(value) is None or not 0 <= number(value) <= 100:
                raise ValueError(f'invalid extra override value {field}')
            extra[field] = str(value); extra_sources[field] = 'reviewed override'
        changed_extra = overrides.get(key, {}).get('extra_fields', {})
        if table == 'yeasts' and changed_extra:
            if set(changed_extra) != {'MIN_ATTENUATION', 'MAX_ATTENUATION'}:
                raise ValueError('override both attenuation bounds together')
            lo, hi = number(extra['MIN_ATTENUATION']), number(extra['MAX_ATTENUATION'])
            if lo > hi or row['attenuation_percent'] != round((lo + hi) / 2, 6):
                raise ValueError('attenuation override disagrees with app midpoint')
        if table == 'yeasts' and 'MIN_ATTENUATION' in extra and 'MAX_ATTENUATION' in extra:
            lo, hi = number(extra['MIN_ATTENUATION']), number(extra['MAX_ATTENUATION'])
            if lo > hi or row['attenuation_percent'] != round((lo + hi) / 2, 6):
                raise ValueError('merged attenuation range disagrees with app midpoint')
        validate(table, row)
        identifier = ingredient_id(key)
        row.update(id=identifier, created_at='1970-01-01T00:00:00.000Z', updated_at='1970-01-01T00:00:00.000Z')
        catalog[table].append(row)
        provenance[identifier] = {'identity_key': key, 'table': table, 'fields': field_sources, 'extra': extra, 'extra_sources': extra_sources, 'override': overrides.get(key), 'sources': [{'id': r['source'], 'index': r['source_index'], 'name': r['data']['name'], 'fingerprint': fingerprint(r), 'sha256': r['source_sha256'], 'repairs': r.get('repairs', []), **({'review': r['review']} if r.get('review') else {})} for r in entries]}
    # The app expects distinct display names. Keep genuinely distinct products,
    # qualify their names rather than collapsing brands, origins or forms.
    for table, rows in catalog.items():
        names = {}
        for row in rows: names.setdefault(norm(row['name']), []).append(row)
        for duplicates in names.values():
            if len(duplicates) < 2: continue
            labels = {}
            for row in duplicates:
                p = provenance[row['id']]
                qualifiers = [row.get('laboratory') or p['extra'].get('SUPPLIER'), row.get('product_id'), row.get('origin'), row.get('form')]
                labels[row['id']] = ', '.join(x for x in qualifiers if x and norm(x))
            for row in duplicates:
                p = provenance[row['id']]; label = labels[row['id']]
                if not label or list(labels.values()).count(label) > 1: label += '; ' + row['id'][:8]
                row['name'] += ' [' + label.strip('; ') + ']'
                p['fields']['name'] = 'qualified to distinguish products'
        rows.sort(key=lambda r: (r['name'].casefold(), r['id']))
    return catalog, provenance, conflicts, identity_map, skipped, sorted(set(unregistered))


def write_outputs(output, catalog, provenance, conflicts, report, identity_map):
    output = Path(output); output.mkdir(parents=True, exist_ok=True)
    collections = {'grains': 'fermentables', 'hops': 'hop_varieties', 'yeasts': 'cultures', 'misc_ingredients': 'miscellaneous_ingredients'}
    beerjson = {'version': 1.0}
    beerjson_ids = {}
    for table, rows in catalog.items():
        for row in rows:
            provenance[row['id']]['content_sha256'] = digest(dumps({k: v for k, v in row.items() if k not in ('id', 'created_at', 'updated_at')}).encode())
        beerjson[collections[table]] = [beerjson_record(table, row, provenance[row['id']]['extra']) for row in rows]
        beerjson_ids[collections[table]] = [row['id'] for row in rows]
    documents = {'catalog.json': catalog, 'provenance.json': provenance, 'conflicts.json': conflicts, 'build-report.json': report, 'identity-map.json': identity_map, 'beerjson.json': {'beerjson': beerjson}, 'beerjson-ids.json': beerjson_ids}
    for name, data in documents.items(): atomic_write(output / name, dumps(data).encode())
    fd, temp = tempfile.mkstemp(dir=output, suffix='.sqlite'); os.close(fd)
    try:
        with closing(sqlite3.connect(temp)) as db, db:
            for table, rows in catalog.items():
                db.execute(f'CREATE TABLE {table} (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)))')
                db.executemany(f'INSERT INTO {table}(id,data) VALUES (?,?)', [(r['id'], json.dumps(r, ensure_ascii=False, allow_nan=False)) for r in rows])
            db.execute('CREATE TABLE catalog_metadata (key TEXT PRIMARY KEY, data TEXT NOT NULL)')
            db.execute('INSERT INTO catalog_metadata VALUES (?,?)', ('build', dumps(report)))
        os.replace(temp, output / 'ingredients.sqlite')
    finally:
        if os.path.exists(temp): os.unlink(temp)


def build(manifest_path, output, cache, offline=False, progress=None, network_budget=None):
    manifest_path = Path(manifest_path).resolve()
    manifest = read_json(manifest_path)
    registry_path = manifest_path.parent / manifest['registry']
    registry = read_json(registry_path)
    redirects = {}
    for old_key in registry.get('redirects', {}):
        key, seen = old_key, set()
        while key in registry['redirects']:
            if key in seen: raise ValueError('cyclic identity redirect')
            seen.add(key)
            key = registry['redirects'][key]
        if key not in registry.get('aliases', {}).values():
            raise ValueError('identity redirect has no registered target')
        if old_key in registry.get('aliases', {}).values():
            raise ValueError('retired identity still has active aliases')
        redirects[ingredient_id(old_key)] = ingredient_id(key)
    deadline = time.monotonic() + network_budget if network_budget is not None else None
    records, sources, rejected = load_sources(manifest, cache, offline, manifest_path.parent, progress, deadline)
    styles = []
    if manifest.get('styles'):
        from .styles import download_styles
        if progress: progress({'phase': 'styles', 'completed': len(sources), 'total': len(sources) + 1})
        styles, style_status = download_styles(read_json(manifest_path.parent / manifest['styles']), cache, offline, manifest_path.parent, deadline)
        sources.append(style_status)
    if not records: raise ValueError('no usable sources; existing output has not been replaced')
    if progress: progress({'phase': 'merge', 'completed': len(sources), 'total': len(sources)})
    catalog, provenance, conflicts, identity_map, skipped, unregistered = merge(records, registry)
    report = {'manifest_sha256': digest(manifest_path.read_bytes()), 'registry_sha256': digest(registry_path.read_bytes()), 'sources': sources, 'counts': {t: len(rows) for t, rows in catalog.items()}, 'input_records': len(records), 'merged_records': len(records) - len(skipped) - sum(map(len, catalog.values())), 'rejected': rejected, 'excluded': skipped, 'unregistered_fingerprints': unregistered, 'conflict_count': len(conflicts), 'partial': any(s['status'] != 'loaded' for s in sources), 'scope': 'ingredient catalogue only; not an application backup', 'redistribution': 'Source permissions are not established by this build.'}
    write_outputs(output, catalog, provenance, conflicts, report, identity_map)
    atomic_write(Path(output) / 'styles.json', dumps(styles).encode())
    atomic_write(Path(output) / 'retired-id-map.json', dumps(redirects).encode())
    return report
