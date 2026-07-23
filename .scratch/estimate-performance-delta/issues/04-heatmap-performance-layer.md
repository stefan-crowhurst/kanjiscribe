# Heatmap performance layer

Status: ready-for-agent

## Parent

`.scratch/estimate-performance-delta/PRD.md`

## What to build

The year-at-a-glance performance layer on the dashboard heatmap: red/green cell outlines plus the day delta in the hover tooltip, driven by the gated `estimate_delta_ms` field from slice 3.

End-to-end behaviour:

- Heatmap cells whose day row carries a non-null `estimate_delta_ms` get a coloured outline: red when the day was over estimate (slower), green when under (faster). The outline is a CSS outline/border class alongside the existing `tone-*` fill classes — the fill encoding (pending/skipped/done levels) is untouched.
- Zero day delta: no outline (a neutral day must not read as pass/fail noise).
- Days without the gated value (legacy, mixed coverage, unfinished) get no outline.
- The heatmap tooltip's detail line gains the signed day delta (reusing the shared indicator's formatting) for gated days; ungated days' tooltips are unchanged.
- Click-through to the day page and all existing heatmap interactions (pinning, scrolling, month labels) are unchanged.

## Acceptance criteria

- [ ] Gated days show a red (over) or green (under) outline; zero-delta days show no outline.
- [ ] Ungated days (legacy, mixed coverage, pending/skipped remaining) show no outline and unchanged tooltips.
- [ ] Gated days' tooltip detail line shows the signed delta, agreeing with the day page header for the same date.
- [ ] Fill tones, tooltip existing content, click-through navigation, and pin behaviour are all unchanged.
- [ ] The outline composes visually with every existing `tone-*` class (verified on done-level fills at minimum).

## Blocked by

- `.scratch/estimate-performance-delta/issues/03-day-verdict-surfaces.md`

## Comments

## Answer
