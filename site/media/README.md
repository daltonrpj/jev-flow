# Public media slots

`studio-screenshot.png` is a real capture of the standalone Studio using a synthetic support flow and its deterministic fixture preview. It contains no user data or provider credentials. The SVG diagrams in `site/assets/` are project-created illustrations and are labeled as such.

The following files are expected only after the standalone application and media have been verified:

- `site/media/jev-flow-walkthrough.webm` — final English narrated walkthrough.
- `site/media/jev-flow-walkthrough.vtt` — synchronized English captions.
- `site/media/jev-flow-walkthrough-transcript.md` — complete narration transcript with voice/model attribution.

The landing page checks that the video, captions, and transcript exist before displaying its player. Do not substitute a diagram or a synthetic clip while claiming it is a real application capture. The generator may accept an API key from the process environment, but no key or `.env` belongs here.
