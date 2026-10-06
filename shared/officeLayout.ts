// THE office map. Rendering (client) and pathfinding (server) both read this one file.
//
// 32 x 20 tiles of 16 px (512 x 320 px). 3/4 top-down view: walls have a cap ('#') and a
// visible face below it. Two tile tall faces get upper / lower variants automatically.

export const MAP_W = 32;
export const MAP_H = 20;

/**
 * ASCII grid. Legend (see TILE_LEGEND for the tile names):
 *   #  wall cap (autotiled)            =  wall face
 *   c  wall face with cyan neon        m  wall face with magenta neon
 *   w  wall face with a night window   D  door in a face (walkable)
 *   E  side door in a vertical wall    .  floor_a
 *   g  floor_b (grid)                  n  floor_neon (cyan strip)
 *   k  carpet                          r  grate
 *   x  checker                         -  cable_h      |  cable_v
 *   v  vent                            s  server_floor
 */
export const LAYOUT_ROWS: readonly string[] = [
  '################################', //  0
  '#========#mm=======mm#=========#', //  1  Server Room | Command Center | Ghost's Workstation
  '#========#===========#=========#', //  2
  '#ssssssss#kkkkkkkkkkk#ggggggggg#', //  3
  '#vssssssv#kkkkkkkkkkk#ggggggggg#', //  4
  '#s----sss#kkkkkkkkkkk#ggggggggg#', //  5
  '#ssssssss#kkkkkkkkkkk#ggggggggg#', //  6
  '#ssssssss#kkkkkkkkkkk#ggggggggg#', //  7
  '#####s#########k##########g#####', //  8  doors through the cap row
  '#====D=w==c==w=D==w=cc=w==D=w==#', //  9  corridor wall face
  '#..............................E', // 10  corridor
  '#nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnE', // 11  corridor (neon strip)
  '####.######r#######xx######.####', // 12  doors through the cap row
  '#===D==#=c=D=c=#=m=DD=m=#w=D=w=#', // 13  Archive | Lab | Coffee Corner | Mail Room
  '#......#.......#xxxxxxxx#......#', // 14
  '#......#..rr...#xxxxxxxx#......#', // 15
  '#......#..rr...#xxxxxxxx#......#', // 16
  '#......#.......#xxxxxxxx#......#', // 17
  '#......#.......#xxxxxxxx#..v...#', // 18
  '################################', // 19
];

/** Character -> base tile name (from tileset.json). Faces get _top / _bottom variants. */
export const TILE_LEGEND: Readonly<Record<string, string>> = {
  '#': 'wall_top',
  '=': 'wall_face',
  c: 'wall_neon_cyan',
  m: 'wall_neon_magenta',
  w: 'window_night',
  D: 'door',
  E: 'door_side',
  '.': 'floor_a',
  g: 'floor_b',
  n: 'floor_neon',
  k: 'carpet',
  r: 'grate',
  x: 'checker',
  '-': 'cable_h',
  '|': 'cable_v',
  v: 'vent',
  s: 'server_floor',
};

export const CAP_CHARS = new Set(['#']);
export const FACE_CHARS = new Set(['=', 'c', 'm', 'w', 'D']);
/** Characters an agent can stand on. */
export const WALKABLE_CHARS = new Set(['D', 'E', '.', 'g', 'n', 'k', 'r', 'x', '-', '|', 'v', 's']);

export type Facing = 'down' | 'left' | 'right' | 'up';

export interface Station {
  x: number;
  y: number;
  facing: Facing;
  room: RoomId;
  /** Pixel offset applied to the agent sprite while it is posed here (seated, on the couch). */
  pose?: { dx: number; dy: number };
}

export type RoomId = 'server' | 'command' | 'workstation' | 'corridor' | 'archive' | 'lab' | 'coffee' | 'mail';

export const ROOMS: Readonly<Record<RoomId, { name: string; x: number; y: number; w: number; h: number }>> = {
  server: { name: 'SERVER ROOM', x: 1, y: 3, w: 8, h: 5 },
  command: { name: 'COMMAND CENTER', x: 10, y: 3, w: 11, h: 5 },
  workstation: { name: "GHOST'S WORKSTATION", x: 22, y: 3, w: 9, h: 5 },
  corridor: { name: 'CORRIDOR', x: 1, y: 10, w: 30, h: 2 },
  archive: { name: 'ARCHIVE', x: 1, y: 14, w: 6, h: 5 },
  lab: { name: 'LAB', x: 8, y: 14, w: 7, h: 5 },
  coffee: { name: 'COFFEE CORNER', x: 16, y: 14, w: 8, h: 5 },
  mail: { name: 'MAIL ROOM', x: 25, y: 14, w: 6, h: 5 },
};

