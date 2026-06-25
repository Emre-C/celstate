# Illustrated UI Ornaments Proof

This folder is the bounded proof for the illustrated UI ornament direction.

The test is not whether Celstate can generate a whole UI. The test is whether a
real app screen can accept alpha-native ornament assets in declared slots:

- `header_village_vignette`: faded scenery, top-right anchored.
- `bottom_scroll_foliage`: foliage in scroll content flow, not fixed to viewport.
- `action_icon_calendar`: hand-drawn semantic icon inside a real action card.

Open `proof.html` directly in a browser. The page is intentionally static so the
composition can be inspected without a dev server or runtime package.

## Pass Criteria

- No rectangular fade or mask artifacts around any asset.
- Header scenery does not obscure top controls.
- Bottom foliage appears by scrolling down into content and scrolls away again.
- The icon reads as an event/calendar action at mobile UI size.
- Code uses simple placement, opacity, and flow layout only.

## Stop Criteria

Stop the path if a slot requires complex masking, background extraction,
computer-vision layout recovery, or more than two generation/refinement passes.
