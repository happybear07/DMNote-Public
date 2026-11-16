<!-- 2026-10-05 리서치 워크플로(GoodNotes · Notability · 웹 잉크 기법 조사) 결과. 펜 작업(후순위)의 구현 기준. -->

# DamianNote pen spec v1: types, thickness, color, highlighter, stabilization, latency, storage, toolbar

Priority labels: **[M]** must (phase 1, writing-feel correctness), **[S]** should (phase 2), **[C]** could (phase 3).

Units: every px value is a world px at zoom 1. The A4 page is 794 px wide for 210 mm (`sheet.ts`: `A4 = {w:794,h:1123}`), so **1 mm = 3.781 px**. Store widths in px and show mm in the UI.

Baseline is HEAD `df77ab2`, where the earlier WIP is now committed:
- `ink-render.ts` builds perfect-freehand outlines and caches them in `PEN_STYLE` by `s.id`.
- `ink-layer.ts` has the static/wet canvas split, and highlighters are composited first, so they sit below the pens.
- `ink-input.ts` collects coalesced and predicted events.
- `ink.ts` has `PenKind` and an optional `pen`.
- Not done yet: UI wiring, settings persistence, pressure normalization, stabilization, legacy compatibility, and the palm/pinch fixes.

---

## 1. What each stroke stores (backward compatible, no schema bump) — [M]

`StrokeRecord` is an open record (`model.ts:134`). `parse` does not validate stroke fields (`serialize.ts:184`), and the Yjs bridge copies every field (`sync/src/bridge.ts:18-31`). Old clients ignore unknown fields.

| Field | Values | Rule |
|---|---|---|
| `sv` | `1` | Render-style version, **new**. Every new stroke writes it. The mapping from knobs to perfect-freehand options is frozen per `sv`, so later tuning ships as `sv: 2` and old notes keep their look. |
| `pen` | `'ball'\|'fountain'\|'brush'` | Pen strokes **always** write it, including `'ball'`. Today `addStroke` drops `'ball'`; change that. Highlighters omit it. |
| `input` | `'pen'\|'mouse'\|'touch'` | **New.** Replaces the `real = any \|p-0.5\|>1e-3` guess in `outlinePath`. |
| `ps` | 0..1 | Pressure sensitivity. Fountain and brush only; omitted when it equals the default 0.5. |
| `tip` | 0..1 | Tip sharpness. Fountain only; omitted when it equals the default 0.5. |
| `dash` | `'dash'\|'dot'` | [C] Line pattern; omitted means solid. |
| `width` | number | Unchanged meaning: the nominal diameter in world px at p = 0.5. |
| `points` | `[x,y,p,t]` | Unchanged encoding. x and y are already **stabilized** (§2.4). p is already **normalized** (pen) or **speed-derived** (mouse/touch). Stabilization and pressure mapping are baked into the points, so the saved stroke matches what was drawn, and hit-testing, lasso, doc view and old clients all agree. |

How to render each stroke:
- **No `sv` and no `pen`** (all pre-df77ab2 strokes): use the `LEGACY` preset (§3). It reproduces the old `width*(0.6+0.8p)` width range exactly, minus the beading at segment joins.
- **No `sv` but with `pen`** (strokes made since df77ab2 today): render with the current table, renamed `PEN_STYLE_V0`.
- Ball strokes from df77ab2 can't be told apart from older strokes, so they fall into `LEGACY`. Only today's dev data is affected, so this is accepted.

Cache key in `strokePath`: `id + points + width + pen + sv + input + ps + tip + dash`, as one style string.

---

## 2. Input pipeline in `ink-input.ts`, in this order

### 2.1 Sampling [M]
- Cache `root.getBoundingClientRect()` at pointerdown. Today it runs on every move (`ink-input.ts:52`, and `local()` in `pointer.ts`).
- **Safari dedupe:** keep `lastTs` and skip coalesced events with `ev.timeStamp <= lastTs`. Safari's `getCoalescedEvents()` repeats the previous batch, which makes strokes double back and look dotted. The current `<0.5px` filter can't catch these because the repeated points are far from the last point.
- Keep the `<0.5 screen px` jitter drop. Keep the fix that takes the second sample's pressure when the first is 0.
- Append the pointerup point if it differs from the last point. [S]

