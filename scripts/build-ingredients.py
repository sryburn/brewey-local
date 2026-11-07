#!/usr/bin/env python3
"""Compile a source manifest into a standalone, deduplicated ingredient database."""
import argparse
import json
from ingredients.pipeline import build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', help='JSON manifest path')
    parser.add_argument('--output', required=True, help='Separate generated output directory')
    parser.add_argument('--cache', default='.runtime/ingredient-source-cache')
    parser.add_argument('--offline', action='store_true', help='Only use pinned local files or verified cache')
    parser.add_argument('--progress-json', action='store_true', help='Emit one JSON progress event per line')
    parser.add_argument('--network-budget', type=float, help='Maximum seconds spent starting network downloads')
    args = parser.parse_args()
    if args.network_budget is not None and args.network_budget <= 0: parser.error('network budget must be positive')
    progress = (lambda event: print(json.dumps(event), flush=True)) if args.progress_json else None
    try: report = build(args.manifest, args.output, args.cache, args.offline, progress, args.network_budget)
    except (OSError, ValueError, KeyError) as exc: parser.exit(1, f'Build failed: {exc}\n')
    if args.progress_json:
        print(json.dumps({'phase': 'complete', 'counts': report['counts'], 'partial': report['partial']}), flush=True)
        return
    print(json.dumps({k: report[k] for k in ('counts', 'input_records', 'merged_records', 'partial')}, indent=2))
    print(f"Rejected records: {len(report['rejected'])}; see build-report.json. Output: {args.output}")


if __name__ == '__main__': main()
