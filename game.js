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
  // Shoppers. Cars leave when their shopper comes back out of the store.
  shopperSize: 14,
  shopperSpeed: 44, // walking
  shopperCartSpeed: 38, // pushing a cart
  shopperExitEvery: [4, 9], // random seconds between shoppers leaving the store
  maxShoppers: 7, // out in the lot at once
  abandonChance: 0.4, // chance a shopper leaves the cart by their car instead of returning it
  shopperReplanAfter: 1.5, // seconds stuck before a shopper walks around what's blocking them
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

// Candy car paint: mint, butter, coral, blueberry, lilac, peach, sky, cherry.
const CAR_COLORS = ['#7ed9b0', '#ffe08a', '#ff8a70', '#5b7fe0', '#b99af0', '#ffb38a', '#7cc8f0', '#f06c8a'];

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
  shoppers: [], // people walking between their cars and the store
  nextShopperId: 1,
  shopperTimer: 0, // until the next shopper comes out of the store
  pendingDepart: [], // spaces whose shopper just got in; the car leaves when traffic allows
  player: makePlayer(),
  message: null, // { text, t }
};

// Presentation-only effects: pops, dust, bubbles, stickers. Game rules write
// events here but never read it back, so nothing in it can change play.
const fx = {
  time: 0,
  lastNow: 0,
  pops: new Map(), // cart id -> fx.time when it was latched
  ghosts: [], // docked carts settling into the corral
  puffs: [], // dust
  honks: [], // "HONK" bubbles
  sticker: null, // { text, t }
  binFlash: 0,
  walk: 0, // distance the player has walked, drives the waddle
  speed: 0,
  lastPos: null,
};

function fxLatch(cart, fromBin) {
  fx.pops.set(cart.id, fx.time);
  if (fromBin && !state.carts.some((c) => c.status === 'inBin')) fx.binFlash = 1.2;
}

function fxDock(carts, comboUp) {
  for (const c of carts) {
    fx.ghosts.push({ x: c.x + c.w / 2, y: c.y + c.h / 2, angle: c.angle, kind: c.kind, t: 0 });
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      fx.puffs.push({ x: c.x + c.w / 2 + Math.cos(a) * 8, y: c.y + c.h / 2 + 6 + Math.sin(a) * 4, t: 0, life: 0.6 + Math.random() * 0.3 });
    }
  }
  const n = carts.length;
  let text = null;
  if (comboUp) text = `COMBO ${comboMult()}x!`;
  else if (n >= 5) text = 'HUGE TRAIN!';
  else if (n >= 3) text = 'NICE TRAIN!';
  else if (carts.some((c) => c.kind === 'stray')) text = 'STRAY SAVED!';
  if (text) fx.sticker = { text, t: 0 };
}

function fxHonk(car) {
  fx.honks.push({ car, t: 0 });
}

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
  state.shoppers = [];
  state.nextShopperId = 1;
  state.shopperTimer = 2;
  state.pendingDepart = [];
  state.player = makePlayer();
  state.message = null;

  // A random lot to start: fill spaces the player isn't standing in. Each
  // car's shopper is already inside the store.
  const open = LOT.spaces.filter((s) => spaceClear(s));
  for (let i = 0; i < CONFIG.parkedStart && open.length; i++) {
    const s = open.splice(Math.floor(Math.random() * open.length), 1)[0];
    state.parked.set(s.id, {
      color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
      look: makeLook(),
      ownerInside: true,
    });
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
        { label: 'Play again', action: 'play', x: W / 2 - 166, y: 424, w: 160, h: 46 },
        { label: 'Title', action: 'title', x: W / 2 + 6, y: 424, w: 160, h: 46 },
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
  const others = free.concat(vehicleBoxes(), cartPusherBoxes()).filter((o) => !bodies.some((b) => overlaps(b, o)));
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
    if (cart.status === 'train' || cart.status === 'shopper') continue; // a shopper's cart isn't yours to take
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
  const fromBin = cart.status === 'inBin';
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
  fxLatch(cart, fromBin);
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

  const levelBefore = state.combo.level;
  if (state.combo.timer === 0) {
    state.combo.level = 0;
    state.combo.timer = CONFIG.comboWindow;
  } else if (state.freshPickup) {
    state.combo.level = Math.min(state.combo.level + 1, CONFIG.comboMults.length - 1);
    state.combo.timer = CONFIG.comboWindow;
  }
  fxDock(carts, state.combo.level > levelBefore);
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
    look: makeLook(), // the shopper who gets out once it's parked
  };
  car.angle = Math.atan2(path[1].y - path[0].y, path[1].x - path[0].x);
  state.traffic.push(car);
  return car;
}

// A parked car backs out and drives off to a random entrance. Called when
// its shopper has climbed in.
function spawnDeparture(id) {
  if (state.traffic.length >= CONFIG.trafficMaxMoving || !state.parked.has(id)) return null;
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
  // Cars always stop for shoppers on foot (and the carts they push).
  const walkers = shopperBodies();
  for (const [v, probe] of probes) {
    if (walkers.some((b) => overlaps(probe, b))) blocked.add(v);
  }
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
    state.parked.set(space.id, { color: car.color, look: car.look, ownerInside: false });
    state.reserved.delete(space.id);
    spawnShopperFromCar(space.id);
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
  fxHonk(car);
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
  // Cars whose shopper is back inside pull out as soon as traffic allows.
  while (state.pendingDepart.length && state.traffic.length < CONFIG.trafficMaxMoving) {
    spawnDeparture(state.pendingDepart.shift());
  }
}

// ---------------------------------------------------------------------------
// Shoppers: people who get out of arriving cars and walk into the store, and
// people who come back out pushing a cart, return it to the bin or abandon it
// by their car, climb in and drive away. A shopper pushing a cart is solid:
// the player and their train can't push through, and cars stop for them.
// ---------------------------------------------------------------------------

const SHOPPER_LOOK = {
  skins: ['#ffe0c4', '#f5c7a1', '#e0a47a', '#c68a5e', '#8d5a3b', '#5e3a26'],
  hairs: ['#2b1d16', '#5a3620', '#a0522d', '#d8b36a', '#e6e0d6', '#1a1a1a', '#b5422e'],
  tops: ['#5b7fe0', '#ff8a70', '#7ed9b0', '#b99af0', '#ffe08a', '#f06c8a', '#7cc8f0', '#ff9f43'],
  styles: ['short', 'bun', 'long', 'curly', 'bald', 'cap', 'headscarf', 'ponytail'],
};
let recentStyles = [];

// A random shopper, avoiding the last few hair styles so a crowd stays varied.
function makeLook() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const styles = SHOPPER_LOOK.styles.filter((s) => !recentStyles.includes(s));
  const style = pick(styles);
  recentStyles = [...recentStyles, style].slice(-3);
  return {
    skin: pick(SHOPPER_LOOK.skins),
    hair: pick(SHOPPER_LOOK.hairs),
    top: pick(SHOPPER_LOOK.tops),
    accent: pick(SHOPPER_LOOK.tops),
    style,
    glasses: Math.random() < 0.3,
    tote: Math.random() < 0.45,
    height: 0.9 + Math.random() * 0.22,
    girth: 0.9 + Math.random() * 0.3,
  };
}

const DOOR_POINT = { x: LOT.doors.x + LOT.doors.w / 2, y: 110 };
// One drop-off in front of each bin lane, so returning shoppers don't queue on one spot.
const BIN_MOUTHS = LOT.binLanes.map((lane) => ({ x: lane.x + CART_SIZE / 2, y: LOT.bin.y - 16 }));
const HANDOFF_RADIUS = 24; // close enough to the bin or corral to hand a cart over
const SHOPPER_PATIENCE = 8; // seconds stuck before a shopper gives up and leaves their cart

function binMouthFor(from) {
  const busy = (m) => state.shoppers.filter((o) => o.goal === m).length;
  return [...BIN_MOUTHS].sort((a, b) => busy(a) - busy(b) || Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
}
const CORRAL_MOUTH = { x: LOT.returnZone.x + LOT.returnZone.w / 2, y: LOT.corral.y + LOT.corral.h + 14 };

// Where a driver gets in or out: the open end of their space.
function boardingPoint(space) {
  const dir = space.pullAngle > 0 ? -1 : 1; // pulled in heading down -> the open end is up
  return { x: space.center.x, y: space.center.y + dir * (SPACE_D / 2 + 6) };
}

function shopperBox(sh) {
  const s = CONFIG.shopperSize;
  return { x: sh.x - s / 2, y: sh.y - s / 2, w: s, h: s };
}

// Every shopper, and the cart any of them is pushing: what cars stop for.
function shopperBodies() {
  const out = [];
  for (const sh of state.shoppers) {
    out.push(shopperBox(sh));
    if (sh.cartId) out.push(cartById(sh.cartId));
  }
  return out;
}

// Shoppers pushing carts: solid to the player (their carts are already solid
// as carts).
function cartPusherBoxes() {
  return state.shoppers.filter((sh) => sh.cartId).map(shopperBox);
}

// ---- Walking routes: A* over a 10px grid around the lot's solids ----------

const PED_CELL = 10;
const PED_COLS = Math.ceil(W / PED_CELL);
const PED_ROWS = Math.ceil(H / PED_CELL);
const PED_PAD = 9; // keep this far from solids, so a pushed cart clears them too

function markBlocked(grid, r, pad) {
  const c0 = Math.max(0, Math.floor((r.x - pad) / PED_CELL));
  const c1 = Math.min(PED_COLS - 1, Math.floor((r.x + r.w + pad) / PED_CELL));
  const r0 = Math.max(0, Math.floor((r.y - pad) / PED_CELL));
  const r1 = Math.min(PED_ROWS - 1, Math.floor((r.y + r.h + pad) / PED_CELL));
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) grid[row * PED_COLS + col] = 1;
}

const PED_STATIC = (() => {
  const grid = new Uint8Array(PED_COLS * PED_ROWS);
  for (const s of LOT.staticSolids) markBlocked(grid, s, PED_PAD);
  // Walkers stay off the store wall and out of the bin and corral
  markBlocked(grid, LOT.bin, 2);
  markBlocked(grid, LOT.returnZone, 2);
  return grid;
})();

function cellOf(pt) {
  return {
    c: Math.max(0, Math.min(PED_COLS - 1, Math.floor(pt.x / PED_CELL))),
    r: Math.max(0, Math.min(PED_ROWS - 1, Math.floor(pt.y / PED_CELL))),
  };
}

function nearestOpen(grid, cell) {
  if (!grid[cell.r * PED_COLS + cell.c]) return cell;
  for (let rad = 1; rad < 8; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const r = cell.r + dr;
        const c = cell.c + dc;
        if (r >= 0 && c >= 0 && r < PED_ROWS && c < PED_COLS && !grid[r * PED_COLS + c]) return { r, c };
      }
    }
  }
  return null;
}

