// /js/modules/ggwave-init.js
import GGWave from '../ggwave-wasm.js';

export async function loadGGWave(basePath = '../') {
  return GGWave({
    locateFile: (p) => p.endsWith('.wasm') ? basePath + 'ggwave-wasm.wasm' : basePath + p
  });
}
