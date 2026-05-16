/**
 * AudioWorklet processor — runs in a dedicated audio thread.
 * Collects samples into 4096-sample chunks, converts float32→int16,
 * and posts ArrayBuffers to the main thread for WebSocket transmission.
 */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._chunkSize = 4096; // ~256 ms at 16 kHz
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;

    for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);

    while (this._buf.length >= this._chunkSize) {
      const chunk  = this._buf.splice(0, this._chunkSize);
      const int16  = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, chunk[i] * 32767));
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
