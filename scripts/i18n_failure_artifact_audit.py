"""Scan known synthetic credentials without printing credential or OCR text."""

import argparse
import concurrent.futures
import difflib
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path


def audit_media(secrets, frames, screenshots):
    from PIL import Image, ImageDraw, ImageFont

    os.environ['OMP_THREAD_LIMIT'] = '1'

    def normalize(text):
        return re.sub('[^a-z0-9]', '', text.lower()).translate(str.maketrans({'o': '0', 'i': '1', 'l': '1'}))

    def check_image(path):
        texts = []
        for psm in ('11', '6'):
            result = subprocess.run(['tesseract', str(path), 'stdout', '-l', 'eng', '--psm', psm],
                                    check=True, capture_output=True, text=True)
            texts.append(normalize(result.stdout))
        text = ''.join(texts)
        found = []
        for name, value in secrets.items():
            raw = normalize(value)
            width = min(16, len(raw))
            detected = any(raw[offset:offset + width] in text for offset in range(len(raw) - width + 1))
            # Allow bounded OCR spelling errors for long, full credential values.
            if not detected and len(raw) >= 24:
                matcher = difflib.SequenceMatcher(None, raw, text, autojunk=False)
                for block in matcher.get_matching_blocks():
                    start = max(0, block.b - block.a)
                    for delta in range(-2, 3):
                        candidate = text[start:start + len(raw) + delta]
                        if difflib.SequenceMatcher(None, raw, candidate, autojunk=False).ratio() >= 0.90:
                            detected = True
                            break
                    if detected:
                        break
            if detected:
                found.append(name)
        return {'image': path.name, 'credential_labels': found}

    # Keep the deliberately exposed control inside a private temporary directory.
    # It must never enter the artifact directory or a human-facing screenshot.
    with tempfile.TemporaryDirectory(prefix='private-ocr-control-') as directory:
        control = Image.new('RGB', (1200, max(300, 45 * len(secrets) + 40)), 'white')
        draw = ImageDraw.Draw(control)
        fonts = [Path('/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf'),
                 Path('/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf')]
        font = ImageFont.truetype(str(next(path for path in fonts if path.exists())), 14)
        for line, value in enumerate(secrets.values()):
            draw.text((20, 20 + line * 45), value, fill='black', font=font)
        control_path = Path(directory) / 'control.png'
        control.save(control_path)
        labels = check_image(control_path)['credential_labels']
    if set(labels) != set(secrets):
        return {'negative_control': 'FAIL', 'detected_labels': labels, 'expected_labels': list(secrets)}
    if not frames or not screenshots:
        raise ValueError('Both decoded video frames and failure screenshots are required')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        matches = [item for item in executor.map(check_image, frames + screenshots) if item['credential_labels']]
    return {'negative_control': 'PASS', 'decoded_frames_checked': len(frames),
            'failure_screenshots_checked': len(screenshots), 'known_credential_matches': matches,
            'method': 'Tesseract eng psm11/psm6; normalized 16-character substrings; 90-percent full-value similarity for values at least 24 characters',
            'limit': 'OCR can miss text; this detector covers the known synthetic credentials, not every possible secret.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--secrets', type=Path, required=True)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--frames', type=Path)
    args = parser.parse_args()
    if args.secrets.resolve().is_relative_to(args.artifacts.resolve()):
        parser.error('The private credential file must remain outside artifact uploads')
    secrets = json.loads(args.secrets.read_text(encoding='utf-8'))
    if not secrets or not all(isinstance(value, str) and len(value) >= 8 for value in secrets.values()):
        parser.error('Expected nonempty known synthetic credentials of at least 8 characters')
    patterns = (
        re.compile(rb'(?i)(?:sessionid|csrftoken)\s*[=:]\s*["\x27]?[A-Za-z0-9_-]{16,}'),
        re.compile(rb'(?i)\b(?:Bearer|Token)\s+[A-Za-z0-9_.=-]{16,}'),
        re.compile(rb'(?i)\b(?:token|access|refresh)["\x27]?\s*[=:]\s*["\x27]?[A-Za-z0-9_.=-]{16,}'),
    )
    files, known_hits, pattern_hits = [], [], []
    for path in args.artifacts.rglob('*'):
        if not path.is_file() or path.suffix.lower() in ('.png', '.mp4', '.woff', '.woff2', '.ttf'):
            continue
        raw = path.read_bytes()
        clean = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', raw)
        relative = str(path.relative_to(args.artifacts))
        for name, value in secrets.items():
            if value.encode() in clean:
                known_hits.append({'file': relative, 'credential': name})
        if any(pattern.search(clean) for pattern in patterns):
            pattern_hits.append(relative)
        files.append({'file': relative, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    report = {'files': files, 'known_credential_matches': known_hits, 'generic_pattern_matching_files': pattern_hits}
    failed = bool(known_hits or pattern_hits)
    if args.frames:
        media = audit_media(secrets, sorted(args.frames.glob('frame-*.png')),
                            sorted((args.artifacts / 'screenshots').rglob('*.png')))
        report['media'] = media
        failed = failed or media['negative_control'] != 'PASS' or bool(media.get('known_credential_matches'))
    print(json.dumps(report))
    raise SystemExit(1 if failed else 0)


if __name__ == '__main__':
    main()
