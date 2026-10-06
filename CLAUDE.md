# RUN ROOM - project rules for Claude

RUN ROOM is a server-simulated pixel-art hacker office that runs the user's OWN Python code
(one file or a project folder) and visualises it: the crew walks the code to the PC, installs its
dependencies, runs it while showing the function calls and return types, and asks the viewers when
the program wants input. There is NO real hacking, scanning or exploitation anywhere in it. The
simulation runs on the server; every browser is only a view plus a command sender.

## HARD RULES (copied verbatim from the project brief, section 1)

==================================================
1. HARD RULES (non-negotiable, enforced by a check script)
==================================================
- NO EMOJIS anywhere: not in UI text, logs, buttons, comments, commit messages, README, or strings.
- NO unicode symbol icons either (no check marks, crosses, arrows, play triangles, gears, bullets, stars, box-drawing art).
- NO icon libraries or icon fonts (no lucide, FontAwesome, Material Icons, heroicons, react-icons, emoji pickers).
- NO default browser look: no rounded modern buttons, no system fonts, no default checkboxes, inputs or scrollbars.
- EVERY icon, button glyph, mood face, status light, avatar and mouse cursor is a PIXEL SPRITE produced by the asset generator.
  Text in the UI uses bundled bitmap fonts only: @fontsource/press-start-2p for headings and @fontsource/vt323 for body and terminal text.
  Express states in plain ASCII words such as "OK", "ERR", "RUN", "->".
- All sprites render with image-rendering: pixelated, Phaser pixelArt: true, roundPixels: true, and integer scaling only (2x, 3x, 4x ...), never fractional.
- Create scripts/check-no-emoji.mjs: scan client/src, client/index.html, server, shared, scripts, tools, README.md and CLAUDE.md
  (skip node_modules, dist and binary files) and FAIL with exit code 1 if any of these appear: emoji or pictographs (U+1F000-U+1FAFF, U+2600-U+27BF, U+2B00-U+2BFF,
  U+2190-U+21FF, U+2300-U+23FF, U+25A0-U+25FF, U+FE0F), or imports from lucide, fortawesome, react-icons, @mui/icons, heroicons, @tabler.
  Write the ranges in that script using \u escape sequences so the script itself contains no literal symbols. Wire it into "npm run check" and "prebuild".
  Run it after every milestone and fix every violation.

## Working notes (keep in sync with the code)

- Keep every file ASCII. Use words ("OK", "ERR", "RUN", "->") instead of symbols.
- Art is never downloaded. All PNGs come from tools/assets/generate.mjs (npm run assets).
  Game code and React components look up art ONLY through client/src/assets/manifest.ts.
- The server is the single source of truth (server/sim/Simulation.ts). Clients never simulate;
  they render server events using the shared sim clock (shared/motion.ts, shared/clock.ts).
- The office map lives in ONE file: shared/officeLayout.ts. Rendering and pathfinding both read it.
- Running code (server/runners/PythonRunner.ts + server/runners/python/runroom_harness.py):
  only the user's own Python. Commands follow shared/commands.ts: python / py / pip only, split
  into words and started WITHOUT a shell, scripts must be inside the code folder. Setup commands
  run in a per-code virtual environment. Never add a shell, never serve server/uploads or
  data/projects, keep the one-time consent modal and the origin / host checks.
  RUN ROOM itself adds no network scanning, probing or exploit features. It is not a sandbox and
  the UI and README must keep saying so.
- Access (server/net/security.ts): watching is open to everyone; running code and EVERY other
  command are admin only (enforced on the server in Simulation.handle, not just hidden in the UI).
  Admin = open mode (no RUNROOM_ACCESS_PASSWORD, everyone is admin, meant for 127.0.0.1) OR a
  valid session token. AdminAuth.login checks the password (constant time) and returns a token;
  the browser sends it on the WebSocket (?token=) and on uploads (X-RunRoom-Token). Tokens are
  in-memory only. The Host/Origin checks (refuseReason) block foreign pages and DNS rebinding
  whenever the server binds loopback, password or not (a page could otherwise try a guessable
  password); only password + network bind skips them. index.ts loads the repo-root .env (git-ignored,
  a real environment variable wins), refuses a non-loopback bind (--public / RUNROOM_PUBLIC)
  without a password and warns when it is under 12 characters. childEnv strips the password from
  every program's environment (program output reaches guests). No links, QR codes, access-key file
  or device/network checks: the config carries role + passwordRequired. The client gate is
  client/src/hud/Auth.tsx; login/logout + reconnect live in client/src/net.
- The harness file is plain ASCII and must keep working on Python 3.8+ (sys.monitoring on 3.12+,
  sys.setprofile before). It only traces files inside the project folder.
- Text that comes from a program (output, prompts, function names, values, reports) goes through
  shared/display.ts before it reaches the HUD (no emoji or symbol glyphs, no terminal escapes).
- Narrow layout (client/src/hud/hud.css): the office grid row must stay max-content; an auto row
  collapses to 0px on short screens (a phone held sideways) and hides the office. On phones and
  short narrow screens the agent detail card is a bottom sheet that folds down to its title bar
  (uiState.detailCollapsed); its media query is duplicated in AgentDetail.tsx and must match.
- The PC rule and visual causality (server/sim/TaskDirector.ts, tests in tests/lifecycle.test.ts):
  Ghost walks to his PC (DESK_GHOST) before a run makes any progress; setup commands only start
  once Byte stands at the server racks; the program only starts once Ghost is seated at the PC;
  when it ends he stands up, the PC screen goes dark and he walks to the Command Center wall
  without coming back. Idle behaviors never use the PC, so the PC screen is "off" whenever no run
  needs it. The queue shows TaskInfo.note (e.g. GHOST -> PC, INSTALLING 1/1, WAITING FOR INPUT).
  A crash stays visible: after an uncaught exception Ghost facepalms at the red screen for
  CRASH_BEAT_MS before he gets up (the program exits right after its exception).
- Scrolling: the office canvas never swallows the wheel or touch swipes (createGame passes
  input.mouse.preventDefaultWheel false and input.touch.capture false), so the page scrolls over
  it. Sprite clicks fire on pointerup through takeTap() (client/src/game/tap.ts): only a real tap
  counts (no drag, no browser pan, not a fling stop), once, and page scrolls refresh Phaser's
  canvas bounds. Every scroll area is a PixelScroll (pixel scrollbar; autoHide for small panels);
  in-page scrollers chain into the page (no overscroll-behavior: contain), the page scroller and
  html/body stop at their ends, and a dialog has exactly one scroller (the PixelModal body, which
  gets the focus) - never nest a scroller inside a dialog.
- Ghost and Byte stand side by side at the PC: director bubbles go through speak() so only one of
  them talks at a time (urgent lines hush the other).
- The generated art in client/public/assets is committed (deterministic, so npm run assets leaves
  it unchanged). README media lives in docs/media: screenshots and the demo GIF are captures of
  real runs of the samples, banner.png and crew.png are built from the generated sprites. Retake
  them when the visible UI changes, from a store path without personal folder names (program
  tracebacks show it).
- Run "npm run check" (no-emoji + typecheck + lint + tests) after every change set.
