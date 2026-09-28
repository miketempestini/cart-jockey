'use strict';

// Logical resolution. Everything in the game is measured in these units;
// the canvas is scaled to fit the window with letterboxing.
const W = 960;
const H = 540;

// ?shift=SECONDS shortens the shift for testing.
const SHIFT_OVERRIDE = Number(new URLSearchParams(window.location.search).get('shift'));

const CONFIG = {
  walkSpeed: 150,
  sprintSpeed: 260,
  staminaMax: 100,
  staminaDrain: 40, // per second while sprinting
  staminaRegen: 25, // per second while not sprinting
  staminaRegenDelay: 0.6, // seconds after sprinting before regen starts
  staminaMinToSprint: 20, // once empty, must recover this much to sprint again
  grabRange: 44, // empty-handed: max distance from player center to a cart center
  latchRange: 34, // with a train: max distance from the hitch at the nose to a cart center
  latchCone: (70 * Math.PI) / 180, // the cart must be within this angle of straight ahead of the nose
  maxTrain: 6,
  // Train handling. Every extra cart makes the train slower and its turns wider.
  trainSpeedBase: 0.85, // speed multiplier with one cart
  trainSpeedPerCart: 0.05, // lost per extra cart (6 carts = 0.60)
  turnRadiusBase: 22, // turning radius with one cart
  turnRadiusPerCart: 12, // added per extra cart (6 carts = 82)
  trailerLag: 22, // travel distance for a cart to close ~63% of its angle gap to the cart ahead
  reverseAngle: (110 * Math.PI) / 180, // input this far from the train heading backs up instead
  reverseMult: 0.6, // backing up is slower
  cartAttachDist: 21, // player center to first cart center
  hitch: 8, // cart center to the hitch point at its nose; nested carts sit 2 * hitch apart
  linkSettleRate: 10, // how fast a newly grabbed or latched cart snaps into its nested spot
  binCartSpeed: 80, // how fast carts in the bin slide forward to fill a gap
  cartValue: { standard: 10, stray: 20 },
  messageTime: 1.6,
  // Scoring. A dock pays (sum of cart values) x train bonus x combo.
  // The train bonus grows with every cart, so one big dock always beats the
  // same carts docked in pieces.
  trainBonusPerCart: 0.5, // 1 cart x1, 2 carts x1.5 ... 6 carts x3.5
  // The combo only climbs if a cart was picked up outside this far from the
  // return zone since the last dock, so splitting a train in the corral can't farm it.
  corralAreaPad: 70,
  // Shift
  shiftSeconds: SHIFT_OVERRIDE > 0 ? SHIFT_OVERRIDE : 180,
  startCountdown: 3, // "3, 2, 1, GO" before every shift
  finalStretch: 20, // the clock goes big and ticks for the last this-many seconds
  comboWindow: 12, // seconds after a dock to land the next one
  comboMults: [1, 1.5, 2, 3],
  strayMax: 3, // strays out in the lot at once
  strayRespawn: 10, // seconds between stray spawns while below the max
  strayMinSpawnDist: 120, // strays never pop in right next to the player
  // Vehicles
  carLength: 54,
  carWidth: 34,
  trafficSpeed: 95, // cars driving to and from spaces
  parkingSpeed: 45, // pulling in and backing out
  parkedStart: 24,
  parkedMin: 16,
  parkedMax: 32,
  trafficMaxMoving: 3, // cars driving around at once
  arriveEvery: [4, 9], // random seconds between cars arriving
  departEvery: [5, 11], // random seconds between cars leaving
  spotWaitMax: 6, // a car gives up on a blocked space after this long and drives out
  yieldProbe: 26, // how far ahead a car looks for another car to wait behind
  carHitTimePenalty: 5,
  hitInvuln: 2, // seconds the player can't be hit again
  hitStun: 0.4, // seconds of no control after a hit
  // Grading: the shift's score as a percentage of par, on a standard school
  // scale. Par is the score a solid shift should reach; tune it after playtests.
  parScore: 1500,
  grades: [
    { min: 90, grade: 'A' },
    { min: 80, grade: 'B' },
    { min: 70, grade: 'C' },
    { min: 60, grade: 'D' },
    { min: 0, grade: 'F' },
  ],
};

const CART_SIZE = 20;

// ---------------------------------------------------------------------------
// Lot layout (game rules: what is solid, where the corral, bin, spaces and
// lanes are)
// ---------------------------------------------------------------------------

const SPACE_W = 48;
const SPACE_D = 64;
const ROW_X0 = 96;
const ROW_COUNT = 16;
const RAIL = 6;
const BIN_INDEX = 7; // row C, two spaces wide

const CAR_COLORS = ['#3d6fb6', '#b8423a', '#e0dccf', '#2f8a5b', '#6c6f75', '#1f2a3a', '#c9a13b', '#7a4fa0'];

// Traffic lanes are one-way and follow the painted arrows: east along the
// fire lane, south down the right edge, west along the bottom and the middle
// aisle, north up the left edge. Four entrances connect them to the street,
// each with a separate IN and OUT lane so cars never meet head-on.
const LANE_NODES = {
  FW: { x: 28, y: 180 }, FE: { x: 932, y: 180 },
  MW: { x: 28, y: 360 }, ME: { x: 932, y: 360 },
  L2: { x: 28, y: 430 }, R2: { x: 932, y: 430 },
  BW: { x: 28, y: 500 }, BE: { x: 932, y: 500 },
  B1x: { x: 240, y: 500 }, B1i: { x: 300, y: 500 },
  B2x: { x: 640, y: 500 }, B2i: { x: 700, y: 500 },
  // Entrance ends sit just off screen so cars drive in and out of view.
  GWi: { x: -40, y: 430 }, GWo: { x: -40, y: 360 },
  GEi: { x: 1000, y: 360 }, GEo: { x: 1000, y: 430 },
  GS1i: { x: 300, y: 580 }, GS1o: { x: 240, y: 580 },
  GS2i: { x: 700, y: 580 }, GS2o: { x: 640, y: 580 },
};
const LANE_EDGES = [
  ['FW', 'FE'], ['FE', 'ME'], ['ME', 'R2'], ['R2', 'BE'],
  ['BE', 'B2i'], ['B2i', 'B2x'], ['B2x', 'B1i'], ['B1i', 'B1x'], ['B1x', 'BW'],
  ['BW', 'L2'], ['L2', 'MW'], ['MW', 'FW'], ['ME', 'MW'],
  ['GWi', 'L2'], ['MW', 'GWo'], ['GEi', 'ME'], ['R2', 'GEo'],
  ['GS1i', 'B1i'], ['B1x', 'GS1o'], ['GS2i', 'B2i'], ['B2x', 'GS2o'],
];
const GATES = [
  { label: 'W', in: 'GWi', out: 'GWo', side: 'left', span: [360, 430] },
  { label: 'E', in: 'GEi', out: 'GEo', side: 'right', span: [360, 430] },
  { label: 'S1', in: 'GS1i', out: 'GS1o', side: 'bottom', span: [240, 300] },
  { label: 'S2', in: 'GS2i', out: 'GS2o', side: 'bottom', span: [640, 700] },
];

function buildLot() {
  const store = { x: 0, y: 0, w: W, h: 96 };
  const sidewalk = { x: 0, y: 96, w: W, h: 64 };
  const doors = { x: 232, y: 80, w: 96, h: 16 };

  // Corral sits on the sidewalk, open side facing the lot.
  const corral = { x: 400, y: 100, w: 160, h: 60 };
  const corralRails = [
    { x: corral.x, y: corral.y, w: corral.w, h: RAIL, kind: 'rail' },
    { x: corral.x, y: corral.y, w: RAIL, h: corral.h, kind: 'rail' },
    { x: corral.x + corral.w - RAIL, y: corral.y, w: RAIL, h: corral.h, kind: 'rail' },
  ];
  const returnZone = {
    x: corral.x + RAIL,
    y: corral.y + RAIL,
    w: corral.w - RAIL * 2,
    h: corral.h - RAIL,
  };
  const pad = CONFIG.corralAreaPad;
  const corralArea = { x: returnZone.x - pad, y: returnZone.y - pad, w: returnZone.w + pad * 2, h: returnZone.h + pad * 2 };

  // Parking rows: A and B are back to back, C is alone below the middle
  // aisle. `open` is the side a car drives in from; `lane` is the lane edge
  // that serves it.
  const rows = [
    { id: 'A', y: 200, open: 'up', laneY: 180, lane: ['FW', 'FE'] },
    { id: 'B', y: 264, open: 'down', laneY: 360, lane: ['ME', 'MW'] },
    { id: 'C', y: 392, open: 'up', laneY: 360, lane: ['ME', 'MW'] },
  ];
  const rowW = SPACE_W * ROW_COUNT;

  // Return bin takes two spaces in row C, open toward the aisle above it.
  // Carts nest in two lanes and slide toward the open end.
  const bin = { x: ROW_X0 + BIN_INDEX * SPACE_W, y: 392, w: SPACE_W * 2, h: SPACE_D };
  const binRails = [
    { x: bin.x, y: bin.y, w: RAIL, h: bin.h, kind: 'rail' },
    { x: bin.x + bin.w - RAIL, y: bin.y, w: RAIL, h: bin.h, kind: 'rail' },
    { x: bin.x, y: bin.y + bin.h - RAIL, w: bin.w, h: RAIL, kind: 'rail' },
  ];
  const laneW = (bin.w - RAIL * 2) / 2;
  const binLanes = [0, 1].map((i) => ({ x: bin.x + RAIL + laneW * i + (laneW - CART_SIZE) / 2 }));
  const binDepth = 4; // carts per lane
  const binSlotY = (k) => bin.y + 6 + k * 10;

  // Every parking space. A car parked in one is solid.
  const spaces = [];
  for (const row of rows) {
    for (let i = 0; i < ROW_COUNT; i++) {
      if (row.id === 'C' && (i === BIN_INDEX || i === BIN_INDEX + 1)) continue;
      const x = ROW_X0 + i * SPACE_W;
      const cx = x + SPACE_W / 2;
      const cy = row.y + SPACE_D / 2;
      spaces.push({
        id: `${row.id}${i}`, row: row.id, index: i,
        rect: { x, y: row.y, w: SPACE_W, h: SPACE_D },
        center: { x: cx, y: cy },
        aisle: { x: cx, y: row.laneY }, // where a car turns in from its lane
        lane: row.lane,
        pullAngle: row.open === 'up' ? Math.PI / 2 : -Math.PI / 2, // heading while pulling in
      });
    }
  }
  const spaceById = Object.fromEntries(spaces.map((s) => [s.id, s]));

  // Strays can also be left up on the sidewalk curb, clear of the doors and the corral.
  const curbSpots = [110, 190, 640, 760, 860].map((x) => ({ x: x - CART_SIZE / 2, y: 136, angle: 0, where: 'curb' }));

  const islands = [
    { x: ROW_X0 - 40, y: 200, w: 40, h: SPACE_D * 2, kind: 'island' },
    { x: ROW_X0 + rowW, y: 200, w: 40, h: SPACE_D * 2, kind: 'island' },
    { x: ROW_X0 - 40, y: 392, w: 40, h: SPACE_D, kind: 'island' },
    { x: ROW_X0 + rowW, y: 392, w: 40, h: SPACE_D, kind: 'island' },
  ];

  const lampPosts = [
    { x: ROW_X0 + SPACE_W * 12 - 6, y: 264 - 6, w: 12, h: 12, kind: 'lamp' },
    { x: ROW_X0 + SPACE_W * 4 - 6, y: 392 + SPACE_D / 2 - 6, w: 12, h: 12, kind: 'lamp' },
    { x: ROW_X0 + SPACE_W * 12 - 6, y: 392 + SPACE_D / 2 - 6, w: 12, h: 12, kind: 'lamp' },
  ];

  // Accessible spaces nearest the store, in row A.
  const accessibleSpaces = ['A2', 'A4'];

  // Solids that never move. Parked and moving cars are added each frame.
  const staticSolids = [
    { ...store, kind: 'store' },
    ...corralRails,
    ...binRails,
    ...islands,
    ...lampPosts,
  ];

  return {
    store, sidewalk, doors, corral, corralRails, returnZone, corralArea, rows, rowW,
    bin, binRails, binLanes, binDepth, binSlotY, spaces, spaceById, curbSpots,
    islands, lampPosts, accessibleSpaces, staticSolids,
  };
}

