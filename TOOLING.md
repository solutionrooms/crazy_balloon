# Tooling

## `/watch` — video reference capability (claude-video v0.1.3)

Installed for this project to support the **faithful-recreation** approach in
`prd.md`: we trace the original 8 mazes, balloon swing, blower behaviour, and
difficulty escalation directly from original Crazy Balloon arcade footage.

### Status — set up & verified (2026-05-31)
- Plugin: `watch@claude-video` v0.1.3 (installed via the plugin marketplace).
- Binaries: `ffmpeg`, `ffprobe` (Homebrew), `yt-dlp` 2026.03.17 (installed via
  `brew install yt-dlp`) — all on PATH.
- Config: `~/.config/watch/.env` scaffolded, perms `0600`.
- Preflight: `python3 <plugin>/scripts/setup.py --json` → ready for captioned
  videos and frames-only extraction.

### Whisper API key — optional, not needed here
The Whisper fallback only transcribes *speech* when a video has no captions.
Original arcade gameplay footage is essentially silent (no narration to
transcribe) and we care about **frames**, not audio — so no key is required.
To enable it anyway, add `GROQ_API_KEY` (preferred) or `OPENAI_API_KEY` to
`~/.config/watch/.env`.

### Usage for this project
```
# Trace a maze from a focused window of a gameplay video (denser frames):
/watch <gameplay-url> --start 1:10 --end 1:40 describe the maze layout and spike positions

# Read on-screen text (score/level) at higher resolution:
/watch <gameplay-url> --resolution 1024 what is the score and level shown?

# Frames-only on a silent clip (skip the Whisper step entirely):
/watch <local-or-url> --no-whisper map the wall/thorn geometry
```

Frame budget is duration-aware (denser for short/focused clips, capped at 2 fps
/ 100 frames). Best accuracy under ~10 min — use `--start`/`--end` to focus on a
single maze rather than scanning a whole longplay.
