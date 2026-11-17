const { FileStore } = require('metro-cache');

// Samme vagt som uniwinds egen store: global.css' transform afhænger af klasser i hele src/
// og markeres skipCache, så den aldrig må genbruges fra disk.

/** @typedef {{ output?: Array<{ data?: { css?: { skipCache?: boolean }, [key: string]: unknown } }> } | null | undefined} CacheValue */

/** @extends {FileStore<CacheValue>} */
class UniwindSafeFileStore extends FileStore {
  /** @param {{ root: string }} options */
  constructor(options) {
    super(options);
    this.root = options.root;
  }

  /**
   * @param {Buffer} key
   * @param {CacheValue} value
   */
  async set(key, value) {
    if (value?.output?.some(file => file?.data?.css?.skipCache)) {
      return;
    }
    return super.set(key, value);
  }
}

/** @param {string} root */
function createCacheStore(root) {
  return new UniwindSafeFileStore({ root });
}

module.exports = { createCacheStore };
