'use strict';

// Logical resolution. Everything in the game is measured in these units;
// the canvas is scaled to fit the window with letterboxing.
const W = 960;
const H = 540;

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
  dockPoints: 10, // per cart
  messageTime: 1.6,
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
  const rows = [
    { id: 'A', y: 200, facing: 'down' },
    { id: 'B', y: 264, facing: 'up' },
    { id: 'C', y: 392, facing: 'up' },
  ];
  const rowW = SPACE_W * ROW_COUNT;

  // Return bin takes two spaces in row C, open toward the aisle above it.
  // Carts nest in two lanes and slide toward the open end.
  const binSpace = { row: 'C', index: 7, span: 2 };
  const bin = { x: ROW_X0 + binSpace.index * SPACE_W, y: 392, w: SPACE_W * binSpace.span, h: SPACE_D };
  const binRails = [
    { x: bin.x, y: bin.y, w: RAIL, h: bin.h, kind: 'rail' },
    { x: bin.x + bin.w - RAIL, y: bin.y, w: RAIL, h: bin.h, kind: 'rail' },
    { x: bin.x, y: bin.y + bin.h - RAIL, w: bin.w, h: RAIL, kind: 'rail' },
  ];
  const laneW = (bin.w - RAIL * 2) / 2;
  const binLanes = [0, 1].map((i) => ({ x: bin.x + RAIL + laneW * i + (laneW - CART_SIZE) / 2 }));
  const binDepth = 4; // carts per lane
  const binSlotY = (k) => bin.y + 6 + k * 10;

  const islands = [
    { x: ROW_X0 - 40, y: 200, w: 40, h: SPACE_D * 2, kind: 'island' },
    { x: ROW_X0 + rowW, y: 200, w: 40, h: SPACE_D * 2, kind: 'island' },
    { x: ROW_X0 - 40, y: 392, w: 40, h: SPACE_D, kind: 'island' },
    { x: ROW_X0 + rowW, y: 392, w: 40, h: SPACE_D, kind: 'island' },
  ];

  const lampPosts = [
    { x: ROW_X0 + rowW / 2 - 6, y: 264 - 6, w: 12, h: 12, kind: 'lamp' },
    { x: ROW_X0 + SPACE_W * 4 - 6, y: 392 + SPACE_D / 2 - 6, w: 12, h: 12, kind: 'lamp' },
    { x: ROW_X0 + SPACE_W * 12 - 6, y: 392 + SPACE_D / 2 - 6, w: 12, h: 12, kind: 'lamp' },
  ];

  // Accessible spaces nearest the store, in row A.
  const accessibleSpaces = [
    { row: 'A', index: 3 },
    { row: 'A', index: 4 },
  ];

  const solids = [
    { ...store, kind: 'store' },
    ...corralRails,
    ...binRails,
    ...islands,
    ...lampPosts,
  ];

  return {
    store, sidewalk, doors, corral, corralRails, returnZone, rows, rowW,
    bin, binSpace, binRails, binLanes, binDepth, binSlotY,
    islands, lampPosts, accessibleSpaces, solids,
  };
}

const LOT = buildLot();
const BIN_CAPACITY = LOT.binLanes.length * LOT.binDepth;

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

function makePlayer() {
  return {
    x: 300,
    y: 170,
    w: 18,
    h: 18,
    facingX: 0,
    facingY: 1,
    stamina: CONFIG.staminaMax,
    sprinting: false,
    exhausted: false,
    regenDelay: 0,
    // Carts being pushed, nearest the player first. Each link is
    // { cartId, angle, link }: the cart's heading and its distance from the
    // anchor (the player for the first cart, the hitch of the cart ahead otherwise).
    train: [],
  };
}

const state = {
  debug: false,
  score: 0,
  docked: 0,
  nextCartId: 1,
  carts: [], // status: 'inBin' | 'loose' | 'train'
  player: makePlayer(),
  message: null, // { text, t }
};

function cartsInLane(lane) {
  return state.carts.filter((c) => c.status === 'inBin' && c.lane === lane);
}