### 2.2 Pressure normalization, pen only [M]
1. **Platform gain.**
   - Apple WebKit, detected by `maxTouchPoints>1` plus a `/Macintosh|iPad/` user agent: `p' = min(1, 2p)`. WebKit sends `force/maximumPossibleForce` with max ≈ 4.17, so ordinary handwriting arrives at p ≈ 0.15–0.35. With fountain thinning 0.6 that renders at about 0.7× the chosen width.
   - Windows and other platforms: `p' = p^0.8`.
2. **Smoothing.** Time-based EMA, `α = 1 − exp(−dt/8ms)`, to remove quantization jitter.
3. **[S] Speed effect for real pens.** Fountain `p'·(1 − 0.15·min(1, v/1.5))`, brush `·(1 − 0.25·…)`, with v in CSS px/ms.
4. **[M, dev-only] Measurement overlay.** A `?inkdebug=1` overlay shows sample rate (Hz), coalesced events per frame, raw and normalized pressure p10/p50/p90 over the last ~2000 samples, and wet-frame time. The gain constants have to be confirmed on a real iPad and a Surface. The target is a normalized median of about 0.5.
5. **[C] Auto-calibration.** `gain = clamp(0.5/median, 0.8, 3.0)` from a running median of about 2000 pen samples, kept in localStorage.

### 2.3 Mouse and finger [M]
- perfect-freehand's `simulatePressure` measures distance per sample. With dense coalesced mouse input (125–1000 Hz) the distance is tiny, so every stroke goes to full width. Always pass `simulatePressure:false` for `sv:1`.
- Compute and **store** p yourself:
  - `v` = speed in CSS px/ms, EMA α = 0.25.
  - `p = 0.75 − 0.5·smoothstep(0.2, 3.0, v)`, giving 0.75 when slow and 0.25 when fast.
- Ball ignores p because its thinning is 0.

### 2.4 Stabilization ("손떨림 보정"), applied at input time [M]
- Use a One-Euro filter on x and y in **screen CSS px** (seconds, `ev.timeStamp`), then convert to world coordinates.
  - `fc = minCutoff + beta·|v|`, v in px/s.
  - Steady-state lag is at most `1/(2π·beta)` px.
  - `dCutoff = 1 Hz`. If stroke starts look rounded, raise it to 3–5 Hz.
- Slider S from 0 to 100%: `minCutoff = 8·0.1^S` Hz, `beta = 0.10 − 0.07·S`.

| S | minCutoff | beta | max lag |
|---|---|---|---|
| 0% | 8.0 Hz | 0.100 | 1.6 px |
| 10% | 6.35 | 0.093 | 1.7 |
| **20% (pen default)** | 5.05 | 0.086 | 1.85 |
| **30% (highlighter default)** | 4.0 | 0.079 | 2.0 |
| 50% | 2.53 | 0.065 | 2.45 |
| 75% | 1.42 | 0.0475 | 3.35 |
| 100% | 0.8 | 0.03 | 5.3 |

- The filter is always on, because even S = 0 removes the Windows Chrome whole-device-pixel staircase (0.57–0.67 CSS px at 150–175% scaling).
- After the filter, perfect-freehand `streamline` stays small and fixed per pen (§3). It is **not** tied to S, because streamline works per sample: the same value lags about 4× more at 60 Hz than at 240 Hz.
- [C] Lazy-brush "string" for S > 50%: radius `(S−0.5)·12` screen px.
- Typical GoodNotes user values: 5–10% for ball, about 20% for fountain, up to 50% for some.

### 2.5 Prediction (draw only, never stored) [S]
- Keep predicted points only when they are ≤ 16 ms ahead of the last real sample.
- Skip prediction when speed < 0.05 px/ms or when the direction reverses (dot product with the last velocity < 0).
- Run predicted points through a **cloned** filter state and give them the last real pressure.
- [C] Fallback for Safari < 18.2 (no `getPredictedEvents`): extrapolate linearly from the last two filtered samples, at most one frame ahead.

---

## 3. Pen types: perfect-freehand 1.2.3 options for `sv:1` [M]

Definitions:
- `size = width·(stroke-relative)`.
- `L` = centerline length.
- `s` = pressure sensitivity, default 0.5.
- `k` = tip sharpness, default 0.5.
- All types use `easing: linear` and `simulatePressure: false`.

