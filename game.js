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
};

// ---------------------------------------------------------------------------
// Lot layout (game rules: what is solid, where the corral is)
// ---------------------------------------------------------------------------

const SPACE_W = 48;
const SPACE_D = 64;
const ROW_X0 = 96;
const ROW_COUNT = 16;

function buildLot() {
  const store = { x: 0, y: 0, w: W, h: 96 };
  const sidewalk = { x: 0, y: 96, w: W, h: 64 };
  const doors = { x: 232, y: 80, w: 96, h: 16 };

  // Corral sits on the sidewalk, open side facing the lot.
  const corral = { x: 400, y: 100, w: 160, h: 60 };
  const RAIL = 6;
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
    ...islands,
    ...lampPosts,
  ];

  return { store, sidewalk, doors, corral, corralRails, returnZone, rows, rowW, islands, lampPosts, accessibleSpaces, solids };
}

const LOT = buildLot();

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

const state = {
  debug: false,
  player: {
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
  },
};

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
};

function setHeld(action, isDown) {
  if (action in held) held[action] = isDown;
}

function pressAction(action) {
  if (action === 'toggleDebug') state.debug = !state.debug;
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
// Update
// ---------------------------------------------------------------------------

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function moveAndCollide(body, dx, dy) {
  body.x += dx;
  for (const s of LOT.solids) {
    if (!overlaps(body, s)) continue;
    if (dx > 0) body.x = s.x - body.w;
    else if (dx < 0) body.x = s.x + s.w;
  }
  body.x = Math.max(0, Math.min(W - body.w, body.x));

  body.y += dy;
  for (const s of LOT.solids) {
    if (!overlaps(body, s)) continue;
    if (dy > 0) body.y = s.y - body.h;
    else if (dy < 0) body.y = s.y + s.h;
  }
  body.y = Math.max(0, Math.min(H - body.h, body.y));
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
    p.facingX = dx;
    p.facingY = dy;
  }

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

  const speed = p.sprinting ? CONFIG.sprintSpeed : CONFIG.walkSpeed;
  moveAndCollide(p, dx * speed * dt, dy * speed * dt);
}

function update(dt) {
  updatePlayer(dt);
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
  rail: '#2b2b2b',
  island: '#4f7d3b',
  curb: '#c8c4b8',
  lamp: '#1e1e1e',
  accessible: '#2f6fb3',
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

  // Stamina bar, bottom left
  const bx = 12, by = H - 40, bw = 200, bh = 28;
  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = COLORS.hudText;
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('STAMINA', bx + 8, by + bh / 2);
  const barX = bx + 68, barY = by + 9, barW = bw - 78, barH = 10;
  ctx.fillStyle = '#222';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = p.exhausted ? COLORS.staminaLow : COLORS.stamina;
  ctx.fillRect(barX, barY, barW * (p.stamina / CONFIG.staminaMax), barH);

  // Controls, bottom right
  const lines = ['WASD / Arrows  move', 'Shift  sprint', `H  debug boxes (${state.debug ? 'on' : 'off'})`];
  const cw = 190, ch = 14 + lines.length * 16;
  const cx = W - cw - 12, cy = H - ch - 12;
  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(cx, cy, cw, ch);
  ctx.fillStyle = COLORS.hudText;
  ctx.font = '12px system-ui, sans-serif';
  lines.forEach((line, i) => ctx.fillText(line, cx + 10, cy + 15 + i * 16));
}

function drawDebug() {
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ff3b3b';
  for (const s of LOT.solids) ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);

  ctx.strokeStyle = '#3bff6b';
  const z = LOT.returnZone;
  ctx.strokeRect(z.x + 0.5, z.y + 0.5, z.w - 1, z.h - 1);

  const p = state.player;
  ctx.strokeStyle = '#3bd5ff';
  ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);

  ctx.fillStyle = COLORS.hudBg;
  ctx.fillRect(W - 232, 104, 220, 42);
  ctx.fillStyle = COLORS.hudText;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`pos ${p.x.toFixed(0)},${p.y.toFixed(0)}  stam ${p.stamina.toFixed(0)}`, W - 224, 116);
  ctx.fillText(`sprint ${p.sprinting}  exhausted ${p.exhausted}`, W - 224, 134);
}

function draw() {
  fillRect({ x: 0, y: 0, w: W, h: H }, COLORS.asphalt);
  drawSidewalk();
  drawStore();
  drawCorral();
  drawAisleArrows();
  for (const row of LOT.rows) drawRow(row);
  drawIslandsAndLamps();
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
window.lotRunner = { state, LOT, CONFIG, held, setHeld, pressAction };
