// ORBOUND — Mobiles roster: 8 distinct vehicles with unique silhouettes,
// stats, and weapon behaviors. Flavor names avoid direct GunBound naming
// but mechanics are researched-accurate homages to the genre's classic archetypes.

'use strict';

// Armor tags for the light damage-type triangle (Voltaic vs Mechanical/Bionic)
const ARMOR = { MECH: 'mech', BIONIC: 'bionic', SHIELD: 'shield' };

const MOBILES = {
  bastion: {
    id: 'bastion', name: 'Bastion', role: 'Frontline Tank', armor: ARMOR.MECH,
    maxHp: 120, bodyColor: '#8a8a9a', accentColor: '#e04b4b',
    shape: 'tank', silhouette: 'wide-tread',
    weapons: {
      s1: { name: 'Cannon Shell', power: 22, delay: 18, radius: 30, behavior: 'direct' },
      s2: { name: 'Heavy Shell', power: 34, delay: 30, radius: 42, behavior: 'direct' },
      ss: { name: 'Siege Barrage', power: 55, delay: 55, radius: 60, behavior: 'direct', chargeReq: 100 },
    },
  },
  driller: {
    id: 'driller', name: 'Driller', role: 'Burrowing Skirmisher', armor: ARMOR.BIONIC,
    maxHp: 85, bodyColor: '#c47a34', accentColor: '#3a2412',
    shape: 'drill', silhouette: 'auger-nose',
    weapons: {
      s1: { name: 'Auger Round', power: 18, delay: 16, radius: 24, behavior: 'burrow' },
      s2: { name: 'Deep Drill', power: 28, delay: 28, radius: 34, behavior: 'burrow' },
      ss: { name: 'Core Breach', power: 48, delay: 50, radius: 56, behavior: 'burrow', chargeReq: 100 },
    },
  },
  twinsplit: {
    id: 'twinsplit', name: 'Twinsplit', role: 'Arcane Disruptor', armor: ARMOR.SHIELD,
    maxHp: 80, bodyColor: '#9a5ee0', accentColor: '#e0c85e',
    shape: 'orb', silhouette: 'floating-orb',
    weapons: {
      s1: { name: 'Arc Bolt', power: 16, delay: 14, radius: 22, behavior: 'direct' },
      s2: { name: 'Splitter', power: 20, delay: 26, radius: 26, behavior: 'split' },
      ss: { name: 'Twin Nova', power: 30, delay: 48, radius: 40, behavior: 'split', chargeReq: 100 },
    },
  },
  bouncer: {
    id: 'bouncer', name: 'Bouncer', role: 'Bouncing Bombardier', armor: ARMOR.BIONIC,
    maxHp: 90, bodyColor: '#5ee08a', accentColor: '#1a5e33',
    shape: 'frog', silhouette: 'coiled-legs',
    weapons: {
      s1: { name: 'Skip Shot', power: 14, delay: 15, radius: 20, behavior: 'bounce' },
      s2: { name: 'Ricochet Bomb', power: 20, delay: 24, radius: 28, behavior: 'bounce' },
      ss: { name: 'Chaos Hop', power: 32, delay: 46, radius: 36, behavior: 'bounce', chargeReq: 100 },
    },
  },
  fortress: {
    id: 'fortress', name: 'Fortress', role: 'Bulwark Cannoneer', armor: ARMOR.MECH,
    maxHp: 150, bodyColor: '#6a7a5a', accentColor: '#c4d94b',
    shape: 'turtle', silhouette: 'domed-shell',
    weapons: {
      s1: { name: 'Shell Lob', power: 20, delay: 20, radius: 36, behavior: 'direct' },
      s2: { name: 'Wide Burst', power: 26, delay: 32, radius: 54, behavior: 'direct' },
      ss: { name: 'Groundquake', power: 40, delay: 58, radius: 80, behavior: 'direct', chargeReq: 100 },
    },
  },
  skyfin: {
    id: 'skyfin', name: 'Skyfin', role: 'Aerial Duelist', armor: ARMOR.SHIELD,
    maxHp: 75, bodyColor: '#4b8ee0', accentColor: '#e8f4ff',
    shape: 'dragon', silhouette: 'winged',
    weapons: {
      s1: { name: 'Wind Dart', power: 17, delay: 13, radius: 20, behavior: 'direct', windMult: 1.6 },
      s2: { name: 'Gale Streak', power: 24, delay: 22, radius: 26, behavior: 'direct', windMult: 1.6 },
      ss: { name: 'Sky Strike', power: 38, delay: 44, radius: 40, behavior: 'skystrike', chargeReq: 100 },
    },
  },
  ricochet: {
    id: 'ricochet', name: 'Ricochet', role: 'Precision Skirmisher', armor: ARMOR.MECH,
    maxHp: 88, bodyColor: '#d4d4e0', accentColor: '#3a4ae0',
    shape: 'knight', silhouette: 'lance',
    weapons: {
      s1: { name: 'Pin Shot', power: 19, delay: 15, radius: 22, behavior: 'direct' },
      s2: { name: 'Wall Bounce', power: 24, delay: 25, radius: 28, behavior: 'wallbounce' },
      ss: { name: 'Perfect Strike', power: 50, delay: 52, radius: 34, behavior: 'direct', chargeReq: 100 },
    },
  },
  voltaic: {
    id: 'voltaic', name: 'Voltaic', role: 'Lightning Control', armor: ARMOR.BIONIC,
    maxHp: 82, bodyColor: '#f0e04b', accentColor: '#3a3a5a',
    shape: 'coil', silhouette: 'arcing-rods',
    weapons: {
      s1: { name: 'Shock Jolt', power: 18, delay: 14, radius: 22, behavior: 'direct', elemental: true },
      s2: { name: 'Chain Arc', power: 24, delay: 24, radius: 30, behavior: 'direct', elemental: true },
      ss: { name: 'Storm Call', power: 42, delay: 50, radius: 46, behavior: 'direct', elemental: true, chargeReq: 100 },
    },
  },
};

const ROSTER_ORDER = ['bastion', 'driller', 'twinsplit', 'bouncer', 'fortress', 'skyfin', 'ricochet', 'voltaic'];

// Elemental damage modifier: Voltaic-type vs armor tags
function elementalMultiplier(attackerMobile, defenderMobile) {
  if (!attackerMobile.weapons || attackerMobile.id !== 'voltaic') return 1.0;
  if (defenderMobile.armor === ARMOR.MECH) return 1.5;
  if (defenderMobile.armor === ARMOR.BIONIC) return 0.75;
  return 1.0;
}

window.ORBOUND_MOBILES = { MOBILES, ROSTER_ORDER, ARMOR, elementalMultiplier };