| | Ball 볼펜 (default) | Fountain 만년필 | Brush 붓펜 | LEGACY (no sv, no pen) |
|---|---|---|---|---|
| thinning | **0** (GoodNotes ball has no pressure) | **0.3 + 0.6·s**: default 0.6, range 0.3–0.9, so "min" still keeps some variation | **0.65 + 0.3·s**: default 0.8, range 0.65–0.95 | 0.4 |
| smoothing | 0.6 | 0.62 | 0.65 | 0.5 |
| streamline | 0.15 | 0.2 | 0.25 | 0 |
| start | cap, taper 0 | cap, taper 0 | cap off, taper `min(3·size, 0.25·L)` | cap |
| end (committed, `last:true`) | cap, taper 0 | k = 0: cap, no taper. Otherwise taper `min(6·k·size, 0.25·L)`, which is 3·size at the default k | cap off, taper `min(5·size, 0.3·L)` | cap |
| end (wet, `last:false`) | cap | **cap, taper 0** (taper is applied at lift, so the tip under the nib stays full width) | cap, taper 0 | — |
| user knobs | color, width | s, k | s | — |

Rules:
- **Short strokes:** if `L < 2·size`, use caps on both ends and no taper, for every type. This keeps dots, ㅡ, ㅇ and i-dots from vanishing. The current fixed tapers of 8/14/22 px make thin short strokes slivers and thick strokes stubby.
- Diameter is `size·(1 − thinning + 2·thinning·p)`, so p = 0.5 gives exactly the labelled width.
- **[C] Calligraphy nib / "Tip flatness".** A flat-nib sweep: width factor `0.15 + 0.85·|sin(θ − α)|`, α default 35°, slider −90…90° (negative for left-handed writers). This gives thick downstrokes and avoids GoodNotes' "inverted fountain" complaint.
- **[C] Pencil** with a grain texture as a separate tool.

---

## 4. Thickness

**[M] Model**
- Replace `InkState.size` (an index 0–2) with 3 width slots **per pen kind** plus 3 for the highlighter, each in px.
- Selecting a slot sets `wet.width`.
- `Stroke.width` already accepts any number.

**[M] Defaults**

| Tool | Slot 1 | Slot 2 (selected) | Slot 3 | Slider range | Step |
|---|---|---|---|---|---|
| Ball | 0.3 mm = 1.13 px | 0.5 mm = 1.89 px | 0.7 mm = 2.65 px | 0.1–4.0 mm (0.38–15.1 px) | 0.05 mm |
| Fountain | 0.4 mm = 1.51 px | 0.6 mm = 2.27 px | 1.0 mm = 3.78 px | same | same |
| Brush | 1.0 mm = 3.78 px | 2.0 mm = 7.56 px | 4.0 mm = 15.1 px | same | same |
| Highlighter | 3 mm = 11.3 px | 5 mm = 18.9 px | 8 mm = 30.2 px | 1–15 mm (3.8–56.7 px) | 0.5 mm |

The current values are `PEN_WIDTHS [1.5,3,6]` (0.40/0.79/1.59 mm) and `HL_WIDTHS [10,18,28]`.

**[M] Bounds**
- `strokeBounds` and the `strokeHit` reach pad by `width·scale/2` (`ink.ts` ~119/~134).
- At p = 1 the outline is up to (1 + thinning)× the width, so selection boxes are too tight and the eraser falls short.
- Pad by `width·scale + 1`. This is a safe upper bound because thinning ≤ 0.95.

**[S] Low-zoom floor**
- If `width·scale·zoom < 1` screen px, stroke the centerline with `lineWidth = max(0.5, w·zoom)` instead of filling the outline.
- The 0.4 px floor from the old `wOf` is gone for pens, so a 1.5 px pen at zoom 0.1 is invisible today.
- This also works as level of detail at low zoom.

**[C]** Dash pattern: 3w dash, 2w gap. Dot pattern: round cap, 2w gap. Both drawn as a constant-width centerline with `setLineDash`, stored as `dash`.

---

## 5. Color slots

- **[M]** Keep separate palettes for pen and highlighter (as GoodNotes does). All pen kinds share the pen palette. Today's defaults become the initial slots: `INK_COLORS` (6) and `HIGHLIGHT_COLORS` (5).
- **[S]** Slot editing:
  - Up to 12 slots per tool.
  - A "+" slot adds the current color.
  - **Tap the active slot again** to open an editor with a swatch grid, a HEX field and native `<input type=color>`.
  - Long-press and drag to reorder.
  - "Remove slot".
  - "기본값으로" resets only the current tool's palette.
