# Subagent Guidance — APAH Connections Study Guide

You are processing a batch of AP Art History image-set works for an existing study guide. Each row of the xlsx has a link to a Google Drive "snapshot" document with notes on the work. Your job is to turn each snapshot into a consistent Markdown section.

---

## 1. Inputs

### Row-to-link lookup
`/Users/alext/Dropbox/Claude Accessed/APAH/_row_to_link.tsv`

Columns: `row` · `image_num` (e.g. `126.0`) · `title` · `drive_url`

- `drive_url` will be either `https://docs.google.com/document/d/<ID>/edit?...` or `https://drive.google.com/file/d/<ID>/view?...`.
- Extract `<ID>` (the segment between `/d/` and the next `/`) to fetch the file.
- Rows without a `drive_url` are section headers or blank — skip them.

### Snapshot document
Fetch with `mcp__claude_ai_Google_Drive__read_file_content`, passing `fileId` = the extracted ID.

The document follows a loose template filled out by students. **Treat the student name as a byline to discard.** Typical fields:

- Title · Artist/Culture · Medium · Creation Date · Location · Size
- Vocabulary associated with work
- Historical Context
- Function
- Subject Matter · Content · Form
- **Possible Connections with other works in image set** (a small table: `Image #` · `Themes` · `Connections`)
- Learning Objectives this artwork is a good example of
- Interpretation · Organization (Elements / Principles)
- **Connecting with the Learning Objectives** (often LO 3.5) — a **compare-and-contrast** prompt with an outside work, followed by a written response
- Citations

Formats vary: some fields may be missing, merged, or out of order. Be tolerant.

### Existing entry for reference
`/Users/alext/Dropbox/Claude Accessed/APAH/Connections Study Guide.md` — the entry for #126 Les Demoiselles d'Avignon is the canonical example. Match its tone, length, and structure.

---

## 2. Template

Write **one file per work** to:
`/Users/alext/Dropbox/Claude Accessed/APAH/_sections/<NNN>_<slug>.md`

- `<NNN>` = zero-padded 3-digit image number (e.g. `126`).
- `<slug>` = lowercase, alphanumeric + hyphens, first ~4 meaningful title words (e.g. `les-demoiselles-davignon`).

Start each file with YAML frontmatter so the assembler can sort and classify:

```markdown
---
image_num: 126
title: Les Demoiselles d'Avignon
has_connections: true
---
```

`has_connections` = `true` if **either** the "Possible Connections with other works in image set" section has ≥1 entry **or** the compare-and-contrast exercise has a written response. Otherwise `false`.

Then the section body, in this exact shape:

```markdown
## #<IMAGE_NUM> — <Title>

**<Artist / Culture>** · <Date> · <Medium> · <Location> · <Size (if given)>

<img src="<main-image-url>" width="240" alt="<Title>">

### Summary

<One-sentence thesis: what this work is famous for / why it matters.>

- **Historical Context.** <2–4 sentences. Who made it, when, where, under what circumstances, what influenced it. Names and places are high-value.>
- **Function.** <1–3 sentences. What it was made *for* — ritual, display, propaganda, patron, political statement, etc.>
- **Content.** <1–3 sentences. What it depicts. Describe only the most distinctive subject details; skip exhaustive pose-by-pose blocking.>
- **Form.** <1–3 sentences. Materials, palette, style, composition, notable formal innovations.>

**Vocabulary:** <· separated list from the snapshot's "Vocabulary" section, if present. Omit the line if empty.>
**Learning Objectives:** <comma-separated list, e.g. LO 1.3, 2.3, 3.2. Omit if none listed.>

---

### Connections to other works in the image set

<!-- One subsection per connected work. Omit this whole block if no image-set connections. Include a thumbnail for each connected work. -->

#### → #<OTHER_NUM> — <Other Title> (<Other Artist>, <Other Date>)

<img src="<other-image-url>" width="180" alt="<Other Title>">

**Theme:** <exact "Themes" cell from the snapshot table>

> <exact "Connections" cell text from the snapshot table — verbatim, in a blockquote>

---

### Compare-and-contrast exercise (LO 3.5)

<!-- Omit this whole block if the snapshot has no compare-and-contrast. This is COMMON — many content areas have no LO 3.5 comparison. Absence is not a parse error. -->

#### <Outside Work Title> (<Artist>, <Date>) — *not in image set*

<img src="<outside-work-image-url>" width="180" alt="<Outside Work Title>">

**Prompt:** <the exercise prompt verbatim>

> <the student's written response verbatim, as a single blockquote>
```

