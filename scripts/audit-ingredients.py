#!/usr/bin/env python3
"""Audit an existing reference catalogue against a manifest build."""
import argparse
import json
from ingredients.audit import audit


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--output', required=True, help='Existing builder output directory')
    parser.add_argument('--decisions', help='Reviewed remappings JSON')
    args = parser.parse_args()
    report = audit(args.baseline, args.output, args.decisions)
    print(json.dumps(report['summary'], indent=2))
