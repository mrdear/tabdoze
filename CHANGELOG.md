# Changelog

## 1.1.2 - 2026-07-18

- Made tab activation and wake events authoritative so a woken tab reliably receives a fresh inactivity cycle.
- Kept failed native discard attempts scheduled for retry instead of counting them as successful sleeps.
- Added regression coverage for a full sleep, wake, and second-sleep cycle.

## 1.1.1 - 2026-07-10

- Guarded the `💤` title marker against last-moment SPA title rewrites before native discard.
- Removed the marker again when Chromium rejects a discard operation.

## 1.1.0 - 2026-07-10

- Rebranded the independent project as TabDoze with an original icon and visual system.
- Replaced user-facing suspend/restore terminology with sleep/wake terminology.
- Preserved the fixed extension ID and historical settings key for upgrades.
- Reworked scheduling around one absolute next-deadline alarm.
- Removed stale feature-flag and legacy product documentation.
- Labeled memory statistics as fixed estimates rather than measured process memory.
- Added repeatable validation, packaging, CI, and tagged-release workflows.