/** Named anchor points agents walk to. Every station must be walkable and reachable (tested). */
export const STATIONS = {
  DESK_GHOST: { x: 26, y: 4, facing: 'up', room: 'workstation', pose: { dx: 0, dy: -4 } },
  DESK_SIDE: { x: 27, y: 4, facing: 'left', room: 'workstation' },
  COMMAND_SCREEN: { x: 14, y: 3, facing: 'up', room: 'command' },
  COMMAND_SIDE: { x: 16, y: 4, facing: 'up', room: 'command' },
  SERVER_CHECK: { x: 4, y: 4, facing: 'up', room: 'server' },
  SERVER_HOT: { x: 5, y: 4, facing: 'up', room: 'server' },
  ARCHIVE_SHELF: { x: 2, y: 15, facing: 'up', room: 'archive' },
  LAB_BENCH: { x: 9, y: 15, facing: 'up', room: 'lab' },
  WHITEBOARD: { x: 12, y: 14, facing: 'up', room: 'lab' },
  COFFEE: { x: 16, y: 15, facing: 'up', room: 'coffee' },
  VENDING: { x: 17, y: 15, facing: 'up', room: 'coffee' },
  COUCH: { x: 21, y: 15, facing: 'down', room: 'coffee', pose: { dx: 0, dy: -15 } },
  CAT_SPOT: { x: 17, y: 17, facing: 'right', room: 'coffee' },
  PLANT: { x: 2, y: 10, facing: 'left', room: 'corridor' },
  PLANT_COMMAND: { x: 19, y: 3, facing: 'right', room: 'command' },
  MAIL_DROP: { x: 26, y: 15, facing: 'up', room: 'mail' },
  INBOX: { x: 29, y: 15, facing: 'up', room: 'mail' },
  BYTE_HOME: { x: 28, y: 17, facing: 'down', room: 'mail' },
  DOOR: { x: 30, y: 10, facing: 'right', room: 'corridor' },
  CORRIDOR_W: { x: 3, y: 11, facing: 'down', room: 'corridor' },
  CORRIDOR_MID: { x: 16, y: 10, facing: 'down', room: 'corridor' },
  CORRIDOR_E: { x: 24, y: 11, facing: 'down', room: 'corridor' },
} as const satisfies Record<string, Station>;

export type StationId = keyof typeof STATIONS;
export const STATION_IDS = Object.keys(STATIONS) as StationId[];

export type PropLayer = 'floor' | 'wall' | 'object';

/** World props whose sprite is chosen from shared world state. */
export type PropBinding = 'deskScreen' | 'mailbox' | 'cat' | 'rack' | 'monitor' | 'neon' | 'hologram' | 'rain' | 'courier' | 'bug';

export interface PropPlacement {
  id: string;
  /** Sprite name in the props atlas (for animated props: the base name, frames are base_0, base_1 ...). */
  sprite: string;
  /** Footprint top-left tile. */
  x: number;
  y: number;
  /** Footprint size in tiles. */
  w: number;
  h: number;
  collide: boolean;
  layer: PropLayer;
  /** Pixel offset of the sprite from its default anchor (bottom-center of the footprint; wall props: top-left). */
  ox?: number;
  oy?: number;
  /** Animation frame count when the sprite cycles on the shared prop clock. */
  frames?: number;
  binding?: PropBinding;
  /** Night time glow color drawn additively over the prop. */
  glow?: 'cyan' | 'green' | 'magenta' | 'red';
  /** Extra depth for y-sorting (positive draws later). */
  depthBias?: number;
  /** Click target for the client. */
  click?: 'monitor' | 'cat';
  /** Rack index for the overheat effect. */
  rack?: number;
}

const rack = (n: number, x: number, y: number): PropPlacement => ({
  id: `rack_${n}`,
  sprite: 'server_rack',
  x,
  y,
  w: 1,
  h: 1,
  collide: true,
  layer: 'object',
  binding: 'rack',
  rack: n,
  glow: 'green',
});