const LOT = buildLot();
const BIN_CAPACITY = LOT.binLanes.length * LOT.binDepth;

// Shortest path over the one-way lane graph. `extra` adds a temporary node
// (a space's turn-in point) splitting one lane edge.
function findRoute(from, to, extra) {
  const nodes = { ...LANE_NODES };
  let edges = LANE_EDGES;
  if (extra) {
    nodes[extra.id] = extra.point;
    const [u, v] = extra.lane;
    edges = edges.filter(([a, b]) => !(a === u && b === v)).concat([[u, extra.id], [extra.id, v]]);
  }
  const dist = { [from]: 0 };
  const prev = {};
  const open = new Set(Object.keys(nodes));
  while (open.size) {
    let u = null;
    for (const n of open) if (dist[n] !== undefined && (u === null || dist[n] < dist[u])) u = n;
    if (u === null || u === to) break;
    open.delete(u);
    for (const [a, b] of edges) {
      if (a !== u || !open.has(b)) continue;
      const d = dist[u] + Math.hypot(nodes[b].x - nodes[u].x, nodes[b].y - nodes[u].y);
      if (dist[b] === undefined || d < dist[b]) {
        dist[b] = d;
        prev[b] = u;
      }
    }
  }
  if (dist[to] === undefined) return null;
  const path = [];
  for (let n = to; n !== undefined; n = prev[n]) path.unshift({ x: nodes[n].x, y: nodes[n].y });
  return path;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

function makePlayer() {
  return {
    x: 471,
    y: 240,
    w: 18,
    h: 18,
    facingX: 0,
    facingY: 1,
    stamina: CONFIG.staminaMax,
    sprinting: false,
    exhausted: false,
    regenDelay: 0,
    invuln: 0,
    stun: 0,
    // Carts being pushed, nearest the player first. Each link is
    // { cartId, angle, link }: the cart's heading and its distance from the
    // anchor (the player for the first cart, the hitch of the cart ahead otherwise).
    train: [],
  };
}

function randBetween([lo, hi]) {
  return lo + Math.random() * (hi - lo);
}

// Saved between visits: best score, best combo, and the mute setting.
// localStorage can be missing or throw (private windows, blocked storage);
// the game then just plays without saving.
const STORE_KEY = 'lotRunner.v1';

function loadSaved() {
  const saved = { highScore: 0, bestComboLevel: 0, muted: false };
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE_KEY));
    if (raw && typeof raw === 'object') {
      if (Number.isFinite(raw.highScore)) saved.highScore = Math.max(0, raw.highScore);
      if (Number.isInteger(raw.bestComboLevel)) {
        saved.bestComboLevel = Math.min(Math.max(0, raw.bestComboLevel), CONFIG.comboMults.length - 1);
      }
      saved.muted = raw.muted === true;
    }
  } catch (e) {
    // Unreadable or unavailable storage: start fresh.
  }
  return saved;
}

function persist() {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(state.saved));
  } catch (e) {
    // Storage unavailable: records last for this visit only.
  }
}

const state = {
  debug: false,
  // 'title' | 'howto' | 'countdown' | 'playing' | 'paused' | 'over'
  phase: 'title',
  countdown: 0, // seconds left of "3, 2, 1" before a shift starts
  countShown: 0, // the countdown number last beeped
  goFlash: 0, // seconds left to show GO! after the countdown
  clockSecond: 0, // the whole second the shift clock last showed
  menuFocus: 0, // which menu button the keyboard has selected
  saved: loadSaved(),
  newRecord: { score: false, combo: false }, // set when a shift beats the saved bests
  touchUi: false, // show on-screen touch controls
  timeLeft: CONFIG.shiftSeconds,
  score: 0,
  docked: 0,
  combo: { level: 0, timer: 0 }, // level indexes CONFIG.comboMults; timer counts down the window
  freshPickup: false, // picked up a cart away from the corral since the last dock
  best: { train: 0, comboLevel: 0 },
  strayTimer: CONFIG.strayRespawn,
  nextCartId: 1,
  carts: [], // status: 'inBin' | 'loose' | 'train'
  parked: new Map(), // space id -> { color }
  reserved: new Set(), // space ids a moving car is heading into or backing out of
  traffic: [], // cars driving to or from spaces
  nextCarId: 1,
  arriveTimer: 0,
  departTimer: 0,
  player: makePlayer(),
  message: null, // { text, t }
};

function cartsInLane(lane) {
  return state.carts.filter((c) => c.status === 'inBin' && c.lane === lane);
}

function makeCart(kind, x, y, angle, status) {
  const cart = { id: state.nextCartId++, kind, x, y, w: CART_SIZE, h: CART_SIZE, status, angle };
  state.carts.push(cart);
  return cart;
}

function spawnCartInBin() {
  const counts = LOT.binLanes.map((_, i) => cartsInLane(i).length);
  const lane = counts[0] <= counts[1] ? 0 : 1;
  if (counts[lane] >= LOT.binDepth) return null;
  // Basket points down into the bin, handle toward the aisle.
  const cart = makeCart('standard', LOT.binLanes[lane].x, LOT.binSlotY(counts[lane]), Math.PI / 2, 'inBin');
  cart.lane = lane;
  return cart;
}

function strayCount() {
  return state.carts.filter((c) => c.kind === 'stray' && c.status !== 'train').length;
}

// An empty space is free when no car is in it or headed for it and nothing
// (cart, player, train) is standing in it.
function spaceClear(space) {
  const bodies = [state.player, ...state.carts];
  return !bodies.some((b) => overlaps(b, space.rect));
}

function spaceFree(space) {
  return !state.parked.has(space.id) && !state.reserved.has(space.id) && spaceClear(space);
}

// Where a stray can appear right now: an empty space squeezed between two
// parked cars, or the sidewalk curb. Changes as cars come and go.
function straySpotsNow() {
  const spots = [];
  for (const s of LOT.spaces) {
    if (!spaceFree(s)) continue;
    const left = LOT.spaceById[`${s.row}${s.index - 1}`];
    const right = LOT.spaceById[`${s.row}${s.index + 1}`];
    if (left && right && state.parked.has(left.id) && state.parked.has(right.id)) {
      spots.push({ x: s.center.x - CART_SIZE / 2, y: s.center.y - CART_SIZE / 2, angle: s.pullAngle, where: 'space' });
    }
  }
  return spots.concat(LOT.curbSpots);
}

// Put a stray on a random free spot away from the player. Returns null if none fits.
function spawnStray() {
  const pc = center(state.player);
  const bodies = [state.player, ...state.carts, ...vehicleBoxes()];
  const open = straySpotsNow().filter((s) => {
    const box = { x: s.x, y: s.y, w: CART_SIZE, h: CART_SIZE };
    const d = Math.hypot(s.x + CART_SIZE / 2 - pc.x, s.y + CART_SIZE / 2 - pc.y);
    return d >= CONFIG.strayMinSpawnDist && !bodies.some((b) => overlaps(b, box));
  });
  if (open.length === 0) return null;
  const spot = open[Math.floor(Math.random() * open.length)];
  // Strays are never parked neatly.
  const jitter = (Math.random() - 0.5) * (spot.where === 'curb' ? Math.PI : 0.8);
  return makeCart('stray', spot.x, spot.y, spot.angle + jitter, 'loose');
}

// Start a fresh shift.
function resetSession() {
  state.newRecord = { score: false, combo: false };
  state.timeLeft = CONFIG.shiftSeconds;
  state.score = 0;
  state.docked = 0;
  state.combo = { level: 0, timer: 0 };
  state.freshPickup = false;
  state.best = { train: 0, comboLevel: 0 };
  state.strayTimer = CONFIG.strayRespawn;
  state.nextCartId = 1;
  state.carts = [];
  state.parked = new Map();
  state.reserved = new Set();
  state.traffic = [];
  state.nextCarId = 1;
  state.arriveTimer = randBetween(CONFIG.arriveEvery);
  state.departTimer = randBetween(CONFIG.departEvery);
  state.player = makePlayer();
  state.message = null;

  // A random lot to start: fill spaces the player isn't standing in.
  const open = LOT.spaces.filter((s) => spaceClear(s));
  for (let i = 0; i < CONFIG.parkedStart && open.length; i++) {
    const s = open.splice(Math.floor(Math.random() * open.length), 1)[0];
    state.parked.set(s.id, { color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)] });
  }
  for (let i = 0; i < BIN_CAPACITY; i++) spawnCartInBin();
  for (let i = 0; i < CONFIG.strayMax; i++) spawnStray();

  // Hold everything for "3, 2, 1, GO" before the clock starts.
  setPhase('countdown');
  state.countdown = CONFIG.startCountdown;
  state.countShown = CONFIG.startCountdown + 1; // last number beeped; the first frame beeps "3"
  state.goFlash = 0;
  state.clockSecond = Math.ceil(state.timeLeft); // last whole second the clock showed
}

function showMessage(text, time = CONFIG.messageTime) {
  state.message = { text, t: time };
}

// ---------------------------------------------------------------------------
// Input. Every device goes through the same two functions: setHeld for
// things held down (move, sprint) and pressAction for one-shot actions.
// Keyboard, mouse, on-screen touch buttons and the touch stick all call them.
// ---------------------------------------------------------------------------

const held = { up: false, down: false, left: false, right: false, sprint: false };

// The last few calls with where they came from, for checking that keyboard
// and touch really drive the same actions.
const inputLog = [];
function logInput(kind, action, source) {
  inputLog.push({ kind, action, source });
  if (inputLog.length > 200) inputLog.shift();
}

const KEY_TO_HELD_ACTION = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
};

// Keys that work in every phase.
const KEY_TO_GLOBAL_ACTION = {
  Escape: 'escape',
  KeyH: 'toggleDebug',
  KeyM: 'toggleMute',
  KeyR: 'restart',
};

// Keys during a shift.
const KEY_TO_PLAY_ACTION = {
  Space: 'interact',
  KeyE: 'interact',
  KeyQ: 'dropLast',
};

