// ORBOUND — sprite loading and management.
// Loads real character art (ComfyUI/Flux-generated, background-removed via
// rembg) for each mobile. Falls back to nothing gracefully if a sprite is
// missing so the game never hard-crashes on a bad asset path.

'use strict';

const SPRITE_MANIFEST_URL = 'sprites/manifest.json';
const SPRITE_BASE_URL = 'sprites/';

const SpriteLoader = {
  images: {},      // mobileId -> HTMLImageElement
  manifest: {},     // mobileId -> {width, height, aspect}
  ready: false,
  loadPromise: null,

  async load() {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      try {
        const res = await fetch(SPRITE_MANIFEST_URL);
        this.manifest = await res.json();
      } catch (e) {
        console.warn('SpriteLoader: manifest fetch failed, sprites disabled', e);
        this.ready = true;
        return;
      }

      const ids = Object.keys(this.manifest);
      await Promise.all(ids.map(id => this._loadOne(id)));
      this.ready = true;
    })();
    return this.loadPromise;
  },

  _loadOne(id) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { this.images[id] = img; resolve(); };
      img.onerror = () => {
        console.warn(`SpriteLoader: failed to load sprite for '${id}'`);
        resolve(); // don't block the whole load on one bad file
      };
      img.src = `${SPRITE_BASE_URL}${id}.png`;
    });
  },

  get(id) {
    return this.images[id] || null;
  },

  getAspect(id) {
    const m = this.manifest[id];
    return m ? m.aspect : 1;
  },
};

window.SpriteLoader = SpriteLoader;