- **[C]** Eyedropper through the `EyeDropper` API (Chromium only; hide it elsewhere).
- **[C]** Favorites bar: up to 12 saved `{tool, pen, color, width, ps, tip, S, dash}` combinations in a movable mini-bar (Noteshelf/Notability style).

---

## 6. Highlighter (형광펜)

- **[M]** Keep: constant width, no pressure, butt caps and round joins (already the case), drawn below pen ink, opaque then composited once at 35% alpha so overlapping strokes don't darken.
- **[S] Group-opacity layer.**
  - Move highlighters to their own static canvas plus a wet canvas, both drawn **opaque**, inside one container with CSS `opacity:.35`.
  - Fixes today's bug where the wet highlighter is drawn at 35% over existing highlighters, stacks, then gets lighter on lift.
  - Wet and committed highlighters will then look identical, and the offscreen `drawImage` step goes away.
  - The container sits below the pen canvases.
- **[S] Light theme blend.** Put `mix-blend-mode: multiply` on that container in light theme, so text in DOM blocks under it stays black. The ink canvas lies above `dn-world`. In dark theme use plain alpha, because multiply makes it invisible. Re-tune alpha in the 0.35–0.5 range.
- **[S] PNG export.** `paintStrokesWorld` applies alpha per stroke, so overlaps darken in exports but not on screen. Use the same opaque-then-alpha approach, plus `globalCompositeOperation='multiply'` in light theme.
- **[S] "직선으로 긋기" (straight line) toggle.** On lift, replace the points with first→last, and snap to horizontal within ±4°.
- **[S]** A stabilization slider for the highlighter too (default 30%).
- **[C]** Cache the centerline as a Path2D, stroked with `lineWidth = width` under the stroke transform.
- **[C]** "Smart highlight" that snaps to text lines in DOM blocks.

---

## 7. Eraser (supporting the pens) — [S]

- **Sizes:** S/M/L at 10/20/40 screen px diameter. Today it is fixed at r = 8/zoom.
- **Modes:**
  - **Stroke eraser** (현재, the current one).
  - **Precision eraser:** cut the points at the circle and split into new strokes. New strokes copy every style field (`pen`, `sv`, `input`, `ps`, `tip`, `width`, `color`, `origin`, `scale`), and the whole erase is one transaction, so one undo.
- **Filter:** checkboxes for Pen and Highlighter, plus a "형광펜만" (highlighter only) shortcut.
- **[S] Windows pen eraser end** (`buttons & 32`): acts as a temporary eraser for that stroke. Today `inkDown` rejects `button !== 0`.
- **[C]** Auto-deselect back to the last tool, Clear Page (with confirmation and undo), Scribble-to-erase.

---

## 8. Latency and rendering performance

**[M]**
1. **Wet-only frame.** `inkMove` calls a new `scheduleWet()`. In `render()` (`canvas-view.ts:349-365`), when only the wet stroke changed, skip `syncMounts`, `drawUnder` and `drawOver` and run `drawWet` alone.
2. **Wet canvas clearing.** Clear only the union of the previous and current wet bounding boxes, padded by width + 2 px. Keep a "drawn" flag so idle frames don't clear the full low-latency canvas.
3. Don't rebuild `wetCtx` on resize; cache the context once.

**[S]**
4. **Delegated Ink Trail** on Chromium/Edge (Windows), opaque pens only.
   - `navigator.ink.requestPresenter({presentationArea: wetCanvas})`.
   - After drawing, call `updateInkTrailStartPoint(e, {color, diameter: width·zoom})`.
   - This requires drawing the wet stroke **synchronously in the pointermove handler**, so the trail starts exactly where the drawn stroke ends.
   - Gain is about 8–16 ms. Not available in Safari or Firefox.