export const PROPS: readonly PropPlacement[] = [
  // Server Room
  rack(0, 2, 3),
  rack(1, 3, 3),
  rack(2, 4, 3),
  rack(3, 5, 3),
  rack(4, 6, 3),
  rack(5, 7, 3),
  rack(6, 1, 6),
  rack(7, 2, 6),
  rack(8, 7, 6),
  rack(9, 8, 6),
  { id: 'server_cables', sprite: 'cables', x: 5, y: 7, w: 1, h: 1, collide: false, layer: 'floor' },

  // Command Center
  { id: 'monitor_wall', sprite: 'monitor_wall', x: 13, y: 1, w: 3, h: 2, collide: false, layer: 'wall', ox: 0, oy: 4, binding: 'monitor', glow: 'cyan', click: 'monitor' },
  { id: 'neon_sign', sprite: 'neon_sign_on', x: 17, y: 1, w: 2, h: 1, collide: false, layer: 'wall', ox: 4, oy: 6, binding: 'neon', glow: 'magenta' },
  { id: 'round_table', sprite: 'round_table', x: 14, y: 5, w: 2, h: 2, collide: true, layer: 'object' },
  { id: 'hologram', sprite: 'hologram', x: 14, y: 5, w: 2, h: 1, collide: false, layer: 'object', oy: -2, binding: 'hologram', depthBias: 40, glow: 'cyan' },
  { id: 'console_desk', sprite: 'desk_blue', x: 18, y: 5, w: 2, h: 1, collide: true, layer: 'object', glow: 'cyan', click: 'monitor' },
  { id: 'plant_command_w', sprite: 'plant', x: 10, y: 7, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'plant_command_e', sprite: 'plant', x: 20, y: 3, w: 1, h: 1, collide: true, layer: 'object' },

  // Ghost's Workstation
  { id: 'poster', sprite: 'poster_skull', x: 22, y: 1, w: 1, h: 1, collide: false, layer: 'wall', oy: 6 },
  { id: 'window_ws_1', sprite: 'window_rain', x: 23, y: 1, w: 1, h: 2, collide: false, layer: 'wall', binding: 'rain' },
  { id: 'window_ws_2', sprite: 'window_rain', x: 29, y: 1, w: 1, h: 2, collide: false, layer: 'wall', binding: 'rain' },
  { id: 'workstation', sprite: 'workstation_desk', x: 25, y: 3, w: 3, h: 1, collide: true, layer: 'object', binding: 'deskScreen', glow: 'green', click: 'monitor' },
  { id: 'chair', sprite: 'chair', x: 26, y: 4, w: 1, h: 1, collide: false, layer: 'object' },
  { id: 'cans', sprite: 'energy_drink_cans', x: 28, y: 4, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'crates_ws', sprite: 'stacked_crates', x: 22, y: 7, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'plant_ws', sprite: 'plant', x: 30, y: 7, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'test_desk', sprite: 'desk_green', x: 22, y: 4, w: 2, h: 1, collide: true, layer: 'object', glow: 'green', click: 'monitor' },

  // Corridor
  { id: 'plant_corridor', sprite: 'plant', x: 1, y: 10, w: 1, h: 1, collide: true, layer: 'object' },

  // Archive
  { id: 'cabinet_1', sprite: 'filing_cabinet', x: 1, y: 14, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'cabinet_2', sprite: 'filing_cabinet', x: 2, y: 14, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'cabinet_3', sprite: 'filing_cabinet', x: 3, y: 14, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'cabinet_4', sprite: 'filing_cabinet', x: 5, y: 14, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'cabinet_5', sprite: 'filing_cabinet', x: 6, y: 14, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'crates_archive', sprite: 'stacked_crates', x: 1, y: 18, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'plant_archive', sprite: 'plant', x: 6, y: 18, w: 1, h: 1, collide: true, layer: 'object' },

  // Lab
  { id: 'lab_bench_1', sprite: 'lab_bench', x: 8, y: 14, w: 2, h: 1, collide: true, layer: 'object' },
  { id: 'lab_bench_2', sprite: 'lab_bench', x: 12, y: 16, w: 2, h: 1, collide: true, layer: 'object' },
  { id: 'whiteboard', sprite: 'whiteboard', x: 12, y: 13, w: 2, h: 1, collide: false, layer: 'wall' },
  { id: 'lab_bug', sprite: 'bug', x: 9, y: 17, w: 1, h: 1, collide: false, layer: 'floor', binding: 'bug', ox: 4, oy: -4 },
  { id: 'lab_cables', sprite: 'cables', x: 14, y: 18, w: 1, h: 1, collide: false, layer: 'floor' },

  // Coffee Corner
  { id: 'coffee_machine', sprite: 'coffee_machine', x: 16, y: 14, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'vending', sprite: 'vending_machine', x: 17, y: 14, w: 1, h: 1, collide: true, layer: 'object', glow: 'magenta' },
  { id: 'couch', sprite: 'couch', x: 21, y: 14, w: 2, h: 1, collide: true, layer: 'object' },
  { id: 'plant_coffee', sprite: 'plant', x: 23, y: 14, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'pizza', sprite: 'pizza_box', x: 22, y: 16, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'cat', sprite: 'cat', x: 18, y: 17, w: 1, h: 1, collide: true, layer: 'object', binding: 'cat', click: 'cat' },

  // Mail Room
  { id: 'mail_dropbox', sprite: 'mail_dropbox', x: 26, y: 14, w: 1, h: 1, collide: true, layer: 'object', binding: 'mailbox' },
  { id: 'inbox_tray', sprite: 'task_inbox_tray', x: 29, y: 14, w: 1, h: 1, collide: true, layer: 'object' },
  { id: 'charger', sprite: 'charger_pad', x: 28, y: 17, w: 1, h: 1, collide: false, layer: 'floor' },
  { id: 'courier', sprite: 'robot_courier', x: 30, y: 18, w: 1, h: 1, collide: true, layer: 'object', binding: 'courier' },
  { id: 'crates_mail', sprite: 'stacked_crates', x: 25, y: 18, w: 1, h: 1, collide: true, layer: 'object' },
];

