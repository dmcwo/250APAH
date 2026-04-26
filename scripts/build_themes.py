#!/usr/bin/env python3
"""
Parse 250-info markdown files → js/themes_data.js

For each artwork, extracts connection theme tags and maps them to the
11 AP Art History controlled themes. Outputs a JS file ready to load
in the browser alongside data.js.
"""

import re
import json
import os
from pathlib import Path
from collections import defaultdict

# ── Controlled theme definitions ─────────────────────────────────────────────

THEMES = {
    'power_authority': {
        'label': 'Power & Authority',
        'definition': 'Examines how art expresses, legitimizes, or challenges political and social power—leaders, states, institutions, propaganda, patronage, and symbols of authority.',
    },
    'religion_ritual': {
        'label': 'Religion & Ritual',
        'definition': "Considers art's role in religious beliefs and practices, including sacred spaces, liturgy, icons, ritual objects, and visual systems that convey cosmology and devotion.",
    },
    'human_experience': {
        'label': 'Human Experience',
        'definition': 'Focuses on artworks that represent everyday life, emotions, social roles, labor, leisure, and universal aspects of being human across cultures and periods.',
    },
    'identity': {
        'label': 'Identity',
        'definition': 'Explores how art constructs and communicates personal, group, gender, ethnic, national, or class identities through iconography, portraiture, dress, and cultural markers.',
    },
    'architecture_space': {
        'label': 'Architecture & Space',
        'definition': 'Analyzes built environments and spatial design—how structures organize, define, and shape human activity, movement, ritual, and social relationships.',
    },
    'trade_exchange': {
        'label': 'Trade & Exchange',
        'definition': 'Looks at how movement of goods, ideas, and stylistic influences via trade, migration, and contact affects materials, techniques, and iconography.',
    },
    'death_afterlife': {
        'label': 'Death & the Afterlife',
        'definition': 'Studies visual expressions related to mortality, funerary practices, ancestor veneration, tomb architecture, and beliefs about the afterlife.',
    },
    'art_innovation_materials': {
        'label': 'Art, Innovation & Materials',
        'definition': 'Examines technological and material developments—new media, techniques, workshop practices, and innovations that change artistic production and meaning.',
    },
    'nature_body': {
        'label': 'Nature & the Body',
        'definition': 'Considers representations of the natural world and the human body, including symbolism, idealization, anatomy, landscape, and relationships between humans and nature.',
    },
    'conflict_resistance': {
        'label': 'Conflict & Resistance',
        'definition': 'Investigates artworks produced in contexts of war, conquest, protest, or oppression that reflect, document, resist, or commemorate conflict and social struggle.',
    },
    'narrative_storytelling': {
        'label': 'Narrative & Storytelling',
        'definition': 'Focuses on how art tells stories—myth, history, literary scenes, sequential imagery, and visual strategies used to convey events and meanings.',
    },
}

# ── Keyword → theme mapping ───────────────────────────────────────────────────
# Each entry: (regex_pattern, [theme_keys])
# Patterns are matched case-insensitively against the combined theme text for a work.
# A work is assigned to a theme if any of its patterns match.

