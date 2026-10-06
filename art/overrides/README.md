# Art overrides

Every sprite in RUN ROOM is drawn by code (tools/assets). To swap in hand-drawn art without
touching that code, put PNG files here and run `npm run assets`:

    art/overrides/<group>/<name>.png

- Groups: `tiles`, `props`, `fx`, `ui_icons`, `moods`, `chrome` and `portraits`. The file must
  have the same name and size as the generated sprite (see the contact sheets in
  client/public/assets/sheets or the /assets-test page).
- Characters: `characters/ghost.png` and `characters/byte.png`, 96 x 120 sheets with the same
  row layout as the generated ones (6 x 5 frames of 16 x 24).
- Use only colors from the palette (tools/assets/lib/palette.mjs): the generator audits every
  sheet and stops on any other color. A file with the wrong size is ignored with a warning.