function lineClear(grid, a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.ceil(d / 4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const { r, c } = cellOf({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (grid[r * PED_COLS + c]) return false;
  }
  return true;
}

// A walking route from `from` to `to` around parked cars and the lot's
// solids, plus any `extra` boxes to avoid. Returns waypoints, or null.
function planWalk(from, to, extra = []) {
  const grid = PED_STATIC.slice();
  for (const id of state.parked.keys()) markBlocked(grid, parkedBox(LOT.spaceById[id]), PED_PAD);
  for (const b of extra) markBlocked(grid, b, PED_PAD);
  const start = nearestOpen(grid, cellOf(from));
  const goal = nearestOpen(grid, cellOf(to));
  if (!start || !goal) return null;

  const N = PED_COLS * PED_ROWS;
  const g = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = []; // [f, index]
  const push = (f, i) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const h = (i) => {
    const dc = Math.abs((i % PED_COLS) - goal.c);
    const dr = Math.abs(Math.floor(i / PED_COLS) - goal.r);
    return Math.max(dc, dr) + 0.41 * Math.min(dc, dr);
  };
  const si = start.r * PED_COLS + start.c;
  const gi = goal.r * PED_COLS + goal.c;
  g[si] = 0;
  push(h(si), si);
  while (heap.length) {
    const [, i] = pop();
    if (closed[i]) continue;
    if (i === gi) break;
    closed[i] = 1;
    const c = i % PED_COLS;
    const r = Math.floor(i / PED_COLS);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= PED_ROWS || nc >= PED_COLS) continue;
        const ni = nr * PED_COLS + nc;
        if (grid[ni] || closed[ni]) continue;
        // no cutting corners between two blocked cells
        if (dr && dc && (grid[r * PED_COLS + nc] || grid[nr * PED_COLS + c])) continue;
        const ng = g[i] + (dr && dc ? 1.414 : 1);
        if (ng < g[ni]) {
          g[ni] = ng;
          prev[ni] = i;
          push(ng + h(ni), ni);
        }
      }
    }
  }
  if (g[gi] === Infinity) return null;

  const cells = [];
  for (let i = gi; i !== -1; i = prev[i]) {
    cells.unshift({ x: (i % PED_COLS) * PED_CELL + PED_CELL / 2, y: Math.floor(i / PED_COLS) * PED_CELL + PED_CELL / 2 });
  }
  cells.push({ x: to.x, y: to.y });
  // Straighten: skip waypoints while the line stays clear
  const path = [cells[0]];
  let k = 0;
  while (k < cells.length - 1) {
    let j = cells.length - 1;
    while (j > k + 1 && !lineClear(grid, cells[k], cells[j])) j--;
    path.push(cells[j]);
    k = j;
  }
  return path;
}

// ---- Spawning ---------------------------------------------------------------

function makeShopper(look, from, mode, extra = {}) {
  const sh = {
    id: state.nextShopperId++,
    look,
    x: from.x,
    y: from.y,
    fx: 0,
    fy: 1,
    mode, // 'toStore' | 'toBin' | 'toCorral' | 'toCar'
    path: null,
    idx: 1,
    goal: null,
    cartId: null,
    space: null,
    abandon: false,
    wait: 0,
    stuck: 0, // total seconds held up this leg
    walked: 0, // distance, drives the waddle
    moving: false,
    ...extra,
  };
  state.shoppers.push(sh);
  return sh;
}

function setGoal(sh, goal, extra = []) {
  sh.goal = goal;
  sh.path = planWalk({ x: sh.x, y: sh.y }, goal, extra);
  sh.idx = 1;
  sh.wait = 0;
  if (!extra.length) sh.stuck = 0; // a fresh leg, not a detour
  return !!sh.path;
}

// A driver who just parked walks into the store.
function spawnShopperFromCar(spaceId) {
  const entry = state.parked.get(spaceId);
  const sh = makeShopper(entry.look, boardingPoint(LOT.spaceById[spaceId]), 'toStore', { space: spaceId });
  if (!setGoal(sh, DOOR_POINT)) {
    state.shoppers = state.shoppers.filter((s) => s !== sh);
    entry.ownerInside = true;
  }
}

// A shopper comes out of the store pushing a cart, heading for their car.
function spawnShopperFromStore() {
  if (state.shoppers.length >= CONFIG.maxShoppers || state.parked.size <= CONFIG.parkedMin) return;
  const ready = [...state.parked.entries()].filter(([, e]) => e.ownerInside && !e.leaving);
  if (!ready.length) return;
  const [spaceId, entry] = ready[Math.floor(Math.random() * ready.length)];
  // Don't pop a cart out on top of the player or another cart
  const cartSpot = { x: DOOR_POINT.x - CART_SIZE / 2, y: DOOR_POINT.y + 17 - CART_SIZE / 2, w: CART_SIZE, h: CART_SIZE };
  const busy = [state.player, ...state.carts, ...shopperBodies()].some((b) => overlaps(b, cartSpot) || overlaps(b, shopperBox(DOOR_POINT)));
  if (busy) return;

  const abandon = Math.random() < CONFIG.abandonChance;
  const binFull = state.carts.filter((c) => c.status === 'inBin').length >= BIN_CAPACITY;
  const sh = makeShopper(entry.look, { ...DOOR_POINT }, abandon ? 'toCar' : binFull ? 'toCorral' : 'toBin', { space: spaceId, abandon });
  const cart = makeCart('standard', cartSpot.x, cartSpot.y, Math.PI / 2, 'shopper');
  sh.cartId = cart.id;
  const goal = sh.mode === 'toCar' ? boardingPoint(LOT.spaceById[spaceId]) : sh.mode === 'toBin' ? binMouthFor(sh) : CORRAL_MOUTH;
  if (!setGoal(sh, goal)) {
    state.shoppers = state.shoppers.filter((s) => s !== sh);
    state.carts = state.carts.filter((c) => c !== cart);
    return;
  }
  entry.ownerInside = false;
  entry.leaving = true;
}

// ---- Walking ------------------------------------------------------------------

// Where a shopper's cart sits: just ahead of them.
function pushedCartAt(sh, x, y, fxd, fyd) {
  const cx = x + fxd * 17;
  const cy = y + fyd * 17;
  return { x: cx - CART_SIZE / 2, y: cy - CART_SIZE / 2, w: CART_SIZE, h: CART_SIZE };
}

// Would this step walk the shopper (or their cart) into the player, the
// train, a car or another shopper's cart?
function shopperStepBlocked(sh, box, cartBox) {
  // People on foot can squeeze past each other; only a pushed cart is in the way.
  const hard = [state.player, ...trainCarts(), ...vehicleBoxes()];
  for (const o of state.shoppers) {
    if (o !== sh && o.cartId) hard.push(cartById(o.cartId));
  }
  const mine = [box, cartBox].filter(Boolean);
  const before = [shopperBox(sh), sh.cartId ? cartById(sh.cartId) : null].filter(Boolean);
  // Something we already overlap (say, a cart we spawned next to) doesn't hold us up.
  return hard.some((o) => mine.some((m) => overlaps(m, o)) && !before.some((b) => overlaps(b, o)));
}

function finishLeg(sh) {
  const entry = state.parked.get(sh.space);
  const cart = sh.cartId ? cartById(sh.cartId) : null;
  if (sh.mode === 'toStore') {
    if (entry) entry.ownerInside = true;
    sh.gone = true;
    return;
  }
  if (sh.mode === 'toBin' || sh.mode === 'toCorral') {
    // Cart returned: into the bin if there's room, otherwise it's put away at the corral.
    state.carts = state.carts.filter((c) => c !== cart);
    sh.cartId = null;
    if (sh.mode === 'toBin') spawnCartInBin();
    sh.mode = 'toCar';
    if (!entry || !setGoal(sh, boardingPoint(LOT.spaceById[sh.space]))) sh.gone = true;
    return;
  }
  if (sh.mode === 'toCar') {
    if (cart) {
      // Abandoned: left where it stands, a sad stray for the player
      cart.status = 'loose';
      cart.kind = 'stray';
      sh.cartId = null;
    }
    sh.gone = true;
    if (entry) state.pendingDepart.push(sh.space);
  }
}

function updateShopper(sh, dt) {
  sh.moving = false;
  if (!sh.path) {
    finishLeg(sh);
    return;
  }
  const target = sh.path[sh.idx];
  if (!target) {
    finishLeg(sh);
    return;
  }
  // Returning a cart: close enough to the bin or corral counts.
  if ((sh.mode === 'toBin' || sh.mode === 'toCorral') && Math.hypot(sh.goal.x - sh.x, sh.goal.y - sh.y) < HANDOFF_RADIUS) {
    finishLeg(sh);
    return;
  }
  const dx = target.x - sh.x;
  const dy = target.y - sh.y;
  const d = Math.hypot(dx, dy);
  if (d < 1.5) {
    sh.idx += 1;
    if (sh.idx >= sh.path.length) finishLeg(sh);
    return;
  }
  const speed = sh.cartId ? CONFIG.shopperCartSpeed : CONFIG.shopperSpeed;
  const step = Math.min(d, speed * dt);
  const nx = sh.x + (dx / d) * step;
  const ny = sh.y + (dy / d) * step;
  // Turn smoothly toward the direction of travel, so a pushed cart swings round.
  const k = Math.min(1, 7 * dt);
  let fxd = sh.fx + (dx / d - sh.fx) * k;
  let fyd = sh.fy + (dy / d - sh.fy) * k;
  const fl = Math.hypot(fxd, fyd) || 1;
  fxd /= fl;
  fyd /= fl;
  const cartBox = sh.cartId ? pushedCartAt(sh, nx, ny, fxd, fyd) : null;
  if (shopperStepBlocked(sh, shopperBox({ x: nx, y: ny }), cartBox)) {
    // Wait, then try walking around whatever's in the way.
    sh.wait += dt;
    sh.stuck += dt;
    if (sh.stuck > SHOPPER_PATIENCE && sh.cartId) {
      // Fed up: leave the cart right here and head for the car.
      const cart = cartById(sh.cartId);
      cart.status = 'loose';
      cart.kind = 'stray';
      sh.cartId = null;
      sh.mode = 'toCar';
      if (!setGoal(sh, boardingPoint(LOT.spaceById[sh.space]))) sh.gone = true;
      return;
    }
    if (sh.stuck > SHOPPER_PATIENCE * 1.5) {
      // Hopelessly boxed in on foot: count them as having made it.
      finishLeg(sh);
      return;
    }
    if (sh.wait > CONFIG.shopperReplanAfter) {
      const around = [state.player, ...trainCarts(), ...vehicleBoxes()];
      for (const o of state.shoppers) if (o !== sh && o.cartId) around.push(shopperBox(o), cartById(o.cartId));
      if (!setGoal(sh, sh.goal, around)) sh.wait = 0;
    }
    return;
  }
  sh.wait = 0;
  sh.x = nx;
  sh.y = ny;
  sh.fx = fxd;
  sh.fy = fyd;
  sh.walked += step;
  sh.moving = true;
  if (cartBox) {
    const cart = cartById(sh.cartId);
    cart.x = cartBox.x;
    cart.y = cartBox.y;
    cart.angle = Math.atan2(fyd, fxd);
  }
}

