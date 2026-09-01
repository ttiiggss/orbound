// ORBOUND — main game: rendering, aiming/power UI, projectile physics,
// turn state machine, bot AI, particles, HUD. Milestone 1: single-player
// vs bot, one map, verifies terrain destruction + aiming feel.

'use strict';

const C = window.ORBOUND_CORE;
const MOBILE_DEFS = window.ORBOUND_MOBILES.MOBILES;
const getElementalMultiplier = window.ORBOUND_MOBILES.elementalMultiplier;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ============================================================
// GAME STATE
// ============================================================
const state = {
  phase: 'menu', // menu -> aiming -> flying -> resolving -> gameover
  terrain: null,
  players: [], // {id, teamIdx, mobileId, x, y, hp, maxHp, angle, power, facing, alive, name, isBot}
  turnOrder: [], // delay queue: [{playerId, readyTick}]
  tick: 0,
  activePlayerId: null,
  wind: 0,
  windTarget: 0,
  projectiles: [],
  particles: [],
  shakeAmount: 0,
  cameraX: 0,
  chargeReq: { power: 0 }, // charge meters per player for SS (keyed by id below)
  charges: {},
  log: [],
  winner: null,
};

const keys = {};
window.addEventListener('keydown', e => { keys[e.key] = true; handleKeyDown(e); });
window.addEventListener('keyup', e => { keys[e.key] = false; });

let mouseDown = false;
let chargeStart = 0;
let currentWeaponSlot = 's1';

// ============================================================
// SETUP
// ============================================================
function newMatch(seed = Date.now() & 0xffffffff) {
  state.terrain = new C.Terrain(seed);
  state.players = [
    makePlayer('p1', 0, 'bastion', 0.14, 'You', false),
    makePlayer('p2', 1, 'driller', 0.86, 'Bot', true),
  ];
  layoutPlayersOnTerrain();
  state.tick = 0;
  state.wind = randRangeSigned(C.WIND_MAX * 0.5);
  state.windTarget = state.wind;
  state.turnOrder = state.players.map(p => ({ playerId: p.id, readyTick: 0 }));
  state.charges = {};
  for (const p of state.players) state.charges[p.id] = 0;
  state.projectiles = [];
  state.particles = [];
  state.log = [];
  state.winner = null;
  advanceTurn();
  state.phase = 'aiming';
}

function makePlayer(id, teamIdx, mobileId, xFrac, name, isBot) {
  const mob = MOBILE_DEFS[mobileId];
  return {
    id, teamIdx, mobileId, name, isBot,
    x: xFrac * C.CANVAS_W, y: 0,
    hp: mob.maxHp, maxHp: mob.maxHp,
    angle: teamIdx === 0 ? 45 : 135, // degrees, 0 = right/flat, 90 = straight up
    power: 50,
    facing: teamIdx === 0 ? 1 : -1,
    alive: true,
    stunTimer: 0,
  };
}

function layoutPlayersOnTerrain() {
  for (const p of state.players) {
    p.y = state.terrain.heightAt(p.x) - 14;
  }
}

function randRangeSigned(mag) { return (Math.random() * 2 - 1) * mag; }

// ============================================================
// TURN / DELAY QUEUE
// ============================================================
function advanceTurn() {
  state.turnOrder.sort((a, b) => a.readyTick - b.readyTick);
  // Skip dead players
  while (state.turnOrder.length && !getPlayer(state.turnOrder[0].playerId).alive) {
    state.turnOrder.shift();
  }
  if (!state.turnOrder.length) return;
  const next = state.turnOrder.shift();
  state.activePlayerId = next.playerId;
  state.tick = Math.max(state.tick, next.readyTick);
  // New wind each turn
  state.windTarget = randRangeSigned(C.WIND_MAX);
  currentWeaponSlot = 's1';
  logMsg(`${getPlayer(state.activePlayerId).name}'s turn.`);
}

function getPlayer(id) { return state.players.find(p => p.id === id); }
function activePlayer() { return getPlayer(state.activePlayerId); }

