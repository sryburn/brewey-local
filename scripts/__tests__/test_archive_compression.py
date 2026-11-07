"""Container Python must read the same source archive as modern development Python."""
import base64
from pathlib import Path
import shutil
import sys
import tarfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ingredients.pipeline import archive_reader

# A synthetic tar containing only malt.bsmx = 'Synthetic malt', compressed by zstd.
SOURCE = base64.b64decode('KLUv/QRYrQIApANtYWx0LmJzbXgAMDAwMDY0NDAwMDAwMTYAADAwNzU3MgAgMAB1c3RhcgAwU3ludGhldGljIG1hbHQACQDuBfAFAWqJN6QbgOQAA2g1wLFymZsAEk2aweM=')
OPEN = tarfile.open

def without_native_zstd(*args, **kwargs):
    if kwargs.get('mode') == 'r:*': raise tarfile.ReadError('Synthetic older Python runtime')
    return OPEN(*args, **kwargs)

class ArchiveCompressionTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('zstd'), 'zstd executable not installed')
    def test_old_python_streams_zstd_without_extracting_paths(self):
        with patch('ingredients.pipeline.tarfile.open', side_effect=without_native_zstd):
            with archive_reader(SOURCE) as archive:
                entry = next(iter(archive))
                self.assertEqual(entry.name, 'malt.bsmx')
                self.assertEqual(archive.extractfile(entry).read(), b'Synthetic malt')

    def test_missing_zstd_reports_runtime_requirement(self):
        with patch('ingredients.pipeline.tarfile.open', side_effect=without_native_zstd), patch('ingredients.pipeline.subprocess.Popen', side_effect=FileNotFoundError):
            with self.assertRaisesRegex(ValueError, 'requires the zstd executable'):
                with archive_reader(SOURCE): pass

    def test_other_bad_archives_never_invoke_a_decoder(self):
        with patch('ingredients.pipeline.subprocess.Popen') as process:
            with self.assertRaises(tarfile.ReadError):
                with archive_reader(b'not an archive'): pass
            process.assert_not_called()
