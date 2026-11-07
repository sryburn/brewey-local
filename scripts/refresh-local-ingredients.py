#!/usr/bin/env python3
"""Replace a stopped local installation's ingredients, discarding its recipes."""
import argparse
import json
from ingredients.refresh import refresh

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', required=True, help='Existing local application SQLite database; stop the app first')
    parser.add_argument('--catalog', required=True, help='Reviewed builder catalog.json, with all four ingredient tables')
    parser.add_argument('--backup', required=True, help='New private SQLite backup path; never overwritten')
    parser.add_argument('--discard-recipes', action='store_true', help='Explicitly authorize deletion of all local recipes')
    args = parser.parse_args()
    print(json.dumps(refresh(args.database, args.catalog, args.backup, discard_recipes=args.discard_recipes), indent=2))
