// AudioWorklet processor for ggwave reception.
// Loaded as a same-origin module (not a blob) so it satisfies a strict
// Content-Security-Policy (script-src 'self'). Buffers microphone samples
// and posts fixed-size chunks back to the main thread for decoding.
class GGWaveProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];

      for (let i = 0; i < channelData.length; i++) {
        this.buffer[this.bufferIndex] = channelData[i];
        this.bufferIndex++;

        if (this.bufferIndex >= this.bufferSize) {
          // Send buffer to main thread
          this.port.postMessage({
            type: 'audiodata',
            samples: new Float32Array(this.buffer)
          });
          this.bufferIndex = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('ggwave-processor', GGWaveProcessor);