function spawnCartInBin() {
  const counts = LOT.binLanes.map((_, i) => cartsInLane(i).length);
  const lane = counts[0] <= counts[1] ? 0 : 1;
  if (counts[lane] >= LOT.binDepth) return null;
  const cart = {
    id: state.nextCartId++,
    kind: 'standard',
    x: LOT.binLanes[lane].x,
    y: LOT.binSlotY(counts[lane]),
    w: CART_SIZE,
    h: CART_SIZE,
    status: 'inBin',
    lane,
    angle: Math.PI / 2, // basket points down into the bin, handle toward the aisle
  };
  state.carts.push(cart);
  return cart;
}

function resetSession() {
  state.score = 0;
  state.docked = 0;
  state.nextCartId = 1;
  state.carts = [];
  state.player = makePlayer();
  state.message = null;
  for (let i = 0; i < BIN_CAPACITY; i++) spawnCartInBin();
}

function showMessage(text, time = CONFIG.messageTime) {
  state.message = { text, t: time };
}

resetSession();

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
  else if (action === 'interact') interact();
  else if (action === 'dropLast') dropLast();
  else if (action === 'restart') resetSession();
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
  const cc = center(cart);
  state.player.train.push({
    cartId: cart.id,
    angle: Math.atan2(cc.y - anchor.y, cc.x - anchor.x),
    link: Math.hypot(cc.x - anchor.x, cc.y - anchor.y),
  });
  cart.status = 'train';
  delete cart.lane;
}

function interact() {
  const p = state.player;

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

function dockTrain() {
  const p = state.player;
  const n = p.train.length;
  const ids = new Set(p.train.map((l) => l.cartId));
  state.carts = state.carts.filter((c) => !ids.has(c.id));
  p.train = [];
  const points = CONFIG.dockPoints * n;
  state.score += points;
  state.docked += n;
  showMessage(`+${points}  ${n} cart${n === 1 ? '' : 's'} docked`);
  for (let i = 0; i < n; i++) spawnCartInBin();
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
  let dx = (held.right ? 1 : 0) - (held.left ? 1 : 0);
  let dy = (held.down ? 1 : 0) - (held.up ? 1 : 0);
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

function update(dt) {
  updatePlayer(dt);
  updateBin(dt);
  if (state.message) {
    state.message.t -= dt;
    if (state.message.t <= 0) state.message = null;
  }
}

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
  player: '#ff8a1f',
  playerOutline: '#1a1a1a',
  hudBg: 'rgba(0, 0, 0, 0.55)',
  hudText: '#f2f2f2',
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
    arrow(x, 498, 1);
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

function drawHud() {
  const p = state.player;

  // Score and train length, top left over the store roof
  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(12, 12, 230, 30);
  ctx.fillStyle = COLORS.hudText;
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`SCORE ${state.score}`, 22, 27);
  ctx.fillStyle = p.train.length >= CONFIG.maxTrain ? '#ffd23f' : COLORS.hudText;
  ctx.fillText(`TRAIN ${p.train.length}/${CONFIG.maxTrain}`, 132, 27);

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
    'R  restart',
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
  ctx.fillRect(W - 262, 104, 250, 78);
  ctx.fillStyle = COLORS.hudText;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`pos ${p.x.toFixed(0)},${p.y.toFixed(0)}  stam ${p.stamina.toFixed(0)}`, W - 254, 116);
  ctx.fillText(`sprint ${p.sprinting}  exhausted ${p.exhausted}`, W - 254, 134);
  ctx.fillText(`carts ${state.carts.length}  bin ${state.carts.filter((c) => c.status === 'inBin').length}  train ${n}`, W - 254, 152);
  ctx.fillText(
    n ? `speed x${trainSpeedMult(n).toFixed(2)}  turnR ${turnRadius(n)}  noseIn ${cartInReturnZone(nose)}` : 'speed x1.00',
    W - 254, 170,
  );
}

function draw() {
  fillRect({ x: 0, y: 0, w: W, h: H }, COLORS.asphalt);
  drawSidewalk();
  drawStore();
  drawCorral();
  drawAisleArrows();
  for (const row of LOT.rows) drawRow(row);
  drawBin();
  drawIslandsAndLamps();
  drawCarts();
  drawPlayer();
  if (state.debug) drawDebug();
  drawHud();
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
window.lotRunner = { state, LOT, CONFIG, held, setHeld, pressAction, resetSession };