// Keys on the title, how-to, pause and end screens.
const KEY_TO_MENU_ACTION = {
  ArrowUp: 'menuPrev', KeyW: 'menuPrev', ArrowLeft: 'menuPrev', KeyA: 'menuPrev',
  ArrowDown: 'menuNext', KeyS: 'menuNext', ArrowRight: 'menuNext', KeyD: 'menuNext',
  Enter: 'menuSelect', Space: 'menuSelect', KeyE: 'menuSelect',
};

function setHeld(action, isDown, source = 'keyboard') {
  if (!(action in held)) return;
  if (held[action] !== isDown) logInput('hold', `${action}:${isDown ? 'down' : 'up'}`, source);
  held[action] = isDown;
}

function releaseAll() {
  for (const k in held) held[k] = false;
}

function setPhase(phase) {
  state.phase = phase;
  state.menuFocus = 0;
  releaseAll();
}

function pressAction(action, source = 'keyboard') {
  logInput('press', action, source);
  const phase = state.phase;

  // Available everywhere
  if (action === 'toggleDebug') {
    state.debug = !state.debug;
    return;
  }
  if (action === 'toggleMute') {
    state.saved.muted = !state.saved.muted;
    persist();
    sfx.applyMute();
    return;
  }

  // Screen changes
  if (action === 'play' || (action === 'restart' && phase !== 'title' && phase !== 'howto')) {
    resetSession();
    return;
  }
  if (action === 'howto' && phase === 'title') return setPhase('howto');
  if (action === 'title') return setPhase('title');
  if (action === 'pause' && phase === 'playing') return setPhase('paused');
  if (action === 'resume' && phase === 'paused') return setPhase('playing');
  if (action === 'escape') {
    if (phase === 'playing') setPhase('paused');
    else if (phase === 'paused') setPhase('playing');
    else if (phase === 'howto') setPhase('title');
    return;
  }

  // Menu navigation
  const buttons = menuButtons();
  if (action === 'menuPrev' || action === 'menuNext') {
    if (buttons.length) {
      const step = action === 'menuNext' ? 1 : -1;
      state.menuFocus = (state.menuFocus + step + buttons.length) % buttons.length;
    }
    return;
  }
  if (action === 'menuSelect') {
    const b = buttons[state.menuFocus];
    if (b) pressAction(b.action, source);
    return;
  }

  // Play
  if (phase !== 'playing') return;
  if (action === 'interact') interact();
  else if (action === 'dropLast') dropLast();
}

// Buttons on the current menu screen, in logical canvas units. Used to draw
// them, to hit-test taps and clicks, and for keyboard focus.
function menuButtons() {
  const bw = 240, bh = 52, bx = (W - bw) / 2;
  switch (state.phase) {
    case 'title':
      return [
        { label: 'Play', action: 'play', x: bx, y: 262, w: bw, h: bh },
        { label: 'How to Play', action: 'howto', x: bx, y: 328, w: bw, h: bh },
      ];
    case 'howto':
      return [{ label: 'Back', action: 'title', x: bx, y: 440, w: bw, h: bh }];
    case 'paused':
      return [
        { label: 'Resume', action: 'resume', x: bx, y: 206, w: bw, h: bh },
        { label: 'Restart shift', action: 'restart', x: bx, y: 272, w: bw, h: bh },
        { label: 'Quit to title', action: 'title', x: bx, y: 338, w: bw, h: bh },
      ];
    case 'over':
      return [
        { label: 'Play again', action: 'play', x: W / 2 - 166, y: 412, w: 160, h: 46 },
        { label: 'Title', action: 'title', x: W / 2 + 6, y: 412, w: 160, h: 46 },
      ];
    default:
      return [];
  }
}

// Small icon buttons on the HUD: pause during a shift, mute everywhere.
function hudButtons() {
  const out = [];
  if (state.phase === 'playing') out.push({ icon: 'pause', action: 'pause', x: 700, y: 12, w: 38, h: 30 });
  out.push({ icon: state.saved.muted ? 'muted' : 'sound', action: 'toggleMute', x: 744, y: 12, w: 38, h: 30 });
  return out;
}

window.addEventListener('keydown', (e) => {
  sfx.unlock();
  const code = e.code;

  const globalAction = KEY_TO_GLOBAL_ACTION[code];
  if (globalAction) {
    if (!e.repeat) pressAction(globalAction);
    e.preventDefault();
    return;
  }

  // Movement keys can already be held during the countdown so you're off at GO.
  if (state.phase === 'playing' || state.phase === 'countdown') {
    const heldAction = KEY_TO_HELD_ACTION[code];
    if (heldAction) {
      setHeld(heldAction, true);
      e.preventDefault();
      return;
    }
    const playAction = KEY_TO_PLAY_ACTION[code];
    if (playAction) {
      if (!e.repeat) pressAction(playAction);
      e.preventDefault();
    }
    return;
  }

  const menuAction = KEY_TO_MENU_ACTION[code];
  if (menuAction) {
    if (!e.repeat) pressAction(menuAction);
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  const heldAction = KEY_TO_HELD_ACTION[e.code];
  if (heldAction) setHeld(heldAction, false);
});

// Avoid stuck keys when the window loses focus, and pause a running shift
// when the tab is hidden (a phone locking, switching apps).
window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.phase === 'playing') setPhase('paused');
});

// Taps and clicks on the canvas: menu buttons and HUD icons.
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

function onCanvasPointer(e) {
  sfx.unlock();
  if (e.pointerType === 'touch') enableTouchUi();
  const pt = canvasPoint(e);
  const hit = [...menuButtons(), ...hudButtons()].find((b) => pointIn(pt, b));
  if (hit) {
    e.preventDefault();
    pressAction(hit.action, e.pointerType === 'touch' ? 'touch' : 'mouse');
  }
}

// On-screen touch controls (see index.html). The stick maps to the same
// eight directions as WASD by holding up/down/left/right.
function enableTouchUi() {
  if (state.touchUi) return;
  state.touchUi = true;
  document.body.classList.add('touch-ui');
}

function setupTouchControls() {
  const stick = document.getElementById('stick');
  const knob = stick.querySelector('.knob');
  let stickPointer = null;

  const moveStick = (e) => {
    const r = stick.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = e.clientX - (r.left + radius);
    let dy = e.clientY - (r.top + radius);
    const len = Math.hypot(dx, dy);
    if (len > radius) {
      dx = (dx / len) * radius;
      dy = (dy / len) * radius;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const nx = dx / radius;
    const ny = dy / radius;
    const dead = Math.hypot(nx, ny) < 0.25;
    const t = 0.38; // about 22 degrees either side of a diagonal
    setHeld('right', !dead && nx > t, 'touch');
    setHeld('left', !dead && nx < -t, 'touch');
    setHeld('down', !dead && ny > t, 'touch');
    setHeld('up', !dead && ny < -t, 'touch');
  };
  const endStick = () => {
    stickPointer = null;
    knob.style.transform = '';
    for (const d of ['up', 'down', 'left', 'right']) setHeld(d, false, 'touch');
  };

  // Keep receiving a finger's moves after it slides off the control. Capture
  // can fail for a pointer that has already ended; the control still works.
  const capture = (el, id) => {
    try {
      el.setPointerCapture(id);
    } catch (err) {
      // no capture: fine
    }
  };

  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sfx.unlock();
    stickPointer = e.pointerId;
    capture(stick, e.pointerId);
    moveStick(e);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickPointer) moveStick(e);
  });
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  for (const btn of document.querySelectorAll('#touch .tbtn')) {
    const holdAction = btn.dataset.hold;
    const pressName = btn.dataset.press;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sfx.unlock();
      capture(btn, e.pointerId);
      btn.classList.add('active');
      if (holdAction) setHeld(holdAction, true, 'touch');
      if (pressName) pressAction(pressName, 'touch');
    });
    const release = () => {
      btn.classList.remove('active');
      if (holdAction) setHeld(holdAction, false, 'touch');
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
  }
}

// ---------------------------------------------------------------------------
// Sound: tiny Web Audio synth, no audio files. The context starts on the
// first key press or tap, since browsers block sound before that.
// ---------------------------------------------------------------------------

const sfx = (() => {
  let ac = null;
  let master = null;
  const played = []; // names of recent sounds, for testing

  function unlock() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.connect(ac.destination);
      applyMute();
    }
    if (ac.state === 'suspended') ac.resume();
  }

  function applyMute() {
    if (master) master.gain.value = state.saved.muted ? 0 : 0.5;
  }

  // One oscillator with a quick attack and exponential fade.
  function tone(type, freq, start, dur, gain, freqEnd) {
    const t0 = ac.currentTime + start;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // A short burst of filtered noise, for metal rattle.
  function noise(start, dur, gain, freq) {
    const t0 = ac.currentTime + start;
    const len = Math.ceil(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 3;
    const g = ac.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
  }

  function play(name, fn) {
    played.push(name);
    if (played.length > 50) played.shift();
    if (!ac || state.saved.muted) return;
    fn();
  }

  return {
    unlock,
    applyMute,
    played,
    contextState: () => (ac ? ac.state : 'not started'),
    // Cart latch: two detuned metal pings over a rattle.
    clank: () => play('clank', () => {
      noise(0, 0.09, 0.5, 2400);
      tone('square', 520, 0, 0.08, 0.12, 380);
      tone('square', 780, 0.015, 0.07, 0.08, 600);
    }),
    // Dock: a rising two-note beep, pitched up with the combo.
    dock: (level) => play('dock', () => {
      const base = 660 * (1 + level * 0.12);
      tone('sine', base, 0, 0.12, 0.3);
      tone('sine', base * 1.5, 0.11, 0.18, 0.3);
    }),
    // Car horn: two flat buzzy notes together.
    honk: () => play('honk', () => {
      tone('sawtooth', 392, 0, 0.35, 0.12);
      tone('sawtooth', 494, 0, 0.35, 0.1);
    }),
    // Start countdown: a short beep for 3, 2, 1 and a higher, longer one for GO.
    countBeep: () => play('countBeep', () => tone('sine', 523, 0, 0.16, 0.3)),
    go: () => play('go', () => {
      tone('sine', 1047, 0, 0.4, 0.3);
      tone('square', 523, 0, 0.25, 0.06);
    }),
    // Entering the final stretch: a quick two-tone alarm.
    finalWarning: () => play('finalWarning', () => {
      tone('triangle', 880, 0, 0.12, 0.3);
      tone('triangle', 660, 0.14, 0.12, 0.3);
      tone('triangle', 880, 0.28, 0.12, 0.3);
      tone('triangle', 660, 0.42, 0.16, 0.3);
    }),
    // A clock tick each second after that, sharper in the last five.
    tick: (urgent) => play(urgent ? 'tickUrgent' : 'tick', () => {
      tone('square', urgent ? 1320 : 880, 0, urgent ? 0.07 : 0.04, urgent ? 0.14 : 0.08);
    }),
    // Shift over: three falling notes.
    shiftOver: () => play('shiftOver', () => {
      tone('triangle', 659, 0, 0.26, 0.3);
      tone('triangle', 523, 0.24, 0.26, 0.3);
      tone('triangle', 392, 0.48, 0.5, 0.3);
    }),
  };
})();

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