/** Tile character at (x, y); outside the map counts as wall cap. */
export function charAt(x: number, y: number): string {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return '#';
  return LAYOUT_ROWS[y][x];
}

/** Collision grid: 0 = walkable, 1 = blocked. Walls, faces and colliding prop footprints block. */
export function buildCollisionGrid(): number[][] {
  const grid: number[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    const row: number[] = [];
    for (let x = 0; x < MAP_W; x++) row.push(WALKABLE_CHARS.has(charAt(x, y)) ? 0 : 1);
    grid.push(row);
  }
  for (const p of PROPS) {
    if (!p.collide) continue;
    for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) grid[p.y + dy][p.x + dx] = 1;
  }
  return grid;
}

/** Which room a tile belongs to (corridor and doorways count as corridor). */
export function roomAt(x: number, y: number): RoomId {
  for (const [id, r] of Object.entries(ROOMS) as [RoomId, (typeof ROOMS)[RoomId]][]) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return id;
  }
  return 'corridor';
}

export interface ResolvedTile {
  /** Tile names to draw bottom to top (base tile, then overlays such as shadows). */
  layers: string[];
}

const isCap = (ch: string) => CAP_CHARS.has(ch);
const isFace = (ch: string) => FACE_CHARS.has(ch);

/**
 * Resolves the ASCII map into tile names: caps are autotiled with a 4-bit neighbour mask
 * (plus inner corner overlays), faces pick single / top / bottom variants, floors get contact
 * shadows under walls. The asset generator's preview uses the same rules.
 */
export function resolveTiles(): ResolvedTile[][] {
  const out: ResolvedTile[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    const row: ResolvedTile[] = [];
    for (let x = 0; x < MAP_W; x++) {
      const ch = charAt(x, y);
      const layers: string[] = [];
      if (isCap(ch)) {
        let mask = 0;
        if (isCap(charAt(x, y - 1))) mask |= 1;
        if (isCap(charAt(x + 1, y))) mask |= 2;
        if (isCap(charAt(x, y + 1))) mask |= 4;
        if (isCap(charAt(x - 1, y))) mask |= 8;
        layers.push(`wall_top_${mask}`);
        if (mask & 1 && mask & 2 && !isCap(charAt(x + 1, y - 1))) layers.push('wall_top_inner_ne');
        if (mask & 1 && mask & 8 && !isCap(charAt(x - 1, y - 1))) layers.push('wall_top_inner_nw');
        if (mask & 4 && mask & 2 && !isCap(charAt(x + 1, y + 1))) layers.push('wall_top_inner_se');
        if (mask & 4 && mask & 8 && !isCap(charAt(x - 1, y + 1))) layers.push('wall_top_inner_sw');
      } else if (ch === 'D' || ch === 'E') {
        layers.push(TILE_LEGEND[ch]);
      } else if (isFace(ch)) {
        const above = isFace(charAt(x, y - 1));
        const below = isFace(charAt(x, y + 1));
        const base = TILE_LEGEND[ch];
        layers.push(above ? `${base}_bottom` : below ? `${base}_top` : base);
      } else {
        layers.push(TILE_LEGEND[ch] ?? 'floor_a');
        const n = charAt(x, y - 1);
        if (isCap(n) || (isFace(n) && n !== 'D')) layers.push('shadow_n');
        if (isCap(charAt(x - 1, y))) layers.push('shadow_w');
      }
      row.push({ layers });
    }
    out.push(row);
  }
  return out;
}
