#!/usr/bin/env python3
"""Assemble per-work sections into the final Connections Study Guide.

Reads `_sections/*.md`, parses YAML frontmatter, sorts with-connections first
(image_num ascending) then without-connections (image_num ascending), and writes
`Connections Study Guide.md`.
"""
import re, glob, os
from pathlib import Path

BASE = Path('/Users/alext/Dropbox/Claude Accessed/APAH')
SECTIONS = BASE / '_sections'
OUT = BASE / 'Connections Study Guide.md'

FRONTMATTER_RE = re.compile(r'^---\n(.*?)\n---\n(.*)$', re.DOTALL)

def parse_file(fp: Path):
    text = fp.read_text()
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None
    fm_raw, body = m.group(1), m.group(2)
    fm = {}
    for line in fm_raw.splitlines():
        if ':' in line:
            k, _, v = line.partition(':')
            fm[k.strip()] = v.strip()
    return fm, body.lstrip('\n')

entries = []
for fp in sorted(SECTIONS.glob('*.md')):
    parsed = parse_file(fp)
    if not parsed:
        print(f'WARN: could not parse frontmatter in {fp.name}')
        continue
    fm, body = parsed
    try:
        img = int(fm.get('image_num', '0'))
    except ValueError:
        img = 0
    has_conn = fm.get('has_connections', 'false').lower() == 'true'
    entries.append((has_conn, img, fm, body, fp.name))

# Sort: has_connections=True first, then image_num ascending
entries.sort(key=lambda e: (not e[0], e[1]))

with_conn = [e for e in entries if e[0]]
without_conn = [e for e in entries if not e[0]]

out = []
out.append("# APAH Connections Study Guide\n")
out.append(
    "A cross-reference of all 250 AP Art History image-set works and the connections "
    "between them. Each entry includes a concise summary (Historical Context / Function / "
    "Content / Form), the \"Possible Connections with other works in image set\" text from "
    "the student snapshot, and — when available — the outside work from the compare-and-"
    "contrast (LO 3.5) exercise.\n"
)
out.append(
    f"**Contents.** {len(with_conn)} works with connections, followed by "
    f"{len(without_conn)} works without connections.\n"
)
out.append("---\n")
out.append("## Works with connections\n")
for _, img, fm, body, _ in with_conn:
    out.append(body.rstrip() + "\n")
    out.append("---\n")
if without_conn:
    out.append("## Works without connections\n")
    out.append(
        "*These works have no Possible-Connections table or compare-and-contrast "
        "exercise in their snapshots — only summaries are provided.*\n"
    )
    out.append("---\n")
    for _, img, fm, body, _ in without_conn:
        out.append(body.rstrip() + "\n")
        out.append("---\n")

OUT.write_text('\n'.join(out))
print(f'Assembled {len(entries)} entries → {OUT}')
print(f'  With connections: {len(with_conn)}')
print(f'  Without connections: {len(without_conn)}')