5. **Long wet strokes.** Past about 600 points, freeze the front part into a cached Path2D with a round end cap, and rebuild only the live tail, overlapping by 8 points. Per-frame cost then stays bounded.
6. **Bounds cache.** Cache the relative bounding box alongside the `decoded` map, keyed by the `points` string, so world bounds are `origin + bbox·scale` in O(1). Today `strokeBounds` allocates a `Float64Array` and walks every point of every stroke on every static redraw. This also speeds up `strokeHit` and `lassoStrokes`.
7. **Pan and pinch.** Apply a CSS transform to the existing static canvas during the gesture and redraw once at the end. Today the camera is part of `staticSignature`, so every visible stroke is redrawn every frame.
8. **Pen-up fast path.** When the only change is one appended stroke, paint just that stroke onto the static canvas.
9. Unsubscribe in `engineVersion`, and ignore text-only engine changes so they don't trigger a static redraw.

**[C]**
- `pointerrawupdate` (Chromium only, HTTPS only, and only if the handler takes about 1 ms or less).
- Check `getContextAttributes().desynchronized`. It is mostly a no-op for a transparent overlay and Safari ignores it.
- Centripetal Catmull-Rom subdivision for segments > 4 CSS px (only Safari < 18.2 lacks coalesced events).
- Note: iPad Safari renders at 60 fps by default, and Low Power Mode drops to about 30.

---

## 9. Palm, pen and OS handling

**[M]**
- **Palm bug in `handlePointerDown`** (`pointer.ts`): when `pointerType==='pen'` and an ink tool is active, drop all touch pointers from `view.pointers` and cancel any pan or pinch gesture **before** the `pointers.size === 2` pinch check.
  - Today, a resting palm followed by the Pencil starts a pinch-zoom.
  - With pen-only off, the palm also claims `ink.pointerId` and the Pencil is then ignored.
- **Touch cancel:** `pointercancel` is routed to `handlePointerUp` (`bind-input.ts:29`). For `pointerType==='touch'`, discard the wet stroke instead of committing it, otherwise a palm iPadOS cancels becomes a stroke.
- **Windows press-and-hold:** call `preventDefault` on `contextmenu` while an ink tool is active and the last pointer was a pen. Otherwise holding the pen still opens DamianNote's right-click menu.

**[S]**
- **Auto pen-only:** turn on pen-only the first time a `pen` pointer is seen and save it. Fingers then pan and zoom. Keep the "펜 전용" toggle.
- **iPad Scribble workaround:** while an ink tool is active, add a non-passive `touchmove` listener that calls `preventDefault`, and set `-webkit-touch-callout:none; -webkit-user-select:none` on the root. Verify on a real device.

**[C]**
- Pencil hover (`pen` with `buttons===0`): draw a preview circle at the real diameter and color.
- Two-finger tap to undo, three-finger tap to redo.
- Barrel button (`buttons & 2`) switches to lasso.

---

## 10. Ink toolbar UI (`apps/web/src/InkBar.tsx`)

**Layout when the pen tool is active**, left to right: `[볼펜|만년필|붓펜]` · `thickness ●●●` · `color slots … +` · `⚙` · `paper` · `잉크 / 상자 / 펜 전용`.

- **[M] Pen-kind radio** (`role=radiogroup`, aria-label "펜 종류"). Three icon buttons: 볼펜 (ball), 만년필 (fountain), 붓펜 (brush). Wire `pen` through `setInkStyle`, `uiState()` (`canvas-view.ts:316`) and `CanvasUiState.ink` (`types.ts:15`).
- **[M] Thickness slots.**
  - Three buttons; each dot is sized from its width (clamped to 4–14 px), with the title showing "0.50 mm".
  - Tapping the **active** slot opens a popover with a slider (mm, 0.05 step), a live numeric value, and a preview stroke drawn by the real renderer. The change saves automatically.
  - [C] Solid/dash/dot selector.
  - Replace the labels 가늘게/보통/굵게 with mm values.
- **[S] ⚙ settings popover:**
  - 필압 민감도 (pressure sensitivity): fountain and brush only.
  - 펜 끝 날카로움 (tip sharpness): fountain only.
  - 손떨림 보정 (stabilization) 0–100%.
  - Highlighter: 직선으로 긋기 (straight line).
  - A preview canvas with sample strokes ("가나다 abc").
- **Highlighter:** same bar without pen kinds; its own palette and slots.
- **Eraser:** size S/M/L, mode, filter.

**Keyboard** (`keyboard.ts:70-80`)
- **[M]** `[` / `]` step through the 3 slots (same behavior as today).
- **[S]** `Shift+[` / `Shift+]` change the active slot by ±0.05 mm. Pressing `P` while the pen is active cycles ball → fountain → brush and announces it.
- **[S]** `1`–`9` select color slots.

