#!/usr/bin/env python3
"""Screen a generated catalogue for data quality issues without changing it."""
import argparse
import json
from ingredients.quality import review


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='Existing generated catalogue directory')
    parser.add_argument('--decisions', help='Reviewed decisions for exact finding snapshots')
    args = parser.parse_args()
    report = review(args.output, args.decisions)
    print(json.dumps({'all_findings': report['summary'], 'actionable': report['actionable_summary']}, indent=2))
