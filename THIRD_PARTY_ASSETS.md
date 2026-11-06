# Third-party assets

## Satoshi

- Files: `assets/fonts/satoshi-500.woff2`, `assets/fonts/satoshi-700.woff2`
- Source: Fontshare (https://www.fontshare.com/fonts/satoshi) by the Indian Type Foundry
- Licence: Fontshare / ITF Free Font Licence, free for personal and commercial use, web embedding included; the font files may not be sold or redistributed on their own, and no derivative fonts may be made

## Nährwerte

`src/foods.js` holds rounded reference values written for this app. They are approximations for an "about" figure, not laboratory data.

## ZXing

- Files: `assets/vendor/zxing.min.js` (the unchanged UMD build of `@zxing/library` 0.23.0), licence text in `assets/vendor/zxing-LICENSE`
- Source: https://github.com/zxing-js/library
- Licence: Apache License 2.0
- Use: reads barcodes from the camera on devices whose browser has no built-in barcode reader, such as Safari on the iPhone. Loaded only when the scanner opens.

## Open Food Facts

Scanned products are looked up at https://world.openfoodfacts.org. Its data is under the Open Database License (ODbL); the app shows it and names the source, and keeps only what was eaten.
