# Changelog

All notable changes to this project will be documented in this file.

## 2026-03-24 - 0.3
### Added
- Support for nested `struct` declarations within the parent structure.
- Now correctly handles comma-separated members (`int a, b, *c;`).
- Bracket-aware logic to ensure nested semicolons don't break the main parser.

### Changed
- Refactored `parseStruct` to handle size and alignment calculations via recursion.

## 2026-03-24 - 0.2
### Added
- Support for `stdint.h` types and function pointers.
- Visual representation of padding bytes.

### Changed
- Removed optimized box from main page for cleaner UI.


## 2026-03-24 - 0.1
### Added
- Initial release with basic struct visualization.
- Live demo on GitHub Pages.