function scheduleNextTurn(playerId, delay) {
  state.turnOrder.push({ playerId, readyTick: state.tick + delay });
}

function logMsg(msg) {
  state.log.unshift(msg);
  if (state.log.length > 5) state.log.pop();
}

// ============================================================
// INPUT
// ============================================================
function handleKeyDown(e) {
  if (state.phase !== 'aiming') return;
  const p = activePlayer();
  if (!p || p.isBot) return;
  if (e.key === 'ArrowLeft') p.angle = C.clamp(p.angle - 2, 0, 180);
  if (e.key === 'ArrowRight') p.angle = C.clamp(p.angle + 2, 0, 180);
  if (e.key === '1') currentWeaponSlot = 's1';
  if (e.key === '2') currentWeaponSlot = 's2';
  if (e.key === '3') currentWeaponSlot = 'ss';
  if (e.key === ' ') { e.preventDefault(); beginCharge(); }
}

canvas.addEventListener('mousedown', () => { if (state.phase === 'aiming') beginCharge(); });
window.addEventListener('mouseup', () => { if (mouseDown) releaseCharge(); });

function beginCharge() {
  const p = activePlayer();
  if (!p || p.isBot || mouseDown) return;
  mouseDown = true;
  chargeStart = performance.now();
}

function releaseCharge() {
  if (!mouseDown) return;
  mouseDown = false;
  const p = activePlayer();
  const held = performance.now() - chargeStart;
  p.power = C.clamp(Math.round((held / 1500) * 100), 5, 100);
  fireShot(p, currentWeaponSlot);
}

// ============================================================
// FIRING / PROJECTILE PHYSICS
// ============================================================
function fireShot(p, slot) {
  const mob = MOBILE_DEFS[p.mobileId];
  const wep = mob.weapons[slot];
  if (!wep) return;
  if (wep.chargeReq && (state.charges[p.id] || 0) < wep.chargeReq) {
    logMsg(`${p.name}'s SS isn't charged yet!`);
    return;
  }
  const rad = (p.angle * Math.PI) / 180;
  const dir = p.facing;
  const speed = (p.power / 100) * 11 + 4;
  const vx = Math.cos(rad) * speed * dir;
  const vy = -Math.sin(rad) * speed;

  state.projectiles.push({
    x: p.x, y: p.y - 16, vx, vy,
    ownerId: p.id, weapon: wep, slot,
    bounces: 0, maxBounces: wep.behavior === 'bounce' ? 4 : (wep.behavior === 'wallbounce' ? 1 : 0),
    burrowed: false, burrowTimer: 0,
    trail: [],
    dead: false,
    splitDone: false,
  });
  state.phase = 'flying';
  state.charges[p.id] = 0; // firing resets charge (simplification for v1)
  logMsg(`${p.name} fired ${wep.name}!`);
}

function stepProjectiles() {
  const windForce = (state.wind / C.WIND_MAX) * 0.045;
  for (const proj of state.projectiles) {
    if (proj.dead) continue;
    proj.trail.push({ x: proj.x, y: proj.y });
    if (proj.trail.length > 18) proj.trail.shift();

    if (proj.burrowed) {
      proj.burrowTimer--;
      if (proj.burrowTimer <= 0) explodeProjectile(proj);
      continue;
    }

    proj.vy += C.GRAVITY;
    proj.vx += windForce * (proj.weapon.windMult || 1.0);
    proj.x += proj.vx;
    proj.y += proj.vy;

    // Off-screen sides = wrap check / just let it fly, will hit ground or die below
    if (proj.x < -50 || proj.x > C.CANVAS_W + 50 || proj.y > C.DEATH_Y) {
      proj.dead = true;
      logMsg('Shot missed the battlefield!');
      continue;
    }

    // Wall bounce (screen edges) for Ricochet's wallbounce behavior
    if (proj.weapon.behavior === 'wallbounce' && proj.bounces < proj.maxBounces) {
      if (proj.x < 4 || proj.x > C.CANVAS_W - 4) {
        proj.vx *= -0.85;
        proj.x = C.clamp(proj.x, 5, C.CANVAS_W - 5);
        proj.bounces++;
        spawnParticles(proj.x, proj.y, 6, '#ffffff');
      }
    }

    // Terrain collision
    if (state.terrain.isSolid(proj.x, proj.y)) {
      handleTerrainHit(proj);
    } else {
      // Player collision (direct hit skips waiting for terrain)
      for (const target of state.players) {
        if (!target.alive || target.id === proj.ownerId) continue;
        if (C.dist(proj.x, proj.y, target.x, target.y - 16) < 26) {
          explodeProjectile(proj);
          break;
        }
      }
    }
  }
  state.projectiles = state.projectiles.filter(p => !p.dead);

  if (state.phase === 'flying' && state.projectiles.length === 0) {
    resolveTurnEnd();
  }
}