RULES = [
    # Power & Authority
    (r'\bpower\b',                    ['power_authority']),
    (r'\bauthority\b',                ['power_authority']),
    (r'\bleadership\b',               ['power_authority']),
    (r'\bruler',                      ['power_authority']),
    (r'\bimperial\b',                 ['power_authority']),
    (r'\bpropaganda\b',               ['power_authority']),
    (r'\bpatronage\b',                ['power_authority']),
    (r'\bmilitary might\b',           ['power_authority']),
    (r'\bsovereignty\b',              ['power_authority']),
    (r'\broyalty\b',                  ['power_authority']),
    (r'\blaw\b',                      ['power_authority']),
    (r'\bempire\b',                   ['power_authority']),
    (r'\bgovernm',                    ['power_authority']),
    (r'\badministrativ',              ['power_authority']),
    (r'\blegitimiz',                  ['power_authority']),
    (r'\bnationalism\b',              ['power_authority', 'identity']),
    (r'\bpatriotis',                  ['power_authority']),
    (r'\bmonarch',                    ['power_authority']),
    (r'\bking\b',                     ['power_authority']),
    (r'\bqueen\b',                    ['power_authority']),
    (r'\bpharaoh\b',                  ['power_authority']),
    (r'\bcommemoration\b',            ['power_authority', 'narrative_storytelling']),
    (r'\bcommemorat',                 ['power_authority']),
    (r'\bvictory in battle\b',        ['power_authority', 'conflict_resistance']),
    (r'\bconquest\b',                 ['power_authority', 'conflict_resistance']),
    (r'\btribute\b',                  ['power_authority', 'trade_exchange']),
    (r'\bdomina',                     ['power_authority']),
    (r'\bthrone\b',                   ['power_authority']),
    (r'\bpatrician\b',                ['power_authority']),
    (r'\baztec history\b',            ['power_authority']),
    (r'\bwar.{0,10}battle\b',         ['power_authority', 'conflict_resistance']),
    (r'\bwar and battle\b',           ['power_authority', 'conflict_resistance']),
    (r'\bceremoni.{0,15}center\b',    ['power_authority', 'architecture_space']),
    (r'\bceremoni.{0,15}capital\b',   ['power_authority', 'architecture_space']),

    # Religion & Ritual
    (r'\breligio',                    ['religion_ritual']),
    (r'\britua',                      ['religion_ritual']),
    (r'\bsacred\b',                   ['religion_ritual']),
    (r'\bdevoti',                     ['religion_ritual']),
    (r'\bworship\b',                  ['religion_ritual']),
    (r'\bchurch\b',                   ['religion_ritual', 'architecture_space']),
    (r'\bchristian',                  ['religion_ritual']),
    (r'\bbuddhis',                    ['religion_ritual']),
    (r'\bceremonial\b',               ['religion_ritual']),
    (r'\bprayer\b',                   ['religion_ritual']),
    (r'\bliturgy\b',                  ['religion_ritual']),
    (r'\bcosmolog',                   ['religion_ritual']),
    (r'\bcosmology\b',                ['religion_ritual']),
    (r'\bspiritual\b',                ['religion_ritual']),
    (r'\bdivine\b',                   ['religion_ritual']),
    (r'\bdeity\b',                    ['religion_ritual']),
    (r'\bgods?\b',                    ['religion_ritual']),
    (r'\btemple\b',                   ['religion_ritual', 'architecture_space']),
    (r'\bmosque\b',                   ['religion_ritual', 'architecture_space']),
    (r'\bcathedral\b',                ['religion_ritual', 'architecture_space']),
    (r'\bicon\b',                     ['religion_ritual']),
    (r'\bpilgrimag',                  ['religion_ritual']),
    (r'\bcircumambulat',              ['religion_ritual', 'architecture_space']),
    (r'\bshaman',                     ['religion_ritual']),
    (r'\bmytholog',                   ['religion_ritual', 'narrative_storytelling']),
    (r'\bcosmos\b',                   ['religion_ritual']),
    (r'\babraham',                    ['religion_ritual', 'narrative_storytelling']),
    (r'\bcoming of age\b',            ['religion_ritual']),
    (r'\bislamIc\b',                  ['religion_ritual']),
    (r'\bhindu\b',                    ['religion_ritual']),
    (r'\bhinduis',                    ['religion_ritual']),
    (r'\bburial.{0,15}religio',       ['religion_ritual', 'death_afterlife']),
    (r'\breligious.{0,15}site',       ['religion_ritual', 'architecture_space']),
    (r'\ballegory.{0,10}faith\b',     ['religion_ritual']),
    (r'\bshrine\b',                   ['religion_ritual', 'architecture_space']),
    (r'\bsanctuar',                   ['religion_ritual', 'architecture_space']),

    # Human Experience
    (r'\bdaily life\b',               ['human_experience']),
    (r'\beveryday\b',                 ['human_experience']),
    (r'\bemotio',                     ['human_experience']),
    (r'\bhardship\b',                 ['human_experience', 'conflict_resistance']),
    (r'\bgrief\b',                    ['human_experience']),
    (r'\blamentation\b',              ['human_experience']),
    (r'\banguish\b',                  ['human_experience']),
    (r'\bsorrow\b',                   ['human_experience']),
    (r'\bsocial commentary\b',        ['human_experience', 'conflict_resistance']),
    (r'\bsocietal criticism\b',       ['human_experience', 'conflict_resistance']),
    (r'\bself.portrait\b',            ['human_experience', 'identity']),
    (r'\bself.reflect',               ['human_experience', 'identity']),
    (r'\ballegory.{0,15}human nature',['human_experience']),
    (r'\bbaro.{0,10}daily\b',         ['human_experience']),
    (r'\blocal life\b',               ['human_experience']),
    (r'\bworking class\b',            ['human_experience']),
    (r'\blabor\b',                    ['human_experience']),
    (r'\bpoverty\b',                  ['human_experience']),
    (r'\bfamil',                      ['human_experience']),

    # Identity
    (r'\bidentity\b',                 ['identity']),
    (r'\bportrait',                   ['identity']),
    (r'\bcultural identity\b',        ['identity']),
    (r'\bcultural tradition',         ['identity']),
    (r'\bgender\b',                   ['identity']),
    (r'\bethnic',                     ['identity']),
    (r'\bafrican art\b',              ['identity']),
    (r'\bafrican american\b',         ['identity']),
    (r'\bfeminist\b',                 ['identity', 'conflict_resistance']),
    (r'\bclass\b',                    ['identity']),
    (r'\bnude women\b',               ['identity', 'nature_body']),
    (r'\bcultural syncretism\b',      ['identity', 'trade_exchange']),
    (r'\babstract portrait\b',        ['identity']),
    (r'\bdress\b',                    ['identity']),
    (r'\bfeatherwork\b',              ['identity', 'trade_exchange']),
    (r'\bstatus\b',                   ['identity', 'power_authority']),
    (r'\bsocial class\b',             ['identity']),
    (r'\bnational',                   ['identity', 'power_authority']),

    # Architecture & Space
    (r'\barchitecture\b',             ['architecture_space']),
    (r'\barchitectural\b',            ['architecture_space']),
    (r'\bcity plan',                  ['architecture_space']),
    (r'\bfortress\b',                 ['architecture_space', 'conflict_resistance']),
    (r'\bmonumental\b',               ['architecture_space']),
    (r'\bspatial\b',                  ['architecture_space']),
    (r'\bislamic architecture\b',     ['architecture_space', 'religion_ritual']),
    (r'\breligious architecture\b',   ['architecture_space', 'religion_ritual']),
    (r'\blarge.scale architecture\b', ['architecture_space']),
    (r'\badvanced architecture\b',    ['architecture_space']),
    (r'\bbuilding built on\b',        ['architecture_space']),
    (r'\bcontinuous rebuilding\b',    ['architecture_space']),
    (r'\bimperial capital',           ['architecture_space', 'power_authority']),
    (r'\bfortif',                     ['architecture_space', 'conflict_resistance']),
    (r'\bziggurat\b',                 ['architecture_space', 'religion_ritual']),
    (r'\bamphitheatre\b',             ['architecture_space']),
    (r'\bamphitheater\b',             ['architecture_space']),
    (r'\bcolosseum\b',                ['architecture_space']),
    (r'\bpantheon\b',                 ['architecture_space', 'religion_ritual']),
    (r'\bforum\b',                    ['architecture_space', 'power_authority']),

    # Trade & Exchange
    (r'\btrade\b',                    ['trade_exchange']),
    (r'\bexchange\b',                 ['trade_exchange']),
    (r'\bcontact with european',      ['trade_exchange']),
    (r'\bcross.cultural\b',           ['trade_exchange']),
    (r'\bcombination of.{0,20}cultures', ['trade_exchange']),
    (r'\bindonesian motifs\b',        ['trade_exchange']),
    (r'\bmigrat',                     ['trade_exchange']),
    (r'\bsilk road\b',                ['trade_exchange']),
    (r'\bcolonial',                   ['trade_exchange', 'conflict_resistance']),
    (r'\bporcelain\b',                ['trade_exchange', 'art_innovation_materials']),
    (r'\bcalligraphy\b',              ['trade_exchange', 'art_innovation_materials']),
    (r'\bchanges to devotional.{0,20}contact\b', ['trade_exchange']),
    (r'\beuropean contact\b',         ['trade_exchange']),
    (r'\bsold in.{0,20}africa\b',     ['trade_exchange']),
    (r'\bfusion\b',                   ['trade_exchange']),
    (r'\binfluence.{0,20}culture\b',  ['trade_exchange']),

    # Death & Afterlife
    (r'\bfunerary\b',                 ['death_afterlife']),
    (r'\bafterlife\b',                ['death_afterlife']),
    (r'\bburial\b',                   ['death_afterlife']),
    (r'\btomb\b',                     ['death_afterlife']),
    (r'\bdead\b',                     ['death_afterlife']),
    (r'\bdeath\b',                    ['death_afterlife']),
    (r'\bsarcophag',                  ['death_afterlife']),
    (r'\bancestor\b',                 ['death_afterlife']),
    (r'\bmourning\b',                 ['death_afterlife', 'human_experience']),
    (r'\bgrave\b',                    ['death_afterlife']),
    (r'\bcatacomb\b',                 ['death_afterlife', 'religion_ritual']),
    (r'\bsacrifice\b',                ['death_afterlife', 'religion_ritual']),
    (r'\bassistance for the dead\b',  ['death_afterlife']),
    (r'\breaching the afterlife\b',   ['death_afterlife']),
    (r'\bmausoleum\b',                ['death_afterlife']),
    (r'\bcommemorat.{0,15}king\b',    ['death_afterlife', 'power_authority']),
    (r'\bmemorial\b',                 ['death_afterlife']),

    # Art, Innovation & Materials
    (r'\babstract',                   ['art_innovation_materials']),
    (r'\binnovat',                    ['art_innovation_materials']),
    (r'\bcollodion method\b',         ['art_innovation_materials']),
    (r'\bbarkcloth\b',                ['art_innovation_materials', 'identity']),
    (r'\bworkshop\b',                 ['art_innovation_materials']),
    (r'\bfresco\b',                   ['art_innovation_materials']),
    (r'\bexpressionism\b',            ['art_innovation_materials']),
    (r'\bdada\b',                     ['art_innovation_materials', 'conflict_resistance']),
    (r'\bsatire\b',                   ['art_innovation_materials', 'conflict_resistance']),
    (r'\bcommercializat',             ['art_innovation_materials', 'conflict_resistance']),
    (r'\bindustrializat',             ['art_innovation_materials']),
    (r'\bartistic ideal\b',           ['art_innovation_materials']),
    (r'\bperfection of technique\b',  ['art_innovation_materials']),
    (r'\btriptych\b',                 ['art_innovation_materials', 'religion_ritual']),
    (r'\billuminat',                  ['art_innovation_materials', 'religion_ritual']),
    (r'\buse of.{0,20}medium\b',      ['art_innovation_materials']),
    (r'\btechnique\b',                ['art_innovation_materials']),
    (r'\bmedium\b',                   ['art_innovation_materials']),
    (r'\bphotograph',                 ['art_innovation_materials']),
    (r'\bcubis',                      ['art_innovation_materials']),
    (r'\bimpression',                 ['art_innovation_materials']),
    (r'\bsurrealis',                  ['art_innovation_materials']),
    (r'\bpop art\b',                  ['art_innovation_materials']),
    (r'\binstallat',                  ['art_innovation_materials']),
    (r'\bperformanc',                 ['art_innovation_materials']),
    (r'\bcartoonis',                  ['art_innovation_materials']),
    (r'\bcartoon\b',                  ['art_innovation_materials']),
    (r'\bporcelain\b',                ['art_innovation_materials']),
    (r'\bcalligraphy\b',             ['art_innovation_materials']),
    (r'\bmodernist\b',               ['art_innovation_materials', 'architecture_space']),
    (r'\bmodernism\b',               ['art_innovation_materials', 'architecture_space']),
    (r'\bpostmodern',                ['art_innovation_materials', 'architecture_space']),
    (r'\bmetalwork\b',               ['art_innovation_materials']),
    (r'\btechnology\b',              ['art_innovation_materials']),
    (r'\bfuturism\b',                ['art_innovation_materials']),
    (r'\bearthwork\b',               ['art_innovation_materials', 'nature_body']),
    (r'\bland art\b',                ['art_innovation_materials', 'nature_body']),
    (r'\bvideo\b',                   ['art_innovation_materials']),
    (r'\bopulence\b',                ['power_authority']),
    (r'\bstratification\b',          ['power_authority', 'identity']),
    (r'\belites?\b',                 ['power_authority']),
    (r'\bexclusive\b',               ['power_authority']),
    (r'\bmaritime\b',                ['trade_exchange', 'nature_body']),
    (r'\bnavigation\b',              ['trade_exchange']),
    (r'\bvoyaging\b',                ['trade_exchange']),
    (r'\bsettlement\b',              ['trade_exchange']),
    (r'\bindigenous craft\b',        ['identity']),
    (r'\bglobalism\b',               ['trade_exchange', 'identity']),

    # Nature & Body
    (r'\blandscape\b',                ['nature_body']),
    (r'\bnatural world\b',            ['nature_body']),
    (r'\bnature\b',                   ['nature_body']),
    (r'\banimal',                     ['nature_body']),
    (r'\bhuman.nature relationship\b',['nature_body']),
    (r'\bnude\b',                     ['nature_body', 'identity']),
    (r'\bbody\b',                     ['nature_body']),
    (r'\banatomy\b',                  ['nature_body']),
    (r'\bideali',                     ['nature_body']),
    (r'\bcontrapposto\b',             ['nature_body']),
    (r'\bathlet',                     ['nature_body']),
    (r'\bkouros\b',                   ['nature_body']),
    (r'\bhuman figure\b',             ['nature_body']),
    (r'\bfertility\b',                ['nature_body', 'religion_ritual']),
    (r'\bdepiction of animal',        ['nature_body']),
    (r'\banimalis',                   ['nature_body']),
    (r'\bfloral\b',                   ['nature_body']),
    (r'\btrees?\b',                   ['nature_body']),
    (r'\bsensual',                    ['nature_body']),
    (r'\bphysical form\b',            ['nature_body']),

    # Conflict & Resistance
    (r'\bwar\b',                      ['conflict_resistance']),
    (r'\bconflict\b',                 ['conflict_resistance']),
    (r'\banti.war\b',                 ['conflict_resistance']),
    (r'\bresistance\b',               ['conflict_resistance']),
    (r'\bprotest\b',                  ['conflict_resistance']),
    (r'\boppression\b',               ['conflict_resistance']),
    (r'\bstruggle\b',                 ['conflict_resistance']),
    (r'\bbattle\b',                   ['conflict_resistance']),
    (r'\bfreedom\b',                  ['conflict_resistance']),
    (r'\brevolution\b',               ['conflict_resistance']),
    (r'\bsocial struggle\b',          ['conflict_resistance']),
    (r'\bcritique\b',                 ['conflict_resistance']),
    (r'\bdisillusion',                ['conflict_resistance']),
    (r'\boccupation\b',               ['conflict_resistance']),
    (r'\bcolonis',                    ['conflict_resistance', 'trade_exchange']),
    (r'\bgenocide\b',                 ['conflict_resistance']),
    (r'\bslavery\b',                  ['conflict_resistance']),
    (r'\brebellion\b',                ['conflict_resistance']),
    (r'\bsubversion\b',               ['conflict_resistance']),

    # Narrative & Storytelling
    (r'\bnarrative\b',                ['narrative_storytelling']),
    (r'\bstory',                      ['narrative_storytelling']),
    (r'\bhistorical\b',               ['narrative_storytelling']),
    (r'\bhistoric\b',                 ['narrative_storytelling']),
    (r'\bsequential\b',               ['narrative_storytelling']),
    (r'\bsequence\b',                 ['narrative_storytelling']),
    (r'\brecording events\b',         ['narrative_storytelling']),
    (r'\bpaintings within paintings\b', ['narrative_storytelling']),
    (r'\blife stages\b',              ['narrative_storytelling']),
    (r'\bsymbolic figures\b',         ['narrative_storytelling']),
    (r'\ballegory\b',                 ['narrative_storytelling']),
    (r'\bbiblical\b',                 ['narrative_storytelling', 'religion_ritual']),
    (r'\bcontinuous narrative\b',     ['narrative_storytelling']),
    (r'\bepic\b',                     ['narrative_storytelling']),
    (r'\bmyth\b',                     ['narrative_storytelling', 'religion_ritual']),
    (r'\bliterary\b',                 ['narrative_storytelling']),
    (r'\bscene\b',                    ['narrative_storytelling']),
    (r'\bdepicts?\b',                 ['narrative_storytelling']),
    (r'\billustrat',                  ['narrative_storytelling']),
    (r'\bportrays?\b',                ['narrative_storytelling']),
]

