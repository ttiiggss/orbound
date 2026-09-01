// ORBOUND — core engine: terrain, physics, aiming, rendering, game loop
// Style target: bold flat-shaded "Super Paper Mario" look — thick dark outlines,
// saturated flat fills, soft drop shadows, chunky readable UI. No sprites/images
// required — everything is vector-drawn with canvas paths for a papercraft look.

'use strict';

// ============================================================
// CONSTANTS
// ============================================================
const CANVAS_W = 1280;
const CANVAS_H = 720;
const GRAVITY = 0.22;
const WIND_MAX = 12;
const TERRAIN_SEGMENTS = 256;
const DEATH_Y = CANVAS_H + 60;

const PALETTE = {
  skyTop: '#5ec9f0',
  skyBottom: '#bfeaff',
  sunGlow: 'rgba(255, 244, 190, 0.55)',
  terrainFill: '#8a5a3c',
  terrainFillDeep: '#5c3a26',
  terrainGrass: '#4fd671',
  terrainGrassDark: '#2fae52',
  outline: '#241a33',
  outlineSoft: 'rgba(36, 26, 51, 0.35)',
  uiPanel: '#2c1f4a',
  uiPanelLight: '#402c68',
  uiAccent: '#ffcb3d',
  uiText: '#fff8e7',
  hpGreen: '#5be07a',
  hpOrange: '#ffb238',
  hpRed: '#ff5959',
};

const TEAM_COLORS = [
  { fill: '#ff5b6e', dark: '#c4293c', light: '#ffb0ba' }, // red
  { fill: '#4da3ff', dark: '#1c66c9', light: '#b3d8ff' }, // blue
  { fill: '#5be07a', dark: '#2c9c47', light: '#c0f5cd' }, // green
  { fill: '#ffcb3d', dark: '#d99a00', light: '#ffe8a3' }, // yellow
];

// ============================================================
// UTILITY
// ============================================================
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
function randRange(a, b) { return a + Math.random() * (b - a); }

// Deterministic hash-based pseudo-random for terrain generation (seedable)
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ============================================================
// TERRAIN — heightmap based, destructible via radial carve
// ============================================================
class Terrain {
  constructor(seed) {
    this.seed = seed;
    this.segW = CANVAS_W / TERRAIN_SEGMENTS;
    this.heights = new Float32Array(TERRAIN_SEGMENTS + 1);
    this.generate(seed);
  }

  generate(seed) {
    const rng = makeRng(seed);
    // Layered sine noise for rolling hills + a few random octaves
    const baseline = CANVAS_H * 0.62;
    const octaves = [
      { amp: 70, freq: 1.7, phase: rng() * 100 },
      { amp: 34, freq: 3.4, phase: rng() * 100 },
      { amp: 14, freq: 7.1, phase: rng() * 100 },
    ];
    for (let i = 0; i <= TERRAIN_SEGMENTS; i++) {
      const t = i / TERRAIN_SEGMENTS;
      let h = baseline;
      for (const o of octaves) {
        h += Math.sin(t * Math.PI * o.freq + o.phase) * o.amp;
      }
      this.heights[i] = h;
    }
    // Flatten small plateaus near likely spawn zones (10%-25% and 75%-90%)
    this.flattenZone(0.08, 0.24);
    this.flattenZone(0.76, 0.92);
  }

  flattenZone(t0, t1) {
    const i0 = Math.floor(t0 * TERRAIN_SEGMENTS);
    const i1 = Math.floor(t1 * TERRAIN_SEGMENTS);
    let avg = 0;
    for (let i = i0; i <= i1; i++) avg += this.heights[i];
    avg /= (i1 - i0 + 1);
    for (let i = i0; i <= i1; i++) {
      const localT = (i - i0) / (i1 - i0);
      const w = Math.sin(localT * Math.PI); // smooth falloff at edges
      this.heights[i] = lerp(this.heights[i], avg, w * 0.9);
    }
  }

  heightAt(x) {
    const idx = clamp(x / this.segW, 0, TERRAIN_SEGMENTS);
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, TERRAIN_SEGMENTS);
    const frac = idx - i0;
    return lerp(this.heights[i0], this.heights[i1], frac);
  }

  isSolid(x, y) {
    if (x < 0 || x > CANVAS_W) return false;
    return y >= this.heightAt(x);
  }

  // Carve a crater centered at (cx, cy) with given radius — pushes terrain down/away
  carve(cx, cy, radius) {
    const i0 = Math.max(0, Math.floor((cx - radius) / this.segW));
    const i1 = Math.min(TERRAIN_SEGMENTS, Math.ceil((cx + radius) / this.segW));
    for (let i = i0; i <= i1; i++) {
      const x = i * this.segW;
      const dx = x - cx;
      const distToCenter = Math.abs(dx);
      if (distToCenter > radius) continue;
      // Circular crater profile: deepest at center
      const depthFactor = Math.sqrt(Math.max(0, radius * radius - dx * dx));
      const craterFloor = cy + depthFactor;
      if (craterFloor > this.heights[i]) {
        this.heights[i] = Math.min(CANVAS_H + 100, craterFloor);
      }
    }
  }

  // Check if a point (x, radius) has NO ground beneath within `dropCheck` px — used for bunge/fall detection
  groundSupportBelow(x, y, checkDist = 40) {
    return this.heightAt(x) - y < checkDist * 3; // generous — solid ground reasonably close
  }

  draw(ctx) {
    // Deep fill (darker) first
    ctx.beginPath();
    ctx.moveTo(0, CANVAS_H);
    for (let i = 0; i <= TERRAIN_SEGMENTS; i++) {
      ctx.lineTo(i * this.segW, this.heights[i]);
    }
    ctx.lineTo(CANVAS_W, CANVAS_H);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, CANVAS_H * 0.55, 0, CANVAS_H);
    grad.addColorStop(0, PALETTE.terrainFill);
    grad.addColorStop(1, PALETTE.terrainFillDeep);
    ctx.fillStyle = grad;
    ctx.fill();

    // Thick bold outline on the surface (Paper Mario style)
    ctx.beginPath();
    ctx.moveTo(0, this.heights[0]);
    for (let i = 1; i <= TERRAIN_SEGMENTS; i++) {
      ctx.lineTo(i * this.segW, this.heights[i]);
    }
    ctx.lineWidth = 6;
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Grass cap — thin bright strip following the surface
    ctx.beginPath();
    ctx.moveTo(0, this.heights[0]);
    for (let i = 1; i <= TERRAIN_SEGMENTS; i++) {
      ctx.lineTo(i * this.segW, this.heights[i]);
    }
    ctx.lineWidth = 10;
    ctx.strokeStyle = PALETTE.terrainGrass;
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = PALETTE.terrainGrassDark;
    ctx.stroke();
  }
}

// ============================================================
// EXPORT (for game.js consumption in same global scope)
// ============================================================
window.ORBOUND_CORE = {
  CANVAS_W, CANVAS_H, GRAVITY, WIND_MAX, DEATH_Y,
  PALETTE, TEAM_COLORS,
  clamp, lerp, dist, randRange, makeRng,
  Terrain,
};