function handleTerrainHit(proj) {
  const behavior = proj.weapon.behavior;
  if (behavior === 'burrow' && !proj.burrowed) {
    proj.burrowed = true;
    proj.burrowTimer = 18;
    proj.vx = 0; proj.vy = 0.4;
    spawnParticles(proj.x, proj.y, 4, '#c47a34');
    return;
  }
  if (behavior === 'bounce' && proj.bounces < proj.maxBounces) {
    // Bounce: deal partial "impact" damage at each bounce point, then continue
    dealAreaDamage(proj.x, proj.y, proj.weapon.radius * 0.55, proj.weapon.power * 0.35, proj);
    state.terrain.carve(proj.x, proj.y, proj.weapon.radius * 0.4);
    spawnParticles(proj.x, proj.y, 8, '#5ee08a');
    proj.vy *= -0.55;
    proj.vx *= 0.9;
    proj.y -= 4;
    proj.bounces++;
    return;
  }
  if (behavior === 'split' && !proj.splitDone && proj.slot !== 's1') {
    proj.splitDone = true;
    explodeProjectile(proj, false);
    for (const side of [-1, 1]) {
      state.projectiles.push({
        x: proj.x + side * 22, y: proj.y - 6, vx: side * 2.4, vy: -3,
        ownerId: proj.ownerId, weapon: { ...proj.weapon, power: proj.weapon.power * 0.65, behavior: 'direct' },
        slot: proj.slot, bounces: 0, maxBounces: 0, burrowed: false, burrowTimer: 0,
        trail: [], dead: false, splitDone: true,
      });
    }
    return;
  }
  explodeProjectile(proj);
}

function explodeProjectile(proj, removeSelf = true) {
  dealAreaDamage(proj.x, proj.y, proj.weapon.radius, proj.weapon.power, proj);
  state.terrain.carve(proj.x, proj.y, proj.weapon.radius);
  spawnExplosion(proj.x, proj.y, proj.weapon.radius);
  if (removeSelf) proj.dead = true;
}

function dealAreaDamage(x, y, radius, basePower, proj) {
  const attacker = getPlayer(proj.ownerId);
  const attackerMob = MOBILE_DEFS[attacker.mobileId];
  for (const target of state.players) {
    if (!target.alive) continue;
    const d = C.dist(x, y, target.x, target.y - 16);
    if (d > radius + 20) continue;
    const falloff = C.clamp(1 - d / (radius + 20), 0.25, 1);
    const targetMob = MOBILE_DEFS[target.mobileId];
    const elemMult = target.id === attacker.id ? 1.0 : getElementalMultiplier(attackerMob, targetMob);
    let dmg = basePower * falloff * elemMult;
    if (target.id === attacker.id) dmg *= 0.5; // self-damage reduced
    dmg = Math.round(dmg);
    target.hp = C.clamp(target.hp - dmg, 0, target.maxHp);
    state.shakeAmount = Math.min(22, state.shakeAmount + dmg * 0.4);
    if (dmg > 0) logMsg(`${target.name} took ${dmg} damage!`);
    if (target.hp <= 0) {
      target.alive = false;
      logMsg(`${target.name} was eliminated!`);
    }
  }
  // Charge meter builds for the attacker regardless of hit
  state.charges[attacker.id] = Math.min(100, (state.charges[attacker.id] || 0) + 22);
}

