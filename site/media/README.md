# Public media slots

`studio-screenshot.png` is a real capture of the standalone Studio using a synthetic support flow and its deterministic fixture preview. It contains no user data or provider credentials. The SVG diagrams in `site/assets/` are project-created illustrations and are labeled as such.

The narration draft is published as [`jev-flow-walkthrough-transcript.md`](./jev-flow-walkthrough-transcript.md). Its scene directions are not spoken; the finished voice track and captions must be checked against the actual recording.

The following files are expected only after the standalone application and media have been verified:

- `site/media/jev-flow-walkthrough.webm` — final English narrated walkthrough.
- `site/media/jev-flow-walkthrough.vtt` — synchronized English captions.
- `site/media/jev-flow-walkthrough-transcript.md` — narration script; add final Gemini TTS voice/model attribution after recording.

The landing page checks that the video, captions, and transcript exist before displaying its player. Do not substitute a diagram or a synthetic clip while claiming it is a real application capture. The generator may accept an API key from the process environment, but no key or `.env` belongs here.