// Boxes that merely touch (within float rounding) do not overlap.
const EPS = 1e-6;
function overlaps(a, b) {
  return a.x < b.x + b.w - EPS && a.x + a.w > b.x + EPS && a.y < b.y + b.h - EPS && a.y + a.h > b.y + EPS;
}

function center(b) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// A vehicle's axis-aligned box from its center and heading.
function vehicleBox(v, cx = v.cx, cy = v.cy, angle = v.angle) {
  const horizontal = Math.abs(Math.cos(angle)) > 0.5;
  const w = horizontal ? CONFIG.carLength : CONFIG.carWidth;
  const h = horizontal ? CONFIG.carWidth : CONFIG.carLength;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function parkedBox(space) {
  return vehicleBox(null, space.center.x, space.center.y, space.pullAngle);
}

function movingVehicles() {
  return state.traffic;
}

function vehicleBoxes() {
  return movingVehicles().map((v) => vehicleBox(v));
}

// Everything solid in the lot right now: the fixed solids plus parked cars.
function worldSolids() {
  const parked = [];
  for (const id of state.parked.keys()) parked.push({ ...parkedBox(LOT.spaceById[id]), kind: 'car' });
  return LOT.staticSolids.concat(parked);
}

function hitsWorld(b, blockers = worldSolids()) {
  if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) return true;
  return blockers.some((s) => overlaps(b, s));
}

// Everything that blocks these moving bodies: the lot's solids, parked and
// moving cars, and free carts. Anything the bodies already overlap (a cart
// just dropped off the nose, say) is ignored so it can't snag them; it
// blocks again once clear.
function blockersFor(bodies) {
  const free = state.carts.filter((c) => c.status !== 'train');
  const others = free.concat(vehicleBoxes()).filter((o) => !bodies.some((b) => overlaps(b, o)));
  return worldSolids().concat(others);
}

function cartById(id) {
  return state.carts.find((c) => c.id === id);
}

function trainCarts() {
  return state.player.train.map((l) => cartById(l.cartId));
}

function trainSpeedMult(n) {
  return CONFIG.trainSpeedBase - CONFIG.trainSpeedPerCart * (n - 1);
}

function turnRadius(n) {
  return CONFIG.turnRadiusBase + CONFIG.turnRadiusPerCart * (n - 1);
}

function trainBonus(n) {
  return 1 + CONFIG.trainBonusPerCart * (n - 1);
}

function comboMult() {
  return CONFIG.comboMults[state.combo.level];
}

// Whole-number percent of par, so 89.6% reads and grades as 89%, not a
// rounded-up A. It can go past 100.
function scorePercent(score) {
  return Math.floor((score / CONFIG.parScore) * 100);
}

function gradeFor(score) {
  const pct = scorePercent(score);
  return CONFIG.grades.find((g) => pct >= g.min).grade;
}

// Cart centers for a train, walking out from the player: each cart hangs off
// the hitch at the nose of the cart ahead of it.
function layoutTrain(p, links) {
  const out = [];
  let anchor = center(p);
  for (const l of links) {
    const c = {
      x: anchor.x + Math.cos(l.angle) * l.link,
      y: anchor.y + Math.sin(l.angle) * l.link,
    };
    out.push(c);
    anchor = { x: c.x + Math.cos(l.angle) * CONFIG.hitch, y: c.y + Math.sin(l.angle) * CONFIG.hitch };
  }
  return out;
}

function boxAt(c) {
  return { x: c.x - CART_SIZE / 2, y: c.y - CART_SIZE / 2, w: CART_SIZE, h: CART_SIZE };
}

function applyTrainLayout(p) {
  const centers = layoutTrain(p, p.train);
  p.train.forEach((l, i) => {
    const cart = cartById(l.cartId);
    const b = boxAt(centers[i]);
    cart.x = b.x;
    cart.y = b.y;
    cart.angle = l.angle;
  });
}

// Where the next cart would latch on: the hitch at the nose of the train.
function trainHitch(p) {
  const last = p.train[p.train.length - 1];
  const c = center(cartById(last.cartId));
  return {
    x: c.x + Math.cos(last.angle) * CONFIG.hitch,
    y: c.y + Math.sin(last.angle) * CONFIG.hitch,
  };
}

// With `ahead`, only carts in front of `from` along that heading count, so a
// latched cart always lines up nose to tail instead of folding back.
function nearestFreeCart(from, range, ahead = null) {
  let best = null;
  let bestDist = range;
  for (const cart of state.carts) {
    if (cart.status === 'train') continue;
    const cc = center(cart);
    if (ahead !== null) {
      const off = Math.abs(wrapAngle(Math.atan2(cc.y - from.y, cc.x - from.x) - ahead));
      if (off > CONFIG.latchCone) continue;
    }
    const d = Math.hypot(cc.x - from.x, cc.y - from.y);
    if (d <= bestDist) {
      best = cart;
      bestDist = d;
    }
  }
  return best;
}

function pointIn(pt, r) {
  return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
}

function cartInReturnZone(cart) {
  return pointIn(center(cart), LOT.returnZone);
}

// Take a free cart into the train. It stays where it is and settles into
// its nested spot over the next few frames.
function attachCart(cart, anchor) {
  const p = state.player;
  const cc = center(cart);
  p.train.push({
    cartId: cart.id,
    angle: Math.atan2(cc.y - anchor.y, cc.x - anchor.x),
    link: Math.hypot(cc.x - anchor.x, cc.y - anchor.y),
  });
  cart.status = 'train';
  delete cart.lane;
  if (!pointIn(cc, LOT.corralArea)) state.freshPickup = true;
  state.best.train = Math.max(state.best.train, p.train.length);
  sfx.clank();
}

function interact() {
  const p = state.player;
  if (p.stun > 0) return;

  if (p.train.length === 0) {
    const target = nearestFreeCart(center(p), CONFIG.grabRange);
    if (target) attachCart(target, center(p));
    else showMessage('No cart in reach');
    return;
  }

  const carts = trainCarts();
  const nose = carts[carts.length - 1];
  if (cartInReturnZone(nose)) {
    dockTrain();
    return;
  }

  const last = p.train[p.train.length - 1];
  const hitch = trainHitch(p);
  const target = nearestFreeCart(hitch, CONFIG.latchRange, last.angle);
  if (target) {
    if (p.train.length >= CONFIG.maxTrain) showMessage("Train's full", 0.9);
    else attachCart(target, hitch);
    return;
  }

  showMessage('Push the front cart into the corral to dock');
}

function dropLast() {
  const p = state.player;
  const last = p.train.pop();
  if (!last) return;
  cartById(last.cartId).status = 'loose';
}

function breakCombo() {
  state.combo.level = 0;
  state.combo.timer = 0;
}

// Score only happens here: (sum of cart values) x train bonus x combo.
// The combo climbs one step only when this dock lands inside the window AND
// a cart was picked up away from the corral since the last dock. A dock of
// carts that were already in hand (a train split up inside the corral) keeps
// the current multiplier and doesn't extend the window.
function dockTrain() {
  const p = state.player;
  const carts = trainCarts();
  const n = carts.length;

  if (state.combo.timer === 0) {
    state.combo.level = 0;
    state.combo.timer = CONFIG.comboWindow;
  } else if (state.freshPickup) {
    state.combo.level = Math.min(state.combo.level + 1, CONFIG.comboMults.length - 1);
    state.combo.timer = CONFIG.comboWindow;
  }
  state.freshPickup = false;
  state.best.comboLevel = Math.max(state.best.comboLevel, state.combo.level);

  const base = carts.reduce((sum, c) => sum + CONFIG.cartValue[c.kind], 0);
  const bonus = trainBonus(n);
  const mult = comboMult();
  const points = Math.round(base * bonus * mult);
  const standardCount = carts.filter((c) => c.kind === 'standard').length;

  const ids = new Set(carts.map((c) => c.id));
  state.carts = state.carts.filter((c) => !ids.has(c.id));
  p.train = [];
  state.score += points;
  state.docked += n;
  const parts = [n > 1 ? `${n}-cart train x${bonus}` : '1 cart'];
  if (mult > 1) parts.push(`${mult}x combo`);
  showMessage(`+${points}  ${parts.join(', ')}`);
  sfx.dock(state.combo.level);
  // Bin carts go back to the bin; strays reappear on their own timer.
  for (let i = 0; i < standardCount; i++) spawnCartInBin();
}

// Move several boxes together, one axis at a time. If any of them runs into a
// solid or the lot edge, the whole group is pushed back by the largest overlap.
// Only overlaps this step created count, and the push-back never exceeds the
// step, so a body resting against a wall can't be flung across the lot.
function shiftAxis(bodies, axis, d, blockers) {
  if (d === 0) return;
  const size = axis === 'x' ? 'w' : 'h';
  const limit = axis === 'x' ? W : H;
  const already = bodies.map((b) => new Set(blockers.filter((s) => overlaps(b, s))));
  for (const b of bodies) b[axis] += d;

  let fix = 0;
  bodies.forEach((b, i) => {
    for (const s of blockers) {
      if (already[i].has(s) || !overlaps(b, s)) continue;
      const c = d > 0 ? s[axis] - (b[axis] + b[size]) : s[axis] + s[size] - b[axis];
      if (Math.abs(c) > Math.abs(fix)) fix = c;
    }
    const edge = d > 0 ? Math.min(0, limit - (b[axis] + b[size])) : Math.max(0, -b[axis]);
    if (Math.abs(edge) > Math.abs(fix)) fix = edge;
  });
  if (Math.abs(fix) > Math.abs(d)) fix = -d;
  for (const b of bodies) b[axis] += fix;
}

function moveGroup(bodies, dx, dy) {
  const blockers = blockersFor(bodies);
  shiftAxis(bodies, 'x', dx, blockers);
  shiftAxis(bodies, 'y', dy, blockers);
}

function updateStamina(p, moving, dt) {
  if (p.exhausted && p.stamina >= CONFIG.staminaMinToSprint) p.exhausted = false;
  p.sprinting = held.sprint && moving && !p.exhausted && p.stamina > 0;

  if (p.sprinting) {
    p.stamina = Math.max(0, p.stamina - CONFIG.staminaDrain * dt);
    p.regenDelay = CONFIG.staminaRegenDelay;
    if (p.stamina === 0) p.exhausted = true;
  } else if (p.regenDelay > 0) {
    p.regenDelay = Math.max(0, p.regenDelay - dt);
  } else {
    p.stamina = Math.min(CONFIG.staminaMax, p.stamina + CONFIG.staminaRegen * dt);
  }
}

