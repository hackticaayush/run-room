// Constants shared by the server simulation and the client renderer.

export const APP_VERSION = '0.1.0';

/** Tile size in pixels. Every map coordinate is in tiles unless noted. */
export const TILE = 16;

/** Shared prop animation clock: 6 frames per second of sim time. */
export const PROP_FRAME_MS = 166;

/** How often the server re-broadcasts the sim clock (real ms). */
export const CLOCK_SYNC_MS = 1000;

/** Default HTTP / WebSocket port of the server. */
export const DEFAULT_PORT = 8787;

/** WebSocket path on the server. */
export const WS_PATH = '/ws';

/** Upload rules (enforced on the server, mirrored in the client for early feedback). */
const GB = 1024 * 1024 * 1024;
/** A single .py file. */
export const MAX_FILE_BYTES = GB;
/** A whole project folder. */
export const MAX_PROJECT_BYTES = GB;
export const MAX_PROJECT_FILES = 2000;
/** Any one file inside a project folder. */
export const MAX_PER_FILE_BYTES = GB;
/** A single file upload must be one of these. */
export const PYTHON_EXTENSIONS = ['.py', '.pyw'] as const;

/** Run limits. */
export const MAX_COMMAND_LENGTH = 300;
export const MAX_SETUP_LINES = 5;
export const MAX_INPUT_LENGTH = 4000;
export const MAX_PROJECT_NAME = 40;

/** Rack LED blink period in sim ms, idle vs. while a task runs. */
export const RACK_BLINK_IDLE_MS = 520;
export const RACK_BLINK_BUSY_MS = 140;

/** Typing animation frame period in sim ms. */
export const TYPING_FRAME_MS = 180;

/** Walk cycle: frames advance every this many tiles travelled. */
export const WALK_FRAME_TILES = 0.25;

/** Number of log lines kept by the server for late joiners. */
export const LOG_BACKLOG = 200;

/** Number of results kept by the server. */
export const RESULT_BACKLOG = 25;