# ── Manual overrides for works with no connection theme tags ─────────────────
# Keyed by image_num → list of theme keys to force-assign.
MANUAL = {
    73:  ['religion_ritual', 'narrative_storytelling', 'human_experience',
          'art_innovation_materials'],                 # Last Supper
    151: ['art_innovation_materials', 'nature_body'],  # Spiral Jetty
    152: ['architecture_space', 'art_innovation_materials'],  # House, New Castle County
    160: ['power_authority', 'religion_ritual', 'nature_body'],  # Maize Cobs
}

# ── Parser ────────────────────────────────────────────────────────────────────

def parse_md(path):
    """
    Returns dict with:
      image_num: int
      title: str
      summary: str (first sentence of Summary section)
      theme_texts: list[str]  (all **Theme:** tag values from connections)
    """
    text = path.read_text(encoding='utf-8')

    # frontmatter
    fm = re.search(r'^image_num:\s*(\d+)', text, re.MULTILINE)
    title_fm = re.search(r'^title:\s*(.+)', text, re.MULTILINE)
    if not fm:
        return None

    image_num = int(fm.group(1))
    title = title_fm.group(1).strip() if title_fm else ''

    # summary: first non-empty line after "### Summary"
    summary = ''
    sm = re.search(r'### Summary\s*\n+(.*?)(?:\n\n|\n-|\n\*)', text, re.DOTALL)
    if sm:
        summary = sm.group(1).strip()
        # take just the first sentence
        first = re.split(r'(?<=[.!?])\s+', summary)
        summary = first[0] if first else summary

    # all **Theme:** tags
    theme_texts = re.findall(r'\*\*Theme:\*\*\s*(.+)', text)

    return {
        'image_num': image_num,
        'title': title,
        'summary': summary,
        'theme_texts': theme_texts,
    }