// Pushing a train handles like a vehicle: input steers the heading of the
// cart nearest the player along an arc whose radius grows with train length,
// and each cart further out only swings toward the cart behind it as the
// train actually travels, so turns ripple down the line with a lag.
function updateTrain(p, input, baseSpeed, dt) {
  const n = p.train.length;
  const speed = baseSpeed * trainSpeedMult(n);
  const first = p.train[0];

  let travel = 0;
  let steer = 0;
  let dir = 1; // 1 forward (push), -1 reverse (pull back)
  if (input) {
    const diff = wrapAngle(Math.atan2(input.y, input.x) - first.angle);
    if (Math.abs(diff) > CONFIG.reverseAngle) {
      dir = -1;
      travel = speed * CONFIG.reverseMult * dt;
    } else {
      // Sharp steering scrubs speed.
      travel = speed * (0.5 + 0.5 * Math.max(0, Math.cos(diff))) * dt;
      const maxTurn = travel / turnRadius(n);
      steer = Math.max(-maxTurn, Math.min(maxTurn, diff));
    }
  }

  // Propose new headings and link lengths, keep them only if no cart ends up in a wall.
  const settle = Math.min(1, CONFIG.linkSettleRate * dt);
  const follow = 1 - Math.exp(-travel / CONFIG.trailerLag);
  const proposal = p.train.map((l) => ({ ...l }));
  proposal[0].angle = wrapAngle(proposal[0].angle + steer);
  proposal.forEach((l, i) => {
    if (i > 0) l.angle = wrapAngle(l.angle + wrapAngle(proposal[i - 1].angle - l.angle) * follow);
    const target = i === 0 ? CONFIG.cartAttachDist : CONFIG.hitch;
    l.link += (target - l.link) * settle;
  });
  const blockers = blockersFor([p, ...trainCarts()]);
  if (!layoutTrain(p, proposal).some((c) => hitsWorld(boxAt(c), blockers))) p.train = proposal;
  applyTrainLayout(p);

  const heading = p.train[0].angle;
  const carts = trainCarts();
  moveGroup([p, ...carts], Math.cos(heading) * travel * dir, Math.sin(heading) * travel * dir);

  p.facingX = Math.cos(heading);
  p.facingY = Math.sin(heading);
}

function updatePlayer(dt) {
  const p = state.player;
  p.invuln = Math.max(0, p.invuln - dt);
  p.stun = Math.max(0, p.stun - dt);

  let dx = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  let dy = (held.down ? 1 : 0) - (held.up ? 1 : 0);
  if (p.stun > 0) dx = dy = 0;
  const moving = dx !== 0 || dy !== 0;
  if (moving) {
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
  }

  updateStamina(p, moving, dt);
  const speed = p.sprinting ? CONFIG.sprintSpeed : CONFIG.walkSpeed;

  if (p.train.length > 0) {
    updateTrain(p, moving ? { x: dx, y: dy } : null, speed, dt);
    return;
  }

  if (moving) {
    p.facingX = dx;
    p.facingY = dy;
  }
  moveGroup([p], dx * speed * dt, dy * speed * dt);
}

// Carts in the bin slide toward the open end to fill any gap, but stop
// rather than slide into the player or the train.
function updateBin(dt) {
  const movers = [state.player, ...trainCarts()];
  LOT.binLanes.forEach((lane, i) => {
    const carts = cartsInLane(i).sort((a, b) => a.y - b.y);
    carts.forEach((cart, k) => {
      const ty = LOT.binSlotY(k);
      const step = CONFIG.binCartSpeed * dt;
      const ny = cart.y > ty ? Math.max(ty, cart.y - step) : Math.min(ty, cart.y + step);
      const next = { x: lane.x, y: ny, w: cart.w, h: cart.h };
      if (movers.some((m) => overlaps(m, next) && !overlaps(m, cart))) return;
      cart.x = next.x;
      cart.y = next.y;
    });
  });
}

// ---------------------------------------------------------------------------
// Vehicles: traffic pulling in and out of spaces
// ---------------------------------------------------------------------------

// A car that heads in from an entrance, drives to a free space and parks.
function spawnArrival() {
  const moving = state.traffic.length;
  const taken = state.parked.size + state.reserved.size;
  if (moving >= CONFIG.trafficMaxMoving || taken >= CONFIG.parkedMax) return null;
  const free = LOT.spaces.filter(spaceFree);
  if (free.length === 0) return null;
  const space = free[Math.floor(Math.random() * free.length)];
  const gate = GATES[Math.floor(Math.random() * GATES.length)];
  const path = findRoute(gate.in, 'SPOT', { id: 'SPOT', point: space.aisle, lane: space.lane });
  if (!path) return null;
  state.reserved.add(space.id);
  const car = {
    id: state.nextCarId++, kind: 'traffic', mode: 'toSpot', space: space.id,
    path, idx: 1, cx: path[0].x, cy: path[0].y, angle: 0, reverse: false,
    color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)], wait: 0, moved: false,
  };
  car.angle = Math.atan2(path[1].y - path[0].y, path[1].x - path[0].x);
  state.traffic.push(car);
  return car;
}

// A parked car backs out and drives off to a random entrance.
function spawnDeparture() {
  if (state.traffic.length >= CONFIG.trafficMaxMoving || state.parked.size <= CONFIG.parkedMin) return null;
  const ids = [...state.parked.keys()];
  const id = ids[Math.floor(Math.random() * ids.length)];
  const space = LOT.spaceById[id];
  const { color } = state.parked.get(id);
  state.parked.delete(id);
  state.reserved.add(id);
  const car = {
    id: state.nextCarId++, kind: 'traffic', mode: 'backOut', space: id,
    path: null, idx: 0, cx: space.center.x, cy: space.center.y, angle: space.pullAngle, reverse: true,
    color, wait: 0, moved: false,
  };
  state.traffic.push(car);
  return car;
}

function routeToExit(car, space) {
  const gate = GATES[Math.floor(Math.random() * GATES.length)];
  car.path = findRoute('SPOT', gate.out, { id: 'SPOT', point: space.aisle, lane: space.lane });
  car.idx = 1;
  car.mode = 'toExit';
  car.reverse = false;
  state.reserved.delete(space.id);
}

// Where this car wants to move next, or null if it's parked in place this frame.
function trafficTarget(car) {
  const space = LOT.spaceById[car.space];
  if (car.mode === 'toSpot' || car.mode === 'toExit') return car.path[car.idx];
  if (car.mode === 'pullIn') return space.center;
  if (car.mode === 'backOut') return space.aisle;
  return null;
}

function trafficSpeed(car) {
  return car.mode === 'pullIn' || car.mode === 'backOut' ? CONFIG.parkingSpeed : CONFIG.trafficSpeed;
}

// Direction the car body is actually traveling (reverse when backing out).
function motionAngle(v) {
  return v.reverse ? v.angle + Math.PI : v.angle;
}

function wantsToMove(v) {
  return trafficTarget(v) !== null;
}

// Cars already driving a lane have right of way over cars pulling in or
// backing out of a space.
function rightOfWay(v) {
  return v.mode === 'toSpot' || v.mode === 'toExit' ? 0 : 1;
}

// Each car looks a little way ahead along its direction of travel. It waits
// if another car is there, unless that car is also waiting on it, in which
// case right of way decides, then the lower id. Cars never wait for the
// player: standing in a lane is how you get hit.
function yieldingCars() {
  const vehicles = movingVehicles();
  const probes = new Map();
  for (const v of vehicles) {
    if (!wantsToMove(v)) continue;
    const a = motionAngle(v);
    probes.set(v, vehicleBox(v, v.cx + Math.cos(a) * CONFIG.yieldProbe, v.cy + Math.sin(a) * CONFIG.yieldProbe));
  }
  const sees = new Map();
  for (const [v, probe] of probes) {
    sees.set(v, vehicles.filter((o) => o !== v && overlaps(probe, vehicleBox(o))));
  }
  const blocked = new Set();
  for (const [v, list] of sees) {
    for (const o of list) {
      const mutual = (sees.get(o) || []).includes(v);
      const outranked = rightOfWay(v) > rightOfWay(o) || (rightOfWay(v) === rightOfWay(o) && v.id > o.id);
      if (!mutual || outranked) blocked.add(v);
    }
  }
  return blocked;
}

function stepToward(v, target, speed, dt) {
  const dx = target.x - v.cx;
  const dy = target.y - v.cy;
  const d = Math.hypot(dx, dy);
  const step = speed * dt;
  if (d <= step) {
    v.cx = target.x;
    v.cy = target.y;
    return true;
  }
  v.cx += (dx / d) * step;
  v.cy += (dy / d) * step;
  return false;
}

function updateTrafficCar(car, dt, blocked) {
  const space = LOT.spaceById[car.space];
  car.moved = false;

  if (car.mode === 'waitSpot') {
    car.wait += dt;
    if (spaceClear(space)) {
      car.mode = 'pullIn';
      car.angle = space.pullAngle;
    } else if (car.wait >= CONFIG.spotWaitMax) {
      routeToExit(car, space);
    }
    return;
  }
  if (blocked) return;

  const target = trafficTarget(car);
  if (car.mode === 'toSpot' || car.mode === 'toExit') {
    car.angle = Math.atan2(target.y - car.cy, target.x - car.cx);
  }
  const arrived = stepToward(car, target, trafficSpeed(car), dt);
  car.moved = true;
  if (!arrived) return;

  if (car.mode === 'toSpot' || car.mode === 'toExit') {
    car.idx += 1;
    if (car.idx < car.path.length) return;
    if (car.mode === 'toExit') {
      car.gone = true;
    } else {
      car.mode = 'waitSpot';
      car.wait = 0;
    }
  } else if (car.mode === 'pullIn') {
    state.parked.set(space.id, { color: car.color });
    state.reserved.delete(space.id);
    car.gone = true;
  } else if (car.mode === 'backOut') {
    routeToExit(car, space);
  }
}

// Shove a body sideways out of a car's path, respecting walls.
function knockAside(body, car) {
  const bc = center(body);
  const box = vehicleBox(car);
  const a = motionAngle(car);
  const sideX = -Math.sin(a);
  const sideY = Math.cos(a);
  const side = (bc.x - car.cx) * sideX + (bc.y - car.cy) * sideY >= 0 ? 1 : -1;
  const push = Math.max(box.w, box.h) / 2 + 12;
  for (let i = 0; i < 8 && overlaps(body, box); i++) {
    moveGroup([body], (sideX * side * push) / 4, (sideY * side * push) / 4);
  }
}

function hitByCar(car) {
  const p = state.player;
  const box = vehicleBox(car);
  const dropped = trainCarts();
  for (const cart of dropped) cart.status = 'loose';
  p.train = [];
  for (const cart of dropped) if (overlaps(cart, box)) knockAside(cart, car);
  knockAside(p, car);

  p.invuln = CONFIG.hitInvuln;
  p.stun = CONFIG.hitStun;
  state.timeLeft = Math.max(0, state.timeLeft - CONFIG.carHitTimePenalty);
  breakCombo();
  sfx.honk();
  showMessage(`Hit by a car!  -${CONFIG.carHitTimePenalty}s${dropped.length ? `, dropped ${dropped.length}` : ''}`);
}

function updateVehicles(dt) {
  const blocked = yieldingCars();
  for (const car of state.traffic) updateTrafficCar(car, dt, blocked.has(car));
  state.traffic = state.traffic.filter((c) => !c.gone);

  // Moving cars nudge loose carts out of the way and hit the player or train.
  const p = state.player;
  for (const v of movingVehicles()) {
    if (!v.moved) continue;
    const box = vehicleBox(v);
    for (const cart of state.carts) {
      if (cart.status === 'loose' && overlaps(cart, box)) knockAside(cart, v);
    }
    if (p.invuln > 0) continue;
    if (overlaps(box, p) || trainCarts().some((c) => overlaps(box, c))) hitByCar(v);
  }

  state.arriveTimer -= dt;
  if (state.arriveTimer <= 0) {
    spawnArrival();
    state.arriveTimer = randBetween(CONFIG.arriveEvery);
  }
  state.departTimer -= dt;
  if (state.departTimer <= 0) {
    spawnDeparture();
    state.departTimer = randBetween(CONFIG.departEvery);
  }
}