function updateShoppers(dt) {
  for (const sh of state.shoppers) updateShopper(sh, dt);
  state.shoppers = state.shoppers.filter((sh) => !sh.gone);

  state.shopperTimer -= dt;
  if (state.shopperTimer <= 0) {
    spawnShopperFromStore();
    state.shopperTimer = randBetween(CONFIG.shopperExitEvery);
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
  updateShoppers(dt);
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

// The look: a clay diorama under a fixed high 3/4 camera. Every prop sits
// on its real collision footprint and is extruded upward as a chunky block,
// with a soft ground shadow, a darker side face and a thin warm outline.
// Things further up the lot are drawn a touch smaller for a shallow fake
// perspective; footprints (and so collisions) never move.

const FONT = '"ui-rounded", "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, "Courier New", monospace';

const COLORS = {
  grass: '#9ee0bf',
  grassDark: '#74c9a0',
  asphalt: '#6f7b8b',
  asphaltEdge: '#5a6573',
  line: '#f7e7a6',
  sidewalk: '#ece3d3',
  sidewalkLine: '#d9cdb7',
  curbRed: '#e2574c',
  wall: '#fff4dc',
  wallShade: '#f2e2c2',
  roof: '#d8c29a',
  awning: '#e8513f',
  awningStripe: '#fff4dc',
  glass: '#a9def2',
  mint: '#8fdcb8',
  mintSide: '#5fb892',
  leaf: '#4fb884',
  yellow: '#ffc93c',
  yellowSide: '#dea21f',
  cartTop: '#cfe0f2',
  cartSide: '#8fa9c6',
  cartGrid: '#7d95b3',
  cartHandle: '#e8513f',
  wheel: '#2f3440',
  outline: '#3b2b2b',
  shadow: 'rgba(45, 35, 55, 0.24)',
  vest: '#17a39c',
  vestDark: '#0f7d77',
  shirt: '#ffffff',
  skin: '#ffd2ad',
  hair: '#6b3f2a',
  shoe: '#e8513f',
  ink: '#3b2b2b',
  cream: '#fff6e2',
  creamDark: '#efdfbc',
  tomato: '#e8513f',
  tomatoDark: '#b83a2c',
  teal: '#17a39c',
  gold: '#ffc93c',
  // Kept for the HUD, menus and debug overlay.
  storeRoof: '#b83a2c',
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

// Rounded-rectangle path.
function rrPath(x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function rr(x, y, w, h, r, fill, stroke, lineWidth = 2) {
  rrPath(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function circle(x, y, r, fill, stroke, lineWidth = 2) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

// Mix a #rrggbb color toward black (amt < 0) or white (amt > 0).
const shadeCache = new Map();
function shade(hex, amt) {
  const key = hex + amt;
  if (shadeCache.has(key)) return shadeCache.get(key);
  const n = parseInt(hex.slice(1), 16);
  const target = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  const ch = (v) => Math.round(v + (target - v) * k);
  const out = `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
  shadeCache.set(key, out);
  return out;
}

function groundShadow(x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.shadow;
  ctx.fill();
}

// Shallow fake perspective: 0.92 at the storefront, 1.0 at the bottom edge.
function depthScale(y) {
  return 0.92 + 0.08 * Math.max(0, Math.min(1, (y - 100) / (H - 100)));
}

// A chunky block: `path` traces the footprint in a local frame centered on
// (cx, cy) and rotated by `angle` (+x forward). The side is stacked slices,
// the top is lighter, the silhouette gets the warm outline.
function block(cx, cy, angle, height, side, top, path, s = 1) {
  const slice = (dz, fill, outline) => {
    ctx.save();
    ctx.translate(cx, cy - dz * s);
    ctx.rotate(angle);
    ctx.scale(s, s);
    path();
    ctx.fillStyle = fill;
    ctx.fill();
    if (outline) {
      ctx.strokeStyle = COLORS.outline;
      ctx.lineWidth = 2 / s;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();
  };
  slice(0, side, true);
  for (let dz = 2; dz < height; dz += 2) slice(dz, side, false);
  slice(height, top, true);
}

// Run `fn` in a local frame at (cx, cy - lift), rotated and scaled.
function inFrame(cx, cy, angle, s, lift, fn) {
  ctx.save();
  ctx.translate(cx, cy - lift * s);
  ctx.rotate(angle);
  ctx.scale(s, s);
  fn();
  ctx.restore();
}

// ---- Ground ------------------------------------------------------------

// Asphalt speckle, placed once so it doesn't shimmer.
const SPECKS = (() => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 260 }, () => ({ x: rand() * W, y: 162 + rand() * (H - 164), r: 0.8 + rand() * 1.6, light: rand() > 0.5 }));
})();

function wobblyLine(x1, y1, x2, y2, seed) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(2, Math.round(len / 8));
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wob = Math.sin(t * 9 + seed * 1.7) * 0.9;
    const x = x1 + (x2 - x1) * t + nx * wob;
    const y = y1 + (y2 - y1) * t + ny * wob;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawGround() {
  // Mint lawn around the lot
  fillRect({ x: 0, y: 0, w: W, h: H }, COLORS.grass);

  // Sidewalk with tiles and the red fire-lane curb
  rr(0, 90, W, 76, 10, COLORS.sidewalk);
  ctx.strokeStyle = COLORS.sidewalkLine;
  ctx.lineWidth = 1.5;
  for (let x = 24; x < W; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 98);
    ctx.lineTo(x, 154);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, 127);
  ctx.lineTo(W, 127);
  ctx.stroke();

  // Warm asphalt slab with rounded corners and a soft rim
  rr(0, 156, W, H - 156 + 12, 26, COLORS.asphaltEdge);
  rr(3, 159, W - 6, H - 159 + 8, 24, COLORS.asphalt);
  for (const s of SPECKS) circle(s.x, s.y, s.r, s.light ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)');
  rr(0, 154, W, 7, 3.5, COLORS.curbRed, COLORS.outline, 1.5);

  // Welcome mat at the doors
  rr(LOT.doors.x + 6, 100, LOT.doors.w - 12, 20, 6, '#7a8f6a', COLORS.outline, 1.5);

  // Parking rows: thick, slightly wobbly cream lines
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const row of LOT.rows) {
    for (let i = 0; i <= ROW_COUNT; i++) {
      const x = ROW_X0 + i * SPACE_W;
      wobblyLine(x, row.y + 4, x, row.y + SPACE_D - 4, i + row.y);
    }
    const endY = row.open === 'up' ? row.y + SPACE_D - 2 : row.y + 2;
    wobblyLine(ROW_X0, endY, ROW_X0 + LOT.rowW, endY, row.y);
  }
  ctx.lineCap = 'butt';

  // Accessible spaces
  for (const id of LOT.accessibleSpaces) {
    const s = LOT.spaceById[id];
    rr(s.rect.x + 6, s.rect.y + 7, SPACE_W - 12, SPACE_D - 14, 8, '#5b8fe0');
    circle(s.center.x, s.center.y, 9, '#ffffff');
    circle(s.center.x, s.center.y, 4, '#5b8fe0');
  }

  drawAisleArrows();
  drawGates();

  // Bin floor and corral floor
  const bin = LOT.bin;
  rr(bin.x + 2, bin.y + 2, bin.w - 4, bin.h - 4, 8, '#5d6878');
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(bin.x + bin.w / 2, bin.y + 6);
  ctx.lineTo(bin.x + bin.w / 2, bin.y + bin.h - 8);
  ctx.stroke();
  ctx.setLineDash([]);

  const z = LOT.returnZone;
  rr(z.x - 2, z.y - 2, z.w + 4, z.h + 6, 8, '#ffe6a0');
  ctx.save();
  rrPath(z.x - 2, z.y - 2, z.w + 4, z.h + 6, 8);
  ctx.clip();
  ctx.strokeStyle = 'rgba(222, 162, 31, 0.35)';
  ctx.lineWidth = 7;
  for (let x = z.x - z.h; x < z.x + z.w + 10; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x, z.y + z.h + 6);
    ctx.lineTo(x + z.h + 6, z.y - 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(160, 105, 10, 0.75)';
  ctx.font = `800 13px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CART CORRAL', z.x + z.w / 2, z.y + 18);
  ctx.font = `800 10px ${FONT}`;
  ctx.fillText('RETURN ZONE', z.x + z.w / 2, z.y + 34);
}

function drawAisleArrows() {
  ctx.fillStyle = 'rgba(247, 231, 166, 0.6)';
  const arrow = (x, y, angle) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    rrPath(-12, -4, 14, 8, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(0, -10);
    ctx.lineTo(0, 10);
    ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(247, 231, 166, 0.6)';
    ctx.stroke();
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

// Entrances: rounded yellow IN / OUT tags at the lot edge.
function drawGates() {
  ctx.font = `800 10px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tag = (x, y, text) => {
    rr(x - 16, y - 8, 32, 16, 8, COLORS.yellow, COLORS.outline, 1.5);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(text, x, y + 0.5);
  };
  for (const g of GATES) {
    const inPt = LANE_NODES[g.in];
    const outPt = LANE_NODES[g.out];
    if (g.side === 'bottom') {
      tag(inPt.x, H - 12, 'IN');
      tag(outPt.x, H - 12, 'OUT');
    } else {
      const x = g.side === 'left' ? 18 : W - 18;
      tag(x, inPt.y, 'IN');
      tag(x, outPt.y, 'OUT');
    }
  }
}

// ---- Storefront -----------------------------------------------------------

function drawStore() {
  const { doors } = LOT;
  // Cream wall with a roof cap
  fillRect({ x: 0, y: 0, w: W, h: 96 }, COLORS.wall);
  fillRect({ x: 0, y: 0, w: W, h: 10 }, COLORS.roof);
  fillRect({ x: 0, y: 86, w: W, h: 10 }, COLORS.wallShade);

  // Big windows with produce stacked inside
  const produce = ['#e8513f', '#ffb13c', '#7cc85a', '#ffd84a', '#e8513f', '#b36ad8'];
  for (const [x0, x1] of [[20, 214], [346, 382], [708, 940]]) {
    rr(x0, 50, x1 - x0, 34, 8, COLORS.glass, COLORS.outline, 2);
    for (let x = x0 + 9, i = 0; x < x1 - 6; x += 11, i++) circle(x, 78, 5, produce[i % produce.length]);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.fillRect(x0 + 8, 54, 6, 18);
  }

  // Striped awning with a scalloped edge
  const ay = 38, ah = 14;
  for (let x = 0, i = 0; x < W; x += 24, i++) {
    ctx.fillStyle = i % 2 ? COLORS.awningStripe : COLORS.awning;
    ctx.fillRect(x, ay, 24, ah);
    ctx.beginPath();
    ctx.arc(x + 12, ay + ah, 12, 0, Math.PI);
    ctx.fill();
  }
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, ay);
  ctx.lineTo(W, ay);
  ctx.stroke();

  // Big automatic glass doors, framed
  rr(doors.x - 6, 26, doors.w + 12, 72, 12, '#f7f2e6', COLORS.outline, 2.5);
  rr(doors.x, 34, doors.w, 62, 8, COLORS.glass, COLORS.outline, 2);
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(doors.x + doors.w / 2, 34);
  ctx.lineTo(doors.x + doors.w / 2, 96);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.moveTo(doors.x + 8, 90);
  ctx.lineTo(doors.x + 22, 40);
  ctx.lineTo(doors.x + 30, 40);
  ctx.lineTo(doors.x + 16, 90);
  ctx.fill();

  // GROCERY sign
  rr(W / 2 - 100, 4, 200, 40, 20, COLORS.tomato, COLORS.outline, 3);
  ctx.fillStyle = COLORS.cream;
  ctx.font = `900 24px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GROCERY', W / 2, 25);

  // "Please return your carts" board with a smiling cart
  const bx = 594, by = 2, bw = 100, bh = 34;
  rr(bx, by, bw, bh, 8, COLORS.cream, COLORS.outline, 2);
  drawCartIcon(bx + 14, by + 18, 0.7, true);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `800 7px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('PLEASE RETURN', bx + 29, by + 13);
  ctx.fillText('YOUR CARTS :)', bx + 29, by + 24);
}

// A flat little cart icon for signs and the UI.
function drawCartIcon(x, y, s, smile) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  rr(-12, -9, 20, 13, 4, COLORS.cartTop, COLORS.outline, 2);
  ctx.strokeStyle = COLORS.cartHandle;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(8, -9);
  ctx.lineTo(12, -13);
  ctx.stroke();
  ctx.lineCap = 'butt';
  circle(-7, 7, 3, COLORS.wheel);
  circle(4, 7, 3, COLORS.wheel);
  if (smile) {
    circle(-6, -4, 1.4, COLORS.ink);
    circle(1, -4, 1.4, COLORS.ink);
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(-2.5, -2, 3, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- Props ---------------------------------------------------------------

// Rounded-box footprint path for a local frame.
const boxPath = (w, h, r) => () => rrPath(-w / 2, -h / 2, w, h, r);

function drawCarProp(cx, cy, angle, color, opts = {}) {
  const s = depthScale(cy);
  const L = CONFIG.carLength;
  const Wd = CONFIG.carWidth;
  // Shadow: the rotated body, flattened and nudged down-right
  inFrame(cx + 3, cy + 4, angle, s, 0, () => {
    rrPath(-L / 2, -Wd / 2, L, Wd, 12);
    ctx.fillStyle = COLORS.shadow;
    ctx.fill();
  });
  // Wheels peeking out at the corners
  inFrame(cx, cy, angle, s, 0, () => {
    for (const [wx, wy] of [[-16, -Wd / 2], [16, -Wd / 2], [-16, Wd / 2 - 5], [16, Wd / 2 - 5]]) {
      rr(wx - 6, wy, 12, 5, 2.5, COLORS.wheel);
    }
  });
  // Body, then the cabin on top
  block(cx, cy - 2 * s, angle, 9, shade(color, -0.25), color, boxPath(L - 2, Wd - 2, 12), s);
  block(cx, cy - 11 * s, angle, 7, shade(color, -0.12), shade(color, 0.3), boxPath(24, Wd - 10, 8), s);
  inFrame(cx, cy, angle, s, 18, () => {
    rr(3, -Wd / 2 + 7, 8, Wd - 14, 3, COLORS.glass); // windshield
    rr(-12, -Wd / 2 + 8, 5, Wd - 16, 2, COLORS.glass); // rear window
  });
  // Headlights, and white reverse lights when backing out
  inFrame(cx, cy, angle, s, 11, () => {
    circle(L / 2 - 4, -Wd / 2 + 6, 3, opts.lights ? '#fff8c4' : '#f4ecd0', COLORS.outline, 1);
    circle(L / 2 - 4, Wd / 2 - 6, 3, opts.lights ? '#fff8c4' : '#f4ecd0', COLORS.outline, 1);
    if (opts.reverse) {
      circle(-L / 2 + 4, -Wd / 2 + 6, 3, '#ffffff', COLORS.outline, 1);
      circle(-L / 2 + 4, Wd / 2 - 6, 3, '#ffffff', COLORS.outline, 1);
    }
  });
}

// The hero prop. Local frame: +x is the nose (latch tongue), -x the red handle.
function drawCartProp(cx, cy, angle, kind, opts = {}) {
  const s = depthScale(cy) * (opts.scale || 1);
  const lift = opts.lift || 0;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  // Squash and stretch around the ground point
  if (opts.sx || opts.sy) {
    ctx.translate(cx, cy);
    ctx.scale(opts.sx || 1, opts.sy || 1);
    ctx.translate(-cx, -cy);
  }
  groundShadow(cx + 1, cy + 4, 10 * s, 7 * s);
  // Wheels
  inFrame(cx, cy, angle, s, 0, () => {
    for (const [wx, wy] of [[-7, -6.5], [3, -5.5], [-7, 6.5], [3, 5.5]]) circle(wx, wy, 2.6, COLORS.wheel);
  });
  // The basket is drawn shorter than the 20-unit collision box so that in a
  // nested train (carts 16 apart) each basket stays separate and countable;
  // the latch tongue at the nose tucks under the next cart's handle, so the
  // train still reads as hooked together.
  block(cx, cy - (3 + lift) * s, angle, 3, shade('#8fa9c6', -0.2), '#a9bdd4', () => rrPath(3, -3, 8, 6, 3), s);
  // Basket: a rounded trapezoid, wider at the handle end
  const basket = () => {
    ctx.beginPath();
    ctx.moveTo(-7, -8);
    ctx.lineTo(3, -6.5);
    ctx.quadraticCurveTo(5, -6.5, 5, -4.5);
    ctx.lineTo(5, 4.5);
    ctx.quadraticCurveTo(5, 6.5, 3, 6.5);
    ctx.lineTo(-7, 8);
    ctx.quadraticCurveTo(-9, 8, -9, 6);
    ctx.lineTo(-9, -6);
    ctx.quadraticCurveTo(-9, -8, -7, -8);
    ctx.closePath();
  };
  block(cx, cy - (3 + lift) * s, angle, 8, COLORS.cartSide, COLORS.cartTop, basket, s);
  inFrame(cx, cy, angle, s, 11 + lift, () => {
    // Wire grid on the top
    ctx.strokeStyle = COLORS.cartGrid;
    ctx.lineWidth = 1.2;
    for (const gx of [-4, 0, 3]) {
      ctx.beginPath();
      ctx.moveTo(gx, -5.5);
      ctx.lineTo(gx, 5.5);
      ctx.stroke();
    }
    // Red child seat and handle bar
    rr(-8, -3.5, 4, 7, 2, COLORS.cartHandle);
    rr(-12, -8, 3.5, 16, 1.75, COLORS.cartHandle, COLORS.outline, 1.5);
    // Strays: a sad sticky note
    if (kind === 'stray') {
      ctx.rotate(-angle + 0.25);
      rr(-4, -4.5, 8.5, 8.5, 1.5, '#ffe45c', COLORS.outline, 1);
      circle(-1.6, -1.6, 0.8, COLORS.ink);
      circle(1.9, -1.6, 0.8, COLORS.ink);
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(0.2, 2.2, 1.8, Math.PI + 0.4, -0.4);
      ctx.stroke();
    }
  });
  ctx.restore();
}

function drawPlayerProp() {
  const p = state.player;
  const c = center(p);
  const moving = fx.speed > 8;
  const sprint = p.sprinting && moving;
  const hitAge = CONFIG.hitInvuln - p.invuln;
  const sitting = p.invuln > 0 && hitAge < 0.8;
  drawAttendant({
    x: c.x,
    y: c.y + 4,
    s: depthScale(c.y),
    fxd: p.facingX,
    fyd: p.facingY,
    moving,
    sprint,
    step: fx.walk * (sprint ? 0.09 : 0.14),
    pushing: p.train.length > 0,
    sitting,
    hitAge,
    faded: p.invuln > 0 && !sitting && Math.floor(p.invuln * 10) % 2 === 0,
  });
}

// The cart attendant, standing on (x, y), facing (fxd, fyd). Shared by the
// player in the lot and the mascot on the title screen.
function drawAttendant({ x, y, s, fxd, fyd, moving, sprint, step, pushing, sitting, hitAge, faded }) {
  const px = -fyd; // perpendicular (to the facing's right)
  const py = fxd;
  const stride = moving ? (sprint ? 5 : 3) : 0;

  ctx.save();
  if (faded) ctx.globalAlpha = 0.55;
  ctx.translate(x, y);
  ctx.scale(s, s);

  groundShadow(0, 4, 12, 6);

  // Comedic sit-down: squashed, feet out front, a little bounce
  let bounce = 0;
  let squash = 1;
  if (sitting) {
    const k = Math.max(0, 1 - hitAge / 0.8);
    bounce = Math.abs(Math.sin(hitAge * 16)) * 5 * k;
    squash = 0.72;
  }
  const bob = moving ? Math.abs(Math.sin(step)) * 2 : Math.sin(fx.time * 3) * 1;
  const lean = sprint ? 4 : moving ? 1 : 0;

  // Sneakers
  const foot = (side, phase) => {
    const f = sitting ? 7 : Math.sin(step + phase) * stride;
    const x = side * px * 4 + fxd * f;
    const y = side * py * 4 + fyd * f * 0.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(fyd, fxd));
    rr(-3, -2.5, 8, 5, 2.5, COLORS.shoe, COLORS.outline, 1.5);
    rr(-3, 1, 8, 1.6, 0.8, '#ffffff');
    ctx.restore();
  };
  foot(1, 0);
  foot(-1, Math.PI);

  ctx.translate(fxd * lean, -bounce);
  ctx.rotate(moving && !sitting ? Math.sin(step) * 0.12 : 0);
  ctx.scale(1, squash);

  // Body: white shirt under a teal vest with a reflective stripe
  const by = -12 - bob;
  rr(-8, by - 3, 16, 17, 7, COLORS.shirt, COLORS.outline, 2);
  rr(-8, by, 16, 12, 5, COLORS.vest, COLORS.outline, 1.5);
  ctx.fillStyle = COLORS.gold;
  ctx.fillRect(-7, by + 5, 14, 2.5);
  if (fyd > -0.4) {
    // Name tag on the chest
    rr(-2 + px * 3 + fxd * 2, by + 1, 6, 4, 1, '#ffffff', COLORS.outline, 0.8);
  }

  // Hands: both on the train's handle when pushing, swinging otherwise
  for (const side of [1, -1]) {
    let hx;
    let hy;
    if (pushing) {
      hx = fxd * 10 + side * px * 5;
      hy = by + 5 + fyd * 6 + side * py * 5;
    } else {
      const swing = moving ? Math.sin(step + (side > 0 ? Math.PI : 0)) * 3 : 0;
      hx = side * px * 9 + fxd * swing;
      hy = by + 6 + side * py * 5 + fyd * swing * 0.5;
    }
    circle(hx, hy, 3.2, COLORS.skin, COLORS.outline, 1.5);
  }

  // Big head; the face shows on the side it's looking toward
  const hx = fxd * (1 + lean * 0.6);
  const hy = by - 12 + fyd * 1.5;
  circle(hx, hy, 11, COLORS.hair, COLORS.outline, 2);
  if (fyd > -0.6) {
    const fx0 = hx + fxd * 2.5;
    const fy0 = hy + fyd * 2 + 1.5;
    circle(fx0, fy0, 8.8, COLORS.skin);
    // Eyes and blush toward the facing side
    const ex = fx0 + fxd * 3;
    const ey = fy0 + fyd * 1.5 - 1;
    const spread = Math.abs(fyd) > 0.5 ? 3.5 : 2;
    circle(ex + px * spread, ey + py * spread * 0.4, 1.6, COLORS.ink);
    circle(ex - px * spread, ey - py * spread * 0.4, 1.6, COLORS.ink);
    circle(ex + px * (spread + 2), ey + 3, 1.6, 'rgba(255, 120, 120, 0.45)');
    circle(ex - px * (spread + 2), ey + 3, 1.6, 'rgba(255, 120, 120, 0.45)');
  }
  // Hair tuft on top
  ctx.fillStyle = COLORS.hair;
  ctx.beginPath();
  ctx.arc(hx - 2, hy - 10, 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Dizzy stars after a knockdown
  if (sitting) {
    for (let i = 0; i < 3; i++) {
      const a = fx.time * 6 + (i * Math.PI * 2) / 3;
      drawStar(hx + Math.cos(a) * 13, hy - 12 + Math.sin(a) * 4, 3, COLORS.gold);
    }
  }
  ctx.restore();
}

// A shopper: same chunky build as the attendant, but in their own clothes,
// hair, skin tone and size, with glasses or a tote bag on some.
function drawShopperProp(sh) {
  const look = sh.look;
  const s = depthScale(sh.y) * look.height;
  const g = look.girth;
  const fxd = sh.fx;
  const fyd = sh.fy;
  const px = -fyd;
  const py = fxd;
  const step = sh.walked * 0.17;
  const moving = sh.moving;
  const pushing = !!sh.cartId;

  ctx.save();
  ctx.translate(sh.x, sh.y + 3);
  ctx.scale(s, s);
  groundShadow(0, 3, 9 * g, 5);

  // Shoes
  for (const [side, phase] of [[1, 0], [-1, Math.PI]]) {
    const f = moving ? Math.sin(step + phase) * 2.5 : 0;
    const x = side * px * 3.2 + fxd * f;
    const y = side * py * 3.2 + fyd * f * 0.6;
    rr(x - 3, y - 2, 6, 4, 2, '#3b3340', COLORS.outline, 1.2);
  }

  const bob = moving ? Math.abs(Math.sin(step)) * 1.6 : Math.sin(fx.time * 2.5 + sh.id) * 0.8;
  ctx.rotate(moving ? Math.sin(step) * 0.09 : 0);
  const by = -11 - bob;

  // Body with a collar in the accent color
  rr(-6.5 * g, by - 2, 13 * g, 14, 6, look.top, COLORS.outline, 1.8);
  rr(-3.5, by - 2, 7, 3, 1.5, look.accent);

  // Tote bag on the far side when their hands are free
  if (!pushing && look.tote) {
    const bx = px * 8.5 * g;
    const bys = by + 3 + py * 3;
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(bx, bys, 3, Math.PI, 0);
    ctx.stroke();
    rr(bx - 4, bys, 8, 8, 2, look.accent, COLORS.outline, 1.2);
  }

  // Hands: both on the cart handle when pushing, swinging otherwise
  for (const side of [1, -1]) {
    let hx;
    let hy;
    if (pushing) {
      hx = fxd * 8 + side * px * 4.5;
      hy = by + 5 + fyd * 5 + side * py * 4;
    } else {
      const swing = moving ? Math.sin(step + (side > 0 ? Math.PI : 0)) * 2.5 : 0;
      hx = side * px * 7.5 * g + fxd * swing;
      hy = by + 6 + side * py * 4 + fyd * swing * 0.5;
    }
    circle(hx, hy, 2.6, look.skin, COLORS.outline, 1.2);
  }

  // Head
  const hx = fxd * 1.2;
  const hy = by - 9 + fyd * 1.2;
  const faceShows = fyd > -0.6;
  const style = look.style;
  // Hair behind the head
  if (style === 'long') rr(hx - 9, hy - 5, 18, 16, 7, look.hair, COLORS.outline, 1.5);
  if (style === 'ponytail') circle(hx - fxd * 8.5, hy - fyd * 3 + 3, 3.8, look.hair, COLORS.outline, 1.2);
  if (style === 'bun') circle(hx, hy - 9, 4.2, look.hair, COLORS.outline, 1.2);
  if (style === 'curly') {
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      circle(hx + Math.cos(a) * 8, hy + Math.sin(a) * 7.5, 3.6, look.hair, COLORS.outline, 1);
    }
  }
  // Head base: hair color from behind, scarf, or bare
  const base = style === 'bald' ? look.skin : style === 'headscarf' ? look.accent : look.hair;
  circle(hx, hy, style === 'headscarf' ? 9.5 : 8.5, base, COLORS.outline, 1.8);
  if (faceShows) {
    const fr = style === 'headscarf' ? 6.2 : style === 'bald' ? 0 : 7.2;
    const fcx = hx + fxd * 2.2;
    const fcy = hy + fyd * 1.6 + 1.8;
    if (fr) circle(fcx, fcy, fr, look.skin);
    const ex = fcx + fxd * 2.5;
    const ey = fcy + fyd * 1.2 - 1;
    const spread = Math.abs(fyd) > 0.5 ? 3 : 1.8;
    circle(ex + px * spread, ey + py * spread * 0.4, 1.3, COLORS.ink);
    circle(ex - px * spread, ey - py * spread * 0.4, 1.3, COLORS.ink);
    if (look.glasses) {
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1;
      circle(ex + px * spread, ey + py * spread * 0.4, 2.4, null, COLORS.ink, 1);
      circle(ex - px * spread, ey - py * spread * 0.4, 2.4, null, COLORS.ink, 1);
    } else {
      circle(ex + px * (spread + 1.8), ey + 2.5, 1.3, 'rgba(255, 120, 120, 0.4)');
      circle(ex - px * (spread + 1.8), ey + 2.5, 1.3, 'rgba(255, 120, 120, 0.4)');
    }
  }
  if (style === 'bald') {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx - 2, hy - 3, 4, Math.PI * 1.1, Math.PI * 1.5);
    ctx.stroke();
  }
  if (style === 'cap') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(hx, hy - 1, 9, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = look.accent;
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(hx + fxd * 7, hy - 1 + fyd * 3, 5, 2.5, Math.atan2(fyd, fxd), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawStar(x, y, r, fill) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Yellow metal bars with white stripes, used by the bin and the corral.
function drawRail(r, height, flash) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = depthScale(r.y + r.h);
  const top = flash ? '#ffffff' : COLORS.yellow;
  block(cx, cy, 0, height, COLORS.yellowSide, top, () => rrPath(-r.w / 2, -r.h / 2, r.w, r.h, Math.min(r.w, r.h) / 2), s);
  // White safety stripes on the top face
  inFrame(cx, cy, 0, s, height, () => {
    ctx.save();
    rrPath(-r.w / 2, -r.h / 2, r.w, r.h, Math.min(r.w, r.h) / 2);
    ctx.clip();
    ctx.strokeStyle = flash ? COLORS.yellow : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 3;
    const span = Math.max(r.w, r.h);
    for (let d = -span; d < span; d += 10) {
      ctx.beginPath();
      ctx.moveTo(d - 6, -r.h / 2 - 6);
      ctx.lineTo(d + 6, r.h / 2 + 6);
      ctx.stroke();
    }
    ctx.restore();
  });
}

function drawIslandProp(isl) {
  const cx = isl.x + isl.w / 2;
  const cy = isl.y + isl.h / 2;
  const s = depthScale(isl.y + isl.h);
  groundShadow(cx + 2, cy + 4, isl.w / 2 + 2, isl.h / 2 + 2);
  block(cx, cy, 0, 8, COLORS.mintSide, COLORS.mint, () => rrPath(-isl.w / 2, -isl.h / 2, isl.w, isl.h, 12), s);
  // Round shrubs
  inFrame(cx, cy, 0, s, 8, () => {
    for (let y = -isl.h / 2 + 14; y < isl.h / 2 - 6; y += 22) {
      circle(-4, y, 8, COLORS.leaf, COLORS.outline, 1.5);
      circle(5, y + 6, 6, shade('#4fb884', 0.15), COLORS.outline, 1.5);
    }
  });
}

function drawLampProp(lamp) {
  const cx = lamp.x + lamp.w / 2;
  const cy = lamp.y + lamp.h / 2;
  const s = depthScale(cy);
  groundShadow(cx + 3, cy + 3, 9 * s, 5 * s);
  block(cx, cy, 0, 4, '#5a6270', '#7d8696', () => rrPath(-6, -6, 12, 12, 6), s);
  inFrame(cx, cy, 0, s, 0, () => {
    rr(-2.5, -46, 5, 44, 2.5, '#7d8696', COLORS.outline, 1.5);
    circle(0, -50, 12, 'rgba(255, 244, 190, 0.35)');
    circle(0, -50, 7, '#fff3bf', COLORS.outline, 2);
  });
}

// Glow at the corral mouth when the player or the train's nose is close.
function drawDockGlow() {
  const p = state.player;
  const mouth = { x: LOT.returnZone.x + LOT.returnZone.w / 2, y: LOT.corral.y + LOT.corral.h };
  const pts = [center(p)];
  if (p.train.length) pts.push(center(trainCarts()[p.train.length - 1]));
  const d = Math.min(...pts.map((pt) => Math.hypot(pt.x - mouth.x, pt.y - mouth.y)));
  if (d > 130) return;
  const k = (1 - d / 130) * (0.6 + 0.4 * Math.sin(fx.time * 6));
  const g = ctx.createRadialGradient(mouth.x, mouth.y, 5, mouth.x, mouth.y, 90);
  g.addColorStop(0, `rgba(255, 236, 140, ${0.75 * k})`);
  g.addColorStop(1, 'rgba(255, 236, 140, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(mouth.x, mouth.y - 10, 95, 45, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Everything with height, drawn back to front by where it touches the ground.
function drawWorld() {
  drawGround();
  drawStore();
  drawDockGlow();
  drawPuffs();

  const props = [];
  const add = (key, fn) => props.push({ key, fn });

  for (const [id, car] of state.parked) {
    const sp = LOT.spaceById[id];
    const b = parkedBox(sp);
    add(b.y + b.h, () => drawCarProp(sp.center.x, sp.center.y, sp.pullAngle, car.color));
  }
  for (const car of state.traffic) {
    const b = vehicleBox(car);
    add(b.y + b.h, () => drawCarProp(car.cx, car.cy, car.angle, car.color, { lights: true, reverse: car.reverse }));
  }
  for (const cart of state.carts) {
    add(cart.y + cart.h, () => drawCartProp(cart.x + cart.w / 2, cart.y + cart.h / 2, cart.angle, cart.kind, cartMotion(cart)));
  }
  // Docked carts settling into the corral: a small drop with overshoot, then fade
  for (const g of fx.ghosts) {
    const settle = easeOutBack(Math.min(1, g.t / 0.35));
    const alpha = g.t < 0.35 ? 1 : Math.max(0, 1 - (g.t - 0.35) / 0.4);
    add(g.y + 10, () => drawCartProp(g.x, g.y, g.angle, g.kind, { lift: 6 * (1 - settle), alpha }));
  }
  add(state.player.y + state.player.h, drawPlayerProp);
  for (const sh of state.shoppers) add(sh.y + CONFIG.shopperSize / 2, () => drawShopperProp(sh));
  for (const isl of LOT.islands) add(isl.y + isl.h, () => drawIslandProp(isl));
  for (const lamp of LOT.lampPosts) add(lamp.y + lamp.h, () => drawLampProp(lamp));
  const binFlash = fx.binFlash > 0 && Math.floor(fx.binFlash * 8) % 2 === 0;
  for (const r of LOT.binRails) add(r.y + r.h, () => drawRail(r, 12, binFlash));
  for (const r of LOT.corralRails) add(r.y + r.h, () => drawRail(r, 14, false));

  props.sort((a, b) => a.key - b.key);
  for (const prop of props) prop.fn();

  drawHonks();
  drawSticker();
}

// Overshoot easing for the dock settle and pop-ins.
function easeOutBack(t) {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

// Idle bob for carts standing still, and a squash-and-stretch pop right
// after a cart is latched.
function cartMotion(cart) {
  const opts = {};
  if (cart.status === 'loose' || cart.status === 'inBin') opts.lift = 1.2 + Math.sin(fx.time * 3 + cart.id * 1.7) * 1.2;
  const t0 = fx.pops.get(cart.id);
  if (t0 !== undefined) {
    const age = fx.time - t0;
    if (age > 0.35) {
      fx.pops.delete(cart.id);
    } else {
      const k = 1 - age / 0.35;
      const wob = Math.sin(age * 30) * 0.25 * k;
      opts.sx = 1 + wob;
      opts.sy = 1 - wob;
    }
  }
  return opts;
}

// Dust puffs at ground level when a train docks. Small and low, drawn under
// the carts so they never hide one.
function drawPuffs() {
  for (const p of fx.puffs) {
    const k = p.t / p.life;
    circle(p.x, p.y - k * 4, 4 + k * 9, `rgba(255, 248, 228, ${0.6 * (1 - k)})`);
  }
}

// A rounded HONK bubble above the car that hit you.
function drawHonks() {
  for (const h of fx.honks) {
    if (state.traffic.includes(h.car)) {
      h.x = h.car.cx;
      h.y = h.car.cy;
    }
    if (h.x === undefined) continue;
    // Sit off to the side of the car away from the player, so the bubble
    // never covers the knocked-down player or their carts.
    if (h.side === undefined) h.side = center(state.player).x < h.x ? 1 : -1;
    const pop = easeOutBack(Math.min(1, h.t / 0.2));
    const alpha = h.t < 0.7 ? 1 : Math.max(0, 1 - (h.t - 0.7) / 0.3);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(h.x + h.side * 46, h.y - 40);
    ctx.scale(pop, pop);
    ctx.rotate(-0.08);
    ctx.beginPath();
    ctx.moveTo(-6, 12);
    ctx.lineTo(2, 22);
    ctx.lineTo(8, 12);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    rr(-30, -14, 60, 28, 14, '#ffffff', COLORS.outline, 2.5);
    ctx.fillStyle = COLORS.tomato;
    ctx.font = `900 16px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('HONK!', 0, 1);
    ctx.restore();
  }
}

// A sticker slapped on the awning after a good dock ("NICE TRAIN!").
function drawSticker() {
  const st = fx.sticker;
  if (!st) return;
  const pop = easeOutBack(Math.min(1, st.t / 0.25));
  const alpha = st.t < 1.2 ? 1 : Math.max(0, 1 - (st.t - 1.2) / 0.3);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2 + 205, 70);
  ctx.rotate(-0.12);
  ctx.scale(pop, pop);
  ctx.font = `900 20px ${FONT}`;
  const w = ctx.measureText(st.text).width + 34;
  rr(-w / 2 + 3, -18 + 4, w, 36, 18, 'rgba(59, 43, 43, 0.3)');
  rr(-w / 2, -18, w, 36, 18, COLORS.gold, '#ffffff', 5);
  rr(-w / 2, -18, w, 36, 18, null, COLORS.outline, 2);
  ctx.fillStyle = COLORS.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(st.text, 0, 1);
  ctx.restore();
}

function formatTime(t) {
  const s = Math.ceil(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---- UI kit: chunky rounded pills, cream panels, fat type, soft shadows ----

function pill(x, y, w, h, fill = COLORS.cream, r = h / 2) {
  rr(x, y + 4, w, h, r, 'rgba(59, 43, 43, 0.28)');
  rr(x, y, w, h, r, fill, COLORS.outline, 2.5);
}

function text(str, x, y, size, color, align = 'left', weight = 900, font = FONT) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

// Fat sticker lettering: a thick dark outline under a colored fill.
function stickerText(str, x, y, size, fill, scale = 1, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = Math.max(4, size * 0.16);
  ctx.strokeText(str, 0, size * 0.04);
  ctx.fillStyle = fill;
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

// Rounded meter: a cream track with a colored fill.
function meter(x, y, w, h, frac, fill) {
  rr(x, y, w, h, h / 2, COLORS.creamDark, COLORS.outline, 1.5);
  if (frac > 0) rr(x + 2, y + 2, Math.max(h - 4, (w - 4) * frac), h - 4, (h - 4) / 2, fill);
}

// Red-and-cream scalloped awning strip.
function awning(x, y, w, h = 18) {
  ctx.save();
  rrPath(x, y, w, h + 10, 10);
  ctx.clip();
  const stripe = 26;
  for (let sx = x, i = 0; sx < x + w; sx += stripe, i++) {
    ctx.fillStyle = i % 2 ? COLORS.awningStripe : COLORS.awning;
    ctx.fillRect(sx, y, stripe, h);
    ctx.beginPath();
    ctx.arc(sx + stripe / 2, y + h, stripe / 2, 0, Math.PI);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x + 8, y);
  ctx.lineTo(x + w - 8, y);
  ctx.stroke();
}

// A cream panel with an awning across its top.
function awningCard(x, y, w, h) {
  rr(x, y + 6, w, h, 22, 'rgba(59, 43, 43, 0.3)');
  rr(x, y, w, h, 22, COLORS.cream, COLORS.outline, 3);
  awning(x + 3, y + 3, w - 6, 20);
}

function dim(alpha = 0.6) {
  ctx.fillStyle = `rgba(40, 28, 40, ${alpha})`;
  ctx.fillRect(0, 0, W, H);
}

// ---- HUD ------------------------------------------------------------------

function drawHud() {
  const p = state.player;
  const n = p.train.length;

  // Score
  pill(12, 8, 112, 40, COLORS.cream, 16);
  text('SCORE', 26, 20, 9, COLORS.tomatoDark);
  text(String(state.score), 26, 36, 20, COLORS.ink);

  // Train: count, dock bonus, and a pip per cart
  pill(130, 8, 150, 40, COLORS.cream, 16);
  text(`TRAIN ${n}/${CONFIG.maxTrain}`, 144, 20, 9, COLORS.tomatoDark);
  if (n > 1) {
    rr(226, 12, 44, 16, 8, COLORS.gold, COLORS.outline, 1.5);
    text(`x${trainBonus(n)}`, 248, 20.5, 10, COLORS.ink, 'center');
  }
  for (let i = 0; i < CONFIG.maxTrain; i++) {
    rr(144 + i * 21, 29, 17, 11, 4, i < n ? COLORS.teal : COLORS.creamDark, COLORS.outline, 1.5);
  }

  // Shift clock
  const warn = state.timeLeft <= 30;
  pill(286, 8, 80, 40, warn ? '#ffe0d8' : COLORS.cream, 16);
  circle(304, 28, 8, '#ffffff', COLORS.outline, 2);
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(304, 28);
  ctx.lineTo(304, 23);
  ctx.moveTo(304, 28);
  ctx.lineTo(308, 30);
  ctx.stroke();
  text(formatTime(state.timeLeft), 318, 29, 17, warn ? COLORS.tomato : COLORS.ink);

  // Combo: multiplier and the window draining
  const live = state.combo.timer > 0;
  const kx = W - 172;
  pill(kx, 8, 160, 40, live ? '#fff0c2' : COLORS.cream, 16);
  text('COMBO', kx + 14, 20, 9, COLORS.tomatoDark);
  text(`${comboMult()}x`, kx + 14, 36, 20, live ? COLORS.tomato : 'rgba(59, 43, 43, 0.45)');
  meter(kx + 70, 22, 78, 13, live ? state.combo.timer / CONFIG.comboWindow : 0, COLORS.gold);

  // Stamina: a lightning bolt and a rounded meter
  const sy = H - 46;
  pill(12, sy, 206, 34, COLORS.cream, 17);
  ctx.fillStyle = p.exhausted ? COLORS.tomato : COLORS.gold;
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(33, sy + 6);
  ctx.lineTo(25, sy + 19);
  ctx.lineTo(31, sy + 19);
  ctx.lineTo(28, sy + 29);
  ctx.lineTo(38, sy + 14);
  ctx.lineTo(32, sy + 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  meter(46, sy + 10, 160, 14, p.stamina / CONFIG.staminaMax, p.exhausted ? COLORS.tomato : '#5fcf8a');

  // Keyboard controls, bottom right. Touch players have the on-screen pad instead.
  if (!state.touchUi) {
    const lines = [
      ['WASD / Arrows', 'move / steer'],
      ['Shift', 'sprint'],
      ['Space / E', 'grab · latch · dock'],
      ['Q', 'drop last cart'],
      ['Esc  ·  M', 'pause · mute'],
      ['R  ·  H', `restart · debug ${state.debug ? 'on' : 'off'}`],
    ];
    const cw = 222, ch = 14 + lines.length * 15;
    const cx = W - cw - 12, cy = H - ch - 12;
    rr(cx, cy + 4, cw, ch, 14, 'rgba(59, 43, 43, 0.25)');
    rr(cx, cy, cw, ch, 14, 'rgba(255, 246, 226, 0.92)', COLORS.outline, 2);
    lines.forEach(([k, v], i) => {
      text(k, cx + 12, cy + 14 + i * 15, 11, COLORS.tomatoDark, 'left', 900);
      text(v, cx + 104, cy + 14 + i * 15, 11, COLORS.ink, 'left', 700);
    });
  }

  // Message toast, bottom center
  if (state.message) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, state.message.t / 0.3);
    ctx.font = `900 14px ${FONT}`;
    const tw = ctx.measureText(state.message.text).width + 32;
    pill(W / 2 - tw / 2, H - 46, tw, 30, COLORS.cream);
    text(state.message.text, W / 2, H - 31, 14, COLORS.ink, 'center');
    ctx.restore();
  }
}

// Pause and mute: round cream buttons with drawn icons.
function drawHudButtons() {
  for (const b of hudButtons()) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2 + 4;
    circle(cx, cy + 3, 17, 'rgba(59, 43, 43, 0.28)');
    circle(cx, cy, 17, COLORS.cream, COLORS.outline, 2.5);
    ctx.fillStyle = COLORS.ink;
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    if (b.icon === 'pause') {
      rr(cx - 7, cy - 7, 5, 14, 2, COLORS.ink);
      rr(cx + 2, cy - 7, 5, 14, 2, COLORS.ink);
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 3);
      ctx.lineTo(cx - 6, cy - 3);
      ctx.lineTo(cx - 1, cy - 8);
      ctx.lineTo(cx - 1, cy + 8);
      ctx.lineTo(cx - 6, cy + 3);
      ctx.lineTo(cx - 10, cy + 3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      if (b.icon === 'muted') {
        ctx.moveTo(cx + 3, cy - 4);
        ctx.lineTo(cx + 10, cy + 4);
        ctx.moveTo(cx + 10, cy - 4);
        ctx.lineTo(cx + 3, cy + 4);
      } else {
        ctx.arc(cx + 1, cy, 5, -Math.PI / 3, Math.PI / 3);
        ctx.moveTo(cx + 1 + 9 * Math.cos(-Math.PI / 3), cy + 9 * Math.sin(-Math.PI / 3));
        ctx.arc(cx + 1, cy, 9, -Math.PI / 3, Math.PI / 3);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
}

// ---- Menus ------------------------------------------------------------------

// Chunky toy buttons: a colored cap on a darker lip. The keyboard-selected
// one gets a gold ring and a gentle pulse.
function drawMenuButtons() {
  menuButtons().forEach((b, i) => {
    const focused = i === state.menuFocus;
    const primary = b.action === 'play' || b.action === 'resume';
    const cap = primary ? COLORS.tomato : COLORS.cream;
    const lip = primary ? COLORS.tomatoDark : COLORS.creamDark;
    const ink = primary ? COLORS.cream : COLORS.ink;
    const s = focused ? 1 + Math.sin(fx.time * 5) * 0.02 : 1;
    ctx.save();
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.scale(s, s);
    const x = -b.w / 2, y = -b.h / 2;
    const r = Math.min(20, b.h / 2);
    if (focused) rr(x - 6, y - 6, b.w + 12, b.h + 14, r + 6, null, COLORS.gold, 5);
    rr(x, y + 6, b.w, b.h, r, lip, COLORS.outline, 2.5);
    rr(x, y, b.w, b.h, r, cap, COLORS.outline, 2.5);
    rr(x + 10, y + 5, b.w - 20, 6, 3, 'rgba(255, 255, 255, 0.35)');
    text(b.label, 0, 1, b.h > 48 ? 21 : 18, ink, 'center');
    ctx.restore();
  });
}

// Title: a marquee sign hanging over a sunburst, the pitch on a ribbon, a
// records sticker, and the attendant pushing a little train across the lot.
function drawTitle() {
  dim(0.3);
  drawSunburst(W / 2, 120);
  drawMarquee();
  drawRibbon('Round up carts into long trains and dock them before your shift ends!', W / 2, 210);
  drawMenuButtons();
  drawRecordsBadge(812, 128);
  drawParade();
  const hint = state.touchUi ? 'Tap Play to start' : 'Arrow keys + Enter, or click  ·  M mutes';
  ctx.font = `800 12px ${FONT}`;
  const hw = ctx.measureText(hint).width + 28;
  pill(W / 2 - hw / 2, 392, hw, 24, COLORS.cream);
  text(hint, W / 2, 404, 12, COLORS.ink, 'center', 800);
}

// Slowly turning cream rays behind the sign.
function drawSunburst(cx, cy) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(fx.time * 0.08);
  const rays = 18;
  for (let i = 0; i < rays; i++) {
    if (i % 2) continue;
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = ((i + 1) / rays) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 820, a0, a1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 236, 170, 0.16)';
    ctx.fill();
  }
  ctx.restore();
  const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 330);
  g.addColorStop(0, 'rgba(255, 244, 200, 0.45)');
  g.addColorStop(1, 'rgba(255, 244, 200, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// The logo: a chunky tomato sign on chains, ringed with blinking bulbs,
// "CART" and "JOCKEY" bouncing letter by letter.
function drawMarquee() {
  const x = 262, y = 30, w = 436, h = 146;
  const swing = Math.sin(fx.time * 1.4) * 0.012;
  ctx.save();
  ctx.translate(W / 2, 0);
  ctx.rotate(swing);
  ctx.translate(-W / 2, 0);

  // Chains up to the top of the screen
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 3;
  for (const cx of [x + 70, x + w - 70]) {
    for (let cy = -6; cy < y; cy += 10) {
      ctx.beginPath();
      ctx.ellipse(cx, cy + 5, 3.5, 5.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Board: darker lip, tomato face, cream inner border
  rr(x, y + 10, w, h, 34, COLORS.tomatoDark, COLORS.outline, 3);
  rr(x, y, w, h, 34, COLORS.tomato, COLORS.outline, 3);
  rr(x + 14, y + 14, w - 28, h - 28, 22, null, 'rgba(255, 246, 226, 0.85)', 3);
  rr(x + 30, y + 6, w - 60, 8, 4, 'rgba(255, 255, 255, 0.28)');

  // Bulbs around the edge, chasing
  const bulbs = [];
  for (let bx = x + 26; bx <= x + w - 26; bx += 29) {
    bulbs.push([bx, y + 7], [bx, y + h - 7]);
  }
  for (let by = y + 36; by <= y + h - 36; by += 30) {
    bulbs.push([x + 7, by], [x + w - 7, by]);
  }
  const chase = Math.floor(fx.time * 4);
  bulbs.forEach(([bx, by], i) => {
    const on = (i + chase) % 3 !== 0;
    if (on) circle(bx, by, 8, 'rgba(255, 236, 140, 0.35)');
    circle(bx, by, 4.5, on ? '#fff6c4' : '#e7b85a', COLORS.outline, 1.5);
  });

  // Letters, each bobbing a little out of step
  const word = (str, cy, size, fill, spacing) => {
    ctx.font = `900 ${size}px ${FONT}`;
    const widths = [...str].map((ch) => ctx.measureText(ch).width + spacing);
    const total = widths.reduce((a, b) => a + b, 0) - spacing;
    let lx = W / 2 - total / 2;
    [...str].forEach((ch, i) => {
      const bob = Math.sin(fx.time * 3 + i * 0.7) * 3;
      const tilt = Math.sin(fx.time * 2 + i) * 0.05;
      ctx.save();
      ctx.translate(lx + widths[i] / 2 - spacing / 2, cy + bob);
      ctx.rotate(tilt);
      stickerText(ch, 0, 0, size, fill);
      ctx.restore();
      lx += widths[i];
    });
  };
  word('CART', y + 48, 46, COLORS.gold, 4);
  word('JOCKEY', y + 104, 58, COLORS.cream, 3);

  // A smiling cart peeking over the top corner of the sign
  drawCartIcon(x + w - 44, y - 4 + Math.sin(fx.time * 3) * 2, 1.5, true);
  ctx.restore();
}

// A cream ribbon banner with folded tails.
function drawRibbon(str, cx, cy) {
  ctx.font = `800 15px ${FONT}`;
  const w = ctx.measureText(str).width + 60;
  const h = 32;
  const x = cx - w / 2;
  const y = cy - h / 2;
  for (const side of [-1, 1]) {
    const ex = side < 0 ? x + 8 : x + w - 8;
    ctx.beginPath();
    ctx.moveTo(ex, y + 8);
    ctx.lineTo(ex + side * 34, y + 8);
    ctx.lineTo(ex + side * 22, y + h / 2 + 8);
    ctx.lineTo(ex + side * 34, y + h + 8);
    ctx.lineTo(ex, y + h + 8);
    ctx.closePath();
    ctx.fillStyle = COLORS.creamDark;
    ctx.fill();
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  rr(x, y + 4, w, h, 10, 'rgba(59, 43, 43, 0.25)');
  rr(x, y, w, h, 10, COLORS.cream, COLORS.outline, 2.5);
  text(str, cx, cy + 1, 15, COLORS.ink, 'center', 800);
}

// Gold starburst sticker with the saved records.
function drawRecordsBadge(cx, cy) {
  const s = state.saved;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(0.14 + Math.sin(fx.time * 1.6) * 0.03);
  const points = 16;
  const star = (ro, ri) => {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = (i * Math.PI) / points;
      const r = i % 2 ? ri : ro;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
  };
  ctx.translate(3, 5);
  star(66, 56);
  ctx.fillStyle = 'rgba(59, 43, 43, 0.3)';
  ctx.fill();
  ctx.translate(-3, -5);
  star(66, 56);
  ctx.fillStyle = COLORS.gold;
  ctx.fill();
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  circle(0, 0, 48, null, 'rgba(255, 255, 255, 0.7)', 2);
  text('HIGH SCORE', 0, -22, 10, COLORS.tomatoDark, 'center', 900);
  stickerText(String(s.highScore), 0, 2, 28, COLORS.cream);
  text(`BEST COMBO ${CONFIG.comboMults[s.bestComboLevel]}x`, 0, 28, 9, COLORS.ink, 'center', 900);
  ctx.restore();
}

// The attendant happily pushing a three-cart train across the bottom of the
// screen, looping forever.
function drawParade() {
  const k = 1.7;
  const span = W + 260;
  const baseX = ((fx.time * 48) % span) - 150;
  const baseY = 470;
  ctx.save();
  ctx.translate(baseX, baseY);
  ctx.scale(k, k);
  const hop = Math.abs(Math.sin(fx.time * 6)) * 0.8;
  for (let i = 2; i >= 0; i--) {
    drawCartProp(21 + i * 16, 0, 0, i === 2 ? 'stray' : 'standard', { lift: hop });
  }
  drawAttendant({
    x: 0,
    y: 4,
    s: 1,
    fxd: 1,
    fyd: 0,
    moving: true,
    sprint: false,
    step: fx.time * 7,
    pushing: true,
    sitting: false,
    hitAge: 1,
    faded: false,
  });
  ctx.restore();
}

function drawHowTo() {
  dim(0.5);
  awningCard(110, 50, W - 220, H - 84);
  stickerText('HOW TO PLAY', W / 2, 96, 30, COLORS.gold);

  const touch = state.touchUi;
  const grab = touch ? 'GRAB' : 'Space / E';
  const lines = [
    `Move with ${touch ? 'the stick' : 'WASD or the arrow keys'}. ${touch ? 'SPRINT' : 'Shift'} runs while your stamina lasts.`,
    `${grab} grabs a cart. Nose into more carts and press ${grab} again to latch them on, up to 6.`,
    `Push the front cart into the CART CORRAL and press ${grab} to dock the whole train.`,
    'Longer trains are slower and turn wider, but pay more: each extra cart adds x0.5.',
    'Yellow-tagged strays, tucked between parked cars or on the curb, are worth double.',
    'Dock again within 12 seconds with freshly collected carts to climb the combo: 1.5x, 2x, 3x.',
    'Cars come and go all shift. A hit drops your whole train and costs 5 seconds.',
    `${touch ? 'DROP' : 'Q'} drops the last cart. ${touch ? 'The pause button' : 'Esc'} pauses. Grade is your score against par.`,
  ];
  const dots = [COLORS.tomato, COLORS.gold, COLORS.teal, '#5b7fe0', '#ff8a70', '#b99af0', '#7ed9b0', '#ffb38a'];
  lines.forEach((line, i) => {
    const y = 136 + i * 35;
    circle(150, y, 6, dots[i % dots.length], COLORS.outline, 1.5);
    text(line, 166, y, 14.5, COLORS.ink, 'left', 700);
  });
  drawMenuButtons();
}

function drawPaused() {
  dim(0.45);
  awningCard(300, 108, 360, 318);
  stickerText('PAUSED', W / 2, 160, 38, COLORS.cream);
  drawMenuButtons();
  text(state.touchUi ? 'Tap Resume to keep going' : 'Esc to resume', W / 2, 410, 12, 'rgba(59, 43, 43, 0.6)', 'center', 700);
}

// The end screen, printed like a shift receipt.
function drawTally() {
  dim(0.5);
  const x = W / 2 - 150, y = 12, w = 300, h = 396;
  const tooth = 8;
  const paper = () => {
    ctx.beginPath();
    ctx.moveTo(x, y + tooth);
    for (let tx = x; tx < x + w; tx += tooth * 2) {
      ctx.lineTo(tx + tooth, y);
      ctx.lineTo(Math.min(x + w, tx + tooth * 2), y + tooth);
    }
    ctx.lineTo(x + w, y + h - tooth);
    for (let tx = x + w; tx > x; tx -= tooth * 2) {
      ctx.lineTo(tx - tooth, y + h);
      ctx.lineTo(Math.max(x, tx - tooth * 2), y + h - tooth);
    }
    ctx.closePath();
  };
  ctx.save();
  ctx.translate(5, 7);
  paper();
  ctx.fillStyle = 'rgba(30, 20, 30, 0.35)';
  ctx.fill();
  ctx.restore();
  paper();
  ctx.fillStyle = '#fffdf6';
  ctx.fill();
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = 2;
  ctx.stroke();

  const left = x + 22;
  const right = x + w - 22;
  const ink = '#2e2a2a';
  drawCartIcon(W / 2, y + 30, 1.2, true);
  text('CART JOCKEY MARKET', W / 2, y + 56, 15, ink, 'center', 800, MONO);
  text('SHIFT RECEIPT', W / 2, y + 74, 11, ink, 'center', 500, MONO);
  text(new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }), W / 2, y + 89, 10, '#6f6a66', 'center', 500, MONO);

  const dashed = (yy) => {
    ctx.strokeStyle = '#8f8a84';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(left, yy);
    ctx.lineTo(right, yy);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  // "LABEL ........ VALUE"
  const row = (label, value, yy, bold = false, flag = '') => {
    const wt = bold ? 800 : 500;
    text(label, left, yy, 12, ink, 'left', wt, MONO);
    text(value, right, yy, 12, ink, 'right', wt, MONO);
    ctx.font = `${wt} 12px ${MONO}`;
    const lw = ctx.measureText(label).width;
    const vw = ctx.measureText(value).width;
    ctx.fillStyle = '#b5afa8';
    for (let dx = left + lw + 6; dx < right - vw - 6; dx += 5) ctx.fillRect(dx, yy + 3, 1.5, 1.5);
    if (flag) {
      rr(right - vw - 44, yy - 7, 34, 14, 7, COLORS.tomato);
      text(flag, right - vw - 27, yy + 0.5, 8, '#ffffff', 'center', 900);
    }
  };

  const s = state.saved;
  dashed(y + 102);
  row('CARTS RETURNED', String(state.docked), y + 120);
  row('BEST TRAIN', `${state.best.train}/${CONFIG.maxTrain}`, y + 139);
  row('BEST COMBO', `${CONFIG.comboMults[state.best.comboLevel]}x`, y + 158, false, state.newRecord.combo ? 'NEW' : '');
  row('HIGH SCORE', String(s.highScore), y + 177, false, state.newRecord.score ? 'NEW' : '');
  dashed(y + 193);
  row('SCORE', String(state.score), y + 211, true);
  row('PAR', String(CONFIG.parScore), y + 230);
  row('PERCENT', `${scorePercent(state.score)}%`, y + 249);
  dashed(y + 265);

  // Grade: a rubber stamp
  const grade = gradeFor(state.score);
  ctx.save();
  ctx.translate(W / 2 + 70, y + 305);
  ctx.rotate(-0.16);
  const stamp = grade === 'F' ? '#c62f24' : grade === 'A' ? '#1f9a70' : '#d0622a';
  ctx.globalAlpha = 0.9;
  circle(0, 0, 30, null, stamp, 4);
  circle(0, 0, 24, null, stamp, 1.5);
  text(grade, 0, 2, 34, stamp, 'center', 900);
  ctx.restore();
  text('GRADE', left, y + 294, 12, ink, 'left', 800, MONO);
  const scale = CONFIG.grades.map((g) => (g.min > 0 ? `${g.grade}${g.min}+` : `${g.grade}<${CONFIG.grades[CONFIG.grades.length - 2].min}`)).join(' ');
  text(scale, left, y + 312, 9, '#6f6a66', 'left', 500, MONO);
  if (state.newRecord.score) text('** NEW HIGH SCORE **', left, y + 330, 10, COLORS.tomato, 'left', 800, MONO);

  // Barcode and thanks
  let bx = W / 2 - 60;
  let seed = state.score + 17;
  while (bx < W / 2 + 60) {
    seed = (seed * 9301 + 49297) % 233280;
    const bw = 1 + (seed % 3);
    ctx.fillStyle = ink;
    ctx.fillRect(bx, y + 346, bw, 22);
    bx += bw + 1 + (seed % 2);
  }
  text('THANK YOU FOR RETURNING CARTS!', W / 2, y + 378, 9, ink, 'center', 700, MONO);

  drawMenuButtons();
  if (!state.touchUi) text('R plays again', W / 2, 482, 11, 'rgba(255, 246, 226, 0.8)', 'center', 700);
}

// ---- Countdown, GO!, final stretch ----------------------------------------

// "3, 2, 1" before the shift: each number pops in large and settles.
function drawCountdown() {
  dim(0.25);
  const n = Math.max(1, Math.ceil(state.countdown));
  const into = n - state.countdown; // 0 when the number appears, 1 when it's replaced
  const pop = 1 + 0.5 * Math.max(0, 1 - into / 0.25);
  pill(W / 2 - 90, 150, 180, 40, COLORS.cream);
  text('GET READY', W / 2, 171, 20, COLORS.ink, 'center');
  stickerText(String(n), W / 2, 300, 150, COLORS.gold, pop);
}

// GO! right after the countdown, growing and fading out.
function drawGo() {
  const t = state.goFlash / 0.8; // 1 -> 0
  stickerText('GO!', W / 2, 280, 130, '#6fdc9a', 1 + (1 - t) * 0.4, Math.min(1, t * 1.5));
}

// The final stretch: a big tomato clock over the store sign that thumps on
// every second, with a red glow around the edge of the lot. The last five
// seconds thump harder.
function drawFinalClock() {
  const t = state.timeLeft;
  const frac = t - Math.floor(t); // 1 -> 0 through each second
  const urgent = t <= 5;
  const beat = Math.max(0, (frac - 0.7) / 0.3); // 1 right as a new second starts
  const scale = 1 + (urgent ? 0.35 : 0.18) * beat;

  const glow = (urgent ? 0.55 : 0.3) * (0.4 + 0.6 * beat);
  ctx.save();
  ctx.strokeStyle = `rgba(232, 60, 45, ${glow})`;
  ctx.lineWidth = urgent ? 16 : 10;
  rrPath(0, 0, W, H, 18);
  ctx.stroke();
  ctx.restore();

  const bw = 170, bh = 62;
  ctx.save();
  ctx.translate(W / 2, 8 + bh / 2);
  ctx.scale(scale, scale);
  rr(-bw / 2, -bh / 2 + 6, bw, bh, 26, COLORS.tomatoDark, COLORS.outline, 3);
  rr(-bw / 2, -bh / 2, bw, bh, 26, urgent ? '#f0402f' : COLORS.tomato, COLORS.outline, 3);
  rr(-bw / 2 + 14, -bh / 2 + 6, bw - 28, 7, 3.5, 'rgba(255, 255, 255, 0.3)');
  stickerText(formatTime(t), 0, 2, 40, COLORS.cream);
  ctx.restore();
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

  // Shoppers: box (solid when pushing a cart) and the rest of their walk
  for (const sh of state.shoppers) {
    const b = shopperBox(sh);
    ctx.strokeStyle = sh.cartId ? '#b6ff3b' : 'rgba(182, 255, 59, 0.5)';
    ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    if (sh.path) {
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(sh.x, sh.y);
      for (const pt of sh.path.slice(sh.idx)) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
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
  ctx.fillText(`parked ${state.parked.size}  moving ${state.traffic.length}  shoppers ${state.shoppers.length}  arrive ${state.arriveTimer.toFixed(1)}`, lx, 152);
}

// Advance presentation-only animation clocks (frozen while paused).
function tickFx() {
  const now = performance.now();
  const dt = fx.lastNow ? Math.min(0.05, (now - fx.lastNow) / 1000) : 0;
  fx.lastNow = now;
  if (state.phase === 'paused') return;
  fx.time += dt;
  for (const list of [fx.ghosts, fx.puffs, fx.honks]) for (const e of list) e.t += dt;
  fx.ghosts = fx.ghosts.filter((g) => g.t < 0.75);
  fx.puffs = fx.puffs.filter((p) => p.t < p.life);
  fx.honks = fx.honks.filter((h) => h.t < 1);
  if (fx.sticker) {
    fx.sticker.t += dt;
    if (fx.sticker.t > 1.5) fx.sticker = null;
  }
  fx.binFlash = Math.max(0, fx.binFlash - dt);
  const p = state.player;
  const pos = { x: p.x, y: p.y };
  const moved = fx.lastPos ? Math.hypot(pos.x - fx.lastPos.x, pos.y - fx.lastPos.y) : 0;
  fx.lastPos = pos;
  if (moved < 40) {
    fx.walk += moved;
    fx.speed = dt > 0 ? fx.speed * 0.7 + (moved / dt) * 0.3 : fx.speed;
  }
}

function draw() {
  tickFx();
  drawWorld();
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
  spawnShopperFromStore, planWalk, makeLook,
};