**[M] Persistence**
- Settings currently reset on every mount (`createInk`).
- Save per device in localStorage under `dn.ink.v1`: pen kind, slots per kind, active slot, both palettes, S / s / k, and the pen-only/auto-pen state.
- Wrap every read and write in try/catch and fall back to defaults when storage is empty or blocked.

---

## 11. Doc view and export — [S]

- Doc view and SVG/Markdown export still draw a centerline at average width (`ink-bind.ts:113-133` `inkPaths`/`inkSvgString`, `rich-render.ts:202`), so pen type and pressure don't show there.
- Fix: move the outline builder into a pure, DOM-free module shared with `ink-render.ts`. perfect-freehand has no DOM dependencies, and `check-arch` only restricts `@dn` imports.
- Output an SVG `d` drawn as a fill, using the same `sv` presets.

---

## 12. Phase plan and tests

**Phase 1 [M]**
1. §1 fields + LEGACY / V0 / `sv:1` presets.
2. §2.1–2.4 (dedupe, rect cache, pressure normalization + debug overlay, mouse pressure, One-Euro filter).
3. §3 presets with length-clamped tapers and the wet/committed split.
4. §4 width model + bounds padding.
5. §8.1–3 wet-only frame and dirty-rect clear.
6. §9 palm/pinch, touch-cancel and contextmenu fixes.
7. §10 pen-kind radio, mm slots and persistence.

**Phase 2 [S]**
- Color-slot editor.
- ⚙ popover.
- Highlighter group-opacity layer + multiply + straight-line toggle + export consistency.
- Delegated Ink Trail.
- Prediction tuning.
- Bounds cache, pan via CSS transform, pen-up fast path.
- Precision eraser + filter + sizes + Windows pen eraser end.
- Auto pen-only, Scribble workaround.
- Doc view outline.
- Low-zoom floor.

**Phase 3 [C]**
- Draw-and-hold shapes:
  - Trigger: stays within 4 screen px for 500 ms while pressed.
  - Recognize in this order: line (chord / path ≥ 0.95), arc, closed shapes (end gap ≤ 15% of perimeter; RDP epsilon 3% of the bounding-box diagonal; 3/4/5/6 corners; ellipse → circle when the axis ratio is ≥ 0.9), arrow.
  - Drag while holding to scale and rotate; snap endpoints within 8 px.
  - Draw at constant p = 0.5. This avoids GoodNotes' "thick held line" bug.
  - The conversion is one undo step.
- Dash/dot, favorites bar, calligraphy nib, hover preview, lazy brush, eyedropper, undo gestures, level-of-detail simplification.

**Tests**
- `e2e/ink.mjs:48` asserts `view.ink.size === 2`; change it to the slot/width model.
- Lines 40 and 55-56 check highlighter alpha 50–140 on `ink.canvas`; repoint them to the highlighter canvas once it moves.
- Add e2e checks:
  - A legacy stroke without `sv` renders at the same width range as before.
  - A new ball stroke has `pen:'ball'`, `sv:1` and an `input` field.
  - A short brush stroke (L < 2·size) is still visible.
  - Touch `pointercancel` adds no stroke.

**Verify on real devices before tuning:**
- Pencil and Surface pressure histograms (the gain constants).
- Whether Safari's coalesced duplicates still occur.
- The Scribble workaround.
- Whether the desynchronized context is actually granted.
- Default S (20%) against corner rounding in small Korean handwriting (ㄱ ㄴ ㅁ).

---

## Conflicts between the reports, and how I resolved them

- **Ball thinning:** 0, not 0.05–0.1, matching GoodNotes "non-pressure-sensitive". If testers find it lifeless, 0.05 is the fallback.
- **One-Euro beta:** 0.03–0.10 in CSS px/s units, not the library's 0.007. With 0.007 the cutoff at handwriting speed stays near minCutoff (the library default minCutoff is 1 Hz, about 159 ms), which lags far too much for writing.
- **Streamline:** fixed per pen at 0.15–0.25. The goodnotes report's formula tied it to S (0.25 + 0.5·S); I didn't, because streamline is per-sample and render-time, while stabilization is baked into the points.
- **Fountain start taper:** 0. The two reports gave 0.5·size and 0.
- **Brush tapers:** start 3·size, end 5·size, each clamped by length. The reports gave start 3–4·size and end 4.2–6·size.