// ---------------------------------------------------------------------------
// Shift
// ---------------------------------------------------------------------------

function updateStrays(dt) {
  if (strayCount() >= CONFIG.strayMax) {
    state.strayTimer = CONFIG.strayRespawn;
    return;
  }
  state.strayTimer -= dt;
  if (state.strayTimer <= 0) {
    spawnStray();
    state.strayTimer = CONFIG.strayRespawn;
  }
}

function updateShift(dt) {
  if (state.combo.timer > 0) {
    state.combo.timer = Math.max(0, state.combo.timer - dt);
    if (state.combo.timer === 0) breakCombo();
  }
  state.timeLeft = Math.max(0, state.timeLeft - dt);
  updateClockSounds();
  if (state.timeLeft === 0) endShift();
}

// Sound each time the clock shows a new whole second inside the final
// stretch: an alarm on entering it, then a tick per second. Also catches the
// clock jumping past seconds when a car hit takes time off.
function updateClockSounds() {
  const sec = Math.ceil(state.timeLeft);
  if (sec >= state.clockSecond) return;
  const entered = state.clockSecond > CONFIG.finalStretch && sec <= CONFIG.finalStretch;
  state.clockSecond = sec;
  if (sec === 0) return; // the shift-over tone covers 0:00
  if (entered) sfx.finalWarning();
  else if (sec <= CONFIG.finalStretch) sfx.tick(sec <= 5);
}

// "3, 2, 1" with a beep on each number, then GO starts the shift.
function updateCountdown(dt) {
  state.countdown -= dt;
  const n = Math.ceil(state.countdown);
  if (state.countdown > 0 && n < state.countShown) {
    state.countShown = n;
    sfx.countBeep();
  }
  if (state.countdown <= 0) {
    // Straight to playing without setPhase, so keys held during the countdown carry over.
    state.phase = 'playing';
    state.goFlash = 0.8;
    sfx.go();
  }
}

// Freeze play, and save the shift's score and combo if they beat the records.
function endShift() {
  setPhase('over');
  state.player.sprinting = false;
  state.message = null;
  const saved = state.saved;
  state.newRecord = {
    score: state.score > saved.highScore,
    combo: state.best.comboLevel > saved.bestComboLevel,
  };
  saved.highScore = Math.max(saved.highScore, state.score);
  saved.bestComboLevel = Math.max(saved.bestComboLevel, state.best.comboLevel);
  persist();
  sfx.shiftOver();
}

function update(dt) {
  if (state.message) {
    state.message.t -= dt;
    if (state.message.t <= 0) state.message = null;
  }
  if (state.phase === 'countdown') {
    updateCountdown(dt);
    return;
  }
  if (state.phase !== 'playing') return;
  state.goFlash = Math.max(0, state.goFlash - dt);
  updatePlayer(dt);
  updateVehicles(dt);
  updateBin(dt);
  updateStrays(dt);
  updateShift(dt);
}

// Build a lot to show behind the title screen; Play starts a fresh shift.
resetSession();
setPhase('title');
state.countdown = 0;

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let viewScale = 1;

canvas.addEventListener('pointerdown', onCanvasPointer);
setupTouchControls();
// Touch controls on phones and tablets; any touch also turns them on.
// ?touch=1 forces them for testing with a mouse.
if (window.matchMedia('(pointer: coarse)').matches || new URLSearchParams(window.location.search).get('touch') === '1') {
  enableTouchUi();
}
window.addEventListener('touchstart', enableTouchUi, { passive: true });

