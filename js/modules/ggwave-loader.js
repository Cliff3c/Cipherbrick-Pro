// ES module import (this file itself is loaded via script.js)
// bump ?v=6 so the browser pulls the fresh single-file bundle
import GGWaveModule from '/js/ggwave.capi.singlefile.js?v=11';
import { buildGGWaveFacade } from '/js/modules/ggwave-api.js?v=11';

let ggwaveInitPromise = null;

export function getGGWaveInstance() {
  if (!ggwaveInitPromise) {
    ggwaveInitPromise = GGWaveModule().then((Module) => buildGGWaveFacade(Module));
  }
  return ggwaveInitPromise;
}
