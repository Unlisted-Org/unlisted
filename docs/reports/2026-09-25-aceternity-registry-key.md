# What the Aceternity registry key unlocks (fetch-level test)

Date: 2026-09-25. The key is `ACETERNITY_UI_API_KEY` in `.env.local`. That file is gitignored (`.env*`) and has never been committed on any branch; the key does not appear in this repo.

## Method

- Fetched `https://ui.aceternity.com/registry.json` with and without `Authorization: Bearer <key>`.
- Then fetched **every** item's full JSON (`https://ui.aceternity.com/registry/{name}.json`), once without the key and once with it.
- For each response, compared the HTTP status, the file count, the total source characters, and a hash of the body.

Comparing the index alone is the wrong test. The listing is identical either way, while the item fetches differ.

## Result

| Item type | Without key | With key | Count |
|---|---|---|---|
| Index (`registry.json`) | 200, 284 items | 200, 284 items, **byte-identical** | 1 |
| `registry:block` | **HTTP 401, no source** | 200, full source | **165** |
| `registry:block` | 200, full source | same, byte-identical | 7 |
| `registry:ui` (components) | 200, full source | same, byte-identical | 112 |

- **What the key gates:** 165 of the 172 blocks, and nothing else.
- **What it doesn't change:** no item's content changes with the key, and no item stays empty with it.
- **What it buys:** assembled sections, not components.
  - 20 heroes, 22 feature sections, 8 CTAs, 4 FAQs, 6 pricing blocks, 3 footers, 7 navbars, 3 sidebars, 4 stats blocks;
  - device frames (MacBook, iPad, iPhone);
  - background treatments.
- **Caveat:** none of the blocks inspected (`feature-section-with-terminal`, `animated-beam-path-illustration`, `grouped-sidebar`, `faqs-with-dashed-lines`, `stats-with-grid-background`) handles `prefers-reduced-motion`. Any block used gets a static equivalent added and verified, like every other animated section.

## Effect on the approved design

The approved design is unchanged except for one recommended swap. It is raised with the spec owner before anything is swapped in.

- **Landing §3, "Every basket breaks": recommend `feature-section-with-terminal`.** Its selectable feature list, where each item replays a terminal, holds the four transcripts: Symmetry pause, Symmetry seizure, Unlisted pause, Unlisted seizure. Same section and content, in a finished frame instead of two hand-placed `terminal` components.
- **App sidebar: keep the static Nodus sidebar.** `grouped-sidebar` is built around an animated expand-on-hover, and the app has no motion.
- **Everything else stays as approved:** Agenforce hero, incident cards, cost table and FAQ; Nodus how-it-works; the free registry components. Sections are built as self-contained components, so a block can replace one later without touching the others.