// ============================================================
// PHYSICS SETTLE — apply terrain-follow + bunge (fall) detection
// ============================================================
function settlePlayers() {
  for (const p of state.players) {
    if (!p.alive) continue;
    const groundY = state.terrain.heightAt(p.x);
    if (p.y < groundY - 14) {
      p.y += 6; // fall
    } else {
      p.y = groundY - 14;
    }
    if (p.y > C.DEATH_Y) {
      p.alive = false;
      logMsg(`${p.name} fell into the void!`);
    }
  }
}

function resolveTurnEnd() {
  settlePlayers();
  checkWinCondition();
  if (state.phase === 'gameover') return;
  const p = activePlayer();
  const mob = MOBILE_DEFS[p.mobileId];
  const wepUsed = mob.weapons[Object.keys(mob.weapons).find(k => true)]; // fallback
  scheduleNextTurn(p.id, 20); // simplified fixed delay for v1; per-weapon delay applied at fire time below
  advanceTurn();
  state.phase = 'aiming';
}

function checkWinCondition() {
  const teamsAlive = new Set(state.players.filter(p => p.alive).map(p => p.teamIdx));
  if (teamsAlive.size <= 1) {
    state.phase = 'gameover';
    state.winner = teamsAlive.size === 1 ? [...teamsAlive][0] : null;
    logMsg(state.winner !== null ? `Team ${state.winner + 1} wins!` : 'Draw!');
  }
}

// ============================================================
// PARTICLES
// ============================================================
function spawnParticles(x, y, count, color) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = randRange(1, 5);
    state.particles.push({
      x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd - 1,
      life: 30 + Math.random() * 20, maxLife: 50, color, size: randRange(2, 5),
    });
  }
}

function spawnExplosion(x, y, radius) {
  spawnParticles(x, y, 20, '#ffcb3d');
  spawnParticles(x, y, 12, '#ff5959');
  state.particles.push({ x, y, vx: 0, vy: 0, life: 14, maxLife: 14, color: '#fff8e7', size: radius * 1.4, ring: true });
}

function stepParticles() {
  for (const pt of state.particles) {
    pt.x += pt.vx; pt.y += pt.vy;
    if (!pt.ring) pt.vy += 0.15;
    pt.life--;
  }
  state.particles = state.particles.filter(pt => pt.life > 0);
}

// ============================================================
// BOT AI (simple: aim toward opponent with noise, fire when settled)
// ============================================================
let botTimer = 0;
function stepBotAI() {
  const p = activePlayer();
  if (!p || !p.isBot || state.phase !== 'aiming') return;
  botTimer++;
  if (botTimer < 40) return;
  botTimer = 0;
  const target = state.players.find(t => t.alive && t.id !== p.id);
  if (!target) return;
  const dx = target.x - p.x;
  const angleGuess = C.clamp(45 - dx * 0.01 + randRangeSigned(8), 15, 80);
  p.angle = angleGuess;
  p.power = C.clamp(Math.round(55 + Math.abs(dx) * 0.04 + randRangeSigned(10)), 30, 95);
  fireShot(p, 's1');
}

// ============================================================
// RENDERING
// ============================================================
function render() {
  ctx.save();
  const shakeX = randRangeSigned(state.shakeAmount);
  const shakeY = randRangeSigned(state.shakeAmount);
  state.shakeAmount *= 0.86;
  if (state.shakeAmount < 0.4) state.shakeAmount = 0;
  ctx.translate(shakeX, shakeY);

  drawSky();
  if (state.terrain) {
    state.terrain.draw(ctx);
    drawParticlesLayer();
    for (const p of state.players) drawMobile(p);
    drawProjectiles();
    drawTrajectoryPreview();
  }
  ctx.restore();

  drawHUD();
}

