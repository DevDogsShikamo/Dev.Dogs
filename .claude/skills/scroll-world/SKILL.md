# Scroll-World Skill

## Overview

The scroll-world skill creates immersive landing pages where camera movement is driven by visitor scrolling. As users scroll, a pre-rendered camera continuously flies through interconnected 3D scenes with no visible cuts—one unbroken flight path.

## Core Deliverables

The skill produces:
- N scene stills (one per section)
- N "dive-in" camera clips (camera enters each scene)
- N-1 "connector" clips (seamless transitions between scenes)
- A portable JavaScript scrub engine for video playback controlled by scroll position

## Critical Success Factor: Seamless Seams

"The one rule that makes or breaks it: seams must be *frame-identical*" to avoid visible "pop" between scenes. This is achieved by using actual rendered frame endpoints rather than the original diorama stills.

## Step-by-Step Process

### Step 0: Bootstrap
Verify CLI tools: Monid, Higgsfield, ffmpeg/ffprobe, image tools (PIL/cwebp/sips), and optionally Codex. Confirm authentication and sufficient credits before proceeding.

### Step 1: User Interview
Gather the subject, brand identity, art direction, camera style, journey sections, and mobile version preference. Present render cost estimates before generation.

### Step 2: Generate Scene Stills
Create one 3:2 image per section using `gpt_image_2` (or Codex's `image_gen`). All stills share an identical style preamble for cohesion. Run generations concurrently and review for consistency before advancing.

### Step 3: Optional Background Knockout
Remove flat backgrounds to create floating diorama scenes using the provided knockout script, preserving interior colors.

### Step 4: Camera Architecture
Choose between two architectures:
- **Architecture A (Continuous forward)**: One camera gliding forward through all scenes sequentially, no reversals at seams
- **Architecture B (Dive-in + aerial)**: Camera dives into each scene, pulls back out, and flies to the next (reversal at seams—only for miniature worlds)

Select a video model capable of frame-locking (`seedance_2_0`, `kling3_0`, or `seedance_2_0_mini`). Monid is the default billing backend for the chain.

### Step 5: Generate Connectors (Architecture B Only)
Extract boundary frames from rendered dives and use them as start/end-images for connector clips. This ensures frame-identical seams on both sides.

### Step 6: Encode for Smooth Scrubbing
Encode all clips at native resolution (1080p) with `-g 8` GOP for efficient blob-based seeking. Include mobile encodes (720p, `-g 4`) if the user opted for the native 9:16 portrait chain. Use `crf 20`, `unsharp` filter, and faststart flag.

### Step 7: Assemble the Page
Use the provided `scrub-engine.js` (self-contained vanilla JavaScript) to build the interactive page. Configure sections, clips, connectors, pacing, and branding. The engine handles scroll-to-currentTime mapping, lazy loading, crossfades, and mobile hardening.

### Step 8: QA the Seams
Verify frame continuity at all seams by screenshotting scroll positions before and after transitions. On mobile, test scrolling performance, iOS priming, safe-area alignment, and confirm native portrait clips are being served.

## Camera Grammar

Within a single clip, the camera is free to move expressively (orbits, crane-ups, tracking). The constraint applies only across seams: the camera must never reverse direction at a seam to avoid a rewind stutter. Every clip ends with a steady forward drift toward the next scene; the following clip begins continuing that drift.

## Video Model Selection

The skill supports three core models on the roster:
- `seedance_2_0` (1080p, default)
- `kling3_0` (720p native, no `--resolution` param)
- `seedance_2_0_mini` (720p draft tier)

All three support both `--start-image` and `--end-image`, enabling frame-locking. One model must be used for the entire chain to avoid render-character shifts.

## Billing & Backend

**Monid is the default video-chain biller** (per-clip USD pricing via Seedance 2.0). Higgsfield credits serve as the fallback when Monid balance is insufficient or for Higgsfield-only models. An N=6 desktop chain costs approximately $27 at 1080p.

Codex can bill scene stills to ChatGPT subscriptions (zero Higgsfield credits) if the CLI is available.

## Mobile Considerations

For users opting into mobile (Step 1.6), a parallel 9:16 portrait chain is rendered natively—not a crop of the landscape version. Portrait clips are encoded 720px wide with `-g 4`. The engine automatically serves mobile clips on phones and falls back to desktop versions when unavailable.

Mobile hardening includes: seek-coalescing, iOS video priming, safe-area insets, reduced-motion fallback, and prevention of layout shifts during URL-bar show/hide.

## Common Pitfalls

- **Seam pop**: Using diorama stills instead of actual rendered frame endpoints
- **Seam stutter**: Architecture B's inherent reversal (backward pull-out) in grounded contexts
- **Frozen video**: Host not serving byte-range requests; use blob URLs
- **NSFW false-positives**: Seedance filters innocent content; re-roll or switch to `kling3_0`
- **Portrait crops focal subject**: Using landscape encodes on mobile instead of native 9:16 renders
- **Concurrent generation races**: Transient 503 errors or credit race conditions; re-roll individual failures

## References Provided

- `references/prompts.md`: Style preambles, intake checklist, and all prompt templates
- `references/pipeline.md`: Copy-paste batch scripts for the full workflow
- `references/scrub-engine.js`: Portable scroll-driven video player (vanilla JS, framework-agnostic)
- `references/index-template.html`: Minimal standalone page template
- `references/knockout.py`: Background removal utility for floating scenes
