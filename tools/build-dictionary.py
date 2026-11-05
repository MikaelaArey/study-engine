#!/usr/bin/env python3
"""Builds Study Engine's spelling dictionaries from SCOWL (http://wordlist.aspell.net/).

Usage:
    python3 -I tools/build-dictionary.py <path to scowl-2020.12.07/final> extension/data/

Writes extension/data/dict-en-US.txt, dict-en-GB.txt and LICENSE-SCOWL.txt.

Each dictionary is plain UTF-8 text: a line "~<size>" starts a tier, and every line after it
is one word from that SCOWL size until the next tier line. Smaller sizes are more common words
(10 is the most common), which is what the spell checker uses to rank its suggestions. Size 70
words are accepted as correct but suggested last.
"""
import pathlib
import sys

SIZES = [10, 20, 35, 40, 50, 55, 60, 70]
# Proper names and capitalised words beyond size 60 are mostly obscure names, which would hide
# real misspellings, so they stop at 60. Ordinary words go up to 70.
WORD_LISTS = {
    'en-US': ['english-words', 'american-words'],
    'en-GB': ['english-words', 'british-words', 'british_z-words'],
}
OTHER_LISTS = {
    'en-US': ['english-upper', 'american-upper', 'english-contractions', 'english-abbreviations',
              'american-abbreviations', 'english-proper-names', 'american-proper-names'],
    'en-GB': ['english-upper', 'british-upper', 'english-contractions', 'english-abbreviations',
              'british-abbreviations', 'english-proper-names', 'british-proper-names'],
}


def read_list(path):
    if not path.exists():
        return []
    # SCOWL's final lists are ISO-8859-1.
    return [w.strip() for w in path.read_text(encoding='latin-1').splitlines() if w.strip()]


def build(final, dialect):
    tier_of = {}
    for size in SIZES:
        names = WORD_LISTS[dialect] + (OTHER_LISTS[dialect] if size <= 60 else [])
        for name in names:
            for word in read_list(final / f'{name}.{size}'):
                tier_of.setdefault(word, size)
    by_tier = {}
    for word, size in tier_of.items():
        by_tier.setdefault(size, []).append(word)
    lines = []
    for size in SIZES:
        if size in by_tier:
            lines.append(f'~{size}')
            lines.extend(sorted(by_tier[size]))
    return '\n'.join(lines) + '\n', len(tier_of)


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    final = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for dialect in WORD_LISTS:
        text, count = build(final, dialect)
        target = out / f'dict-{dialect}.txt'
        target.write_text(text, encoding='utf-8')
        print(f'{target}: {count} words, {target.stat().st_size // 1024} KB')
    # Words only one dialect accepts ("colour", "color"), so a spelling from the other one can
    # be named as such instead of being called a typo.
    words = {d: set(l for l in (out / f'dict-{d}.txt').read_text(encoding='utf-8').split('\n') if l and l[0] != '~') for d in WORD_LISTS}
    for dialect, other in (('en-US', 'en-GB'), ('en-GB', 'en-US')):
        only = sorted(words[dialect] - words[other])
        target = out / f'variants-{dialect}.txt'
        target.write_text('\n'.join(only) + '\n', encoding='utf-8')
        print(f'{target}: {len(only)} words only {dialect} accepts')
    copyright_file = final.parent / 'Copyright'
    (out / 'LICENSE-SCOWL.txt').write_text(
        'Study Engine\'s spelling dictionaries (dict-en-US.txt, dict-en-GB.txt) are built from\n'
        'SCOWL (Spell Checker Oriented Word Lists) version 2020.12.07, http://wordlist.aspell.net/\n'
        'by tools/build-dictionary.py. SCOWL\'s copyright and permission notice follows.\n\n'
        + copyright_file.read_text(encoding='latin-1'),
        encoding='utf-8')
    print(f'{out / "LICENSE-SCOWL.txt"} written')


if __name__ == '__main__':
    main()