function drawSky() {
  const grad = ctx.createLinearGradient(0, 0, 0, C.CANVAS_H);
  grad.addColorStop(0, C.PALETTE.skyTop);
  grad.addColorStop(1, C.PALETTE.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H);
  // sun glow
  const g2 = ctx.createRadialGradient(1080, 120, 10, 1080, 120, 220);
  g2.addColorStop(0, C.PALETTE.sunGlow);
  g2.addColorStop(1, 'rgba(255,244,190,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(860, -100, 440, 440);
  // Bold flat cloud shapes (Paper Mario style — simple rounded blobs w/ outline)
  drawCloud(180, 100, 1.1);
  drawCloud(560, 70, 0.8);
  drawCloud(900, 150, 0.9);
}

function drawCloud(cx, cy, scale) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.arc(0, 0, 26, Math.PI * 0.5, Math.PI * 1.5);
  ctx.arc(24, -18, 20, Math.PI, Math.PI * 2);
  ctx.arc(50, 0, 26, Math.PI * 1.5, Math.PI * 0.5);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(36,26,51,0.25)';
  ctx.stroke();
  ctx.restore();
}

function drawMobile(p) {
  if (!p.alive) return;
  const mob = MOBILE_DEFS[p.mobileId];
  const team = C.TEAM_COLORS[p.teamIdx % C.TEAM_COLORS.length];
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(p.facing, 1);

  // Drop shadow (papercraft feel)
  ctx.save();
  ctx.translate(0, 6);
  ctx.scale(1, 0.35);
  ctx.beginPath();
  ctx.ellipse(0, 14, 22, 22, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20,10,30,0.28)';
  ctx.fill();
  ctx.restore();

  // Body — real sprite art if loaded, vector fallback otherwise
  drawMobileSprite(mob, p, team);

  // Cannon/aim indicator
  const isActive = p.id === state.activePlayerId;
  if (isActive && state.phase === 'aiming') {
    const rad = (p.angle * Math.PI) / 180;
    const len = 40;
    ctx.save();
    ctx.translate(8, -20); // roughly muzzle-height on the sprite's front
    ctx.rotate(-rad);
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(len, -4);
    ctx.lineTo(len, 4);
    ctx.lineTo(0, 4);
    ctx.closePath();
    ctx.fillStyle = '#3a3a4a';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.PALETTE.outline;
    ctx.stroke();
    ctx.restore();
  }

  // Active-turn indicator (bouncing arrow above head)
  if (isActive) {
    const bob = Math.sin(performance.now() / 200) * 5;
    ctx.save();
    ctx.scale(p.facing, 1); // undo double-flip for symmetric arrow
    ctx.translate(0, -46 + bob);
    ctx.beginPath();
    ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.lineTo(0, 12);
    ctx.closePath();
    ctx.fillStyle = C.PALETTE.uiAccent;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.PALETTE.outline;
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  // HP bar above mobile (world space, not flipped)
  drawHpBarWorld(p);
}

function drawMobileSprite(mob, p, team) {
  const img = window.SpriteLoader && window.SpriteLoader.get(mob.id);
  if (!img) {
    // Sprites not loaded yet (or failed) — fall back to procedural vector art
    drawMobileBody(mob, p, team);
    return;
  }

  const aspect = window.SpriteLoader.getAspect(mob.id) || (img.width / img.height);
  const targetH = 62; // consistent on-screen height across all mobiles regardless of source aspect
  const targetW = targetH * aspect;

  // Team-color ground ring so team affiliation reads clearly even though
  // the sprite art itself isn't per-team recolored
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 4, targetW * 0.42, 7, 0, 0, Math.PI * 2);
  ctx.fillStyle = team.fill;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = C.PALETTE.outline;
  ctx.globalAlpha = 1;
  ctx.stroke();
  ctx.restore();

  ctx.drawImage(img, -targetW / 2, -targetH - 2, targetW, targetH);
}

