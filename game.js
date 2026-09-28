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
  // Shift
  shiftSeconds: SHIFT_OVERRIDE > 0 ? SHIFT_OVERRIDE : 180,
  comboWindow: 12, // seconds after a dock to land the next one
  comboMults: [1, 1.5, 2, 3],
  strayMax: 3, // strays out in the lot at once
  strayRespawn: 10, // seconds between stray spawns while below the max
  strayMinSpawnDist: 120, // strays never pop in right next to the player
  // Moving car
  carSpeed: 110,
  carHitTimePenalty: 5,
  hitInvuln: 2, // seconds the player can't be hit again
  hitStun: 0.4, // seconds of no control after a hit
  // Grade by final score
  grades: [
    { min: 900, grade: 'S' },
    { min: 600, grade: 'A' },
    { min: 300, grade: 'B' },
    { min: 0, grade: 'C' },
  ],
};

const CART_SIZE = 20;

// ---------------------------------------------------------------------------
// Lot layout (game rules: what is solid, where the corral and bin are)
// ---------------------------------------------------------------------------

const SPACE_W = 48;
const SPACE_D = 64;
const ROW_X0 = 96;
const ROW_COUNT = 16;
const RAIL = 6;

// Parked cars per row, one character per space: C = parked car, . = empty,
// B = return bin. Spaces 6-9 in rows A and B stay open as a clear lane
// between the bin and the corral; row C is sparse so long trains can turn.
const PARKING = {
  A: 'CC.C.C....C.CC.C',
  B: 'C.CC.C....CC.CC.',
  C: '.C.C...BB..C.C.C',
};
const CAR_COLORS = ['#3d6fb6', '#b8423a', '#e0dccf', '#2f8a5b', '#6c6f75', '#1f2a3a', '#c9a13b'];

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

  // Parking rows: A and B are back to back, C is alone below the second aisle.
  // `open` is the side a car drives in from.
  const rows = [
    { id: 'A', y: 200, facing: 'down', open: 'up' },
    { id: 'B', y: 264, facing: 'up', open: 'down' },
    { id: 'C', y: 392, facing: 'up', open: 'up' },
  ];
  const rowW = SPACE_W * ROW_COUNT;

  // Return bin takes two spaces in row C, open toward the aisle above it.
  // Carts nest in two lanes and slide toward the open end.
  const binIndex = PARKING.C.indexOf('B');
  const bin = { x: ROW_X0 + binIndex * SPACE_W, y: 392, w: SPACE_W * 2, h: SPACE_D };
  const binRails = [
    { x: bin.x, y: bin.y, w: RAIL, h: bin.h, kind: 'rail' },
    { x: bin.x + bin.w - RAIL, y: bin.y, w: RAIL, h: bin.h, kind: 'rail' },
    { x: bin.x, y: bin.y + bin.h - RAIL, w: bin.w, h: RAIL, kind: 'rail' },
  ];
  const laneW = (bin.w - RAIL * 2) / 2;
  const binLanes = [0, 1].map((i) => ({ x: bin.x + RAIL + laneW * i + (laneW - CART_SIZE) / 2 }));
  const binDepth = 4; // carts per lane
  const binSlotY = (k) => bin.y + 6 + k * 10;

  const parkedCars = [];
  const straySpots = [];
  for (const row of rows) {
    const pattern = PARKING[row.id];
    for (let i = 0; i < ROW_COUNT; i++) {
      const sx = ROW_X0 + i * SPACE_W;
      if (pattern[i] === 'C') {
        parkedCars.push({
          x: sx + 6, y: row.y + 4, w: SPACE_W - 12, h: SPACE_D - 8,
          kind: 'car', color: CAR_COLORS[(i * 3 + row.y) % CAR_COLORS.length], nose: row.facing,
        });
      } else if (pattern[i] === '.' && pattern[i - 1] === 'C' && pattern[i + 1] === 'C') {
        // An empty space squeezed between two parked cars: a stray hides here.
        straySpots.push({
          x: sx + (SPACE_W - CART_SIZE) / 2,
          y: row.y + (SPACE_D - CART_SIZE) / 2,
          angle: row.open === 'up' ? Math.PI / 2 : -Math.PI / 2,
          where: 'space',
        });
      }
    }
  }
  // Strays left up on the sidewalk curb, clear of the doors and the corral.
  for (const x of [110, 190, 640, 760, 860]) {
    straySpots.push({ x: x - CART_SIZE / 2, y: 136, angle: 0, where: 'curb' });
  }

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
  const accessibleSpaces = [
    { row: 'A', index: 2 },
    { row: 'A', index: 4 },
  ];

  // The moving car loops the outer lane clockwise: along the fire lane past
  // the corral mouth, down the right edge, along the bottom, up the left edge.
  const carRoute = [
    { x: 28, y: 180 },
    { x: 932, y: 180 },
    { x: 932, y: 500 },
    { x: 28, y: 500 },
  ];

  const solids = [
    { ...store, kind: 'store' },
    ...corralRails,
    ...binRails,
    ...parkedCars,
    ...islands,
    ...lampPosts,
  ];

  return {
    store, sidewalk, doors, corral, corralRails, returnZone, rows, rowW,
    bin, binRails, binLanes, binDepth, binSlotY, parkedCars, straySpots, carRoute,
    islands, lampPosts, accessibleSpaces, solids,
  };
}