After the final body block for a work, end the file. Do **not** add a trailing separator — the assembler handles joins.

---

## 3. Writing the Summary (important)

The snapshot docs are long and inconsistent. Your job is to **compress**, not quote. Target ~120–180 words for the summary block total.

- Lead with a single-sentence thesis ("Widely cited as the starting point of Cubism.", "The earliest known figurative sculpture in Mesoamerica.", etc.).
- Pull only concrete, exam-worthy facts into the four bullets. Drop filler like "the artist was born and then later moved…".
- Preserve **names, places, dates, patrons, techniques, and materials**. These are what students get tested on.
- Do **not** preserve the student's personal opinions, "I believe…" statements, or padding.
- If a bullet would be empty, still include it — write "Unknown" or one specific sentence rather than dropping the bullet. Keep the four bullets uniform across entries.

---

## 4. Extracting Connections verbatim

The "Possible Connections with other works in image set" section is typically a 3-column table rendered as ragged text:

```
Image # Themes Connections
91 Las Meninas A group of figures depicted Both works consist of…
115 Olympia Female figure(s) with gaze at viewer In both works…
```

For each row:
- `#<OTHER_NUM>` = the leading number
- `<Other Title>` = comes from the image-set list (look it up in `_row_to_link.tsv` by `image_num`). The snapshot's own text may only be the title fragment.
- **Theme:** = the "Themes" cell (may be one or several words).
- Blockquote = the "Connections" cell, **verbatim**. Preserve italics, punctuation, and the student's exact phrasing. Fix only obvious OCR artifacts like soft-wrapped line breaks in the middle of a word.

Look up the other work's **artist + date** from `_row_to_link.tsv`'s title field (which usually reads `Title. Artist. Date. Medium.`) and render it as `(Artist, Date)`.

---

## 5. Compare-and-contrast

The "Connecting with the Learning Objectives" section often (but not always) contains a compare-and-contrast exercise with an outside work, followed by a multi-paragraph written response.

- Extract the outside work's title, artist, and date.
- Quote the **prompt** verbatim (usually starts "Using specific formal and contextual evidence…" or similar).
- Quote the student's **response** verbatim as a single blockquote. If it has multiple paragraphs, preserve them (use blank lines inside the blockquote — start each paragraph with `> `).
- Skip meta-commentary about which image is on which side; the reader has the images.

If the LO section is present but has no outside-work compare-and-contrast (just bullet points about the LO), omit this block.

---

## 6. Finding images (be conservative)

**Do not guess URLs.** Use one of these to confirm an image URL exists, then use the confirmed URL:

1. `WebFetch` the Wikipedia page for the work; ask for the main infobox `upload.wikimedia.org` URL.
2. If no Wikipedia page, `WebSearch` with `allowed_domains: ["commons.wikimedia.org", "en.wikipedia.org", "<museum>.org"]` to find a file page, then `WebFetch` that file page for the direct URL.
3. If still nothing reliable, **omit the `<img>` tag** for that work. A missing image is better than a broken one.

**Which images to fetch (policy):**
- **Main image** of the work being profiled: always try. Size `width="240"`.
- **Compare-and-contrast outside-work image**: always try. Size `width="180"`.
- **Connected-work images** (works inside the connections table): always try. Size `width="180"`. Yes, these are duplicated across entries — that's intentional; a reader studying one entry should not have to jump to another to see what's being compared.

