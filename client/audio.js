// ORBOUND — Web Audio API synthesized sound effects
// Uses oscillators/noise/envelopes for punchy, tasteful SFX.
// Gracefully degrades if Web Audio API is unavailable or autoplay blocked.

'use strict';

const AudioFX = (() => {
  let audioContext = null;
  let initialized = false;
  let fanfarePlayed = false;
  let fanfareElement = null;

  // Safely initialize AudioContext on first user gesture
  function ensureContext() {
    if (audioContext !== null) return audioContext;
    try {
      window.AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!window.AudioContext) {
        console.warn('Web Audio API not available');
        return null;
      }
      audioContext = new window.AudioContext();
      return audioContext;
    } catch (e) {
      console.warn('Failed to initialize AudioContext:', e);
      return null;
    }
  }

  // Plays the AI-composed intro fanfare (ace_step_v1_3.5b via ComfyUI) once,
  // on the same first-gesture unlock as the SFX AudioContext. Browsers block
  // autoplay before user interaction, so this can't literally play the
  // instant the page loads - it plays as soon as the player's first
  // click/keypress/touch happens, which in practice is the moment they
  // land on and start engaging with the title screen. Uses a plain
  // HTMLAudioElement (not the Web Audio oscillator graph the SFX use) since
  // it's real file playback, not synthesis.
  function playTitleFanfare() {
    if (fanfarePlayed) return;
    fanfarePlayed = true;
    try {
      fanfareElement = new Audio('audio/title_fanfare.mp3');
      fanfareElement.volume = 0.8;
      const playPromise = fanfareElement.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(e => console.warn('Title fanfare playback failed:', e));
      }
    } catch (e) {
      console.warn('Failed to play title fanfare:', e);
    }
  }

  // Trigger on first user interaction
  function initOnFirstGesture() {
    if (initialized) return;
    initialized = true;
    ensureContext();
    playTitleFanfare();
  }

  // Register for first user gesture
  if (typeof document !== 'undefined') {
    const gestureEvents = ['click', 'keydown', 'touchstart'];
    gestureEvents.forEach(evt => {
      document.addEventListener(evt, initOnFirstGesture, { once: true });
    });
  }

  return {
    playTitleFanfare,
    // Fire shot SFX — bright, crisp upward sweep with punch
    playFireShot() {
      const ctx = ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(420, now + 0.12);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

      osc.start(now);
      osc.stop(now + 0.12);
    },

    // Impact/explosion SFX — short, fat noise burst with quick decay
    playImpact() {
      const ctx = ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // White noise burst
      const noise = ctx.createBufferSource();
      const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < noiseBuf.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      noise.buffer = noiseBuf;

      const gain = ctx.createGain();
      noise.connect(gain);
      gain.connect(ctx.destination);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

      noise.start(now);
      noise.stop(now + 0.15);

      // Low frequency punch (sine sweep down)
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(200, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);

      oscGain.gain.setValueAtTime(0.15, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

      osc.start(now);
      osc.stop(now + 0.15);
    },

    // Damage taken SFX — harsh, sudden drop sound
    playDamage() {
      const ctx = ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'square';
      osc.frequency.setValueAtTime(380, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

      osc.start(now);
      osc.stop(now + 0.2);
    },

    // Victory/game-over SFX — rising triumphant tone
    playVictory() {
      const ctx = ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Three ascending tones
      const frequencies = [280, 352, 440];
      const duration = 0.15;

      frequencies.forEach((freq, idx) => {
        const t = now + idx * duration;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);

        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + duration);

        osc.start(t);
        osc.stop(t + duration);
      });
    },

    // UI click SFX — short, subtle "beep" for menu interactions
    playUIClick() {
      const ctx = ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, now);

      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);

      osc.start(now);
      osc.stop(now + 0.06);
    },
  };
})();

// Expose globally
if (typeof window !== 'undefined') {
  window.AudioFX = AudioFX;
}