function resize() {
  viewScale = Math.min(window.innerWidth / W, window.innerHeight / H);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${Math.floor(W * viewScale)}px`;
  canvas.style.height = `${Math.floor(H * viewScale)}px`;
  canvas.width = Math.floor(W * viewScale * dpr);
  canvas.height = Math.floor(H * viewScale * dpr);
  ctx.setTransform(viewScale * dpr, 0, 0, viewScale * dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const COLORS = {
  asphalt: '#3a3d42',
  sidewalk: '#9a978f',
  storeWall: '#b5563f',
  storeRoof: '#7d3a2a',
  doors: '#9fd3e6',
  paint: '#e8e6df',
  fireLane: '#c9423a',
  corralFloor: '#e3b43c',
  binFloor: '#56595e',
  rail: '#2b2b2b',
  island: '#4f7d3b',
  curb: '#c8c4b8',
  lamp: '#1e1e1e',
  accessible: '#2f6fb3',
  gate: '#ffd23f',
  cart: '#c9ced6',
  cartOutline: '#4a4f57',
  cartHandle: '#d8342c',
  strayTag: '#ffd23f',
  player: '#ff8a1f',
  playerOutline: '#1a1a1a',
  hudBg: 'rgba(0, 0, 0, 0.55)',
  hudText: '#f2f2f2',
  hudWarn: '#ff6b57',
  hudGold: '#ffd23f',
  stamina: '#5fd068',
  staminaLow: '#e0593f',
};

function fillRect(r, color) {
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

function drawStore() {
  const { store, doors } = LOT;
  fillRect(store, COLORS.storeWall);
  fillRect({ x: 0, y: 0, w: W, h: 18 }, COLORS.storeRoof);

  // Sign
  ctx.fillStyle = '#f6efe0';
  ctx.fillRect(W / 2 - 110, 26, 220, 34);
  ctx.fillStyle = COLORS.storeRoof;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GROCERY', W / 2, 44);

  // Windows
  ctx.fillStyle = 'rgba(159, 211, 230, 0.6)';
  for (let x = 40; x < W - 40; x += 120) {
    if (x + 80 > doors.x && x < doors.x + doors.w) continue;
    if (x + 80 > W / 2 - 110 && x < W / 2 + 110) continue;
    ctx.fillRect(x, 58, 80, 18);
  }

  // Automatic doors
  fillRect(doors, COLORS.doors);
  ctx.strokeStyle = COLORS.rail;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(doors.x + doors.w / 2, doors.y);
  ctx.lineTo(doors.x + doors.w / 2, doors.y + doors.h);
  ctx.stroke();
}

function drawSidewalk() {
  fillRect(LOT.sidewalk, COLORS.sidewalk);
  // Red fire-lane curb along the lot edge
  fillRect({ x: 0, y: LOT.sidewalk.y + LOT.sidewalk.h - 4, w: W, h: 4 }, COLORS.fireLane);
}

function drawCorral() {
  const { corral, corralRails, returnZone } = LOT;

  // Hatched floor
  fillRect(returnZone, COLORS.corralFloor);
  ctx.save();
  ctx.beginPath();
  ctx.rect(returnZone.x, returnZone.y, returnZone.w, returnZone.h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 6;
  for (let x = returnZone.x - returnZone.h; x < returnZone.x + returnZone.w; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, returnZone.y + returnZone.h);
    ctx.lineTo(x + returnZone.h, returnZone.y);
    ctx.stroke();
  }
  ctx.restore();

  for (const r of corralRails) fillRect(r, COLORS.rail);

  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = corral.x + corral.w / 2;
  ctx.fillText('CART CORRAL', cx, returnZone.y + 16);
  ctx.fillText('RETURN ZONE', cx, returnZone.y + 34);
}

function drawBin() {
  const { bin, binRails } = LOT;
  fillRect(bin, COLORS.binFloor);
  // Lane divider paint
  ctx.strokeStyle = 'rgba(232, 230, 223, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bin.x + bin.w / 2, bin.y + 4);
  ctx.lineTo(bin.x + bin.w / 2, bin.y + bin.h - RAIL);
  ctx.stroke();
  for (const r of binRails) fillRect(r, COLORS.rail);
}

function drawRow(row) {
  const { rowW } = LOT;
  ctx.strokeStyle = COLORS.paint;
  ctx.lineWidth = 2;

  for (let i = 0; i <= ROW_COUNT; i++) {
    const x = ROW_X0 + i * SPACE_W;
    ctx.beginPath();
    ctx.moveTo(x, row.y);
    ctx.lineTo(x, row.y + SPACE_D);
    ctx.stroke();
  }
  // Closed end of each space, opposite the side cars pull in from
  const endY = row.open === 'up' ? row.y + SPACE_D : row.y;
  ctx.beginPath();
  ctx.moveTo(ROW_X0, endY);
  ctx.lineTo(ROW_X0 + rowW, endY);
  ctx.stroke();

  for (const id of LOT.accessibleSpaces) {
    const s = LOT.spaceById[id];
    if (s.row !== row.id) continue;
    ctx.fillStyle = COLORS.accessible;
    ctx.fillRect(s.rect.x + 3, s.rect.y + 3, SPACE_W - 6, SPACE_D - 6);
    ctx.fillStyle = COLORS.paint;
    ctx.beginPath();
    ctx.arc(s.center.x, s.center.y, 9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAisleArrows() {
  ctx.fillStyle = 'rgba(232, 230, 223, 0.55)';
  const arrow = (x, y, angle) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  // One-way lanes: east on the fire lane, west on the middle and bottom
  // aisles, south on the right edge, north on the left edge.
  for (let x = 200; x < W - 100; x += 280) {
    arrow(x, 180, 0);
    arrow(x + 80, 360, Math.PI);
    arrow(x + 40, 500, Math.PI);
  }
  arrow(28, 440, -Math.PI / 2);
  arrow(28, 270, -Math.PI / 2);
  arrow(932, 270, Math.PI / 2);
  arrow(932, 440, Math.PI / 2);
}

// Entrances: painted yellow stripes at the lot edge.
function drawGates() {
  ctx.fillStyle = COLORS.gate;
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Each entrance: a stripe across both lanes, IN and OUT labels on each.
  for (const g of GATES) {
    const inPt = LANE_NODES[g.in];
    const outPt = LANE_NODES[g.out];
    const [lo, hi] = g.span;
    if (g.side === 'bottom') {
      ctx.fillRect(lo - 22, H - 4, hi - lo + 44, 4);
      ctx.fillText('IN', inPt.x, H - 12);
      ctx.fillText('OUT', outPt.x, H - 12);
    } else {
      const x = g.side === 'left' ? 0 : W - 4;
      ctx.fillRect(x, lo - 22, 4, hi - lo + 44);
      const tx = g.side === 'left' ? 16 : W - 16;
      ctx.fillText('IN', tx, inPt.y);
      ctx.fillText('OUT', tx, outPt.y);
    }
  }
}

function drawIslandsAndLamps() {
  for (const isl of LOT.islands) {
    fillRect(isl, COLORS.curb);
    fillRect({ x: isl.x + 3, y: isl.y + 3, w: isl.w - 6, h: isl.h - 6 }, COLORS.island);
  }
  for (const lamp of LOT.lampPosts) {
    ctx.fillStyle = 'rgba(255, 240, 180, 0.12)';
    ctx.beginPath();
    ctx.arc(lamp.x + lamp.w / 2, lamp.y + lamp.h / 2, 40, 0, Math.PI * 2);
    ctx.fill();
    fillRect(lamp, COLORS.lamp);
  }
}

// Car drawn in its own frame: +x is the nose.
function drawVehicle(cx, cy, angle, color, lights) {
  const L = CONFIG.carLength / 2;
  const Wd = CONFIG.carWidth / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.fillRect(-L, -Wd, L * 2, Wd * 2);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-L, -Wd, L * 2, Wd * 2);
  ctx.fillStyle = 'rgba(20, 30, 45, 0.75)';
  ctx.fillRect(L - 22, -Wd + 4, 11, Wd * 2 - 8); // windshield
  ctx.fillRect(-L + 6, -Wd + 5, 8, Wd * 2 - 10); // rear window
  if (lights) {
    ctx.fillStyle = '#fff6b0';
    ctx.fillRect(L - 3, -Wd + 2, 3, 6);
    ctx.fillRect(L - 3, Wd - 8, 3, 6);
  }
  ctx.restore();
}

function drawParkedCars() {
  for (const [id, car] of state.parked) {
    const s = LOT.spaceById[id];
    drawVehicle(s.center.x, s.center.y, s.pullAngle, car.color, false);
  }
}

function drawMovingCars() {
  for (const car of state.traffic) {
    drawVehicle(car.cx, car.cy, car.angle, car.color, true);
    // Reverse lights while backing out
    if (car.reverse) {
      ctx.save();
      ctx.translate(car.cx, car.cy);
      ctx.rotate(car.angle);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-CONFIG.carLength / 2, -CONFIG.carWidth / 2 + 2, 3, 6);
      ctx.fillRect(-CONFIG.carLength / 2, CONFIG.carWidth / 2 - 8, 3, 6);
      ctx.restore();
    }
  }
}

// Cart drawn in its own frame: +x points from the handle toward the basket nose.
function drawCart(cart) {
  const c = center(cart);
  const half = cart.w / 2;
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(cart.angle);
  ctx.fillStyle = COLORS.cart;
  ctx.strokeStyle = COLORS.cartOutline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-half + 3, -half + 1);
  ctx.lineTo(half, -half + 3);
  ctx.lineTo(half, half - 3);
  ctx.lineTo(-half + 3, half - 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Basket grid
  ctx.strokeStyle = 'rgba(74, 79, 87, 0.5)';
  ctx.lineWidth = 1;
  for (let i = -half + 8; i < half; i += 5) {
    ctx.beginPath();
    ctx.moveTo(i, -half + 3);
    ctx.lineTo(i, half - 3);
    ctx.stroke();
  }
  // Handle
  ctx.fillStyle = COLORS.cartHandle;
  ctx.fillRect(-half, -half, 3, cart.h);
  // Strays wear a yellow tag: worth double
  if (cart.kind === 'stray') {
    ctx.fillStyle = COLORS.strayTag;
    ctx.beginPath();
    ctx.arc(2, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawCarts() {
  // Bin carts from the back of the lane forward so the front one is on top.
  const free = state.carts.filter((c) => c.status !== 'train').sort((a, b) => b.y - a.y);
  for (const cart of free) drawCart(cart);
  // Train from the nose back so each cart nests over the one ahead of it.
  const train = trainCarts();
  for (let i = train.length - 1; i >= 0; i--) drawCart(train[i]);
}

function drawPlayer() {
  const p = state.player;
  // Blink while invulnerable after a hit
  if (p.invuln > 0 && Math.floor(p.invuln * 10) % 2 === 0) return;
  ctx.fillStyle = COLORS.player;
  ctx.strokeStyle = COLORS.playerOutline;
  ctx.lineWidth = 2;
  ctx.fillRect(p.x, p.y, p.w, p.h);
  ctx.strokeRect(p.x, p.y, p.w, p.h);

  // Facing indicator
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  ctx.fillStyle = COLORS.playerOutline;
  ctx.beginPath();
  ctx.arc(cx + p.facingX * 6, cy + p.facingY * 6, 3, 0, Math.PI * 2);
  ctx.fill();
}

function formatTime(t) {
  const s = Math.ceil(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function drawHud() {
  const p = state.player;
  const n = p.train.length;

  // Score, train length (with its dock bonus) and shift clock, top left
  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(12, 12, 360, 30);
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.hudText;
  ctx.fillText(`SCORE ${state.score}`, 22, 27);
  ctx.fillStyle = n >= CONFIG.maxTrain ? COLORS.hudGold : COLORS.hudText;
  ctx.fillText(`TRAIN ${n}/${CONFIG.maxTrain}${n > 1 ? ` x${trainBonus(n)}` : ''}`, 142, 27);
  ctx.fillStyle = state.timeLeft <= 30 ? COLORS.hudWarn : COLORS.hudText;
  ctx.fillText(formatTime(state.timeLeft), 312, 27);

  // Combo, top right: multiplier and the window draining
  const kx = W - 172, ky = 12, kw = 160, kh = 30;
  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(kx, ky, kw, kh);
  const live = state.combo.timer > 0;
  ctx.fillStyle = live ? COLORS.hudGold : 'rgba(242, 242, 242, 0.5)';
  ctx.fillText(`COMBO ${comboMult()}x`, kx + 10, ky + 15);
  ctx.fillStyle = '#222';
  ctx.fillRect(kx + 104, ky + 11, 46, 8);
  if (live) {
    ctx.fillStyle = COLORS.hudGold;
    ctx.fillRect(kx + 104, ky + 11, 46 * (state.combo.timer / CONFIG.comboWindow), 8);
  }

  // Stamina bar, bottom left
  const bx = 12, by = H - 40, bw = 200, bh = 28;
  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = COLORS.hudText;
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillText('STAMINA', bx + 8, by + bh / 2);
  const barX = bx + 68, barY = by + 9, barW = bw - 78, barH = 10;
  ctx.fillStyle = '#222';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = p.exhausted ? COLORS.staminaLow : COLORS.stamina;
  ctx.fillRect(barX, barY, barW * (p.stamina / CONFIG.staminaMax), barH);

  // Keyboard controls, bottom right. Touch players have the on-screen pad instead.
  if (!state.touchUi) {
    const lines = [
      'WASD / Arrows  move / steer',
      'Shift  sprint',
      'Space / E  grab / latch / dock',
      'Q  drop last cart',
      'Esc  pause    M  mute',
      `R  restart    H  debug (${state.debug ? 'on' : 'off'})`,
    ];
    const cw = 210, ch = 14 + lines.length * 16;
    const cx = W - cw - 12, cy = H - ch - 12;
    ctx.fillStyle = COLORS.hudBg;
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = COLORS.hudText;
    ctx.font = '12px system-ui, sans-serif';
    lines.forEach((line, i) => ctx.fillText(line, cx + 10, cy + 15 + i * 16));
  }

  // Message toast, bottom center
  if (state.message) {
    ctx.globalAlpha = Math.min(1, state.message.t / 0.3);
    ctx.font = 'bold 14px system-ui, sans-serif';
    const tw = ctx.measureText(state.message.text).width + 24;
    ctx.fillStyle = COLORS.hudBg;
    ctx.fillRect(W / 2 - tw / 2, H - 42, tw, 28);
    ctx.fillStyle = COLORS.hudText;
    ctx.textAlign = 'center';
    ctx.fillText(state.message.text, W / 2, H - 28);
    ctx.globalAlpha = 1;
  }
}

function dim(alpha = 0.6) {
  ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
  ctx.fillRect(0, 0, W, H);
}

function drawCard(x, y, w, h) {
  ctx.fillStyle = '#f6efe0';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.storeRoof;
  ctx.lineWidth = 4;
  ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
}

// Menu buttons; the keyboard-selected one is filled gold.
function drawMenuButtons(light) {
  menuButtons().forEach((b, i) => {
    const focused = i === state.menuFocus;
    ctx.fillStyle = focused ? COLORS.hudGold : light ? '#e6ddc8' : 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = focused ? '#7a5b00' : light ? COLORS.storeRoof : 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    ctx.fillStyle = focused || light ? '#1a1a1a' : '#f2f2f2';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1);
  });
}

function drawTitle() {
  dim(0.62);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.hudGold;
  ctx.font = 'bold 76px system-ui, sans-serif';
  ctx.fillText('CART JOCKEY', W / 2, 150);
  ctx.fillStyle = '#f2f2f2';
  ctx.font = '19px system-ui, sans-serif';
  ctx.fillText('Round up shopping carts into long trains and dock them before your shift ends.', W / 2, 214);
  drawMenuButtons(false);

  const s = state.saved;
  ctx.fillStyle = '#f2f2f2';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText(`High score ${s.highScore}     Best combo ${CONFIG.comboMults[s.bestComboLevel]}x`, W / 2, 420);
  ctx.fillStyle = 'rgba(242, 242, 242, 0.65)';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(state.touchUi ? 'Tap a button to start' : 'Arrow keys + Enter, or click  ·  M mutes', W / 2, 452);
}

function drawHowTo() {
  dim(0.7);
  // Starts below the HUD icons so the mute button stays clear of the card.
  drawCard(110, 52, W - 220, H - 88);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.storeRoof;
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText('HOW TO PLAY', W / 2, 86);

  const touch = state.touchUi;
  const grab = touch ? 'GRAB' : 'Space / E';
  const lines = [
    `Move with ${touch ? 'the stick' : 'WASD or the arrow keys'}. ${touch ? 'SPRINT' : 'Shift'} runs while your stamina lasts.`,
    `${grab} grabs a cart. Nose into more carts and press ${grab} again to latch them on, up to 6.`,
    `Push the front cart into the CART CORRAL and press ${grab} to dock the whole train.`,
    'Longer trains are slower and turn wider, but pay more: each extra cart adds x0.5.',
    'Yellow-tagged strays, tucked between parked cars or on the curb, are worth double.',
    'Dock again within 12 seconds with freshly collected carts to climb the combo: 1.5x, 2x, 3x.',
    `Cars come and go all shift. A hit drops your whole train and costs 5 seconds.`,
    `${touch ? 'DROP' : 'Q'} drops the last cart. ${touch ? 'The pause button' : 'Esc'} pauses. Grade is your score against par.`,
  ];
  ctx.textAlign = 'left';
  ctx.font = '15px system-ui, sans-serif';
  lines.forEach((line, i) => {
    const y = 128 + i * 35;
    ctx.fillStyle = COLORS.storeRoof;
    ctx.fillRect(146, y - 3, 6, 6);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillText(line, 164, y);
  });
  drawMenuButtons(true);
}

function drawPaused() {
  dim(0.6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2f2f2';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText('PAUSED', W / 2, 150);
  drawMenuButtons(false);
  ctx.fillStyle = 'rgba(242, 242, 242, 0.65)';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(state.touchUi ? 'Tap Resume to keep going' : 'Esc to resume', W / 2, 420);
}

function drawTally() {
  dim(0.6);
  const pw = 400, ph = 456;
  const px = (W - pw) / 2, py = 42;
  drawCard(px, py, pw, ph);

  ctx.fillStyle = COLORS.storeRoof;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText('SHIFT OVER', W / 2, py + 32);

  const s = state.saved;
  const rows = [
    ['Score', `${state.score} / ${CONFIG.parScore} par`],
    ['Carts returned', String(state.docked)],
    ['Best train', `${state.best.train} / ${CONFIG.maxTrain}`],
    ['Best combo', `${CONFIG.comboMults[state.best.comboLevel]}x`, state.newRecord.combo],
    ['High score', String(s.highScore), state.newRecord.score],
  ];
  rows.forEach(([label, value, isNew], i) => {
    const y = py + 72 + i * 27;
    ctx.fillStyle = '#3a3a3a';
    ctx.textAlign = 'left';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(label, px + 34, y);
    if (isNew) {
      const labelW = ctx.measureText(label).width;
      ctx.fillStyle = '#b3261e';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText('NEW!', px + 34 + labelW + 10, y);
    }
    ctx.fillStyle = '#111';
    ctx.textAlign = 'right';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(value, px + pw - 34, y);
  });

  // Grade: the letter, the percent of par behind it, and the scale
  const grade = gradeFor(state.score);
  const gy = py + 232;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#3a3a3a';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('GRADE', W / 2 - 64, gy);
  ctx.fillStyle = grade === 'F' ? '#b3261e' : COLORS.storeRoof;
  ctx.font = 'bold 52px system-ui, sans-serif';
  ctx.fillText(grade, W / 2, gy);
  ctx.fillStyle = '#3a3a3a';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText(`${scorePercent(state.score)}%`, W / 2 + 64, gy);

  ctx.fillStyle = '#6b6b6b';
  ctx.font = '12px system-ui, sans-serif';
  const scale = CONFIG.grades.map((g) => (g.min > 0 ? `${g.grade} ${g.min}%+` : `${g.grade} below ${CONFIG.grades[CONFIG.grades.length - 2].min}%`));
  ctx.fillText(scale.join('   '), W / 2, gy + 42);

  if (state.newRecord.score) {
    ctx.fillStyle = '#b3261e';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText('NEW HIGH SCORE!', W / 2, gy + 80);
  }

  drawMenuButtons(true);
  ctx.fillStyle = '#6b6b6b';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(state.touchUi ? '' : 'R plays again', W / 2, py + ph - 14);
}

// Big centered text with a drop shadow, scaled around its center.
function bigText(text, y, size, color, scale = 1, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2, y);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillText(text, 4, 5);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// "3, 2, 1" before the shift: each number pops in large and settles.
function drawCountdown() {
  dim(0.35);
  const n = Math.max(1, Math.ceil(state.countdown));
  const into = n - state.countdown; // 0 when the number appears, 1 when it's replaced
  const pop = 1 + 0.5 * Math.max(0, 1 - into / 0.25);
  bigText('GET READY', 170, 30, '#f2f2f2');
  bigText(String(n), 290, 150, COLORS.hudGold, pop);
}

// GO! right after the countdown, growing and fading out.
function drawGo() {
  const t = state.goFlash / 0.8; // 1 -> 0
  bigText('GO!', 280, 130, '#5fd068', 1 + (1 - t) * 0.4, Math.min(1, t * 1.5));
}

// The final stretch: a big red clock over the store sign that thumps on
// every second, with a red glow around the edge of the lot. The last five
// seconds thump harder.
function drawFinalClock() {
  const t = state.timeLeft;
  const frac = t - Math.floor(t); // 1 -> 0 through each second
  const urgent = t <= 5;
  const beat = Math.max(0, (frac - 0.7) / 0.3); // 1 right as a new second starts
  const scale = 1 + (urgent ? 0.35 : 0.18) * beat;

  // Edge glow
  const glow = (urgent ? 0.55 : 0.3) * (0.4 + 0.6 * beat);
  ctx.save();
  ctx.strokeStyle = `rgba(230, 40, 30, ${glow})`;
  ctx.lineWidth = urgent ? 16 : 10;
  ctx.strokeRect(0, 0, W, H);
  ctx.restore();

  // Clock badge
  const bw = 170, bh = 64;
  ctx.save();
  ctx.translate(W / 2, 8 + bh / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = urgent ? '#c81e14' : '#a3231a';
  ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 3;
  ctx.strokeRect(-bw / 2 + 1.5, -bh / 2 + 1.5, bw - 3, bh - 3);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px ui-monospace, Menlo, monospace';
  ctx.fillText(formatTime(t), 0, 2);
  ctx.restore();
}

// Pause and mute icons, drawn as shapes.
function drawHudButtons() {
  for (const b of hudButtons()) {
    ctx.fillStyle = COLORS.hudBg;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = COLORS.hudText;
    ctx.strokeStyle = COLORS.hudText;
    ctx.lineWidth = 2;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    if (b.icon === 'pause') {
      ctx.fillRect(cx - 7, cy - 8, 5, 16);
      ctx.fillRect(cx + 2, cy - 8, 5, 16);
      continue;
    }
    // Speaker
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy - 4);
    ctx.lineTo(cx - 6, cy - 4);
    ctx.lineTo(cx, cy - 9);
    ctx.lineTo(cx, cy + 9);
    ctx.lineTo(cx - 6, cy + 4);
    ctx.lineTo(cx - 11, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    if (b.icon === 'muted') {
      ctx.moveTo(cx + 4, cy - 5);
      ctx.lineTo(cx + 12, cy + 5);
      ctx.moveTo(cx + 12, cy - 5);
      ctx.lineTo(cx + 4, cy + 5);
    } else {
      ctx.arc(cx + 2, cy, 6, -Math.PI / 3, Math.PI / 3);
      ctx.moveTo(cx + 2 + 10 * Math.cos(-Math.PI / 3), cy + 10 * Math.sin(-Math.PI / 3));
      ctx.arc(cx + 2, cy, 10, -Math.PI / 3, Math.PI / 3);
    }
    ctx.stroke();
  }
}

function drawDebug() {
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ff3b3b';
  for (const s of worldSolids()) ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);

  ctx.strokeStyle = '#3bff6b';
  const z = LOT.returnZone;
  ctx.strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);
  // The area where pickups don't count toward the combo
  ctx.setLineDash([4, 4]);
  const a = LOT.corralArea;
  ctx.strokeRect(a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1);
  ctx.setLineDash([]);

  // Spaces a moving car has claimed
  ctx.strokeStyle = '#ffd23f';
  for (const id of state.reserved) {
    const r = LOT.spaceById[id].rect;
    ctx.strokeRect(r.x + 2.5, r.y + 2.5, r.w - 5, r.h - 5);
  }

  // Every cart, free or in the train
  ctx.strokeStyle = '#ff4fd8';
  for (const cart of state.carts) ctx.strokeRect(cart.x + 0.5, cart.y + 0.5, cart.w - 1, cart.h - 1);

  // Moving cars: hitbox, and for traffic the rest of the route
  ctx.strokeStyle = '#ff9d2e';
  for (const v of movingVehicles()) {
    const b = vehicleBox(v);
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    if (v.kind !== 'traffic') continue;
    const pts = [{ x: v.cx, y: v.cy }];
    if (v.path && (v.mode === 'toSpot' || v.mode === 'toExit')) pts.push(...v.path.slice(v.idx));
    if (v.mode === 'toSpot' || v.mode === 'waitSpot') pts.push(LOT.spaceById[v.space].center);
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const p = state.player;
  ctx.strokeStyle = '#3bd5ff';
  ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);

  // Reach: a circle around the player when empty-handed, the forward latch
  // cone off the nose hitch with a train
  const hasTrain = p.train.length > 0;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  if (hasTrain) {
    const h = trainHitch(p);
    const ang = p.train[p.train.length - 1].angle;
    ctx.moveTo(h.x, h.y);
    ctx.arc(h.x, h.y, CONFIG.latchRange, ang - CONFIG.latchCone, ang + CONFIG.latchCone);
    ctx.closePath();
  } else {
    const pc = center(p);
    ctx.arc(pc.x, pc.y, CONFIG.grabRange, 0, Math.PI * 2);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Train links and order
  if (hasTrain) {
    const pts = [center(p), ...trainCarts().map(center)];
    ctx.strokeStyle = '#ffd23f';
    ctx.beginPath();
    pts.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.stroke();
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    pts.slice(1).forEach((pt, i) => ctx.fillText(String(i + 1), pt.x, pt.y - 14));
  }

  const n = p.train.length;
  const nose = hasTrain ? trainCarts()[n - 1] : null;
  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(W - 282, 50, 270, 114);
  ctx.fillStyle = COLORS.hudText;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const lx = W - 274;
  ctx.fillText(`pos ${p.x.toFixed(0)},${p.y.toFixed(0)}  stam ${p.stamina.toFixed(0)}`, lx, 62);
  ctx.fillText(`sprint ${p.sprinting}  exhausted ${p.exhausted}`, lx, 80);
  ctx.fillText(`carts ${state.carts.length}  bin ${state.carts.filter((c) => c.status === 'inBin').length}  strays ${strayCount()}  train ${n}`, lx, 98);
  ctx.fillText(
    n ? `speed x${trainSpeedMult(n).toFixed(2)}  turnR ${turnRadius(n)}  noseIn ${cartInReturnZone(nose)}` : 'speed x1.00',
    lx, 116,
  );
  ctx.fillText(`combo ${state.combo.timer.toFixed(1)}s  fresh ${state.freshPickup}  invuln ${p.invuln.toFixed(1)}`, lx, 134);
  ctx.fillText(`parked ${state.parked.size}  moving ${state.traffic.length}  arrive ${state.arriveTimer.toFixed(1)}  leave ${state.departTimer.toFixed(1)}`, lx, 152);
}

function draw() {
  fillRect({ x: 0, y: 0, w: W, h: H }, COLORS.asphalt);
  drawSidewalk();
  drawStore();
  drawCorral();
  drawAisleArrows();
  drawGates();
  for (const row of LOT.rows) drawRow(row);
  drawParkedCars();
  drawBin();
  drawIslandsAndLamps();
  drawCarts();
  drawPlayer();
  drawMovingCars();
  if (state.debug) drawDebug();

  const phase = state.phase;
  const inShift = phase === 'countdown' || phase === 'playing' || phase === 'paused';
  if (inShift || phase === 'over') drawHud();
  if ((phase === 'playing' || phase === 'paused') && state.timeLeft <= CONFIG.finalStretch) drawFinalClock();
  if (phase === 'countdown') drawCountdown();
  if (phase === 'playing' && state.goFlash > 0) drawGo();
  if (phase === 'title') drawTitle();
  else if (phase === 'howto') drawHowTo();
  else if (phase === 'paused') drawPaused();
  else if (phase === 'over') drawTally();
  drawHudButtons();

  // Let CSS show the touch pad only during a shift.
  if (document.body.dataset.phase !== phase) document.body.dataset.phase = phase;
}

// ---------------------------------------------------------------------------
// Loop: fixed-step update, render every frame
// ---------------------------------------------------------------------------

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;

function frame(now) {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= STEP) {
    update(STEP);
    acc -= STEP;
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Exposed for debugging in the console.
window.lotRunner = {
  state, LOT, CONFIG, held, setHeld, pressAction, resetSession,
  spawnStray, spawnArrival, spawnDeparture, findRoute, trainBonus, gradeFor, scorePercent,
  inputLog, sfx, menuButtons, hudButtons, persist, STORE_KEY,
};