Fire these in parallel `WebFetch` batches. A single work with 3 connections + 1 compare-contrast can issue 5 image lookups concurrently.

Prefer `.jpg` thumbnails. Wikimedia thumbnails have the form `https://upload.wikimedia.org/wikipedia/commons/thumb/<a>/<ab>/<file.jpg>/<N>px-<file.jpg>`. It is safe to use a non-thumb (full-size) URL too — the `width` attribute controls display size.

Batch your image lookups: fire multiple `WebFetch` calls in parallel when working through a batch of works.

---

## 7. Classification

Place the **section file** the same way regardless of connection status — always in `_sections/<NNN>_<slug>.md`. Only the frontmatter `has_connections` field drives ordering in the final assembled document.

- `has_connections: true` → at least one image-set connection row **or** a compare-and-contrast response.
- `has_connections: false` → only the summary block will be emitted. Still produce the file; the assembler will place it in the trailing section.

For `has_connections: false` entries, the body should contain **only** the summary block (through the Learning Objectives line). Do **not** include empty "Connections" or "Compare-and-contrast" headings.

---

## 8. Batch protocol

You'll be told which row range to process (e.g. "rows 2–50"). For each row:

1. Look up `drive_url` in `_row_to_link.tsv`. Skip if blank.
2. Extract file ID; call `mcp__claude_ai_Google_Drive__read_file_content`.
3. Parse the snapshot to fill the template.
4. Find image URL(s) via WebFetch/WebSearch — batch these calls in parallel.
5. Write `_sections/<NNN>_<slug>.md`.

Work sequentially through rows, but parallelize within a row where possible (e.g. multiple image lookups at once). If a single work is malformed (missing fields, unparseable), write the file with best-effort content and a note in frontmatter `parse_notes: <short reason>`; continue — do not block the batch.

Report back with a short summary: how many rows processed, how many with connections, how many `parse_notes`, and any systemic issues you hit.

---

## 9. Handling malformed / ambiguous snapshots

Student snapshots vary in quality. Common cases and the policy for each:

- **Wrong image number in connection table** (e.g. snapshot says "#27.6 Power Figure" but Power Figure is actually #172). Use the **corrected** number in the heading, keep the student's text **verbatim** in the blockquote, and add a one-line `parse_notes` string to the frontmatter describing the correction. Look up the correct number by title in `_row_to_link.tsv`.

- **Connection to a work not in the image set** (student listed an outside work inside the connections table). Render the subheading **without** an image number: `#### → <Title> (<Artist>, <Date>) — *not in image set*`. Keep Theme + blockquote as usual.

- **Title mismatch** between snapshot, TSV, and College Board canonical. **Use the TSV title** (`_row_to_link.tsv` `title` column) for your headings and metadata line. Preserve the student's phrasing inside blockquotes even if it uses a different title.

- **Missing fields** (no Medium, no Size, no Vocabulary, etc.). Omit that piece from the metadata line rather than writing "Unknown". For Summary bullets, keep all four bullets but write one concise sentence per bullet even if the source is thin.

- **No compare-and-contrast / LO 3.5 exercise.** **This is common**, especially for early content areas (Prehistory, Ancient Near East, etc.). Just omit the block. Absence is not a parse error; do **not** add a `parse_notes` for this.

- **`parse_notes` format.** Single-line YAML string. Keep under ~200 chars. Example: `parse_notes: connection #27.6 corrected to #172 Power Figure based on title match`.

---

## 10. Style conventions (match existing #126 entry)

- Em dashes between title fields in the H2 (`## #126 — Les Demoiselles d'Avignon`).
- Middle-dot separators (`·`) in the metadata line.
- Blockquote connections (`> …`) exactly as written by the student.
- `→` arrow prefix on connection subheadings.
- Italicize work titles within prose (`*Las Meninas*`), but not in headings.
- ASCII-safe curly apostrophes are fine (`d'Avignon`). Do not add emoji.
- No comments, no commentary about the template — just the content.