const LOT = buildLot();
const BIN_CAPACITY = LOT.binLanes.length * LOT.binDepth;
const ROUTE_LEGS = LOT.carRoute.map((a, i) => {
  const b = LOT.carRoute[(i + 1) % LOT.carRoute.length];
  return { a, b, len: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
});
const ROUTE_LEN = ROUTE_LEGS.reduce((s, l) => s + l.len, 0);

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

function makeCar() {
  // Start partway down the right edge so the first pass isn't instant.
  return { dist: ROUTE_LEGS[0].len + 60, x: 0, y: 0, w: 0, h: 0, angle: 0 };
}

const state = {
  debug: false,
  phase: 'playing', // 'playing' | 'over'
  timeLeft: CONFIG.shiftSeconds,
  score: 0,
  docked: 0,
  combo: { level: 0, timer: 0 }, // level indexes CONFIG.comboMults; timer counts down the window
  best: { train: 0, comboLevel: 0 },
  strayTimer: CONFIG.strayRespawn,
  nextCartId: 1,
  carts: [], // status: 'inBin' | 'loose' | 'train'
  car: makeCar(),
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

// Put a stray on a random free spot away from the player. Returns null if none fits.
function spawnStray() {
  const pc = center(state.player);
  const bodies = [state.player, ...trainCarts(), ...state.carts];
  const open = LOT.straySpots.filter((s) => {
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

function resetSession() {
  state.phase = 'playing';
  state.timeLeft = CONFIG.shiftSeconds;
  state.score = 0;
  state.docked = 0;
  state.combo = { level: 0, timer: 0 };
  state.best = { train: 0, comboLevel: 0 };
  state.strayTimer = CONFIG.strayRespawn;
  state.nextCartId = 1;
  state.carts = [];
  state.car = makeCar();
  state.player = makePlayer();
  state.message = null;
  for (let i = 0; i < BIN_CAPACITY; i++) spawnCartInBin();
  for (let i = 0; i < CONFIG.strayMax; i++) spawnStray();
  placeCar(state.car);
}

function showMessage(text, time = CONFIG.messageTime) {
  state.message = { text, t: time };
}

// ---------------------------------------------------------------------------
// Input: keys map to actions so touch can call the same actions later.
// ---------------------------------------------------------------------------

const held = { up: false, down: false, left: false, right: false, sprint: false };

const KEY_TO_HELD_ACTION = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
};

const KEY_TO_PRESS_ACTION = {
  KeyH: 'toggleDebug',
  Space: 'interact',
  KeyE: 'interact',
  KeyQ: 'dropLast',
  KeyR: 'restart',
};

function setHeld(action, isDown) {
  if (action in held) held[action] = isDown;
}

function pressAction(action) {
  if (action === 'toggleDebug') state.debug = !state.debug;
  else if (action === 'restart') resetSession();
  else if (state.phase !== 'playing') return; // play is frozen on the tally
  else if (action === 'interact') interact();
  else if (action === 'dropLast') dropLast();
}

window.addEventListener('keydown', (e) => {
  const heldAction = KEY_TO_HELD_ACTION[e.code];
  if (heldAction) {
    setHeld(heldAction, true);
    e.preventDefault();
    return;
  }
  const pressed = KEY_TO_PRESS_ACTION[e.code];
  if (pressed) {
    if (!e.repeat) pressAction(pressed);
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  const heldAction = KEY_TO_HELD_ACTION[e.code];
  if (heldAction) setHeld(heldAction, false);
});

// Avoid stuck keys when the window loses focus.
window.addEventListener('blur', () => {
  for (const k in held) held[k] = false;
});

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

function hitsWorld(b, blockers = LOT.solids) {
  if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) return true;
  return blockers.some((s) => overlaps(b, s));
}

// Everything that blocks these moving bodies: the lot's solids plus free
// carts. A free cart the bodies already overlap (one just dropped off the
// nose, say) is ignored so it can't snag them; it blocks again once clear.
function blockersFor(bodies) {
  const free = state.carts.filter((c) => c.status !== 'train' && !bodies.some((b) => overlaps(b, c)));
  return LOT.solids.concat(free);
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

function comboMult() {
  return CONFIG.comboMults[state.combo.level];
}

function gradeFor(score) {
  return CONFIG.grades.find((g) => score >= g.min).grade;
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

function cartInReturnZone(cart) {
  const c = center(cart);
  const z = LOT.returnZone;
  return c.x >= z.x && c.x <= z.x + z.w && c.y >= z.y && c.y <= z.y + z.h;
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
  state.best.train = Math.max(state.best.train, p.train.length);
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

// Score only happens here. A dock inside the combo window raises the
// multiplier one step; the window restarts on every dock.
function dockTrain() {
  const p = state.player;
  const carts = trainCarts();
  const n = carts.length;

  if (state.combo.timer > 0) {
    state.combo.level = Math.min(state.combo.level + 1, CONFIG.comboMults.length - 1);
  } else {
    state.combo.level = 0;
  }
  state.combo.timer = CONFIG.comboWindow;
  state.best.comboLevel = Math.max(state.best.comboLevel, state.combo.level);

  const base = carts.reduce((sum, c) => sum + CONFIG.cartValue[c.kind], 0);
  const mult = comboMult();
  const points = Math.round(base * mult);
  const standardCount = carts.filter((c) => c.kind === 'standard').length;

  const ids = new Set(carts.map((c) => c.id));
  state.carts = state.carts.filter((c) => !ids.has(c.id));
  p.train = [];
  state.score += points;
  state.docked += n;
  showMessage(`+${points}  ${n} cart${n === 1 ? '' : 's'} docked${mult > 1 ? `  (${mult}x combo)` : ''}`);
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

function placeCar(car) {
  let d = car.dist % ROUTE_LEN;
  let leg = ROUTE_LEGS[0];
  for (const l of ROUTE_LEGS) {
    if (d <= l.len) {
      leg = l;
      break;
    }
    d -= l.len;
  }
  const t = d / leg.len;
  const cx = leg.a.x + (leg.b.x - leg.a.x) * t;
  const cy = leg.a.y + (leg.b.y - leg.a.y) * t;
  const horizontal = Math.abs(Math.cos(leg.angle)) > 0.5;
  car.angle = leg.angle;
  car.w = horizontal ? 50 : 30;
  car.h = horizontal ? 30 : 50;
  car.x = cx - car.w / 2;
  car.y = cy - car.h / 2;
}

// Shove a body sideways out of the car's path, respecting walls.
function knockAside(body, car) {
  const bc = center(body);
  const cc = center(car);
  const sideX = -Math.sin(car.angle);
  const sideY = Math.cos(car.angle);
  const side = (bc.x - cc.x) * sideX + (bc.y - cc.y) * sideY >= 0 ? 1 : -1;
  const push = Math.max(car.w, car.h) / 2 + 12;
  for (let i = 0; i < 8 && overlaps(body, car); i++) {
    moveGroup([body], sideX * side * push / 4, sideY * side * push / 4);
  }
}

function hitByCar() {
  const p = state.player;
  const car = state.car;
  const dropped = trainCarts();
  for (const cart of dropped) cart.status = 'loose';
  p.train = [];
  for (const cart of dropped) if (overlaps(cart, car)) knockAside(cart, car);
  knockAside(p, car);

  p.invuln = CONFIG.hitInvuln;
  p.stun = CONFIG.hitStun;
  state.timeLeft = Math.max(0, state.timeLeft - CONFIG.carHitTimePenalty);
  breakCombo();
  showMessage(`Hit by a car!  -${CONFIG.carHitTimePenalty}s${dropped.length ? `, dropped ${dropped.length}` : ''}`);
}

function updateCar(dt) {
  const car = state.car;
  car.dist = (car.dist + CONFIG.carSpeed * dt) % ROUTE_LEN;
  placeCar(car);
  const p = state.player;
  if (p.invuln > 0) return;
  if (overlaps(car, p) || trainCarts().some((c) => overlaps(car, c))) hitByCar();
}

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
  if (state.timeLeft === 0) endShift();
}

function endShift() {
  state.phase = 'over';
  state.player.sprinting = false;
  state.message = null;
}

function update(dt) {
  if (state.message) {
    state.message.t -= dt;
    if (state.message.t <= 0) state.message = null;
  }
  if (state.phase !== 'playing') return;
  updatePlayer(dt);
  updateCar(dt);
  updateBin(dt);
  updateStrays(dt);
  updateShift(dt);
}

resetSession();

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let viewScale = 1;

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
  cart: '#c9ced6',
  cartOutline: '#4a4f57',
  cartHandle: '#d8342c',
  strayTag: '#ffd23f',
  movingCar: '#e8702a',
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
  // Closed end of each space (the side a car's nose would face)
  const endY = row.facing === 'down' ? row.y + SPACE_D : row.y;
  ctx.beginPath();
  ctx.moveTo(ROW_X0, endY);
  ctx.lineTo(ROW_X0 + rowW, endY);
  ctx.stroke();

  for (const s of LOT.accessibleSpaces) {
    if (s.row !== row.id) continue;
    const x = ROW_X0 + s.index * SPACE_W;
    ctx.fillStyle = COLORS.accessible;
    ctx.fillRect(x + 3, row.y + 3, SPACE_W - 6, SPACE_D - 6);
    ctx.fillStyle = COLORS.paint;
    ctx.beginPath();
    ctx.arc(x + SPACE_W / 2, row.y + SPACE_D / 2, 9, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAisleArrows() {
  ctx.fillStyle = 'rgba(232, 230, 223, 0.55)';
  const arrow = (x, y, dir) => {
    ctx.beginPath();
    ctx.moveTo(x + 14 * dir, y);
    ctx.lineTo(x - 8 * dir, y - 8);
    ctx.lineTo(x - 8 * dir, y + 8);
    ctx.closePath();
    ctx.fill();
  };
  for (let x = 200; x < W - 100; x += 280) {
    arrow(x, 180, 1);
    arrow(x + 80, 360, -1);
    arrow(x, 498, -1);
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

function drawParkedCars() {
  for (const car of LOT.parkedCars) {
    fillRect(car, car.color);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(car.x + 0.5, car.y + 0.5, car.w - 1, car.h - 1);
    // Windshield on the nose end, rear window on the other
    ctx.fillStyle = 'rgba(20, 30, 45, 0.7)';
    const noseDown = car.nose === 'down';
    ctx.fillRect(car.x + 4, noseDown ? car.y + car.h - 20 : car.y + 8, car.w - 8, 12);
    ctx.fillRect(car.x + 5, noseDown ? car.y + 8 : car.y + car.h - 17, car.w - 10, 9);
  }
}

// Car drawn in its own frame: +x is its direction of travel.
function drawMovingCar() {
  const car = state.car;
  const c = center(car);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = COLORS.movingCar;
  ctx.fillRect(-25, -15, 50, 30);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(-25, -15, 50, 30);
  ctx.fillStyle = 'rgba(20, 30, 45, 0.75)';
  ctx.fillRect(6, -11, 10, 22); // windshield
  ctx.fillRect(-18, -10, 7, 20); // rear window
  ctx.fillStyle = '#fff6b0';
  ctx.fillRect(22, -13, 3, 6); // headlights
  ctx.fillRect(22, 7, 3, 6);
  ctx.restore();
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

  // Score, train length and shift clock, top left over the store roof
  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(12, 12, 320, 30);
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.hudText;
  ctx.fillText(`SCORE ${state.score}`, 22, 27);
  ctx.fillStyle = p.train.length >= CONFIG.maxTrain ? COLORS.hudGold : COLORS.hudText;
  ctx.fillText(`TRAIN ${p.train.length}/${CONFIG.maxTrain}`, 142, 27);
  ctx.fillStyle = state.timeLeft <= 30 ? COLORS.hudWarn : COLORS.hudText;
  ctx.fillText(formatTime(state.timeLeft), 272, 27);

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

  // Controls, bottom right
  const lines = [
    'WASD / Arrows  move / steer',
    'Shift  sprint',
    'Space / E  grab / latch / dock',
    'Q  drop last cart',
    'R  restart shift',
    `H  debug boxes (${state.debug ? 'on' : 'off'})`,
  ];
  const cw = 210, ch = 14 + lines.length * 16;
  const cx = W - cw - 12, cy = H - ch - 12;
  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(cx, cy, cw, ch);
  ctx.fillStyle = COLORS.hudText;
  ctx.font = '12px system-ui, sans-serif';
  lines.forEach((line, i) => ctx.fillText(line, cx + 10, cy + 15 + i * 16));

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

function drawTally() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, W, H);

  const pw = 360, ph = 290;
  const px = (W - pw) / 2, py = (H - ph) / 2;
  ctx.fillStyle = '#f6efe0';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = COLORS.storeRoof;
  ctx.lineWidth = 4;
  ctx.strokeRect(px + 2, py + 2, pw - 4, ph - 4);

  ctx.fillStyle = COLORS.storeRoof;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText('SHIFT OVER', W / 2, py + 34);

  const rows = [
    ['Score', String(state.score)],
    ['Carts returned', String(state.docked)],
    ['Best train', `${state.best.train} / ${CONFIG.maxTrain}`],
    ['Best combo', `${CONFIG.comboMults[state.best.comboLevel]}x`],
  ];
  ctx.font = '16px system-ui, sans-serif';
  rows.forEach(([label, value], i) => {
    const y = py + 78 + i * 28;
    ctx.fillStyle = '#3a3a3a';
    ctx.textAlign = 'left';
    ctx.fillText(label, px + 34, y);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'right';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(value, px + pw - 34, y);
    ctx.font = '16px system-ui, sans-serif';
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = '#3a3a3a';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('GRADE', W / 2 - 50, py + 208);
  ctx.fillStyle = COLORS.storeRoof;
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillText(gradeFor(state.score), W / 2 + 10, py + 208);

  ctx.fillStyle = '#3a3a3a';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('Press R for a new shift', W / 2, py + ph - 26);
}

function drawDebug() {
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ff3b3b';
  for (const s of LOT.solids) ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);

  ctx.strokeStyle = '#3bff6b';
  const z = LOT.returnZone;
  ctx.strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);

  // Every cart, free or in the train
  ctx.strokeStyle = '#ff4fd8';
  for (const cart of state.carts) ctx.strokeRect(cart.x + 0.5, cart.y + 0.5, cart.w - 1, cart.h - 1);

  // Moving car hitbox and route
  const car = state.car;
  ctx.strokeStyle = '#ff9d2e';
  ctx.strokeRect(car.x + 0.5, car.y + 0.5, car.w - 1, car.h - 1);
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  LOT.carRoute.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

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
    const a = p.train[p.train.length - 1].angle;
    ctx.moveTo(h.x, h.y);
    ctx.arc(h.x, h.y, CONFIG.latchRange, a - CONFIG.latchCone, a + CONFIG.latchCone);
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
  ctx.fillRect(W - 262, 50, 250, 96);
  ctx.fillStyle = COLORS.hudText;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`pos ${p.x.toFixed(0)},${p.y.toFixed(0)}  stam ${p.stamina.toFixed(0)}`, W - 254, 62);
  ctx.fillText(`sprint ${p.sprinting}  exhausted ${p.exhausted}`, W - 254, 80);
  ctx.fillText(`carts ${state.carts.length}  bin ${state.carts.filter((c) => c.status === 'inBin').length}  strays ${strayCount()}  train ${n}`, W - 254, 98);
  ctx.fillText(
    n ? `speed x${trainSpeedMult(n).toFixed(2)}  turnR ${turnRadius(n)}  noseIn ${cartInReturnZone(nose)}` : 'speed x1.00',
    W - 254, 116,
  );
  ctx.fillText(`combo ${state.combo.timer.toFixed(1)}s  invuln ${p.invuln.toFixed(1)}  stray in ${state.strayTimer.toFixed(1)}`, W - 254, 134);
}

function draw() {
  fillRect({ x: 0, y: 0, w: W, h: H }, COLORS.asphalt);
  drawSidewalk();
  drawStore();
  drawCorral();
  drawAisleArrows();
  for (const row of LOT.rows) drawRow(row);
  drawParkedCars();
  drawBin();
  drawIslandsAndLamps();
  drawCarts();
  drawPlayer();
  drawMovingCar();
  if (state.debug) drawDebug();
  drawHud();
  if (state.phase === 'over') drawTally();
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
window.lotRunner = { state, LOT, CONFIG, held, setHeld, pressAction, resetSession, spawnStray };