function drawMobileBody(mob, p, team) {
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.PALETTE.outline;
  ctx.fillStyle = mob.bodyColor;

  switch (mob.shape) {
    case 'tank':
      roundedRectPath(-20, -30, 40, 26, 8);
      ctx.fill(); ctx.stroke();
      roundedRectPath(-24, -6, 48, 10, 4);
      ctx.fillStyle = '#3a3a4a'; ctx.fill(); ctx.stroke();
      break;
    case 'drill':
      ctx.beginPath();
      ctx.moveTo(-18, -6); ctx.lineTo(-18, -28); ctx.lineTo(14, -30);
      ctx.lineTo(26, -16); ctx.lineTo(14, -4); ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    case 'orb':
      ctx.beginPath(); ctx.arc(0, -18, 20, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(6, -22, 6, 0, Math.PI * 2);
      ctx.fillStyle = mob.accentColor; ctx.fill();
      break;
    case 'frog':
      roundedRectPath(-18, -30, 36, 24, 12);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-10, -34, 6, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(10, -34, 6, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case 'turtle':
      ctx.beginPath(); ctx.ellipse(0, -14, 26, 20, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, -18, 16, 12, 0, 0, Math.PI * 2);
      ctx.fillStyle = mob.accentColor; ctx.fill(); ctx.stroke();
      break;
    case 'dragon':
      ctx.beginPath();
      ctx.moveTo(-22, -10); ctx.lineTo(-6, -30); ctx.lineTo(18, -20);
      ctx.lineTo(22, -8); ctx.lineTo(0, -4); ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    case 'knight':
      roundedRectPath(-16, -32, 32, 30, 6);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(16, -20); ctx.lineTo(38, -24); ctx.lineTo(38, -18); ctx.closePath();
      ctx.fillStyle = mob.accentColor; ctx.fill(); ctx.stroke();
      break;
    case 'coil':
      ctx.beginPath(); ctx.arc(0, -16, 18, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-10, -30); ctx.lineTo(-4, -22); ctx.lineTo(-10, -14);
      ctx.strokeStyle = mob.accentColor; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = C.PALETTE.outline; ctx.lineWidth = 4;
      break;
    default:
      ctx.beginPath(); ctx.arc(0, -16, 18, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
  }

  // Team-color accent stripe (bottom of body)
  ctx.beginPath();
  ctx.rect(-18, -2, 36, 6);
  ctx.fillStyle = team.fill;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = C.PALETTE.outline;
  ctx.stroke();
}

function roundedRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHpBarWorld(p) {
  const w = 44, h = 8;
  const x = p.x - w / 2, y = p.y - 62;
  ctx.save();
  roundedRectPath(x - 2, y - 2, w + 4, h + 4, 4);
  ctx.fillStyle = C.PALETTE.outline;
  ctx.fill();
  const frac = p.hp / p.maxHp;
  const color = frac > 0.5 ? C.PALETTE.hpGreen : frac > 0.22 ? C.PALETTE.hpOrange : C.PALETTE.hpRed;
  roundedRectPath(x, y, w * frac, h, 3);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawProjectiles() {
  for (const proj of state.projectiles) {
    // Trail
    for (let i = 0; i < proj.trail.length; i++) {
      const t = proj.trail[i];
      const alpha = (i / proj.trail.length) * 0.5;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,203,61,${alpha})`;
      ctx.fill();
    }
    if (proj.burrowed) continue;
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ff5959';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.PALETTE.outline;
    ctx.stroke();
  }
}

function drawParticlesLayer() {
  for (const pt of state.particles) {
    ctx.save();
    ctx.globalAlpha = C.clamp(pt.life / pt.maxLife, 0, 1);
    if (pt.ring) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * (1 - pt.life / pt.maxLife), 0, Math.PI * 2);
      ctx.lineWidth = 5;
      ctx.strokeStyle = pt.color;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fillStyle = pt.color;
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawTrajectoryPreview() {
  if (state.phase !== 'aiming') return;
  const p = activePlayer();
  if (!p || p.isBot) return;
  const rad = (p.angle * Math.PI) / 180;
  const speed = mouseDown ? C.clamp(((performance.now() - chargeStart) / 1500) * 100, 5, 100) : p.power;
  const speedVal = (speed / 100) * 11 + 4;
  let x = p.x, y = p.y - 16;
  let vx = Math.cos(rad) * speedVal * p.facing;
  let vy = -Math.sin(rad) * speedVal;
  const windForce = (state.wind / C.WIND_MAX) * 0.045;
  ctx.save();
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i < 140; i++) {
    vy += C.GRAVITY;
    vx += windForce;
    x += vx; y += vy;
    if (y > state.terrain.heightAt(x)) break;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

// ============================================================
// HUD
// ============================================================
function drawHUD() {
  drawTopBar();
  drawPowerMeter();
  drawWeaponSelector();
  drawLog();
  if (state.phase === 'gameover') drawGameOver();
  if (state.phase === 'menu') drawMenu();
}

function drawTopBar() {
  ctx.save();
  roundedRectPath(20, 16, 300, 64, 12);
  ctx.fillStyle = C.PALETTE.uiPanel;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.PALETTE.outline;
  ctx.stroke();

  ctx.fillStyle = C.PALETTE.uiText;
  ctx.font = 'bold 16px Trebuchet MS';
  ctx.fillText('WIND', 34, 38);
  const windFrac = state.wind / C.WIND_MAX;
  ctx.save();
  ctx.translate(150, 48);
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1330';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.PALETTE.outline;
  ctx.stroke();
  ctx.rotate(windFrac * Math.PI * 0.6);
  ctx.beginPath();
  ctx.moveTo(-16, 0); ctx.lineTo(16, 0); ctx.lineTo(10, -5); ctx.moveTo(16, 0); ctx.lineTo(10, 5);
  ctx.lineWidth = 4;
  ctx.strokeStyle = state.wind > 0 ? C.PALETTE.hpGreen : state.wind < 0 ? C.PALETTE.hpRed : C.PALETTE.uiText;
  ctx.stroke();
  ctx.restore();

  ctx.fillText(`Turn: ${activePlayer() ? activePlayer().name : '-'}`, 190, 38);
  const p = activePlayer();
  if (p) {
    ctx.font = '13px Trebuchet MS';
    ctx.fillText(`Angle ${Math.round(p.angle)}°  Pwr ${Math.round(p.power)}`, 190, 58);
  }
  ctx.restore();

  // Smoothly interpolate wind toward target each frame (called in update loop too)
}

function drawPowerMeter() {
  const p = activePlayer();
  if (!p || p.isBot || state.phase !== 'aiming') return;
  const x = C.CANVAS_W / 2 - 100, y = C.CANVAS_H - 50, w = 200, h = 22;
  roundedRectPath(x - 3, y - 3, w + 6, h + 6, 8);
  ctx.fillStyle = C.PALETTE.outline;
  ctx.fill();
  const power = mouseDown ? C.clamp(((performance.now() - chargeStart) / 1500) * 100, 0, 100) : 0;
  roundedRectPath(x, y, w * (power / 100), h, 6);
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, C.PALETTE.hpGreen);
  grad.addColorStop(0.6, C.PALETTE.hpOrange);
  grad.addColorStop(1, C.PALETTE.hpRed);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.fillStyle = C.PALETTE.uiText;
  ctx.font = 'bold 14px Trebuchet MS';
  ctx.textAlign = 'center';
  ctx.fillText('HOLD SPACE / CLICK TO CHARGE, RELEASE TO FIRE', C.CANVAS_W / 2, y - 10);
  ctx.textAlign = 'left';
}

function drawWeaponSelector() {
  const p = activePlayer();
  if (!p || p.isBot || state.phase !== 'aiming') return;
  const mob = MOBILE_DEFS[p.mobileId];
  const slots = ['s1', 's2', 'ss'];
  const startX = C.CANVAS_W - 260;
  roundedRectPath(startX - 14, 16, 254, 90, 12);
  ctx.fillStyle = C.PALETTE.uiPanel;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.PALETTE.outline;
  ctx.stroke();
  slots.forEach((slot, i) => {
    const wep = mob.weapons[slot];
    const y = 34 + i * 24;
    const active = currentWeaponSlot === slot;
    ctx.fillStyle = active ? C.PALETTE.uiAccent : C.PALETTE.uiText;
    ctx.font = active ? 'bold 14px Trebuchet MS' : '13px Trebuchet MS';
    const chargeNote = wep.chargeReq ? ` (${state.charges[p.id] || 0}/100)` : '';
    ctx.fillText(`[${i + 1}] ${wep.name}${chargeNote}`, startX, y);
  });
}

function drawLog() {
  ctx.save();
  ctx.font = '13px Trebuchet MS';
  ctx.textAlign = 'left';
  for (let i = 0; i < state.log.length; i++) {
    ctx.fillStyle = `rgba(255,248,231,${1 - i * 0.18})`;
    ctx.fillText(state.log[i], 24, C.CANVAS_H - 100 - i * 18);
  }
  ctx.restore();
}

function drawGameOver() {
  ctx.save();
  ctx.fillStyle = 'rgba(20,10,30,0.7)';
  ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H);
  ctx.fillStyle = C.PALETTE.uiText;
  ctx.font = 'bold 48px Trebuchet MS';
  ctx.textAlign = 'center';
  const msg = state.winner !== null ? `TEAM ${state.winner + 1} WINS!` : 'DRAW!';
  ctx.fillText(msg, C.CANVAS_W / 2, C.CANVAS_H / 2 - 10);
  ctx.font = '18px Trebuchet MS';
  ctx.fillText('Press R to rematch', C.CANVAS_W / 2, C.CANVAS_H / 2 + 30);
  ctx.textAlign = 'left';
  ctx.restore();
}

function drawMenu() {
  ctx.save();
  ctx.fillStyle = 'rgba(20,10,30,0.55)';
  ctx.fillRect(0, 0, C.CANVAS_W, C.CANVAS_H);
  ctx.fillStyle = C.PALETTE.uiText;
  ctx.font = 'bold 56px Trebuchet MS';
  ctx.textAlign = 'center';
  ctx.fillText('ORBOUND', C.CANVAS_W / 2, C.CANVAS_H / 2 - 20);
  ctx.font = '20px Trebuchet MS';
  ctx.fillText('Press ENTER to start (Practice vs Bot)', C.CANVAS_W / 2, C.CANVAS_H / 2 + 30);
  ctx.textAlign = 'left';
  ctx.restore();
}

window.addEventListener('keydown', e => {
  if (e.key === 'Enter' && state.phase === 'menu') newMatch();
  if (e.key.toLowerCase() === 'r' && state.phase === 'gameover') newMatch();
});

// ============================================================
// MAIN LOOP
// ============================================================
function update() {
  state.wind = C.lerp(state.wind, state.windTarget, 0.02);
  if (state.phase === 'flying') stepProjectiles();
  if (state.phase === 'aiming') stepBotAI();
  stepParticles();
}

function loop() {
  update();
  render();
  requestAnimationFrame(loop);
}

// Expose for test/debug harness (playwright verification)
window.ORBOUND_DEBUG = { state, newMatch, fireShot, MOBILES: MOBILE_DEFS, getPlayer };

// Expose game state for Nostr integration
window.ORBOUND_GAME_STATE = state;

// Track gameover state for Nostr share button visibility
let lastPhase = 'menu';
const originalUpdate = update;
update = function() {
  originalUpdate();

  // Detect phase transitions to gameover
  if (state.phase !== lastPhase) {
    if (state.phase === 'gameover' && window.NostrLayer) {
      window.NostrLayer.showShareResultButton();
    } else if (lastPhase === 'gameover' && window.NostrLayer) {
      window.NostrLayer.hideShareResultButton();
    }
    lastPhase = state.phase;
  }
};

// Initialize Nostr layer
if (window.NostrLayer) {
  window.NostrLayer.init().catch(e => console.warn('Nostr init failed:', e));
}

// Kick off sprite loading immediately; the game loop renders fine before
// they're ready (falls back to vector art per-mobile until each image loads).
if (window.SpriteLoader) {
  window.SpriteLoader.load().catch(e => console.warn('Sprite load failed:', e));
}

loop();
