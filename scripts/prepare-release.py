#!/usr/bin/env python3
"""Prepare Compose installation files using the actual published image digest."""
import argparse
from pathlib import Path
import re
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--image', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
if not re.fullmatch(r'ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}', args.image):
    parser.error('Use the immutable GHCR image reference returned by the image build.')
root = Path(__file__).resolve().parents[1]
args.output.mkdir(parents=True, exist_ok=True)
shutil.copyfile(root / 'compose.yaml', args.output / 'compose.yaml')
env = (root / '.env.example').read_text().replace('BREWEY_IMAGE=\n', f'BREWEY_IMAGE={args.image}\n')
# GitHub normalizes leading-dot asset names. Use a visible download filename.
(args.output / 'brewey.env.example').write_text(env)
(args.output / 'INSTALL.txt').write_text('Rename brewey.env.example to .env in this folder.\nRun docker compose pull, then docker compose up -d.\nOpen http://localhost:3100 and choose Start fresh or restore a backup.\nKeep backups outside this computer. Never use docker compose down --volumes to update.\n')
print('Prepared installation files in ' + str(args.output))
