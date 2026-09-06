---
name: shot-list
description: "Create a production-ready shot list from approved script and visual anchors"
---
# Shot List

Use this Skill when the user asks to turn an approved script, creative direction,
or visual anchors into shots for image or video production.

## Required Context

1. Read the relevant approved `script` and `asset_anchors` artifacts before
   proposing a shot list. Do not use stale or rejected artifacts as a source.
2. Read the current canvas context when the user refers to existing nodes,
   images, or videos.
3. Ask one focused clarification only when a missing decision materially changes
   the result, such as target duration, format, or the intended audience.

## Shot Construction

- Number shots in story order. Keep every shot independently understandable.
- For each shot, state its narrative purpose, subject/action, setting,
  composition or camera framing, movement when relevant, and continuity notes.
- Preserve approved character, product, prop, palette, and style anchors. Mark
  deliberate changes explicitly instead of silently changing an anchor.
- Use enough shots to make the requested beat clear, but do not add coverage
  merely to make the list longer.
- Keep the result suitable for later prompt compilation: use concrete visual
  language and avoid provider/model parameters that have not been resolved by
  the capability tools.

## Execution Boundary

This Skill is read-only planning guidance. Record a shot list through the
existing Artifact and confirmation workflow; do not create canvas nodes, submit
tasks, call providers, or claim that media has been generated.