def classify(theme_texts, summary):
    """
    Returns set of controlled theme keys that apply to this artwork.
    Scores based on keyword matches across combined theme text.
    """
    combined = ' '.join(theme_texts + [summary]).lower()
    matched = set()
    for pattern, themes in RULES:
        if re.search(pattern, combined, re.IGNORECASE):
            matched.update(themes)
    return matched


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    info_dir = Path(__file__).parent.parent / '250-info'
    out_path = Path(__file__).parent.parent / 'js' / 'themes_data.js'

    md_files = sorted(info_dir.glob('*.md'))
    print(f"Parsing {len(md_files)} markdown files…")

    # image_num → set of theme keys
    artwork_themes = {}   # {image_num: set(theme_keys)}
    artwork_titles = {}   # {image_num: title}

    unclassified = []

    for f in md_files:
        result = parse_md(f)
        if not result:
            print(f"  SKIP (no image_num): {f.name}")
            continue

        num = result['image_num']
        artwork_titles[num] = result['title']
        themes = classify(result['theme_texts'], result['summary'])
        if num in MANUAL:
            themes.update(MANUAL[num])
        artwork_themes[num] = themes

        if not themes:
            unclassified.append(num)

    print(f"\nUnclassified works ({len(unclassified)}): {unclassified}")

    # Build theme → sorted list of artwork IDs
    theme_artworks = defaultdict(list)
    for num, themes in artwork_themes.items():
        for t in themes:
            theme_artworks[t].append(num)

    for t in theme_artworks:
        theme_artworks[t].sort()

    # Print summary
    print("\nTheme counts:")
    for key in THEMES:
        ids = theme_artworks.get(key, [])
        print(f"  {key:35s} {len(ids):3d} works")

    # Build output object
    out = {}
    for key, meta in THEMES.items():
        out[key] = {
            'label': meta['label'],
            'definition': meta['definition'],
            'artworks': theme_artworks.get(key, []),
        }

    # Write JS file
    js_lines = [
        '// Auto-generated by scripts/build_themes.py — do not edit by hand.',
        '// Maps each AP Art History theme to the artwork IDs that belong to it.',
        '// Artwork details (title, artist, dates, image_url, etc.) live in ART_DATA (data.js).',
        '',
        'const THEMES_DATA = ' + json.dumps(out, indent=2) + ';',
        '',
    ]
    out_path.write_text('\n'.join(js_lines), encoding='utf-8')
    print(f"\nWrote {out_path}")


if __name__ == '__main__':
    main()