## Key sources
- GoodNotes pen tool (pen types, tip sharpness, pressure, stabilization, 3 presets): https://support.goodnotes.com/hc/en-us/articles/7353756785679-Write-and-customize-ink-with-the-Pen-tool
- GoodNotes highlighter: https://support.goodnotes.com/hc/en-us/articles/7353718215823-Using-the-Highlighter-tool
- GoodNotes eraser: https://support.goodnotes.com/hc/en-us/articles/7353718249231-Erase-handwriting-and-page-content-with-the-Eraser-tool
- GoodNotes color presets: https://support.goodnotes.com/hc/en-us/articles/7353743265039-Add-and-manage-writing-tool-color-presets
- GoodNotes shapes: https://support.goodnotes.com/hc/en-us/articles/13682939148943-Draw-shapes-and-build-diagrams-in-Goodnotes
- Typical user mm and stabilization values: https://paperlesslife.de/en-us/blogs/digitale-planer/schoene-handschrift-in-goodnotes and https://www.lemon8-app.com/experience/goodnotes-pen-tool-settings?region=us
- Fountain-pen complaints: https://feedback.goodnotes.com/forums/191274-customer-suggestions-for-goodnotes-apple/suggestions/48881246--fountain-pen-improvements
- Notability calligraphy pen: https://support.gingerlabs.com/hc/en-us/articles/11113646664218-Calligraphy-Pen
- Notability shapes: https://support.gingerlabs.com/hc/en-us/articles/226905028-Creating-and-Styling-Perfect-Shapes
- perfect-freehand radius, simulated pressure and streamline: https://github.com/steveruizok/perfect-freehand (src/getStrokeRadius.ts, simulatePressure.ts, getStrokePoints.ts)
- tldraw pen parameters: https://raw.githubusercontent.com/tldraw/tldraw/main/packages/tldraw/src/lib/shapes/draw/getPath.ts
- WebKit Pencil pressure normalization: https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/ios/WKTouchEventsGestureRecognizer.mm
- Apple full-scale force 2.0: https://github.com/coco-de/co-package/pull/7
- Safari coalesced-event duplicates: https://github.com/carlosbertilotti/relevador-carnes/pull/18
- Windows pen pixel snapping: https://github.com/TheSevenPens/WebTabletTesterBasic/pull/7
- One-Euro filter: https://gery.casiez.net/1euro/
- Lazy brush: https://github.com/dulnan/lazy-brush
- Delegated Ink Trail: https://developer.mozilla.org/en-US/docs/Web/API/Ink_API and https://github.com/WICG/ink-enhancement/blob/main/README.md
- Desynchronized canvas: https://developer.chrome.com/blog/desynchronized
- Safari 18.2 coalesced and predicted events: https://webkit.org/blog/16301/webkit-features-in-safari-18-2/
- Pointer Events (buttons, pointerrawupdate): https://w3c.github.io/pointerevents/
- Scribble workaround: https://mikepk.com/2020/10/iOS-safari-scribble-bug/
- iOS canvas limits: https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/

## Files
- C:\DamianProject\DamianNote\packages\engine-dom\src\ink-render.ts
- C:\DamianProject\DamianNote\packages\engine-dom\src\ink-input.ts
- C:\DamianProject\DamianNote\packages\engine-dom\src\ink-layer.ts
- C:\DamianProject\DamianNote\packages\engine-dom\src\pointer.ts
- C:\DamianProject\DamianNote\packages\engine-dom\src\bind-input.ts
- C:\DamianProject\DamianNote\packages\engine-dom\src\canvas-view.ts
- C:\DamianProject\DamianNote\packages\engine-dom\src\keyboard.ts
- C:\DamianProject\DamianNote\packages\engine-dom\src\types.ts
- C:\DamianProject\DamianNote\packages\engine-dom\src\canvas.css
- C:\DamianProject\DamianNote\packages\engine-core\src\ink.ts
- C:\DamianProject\DamianNote\packages\engine-core\src\ink-bind.ts
- C:\DamianProject\DamianNote\packages\engine-dom\src\rich-render.ts
- C:\DamianProject\DamianNote\apps\web\src\InkBar.tsx
- C:\DamianProject\DamianNote\e2e\ink.mjs
