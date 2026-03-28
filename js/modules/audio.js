// /js/modules/audio.js

import { getGGWaveInstance } from './ggwave-loader.js';
import { ensureMicPermission } from './permissions.js';


// ===== GGWave framing config =====
let PROTOCOL_DEFAULT = 'GGWAVE_PROTOCOL_AUDIBLE_FASTEST';
function getSelectedProtocolToken() {
    try { return localStorage.getItem('cb.txProtocol') || PROTOCOL_DEFAULT; }
    catch { return PROTOCOL_DEFAULT; }
}
const REPEATS = 10;
const FRAME_GAP_MS = 120;
const MAX_PROBE = 256;

// --- Platform flags ---
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

// Simple delay helper
const waitMs = (ms) => new Promise(res => setTimeout(res, ms));

// ---- Dynamic AudioContext management ----
let _playbackContext = null;
let _recordingContext = null;

// --- TX loudness helpers ---
function _rms(float32) {
    let s = 0.0;
    for (let i = 0; i < float32.length; i++) s += float32[i] * float32[i];
    return Math.sqrt(s / Math.max(1, float32.length));
}
function _gainToTargetRMS(float32, target = 0.22, maxGain = 3.0) {
    const cur = _rms(float32) || 1e-6;
    return Math.min(maxGain, target / cur);
}

function getPlaybackContext() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!_playbackContext || _playbackContext.state === 'closed') {
        // Let browser choose optimal sample rate for playback
        _playbackContext = new AC();
    }
    return _playbackContext;
}

async function getRecordingContext(preferredSampleRate = null) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!_recordingContext || _recordingContext.state === 'closed') {
        const options = {};
        if (preferredSampleRate) {
            options.sampleRate = preferredSampleRate;
        }
        _recordingContext = new AC(options);
    }
    return _recordingContext;
}

// Tiny frame header: "CB1 s/t hhhh " + payload
function frameHeader(seq, total, hash4) {
    return `CB1 ${seq}/${total} ${hash4} `;
}

// 4‑hex preview of the full message (for session integrity)
async function shortHash4(text) {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 4);
}

// Access protocol id (fallback if facade didn't expose a map)
function getProtocolId(ggwave) {
    const token = getSelectedProtocolToken();

    // Prefer GGWave’s map if present
    const map =
        (ggwave && (ggwave.ProtocolId || (ggwave.Module && ggwave.Module.ProtocolId))) || null;

    if (map && Object.prototype.hasOwnProperty.call(map, token)) {
        const id = map[token];
        return id;
    }

    // Fallback manual map (stable across your current build)
    const protocolMap = {
        'GGWAVE_PROTOCOL_AUDIBLE_NORMAL': 1,
        'GGWAVE_PROTOCOL_AUDIBLE_FAST': 2,
        'GGWAVE_PROTOCOL_AUDIBLE_FASTEST': 3,
        'GGWAVE_PROTOCOL_ULTRASOUND_NORMAL': 4,
        'GGWAVE_PROTOCOL_ULTRASOUND_FAST': 5,
        'GGWAVE_PROTOCOL_ULTRASOUND_FASTEST': 6
    };

    const protocolId = protocolMap[token] !== undefined ? protocolMap[token] : 3;
    return protocolId;
}

function tryEncode(ggwave, instance, text, protocolId, repeats) {
    try {
        const w = ggwave.encode(instance, text, protocolId, repeats);
        return w && w.length > 0;
    } catch {
        return false;
    }
}

async function probeMaxPayload(ggwave, instance) {
    const protocolId = getProtocolId(ggwave);

    // Known limits for different protocols (conservative estimates)
    const protocolLimits = {
        1: 140, // AUDIBLE_NORMAL
        2: 140, // AUDIBLE_FAST  
        3: 140, // AUDIBLE_FASTEST
        4: 200, // ULTRASOUND_NORMAL
        5: 200, // ULTRASOUND_FAST
        6: 200, // ULTRASOUND_FASTEST
    };

    // Use known limit if available
    if (protocolLimits[protocolId]) {
        return protocolLimits[protocolId];
    }

    // Fallback to probing (but with more conservative approach)
    let ok = 1, lo = 1, hi = Math.min(MAX_PROBE, 140); // Limit probing to 140
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const candidate = 'A'.repeat(mid);
        if (tryEncode(ggwave, instance, candidate, protocolId, REPEATS)) {
            ok = mid; lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }

    return ok;
}

function chunkString(s, n) {
    const out = [];
    for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
    return out;
}

async function playTextFrame(self, text, repeats = REPEATS) {
    const protocolId = getProtocolId(self.ggwave);
    const waveform = self.ggwave.encode(self.playbackInstance, text, protocolId, repeats);

    if (!waveform || waveform.length === 0) throw new Error('encode failed');

    // Additional debug: check waveform characteristics

    await self.playWaveform(waveform);
}

function wait(ms) { return new Promise(res => setTimeout(res, ms)); }

// Parse received frame: "CB1 3/8 abcd <payload>"
function parseFrame(text) {
    // More lenient regex that handles potential whitespace issues
    const m = /^CB1\s+(\d+)\/(\d+)\s+([0-9a-f]{4})\s+(.*)$/is.exec(text.trim());
    if (!m) {
        return null;
    }

    const parsed = {
        seq: +m[1],
        total: +m[2],
        hash4: m[3].toLowerCase(),
        payload: m[4]
    };

    return parsed;
}

export class AudioModule {
    constructor(appInstance = null) {
        this.ggwave = null;
        this.ggwaveReady = false;

        // Separate contexts and instances for TX/RX
        this.playbackContext = null;
        this.recordingContext = null;
        this.playbackInstance = null;
        this.recordingInstance = null;

        this.isTransmitting = false;
        this.isReceiving = false;
        this.mediaStreamNode = null;
        this.audioWorkletNode = null;
        this.userStream = null;
        this._initInFlight = false;

        // Reception state
        this.rxActive = false;
        this.rxHash4 = null;
        this.rxTotal = null;
        this.rxChunks = new Map();
        this.rxTimer = null;
        this._lastDecoded = null;
        this.RX_TIMEOUT_MS = 60000;
        this.appInstance = appInstance;
    }

    get i18n() { return this.appInstance?.i18nStrings || {}; }

    // --- Cleanup helpers ---
    _closeRxNodes() {
        if (this.audioWorkletNode) {
            try { this.audioWorkletNode.disconnect(); this.audioWorkletNode.port.close(); } catch { }
            this.audioWorkletNode = null;
        }
        if (this.recorder) {
            try { this.recorder.disconnect(); } catch { }
            this.recorder = null;
        }
        if (this.mediaStreamNode) {
            try { this.mediaStreamNode.disconnect(); } catch { }
            this.mediaStreamNode = null;
        }
        if (this.userStream) {
            try { this.userStream.getTracks().forEach(t => t.stop()); } catch { }
            this.userStream = null;
        }
    }

    async _closeRecordingContext() {
        this._closeRxNodes();
        if (this.recordingInstance) { this.recordingInstance = null; }
        if (this.recordingContext && this.recordingContext.state !== 'closed') {
            try { await this.recordingContext.close(); } catch { }
        }
        this.recordingContext = null;
        _recordingContext = null; // Reset global
    }

    async _closePlaybackContext() {
        if (this.playbackInstance) { this.playbackInstance = null; }
        if (this.playbackContext && this.playbackContext.state !== 'closed') {
            try { await this.playbackContext.close(); } catch { }
        }
        this.playbackContext = null;
        _playbackContext = null; // Reset global
    }

    resetRxSession() {
        this.rxHash4 = null;
        this.rxTotal = null;
        this.rxChunks = new Map();
        if (this.rxTimer) { clearTimeout(this.rxTimer); this.rxTimer = null; }
    }

    armRxTimeout(UIModule) {
        if (this.rxTimer) clearTimeout(this.rxTimer);

        // Use longer timeout for multi-frame messages
        const timeoutMs = this.rxTotal && this.rxTotal > 1 ?
            Math.max(this.RX_TIMEOUT_MS, this.rxTotal * 15000) : // 15 seconds per expected frame
            this.RX_TIMEOUT_MS;


        this.rxTimer = setTimeout(() => {
            console.warn('[Audio] RX timeout; resetting session');
            UIModule.showMessage((this.i18n.audio_timeout || 'Audio reception timed out after {seconds}s. Resetting.').replace('{seconds}', Math.round(timeoutMs / 1000)), 'warning');
            this.resetRxSession();
        }, timeoutMs);
    }

    async finalizeIfComplete(UIModule) {
        if (!this.rxTotal || this.rxChunks.size !== this.rxTotal) return;

        UIModule.showMessage(this.i18n.audio_assembling || '🔄 Assembling received data...', 'info');

        // Reassemble
        let out = '';
        for (let i = 1; i <= this.rxTotal; i++) {
            const part = this.rxChunks.get(i);
            if (part == null) {
                console.error(`[Audio] Missing chunk ${i} during assembly`);
                return;
            }
            out += part;
        }

        // NOTE: Hash verification not implemented
        // The hash4 is transmitted with frames but currently not verified on reception
        // Future enhancement: Implement end-to-end hash verification for data integrity

        this.resetRxSession();
        UIModule.showMessage((this.i18n.audio_received_chars || '✅ Successfully received {count} characters!').replace('{count}', out.length), 'success');

        // Update UI elements
        const recvEl = document.getElementById('receivedText');
        if (recvEl) recvEl.value = out;

        const newRecvEl = document.getElementById('receivedAudioPayload');
        if (newRecvEl) newRecvEl.value = out;

        // Call the app's handler
        if (window.app && window.app.audioTx && typeof window.app.audioTx.handleReceivedAudioData === 'function') {
            window.app.audioTx.handleReceivedAudioData(out);
        }
    }

    updateReceptionStatus(UIModule) {
        if (!this.rxTotal) return;

        const received = this.rxChunks.size;
        const missing = [];

        for (let i = 1; i <= this.rxTotal; i++) {
            if (!this.rxChunks.has(i)) {
                missing.push(i);
            }
        }

        let statusMsg = (this.i18n.audio_all_frames || 'Progress: {count}/{total} frames received')
            .replace('{count}', received).replace('{total}', this.rxTotal);
        if (missing.length > 0 && missing.length <= 5) {
            statusMsg += ` (missing: ${missing.join(', ')})`;
        }

        UIModule.showMessage(statusMsg, 'info');
    }

    // --- Init ---
    async initialize() {
        if (this.ggwaveReady && this.ggwave) return true;

        try {
            this.ggwave = await getGGWaveInstance();
            this.ggwaveReady = true;
            return true;
        } catch (err) {
            console.error('[Audio] Failed to initialize:', err);
            return false;
        }
    }

    async initPlaybackContext() {
        if (!this.playbackContext) {
            this.playbackContext = getPlaybackContext();
        }

        if (!this.playbackInstance) {
            if (this.playbackContext.state === 'suspended') {
                await this.playbackContext.resume();
            }

            await new Promise(requestAnimationFrame);
            this.playbackInstance = this.ggwave.init();

            if (!this.playbackInstance || this.playbackInstance === 0) {
                throw new Error('GGWave playback instance init failed');
            }

        }
    }

    async initRecordingContext(streamSampleRate) {
        // Create recording context that matches the stream sample rate
        this.recordingContext = await getRecordingContext(streamSampleRate);

        if (this.recordingContext.state === 'suspended') {
            await this.recordingContext.resume();
        }

        await new Promise(requestAnimationFrame);
        this.recordingInstance = this.ggwave.init();

        if (!this.recordingInstance || this.recordingInstance === 0) {
            throw new Error('GGWave recording instance init failed');
        }

    }

    // --- AudioWorklet Registration ---
    async ensureAudioWorklet() {
        if (this.recordingContext.audioWorklet && !this.recordingContext._ggwaveWorkletLoaded) {
            const workletCode = `
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
      `;

            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const workletUrl = URL.createObjectURL(blob);

            try {
                await this.recordingContext.audioWorklet.addModule(workletUrl);
                this.recordingContext._ggwaveWorkletLoaded = true;
            } finally {
                URL.revokeObjectURL(workletUrl);
            }
        }
    }

    // --- TX path ---
    async transmitData(data, UIModule) {
        if (this._initInFlight || this.isTransmitting) {
            UIModule.showMessage(this.i18n.audio_busy || 'Audio is busy. Please wait a moment…', 'warning');
            return;
        }

        const micOk = await ensureMicPermission();
        if (!micOk) {
            UIModule.showMessage(this.i18n.audio_mic_required_tx || 'Microphone permission is required for audio transmit.', 'warning');
            return;
        }

        this._initInFlight = true;

        if (!this.ggwave) {
            const initialized = await this.initialize();
            if (!initialized) {
                UIModule.showMessage(this.i18n.audio_init_failed || 'Audio initialization failed.', 'danger');
                this._initInFlight = false;
                return;
            }
        }

        try {
            this.isTransmitting = true;
            await this.initPlaybackContext();

            // Android-biased TX scheduling (more repeats + bigger gaps + optional dup)
            const repeatsTx = IS_ANDROID ? Math.max(REPEATS, 16) : REPEATS;
            const frameGapTx = IS_ANDROID ? Math.max(FRAME_GAP_MS, 180) : FRAME_GAP_MS;
            const dupOnAndroid = IS_ANDROID ? true : false;   // flip to false to disable quickly

            // (Optional) Nudge Android off FASTEST/ULTRASOUND unless user explicitly chose otherwise
            const savedToken = (typeof getSelectedProtocolToken === 'function')
                ? getSelectedProtocolToken()
                : localStorage.getItem('cb.txProtocol');
            if ((IS_ANDROID || IS_IOS) && (!savedToken || /FASTEST|ULTRASOUND/i.test(savedToken))) {
                try {
                    localStorage.setItem('cb.txProtocol', 'GGWAVE_PROTOCOL_AUDIBLE_NORMAL');
                } catch { }
            }


            const hash4 = await shortHash4(data);
            const perFrameCap = await probeMaxPayload(this.ggwave, this.playbackInstance);

            const headerLen = frameHeader(999, 999, 'ffff').length;
            const payloadPerFrame = Math.max(1, perFrameCap - headerLen);

            if (data.length <= payloadPerFrame) {
                const frame = frameHeader(1, 1, hash4) + data;
                UIModule.showMessage((this.i18n.audio_transmitting || 'Transmitting ({seq}/{total})...').replace('{seq}', 1).replace('{total}', 1), 'info');
                await playTextFrame(this, frame, repeatsTx);
                if (dupOnAndroid) {
                    await waitMs(80);
                    await playTextFrame(this, frame, repeatsTx); // duplicate frame
                }
                UIModule.showMessage(this.i18n.audio_tx_complete || 'Audio transmission completed!', 'success');
            } else {
                await this.transmitChunked(data, payloadPerFrame, hash4, UIModule, {
                    repeats: repeatsTx,
                    frameGap: frameGapTx,
                    duplicate: dupOnAndroid
                });
            }
        } catch (error) {
            console.error('[Audio] Transmission failed:', error);
            UIModule.showMessage((this.i18n.audio_tx_failed || 'Audio transmission failed: {error}').replace('{error}', error.message), 'danger');
        } finally {
            this.isTransmitting = false;
            this._initInFlight = false;
        }
    }

    async playWaveform(waveform) {
        return new Promise(async (resolve, reject) => {
            try {
                // Build a float buffer from whatever we got back
                let floatBuf;

                if (waveform instanceof Float32Array) {
                    floatBuf = waveform;
                } else {
                    // Try two interpretations and pick the louder (by RMS)
                    const u8 = (waveform instanceof Uint8Array)
                        ? waveform
                        : new Uint8Array(waveform.buffer || waveform);

                    // int16 → float
                    const i16 = new Int16Array(u8.buffer, u8.byteOffset, Math.floor(u8.byteLength / 2));
                    const fFromI16 = new Float32Array(i16.length);
                    for (let i = 0; i < i16.length; i++) fFromI16[i] = i16[i] / 32768;

                    // float32 view (if bytes were actually float32)
                    const f32View = (u8.byteLength % 4 === 0)
                        ? new Float32Array(u8.buffer, u8.byteOffset, Math.floor(u8.byteLength / 4))
                        : null;

                    const rms = (arr) => {
                        let s = 0;
                        for (let i = 0; i < arr.length; i++) { const v = arr[i]; s += v * v; }
                        return Math.sqrt(s / Math.max(1, arr.length));
                    };

                    const rmsI16 = rms(fFromI16);
                    const rmsF32 = f32View ? rms(f32View) : -1;

                    if (f32View && rmsF32 > rmsI16 * 1.5) {
                        floatBuf = f32View;
                    } else {
                        floatBuf = fFromI16;
                    }
                }

                // Create buffer and play (with RMS normalize, compressor, and pre‑roll)
                const ctx = this.playbackContext;
                if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { } }

                const audioBuf = ctx.createBuffer(1, floatBuf.length, ctx.sampleRate);
                audioBuf.getChannelData(0).set(floatBuf);

                const src = ctx.createBufferSource();
                src.buffer = audioBuf;

                // Normalize loudness for phone speakers (Android gets a little extra headroom)
                const normGain = _gainToTargetRMS(floatBuf, IS_ANDROID ? 0.28 : 0.22, IS_ANDROID ? 4.0 : 3.0);
                const gain = ctx.createGain();
                gain.gain.setValueAtTime(normGain, ctx.currentTime);

                // Gentle compressor to tame peaks
                const comp = ctx.createDynamicsCompressor();
                comp.threshold.setValueAtTime(-24, ctx.currentTime);
                comp.knee.setValueAtTime(15, ctx.currentTime);
                comp.ratio.setValueAtTime(3, ctx.currentTime);
                comp.attack.setValueAtTime(0.003, ctx.currentTime);
                comp.release.setValueAtTime(0.25, ctx.currentTime);

                // --- ADD THIS BLOCK (silence pre-roll) ---
                const prerollSec = 0.12;
                const silence = ctx.createBuffer(1, Math.round(prerollSec * ctx.sampleRate), ctx.sampleRate);
                const silNode = ctx.createBufferSource();
                silNode.buffer = silence;
                silNode.connect(ctx.destination);
                silNode.start(ctx.currentTime);
                // -----------------------------------------

                // Wire chain
                src.connect(gain).connect(comp).connect(ctx.destination);


                // Optional guard tone (Android sender → helps iOS RX AGC lock midband)
                let startAt = ctx.currentTime + prerollSec;
                let toneNode = null;

                if (IS_ANDROID) {
                    const toneDur = 0.18;
                    const sr = ctx.sampleRate;
                    const len = Math.round(toneDur * sr);
                    const tone = ctx.createBuffer(1, len, sr);
                    const ch = tone.getChannelData(0);
                    const f = 1500;
                    for (let i = 0; i < len; i++) ch[i] = 0.5 * Math.sin(2 * Math.PI * f * (i / sr));
                    toneNode = ctx.createBufferSource();
                    toneNode.buffer = tone;
                    toneNode.connect(ctx.destination);
                    toneNode.start(startAt);
                    startAt += toneDur + 0.02; // +20 ms spacer
                }

                src.onended = () => {
                    try {
                        src.disconnect(); gain.disconnect(); comp.disconnect(); silNode.disconnect();
                        toneNode && toneNode.disconnect();
                    } catch { }
                    resolve();
                };

                // Start data after silence (+ guard tone on Android)
                src.start(startAt);

            } catch (e) {
                try { src?.stop?.(); } catch { }
                try { silNode?.stop?.(); } catch { }
                console.error('[Audio] Playback error:', e);
                reject(e);
            }
        });
    }

    // --- RX path ---
    async startReceiving(UIModule) {
        if (this._initInFlight || this.isReceiving) {
            UIModule.showMessage(this.i18n.audio_already_listening || 'Already listening…', 'warning');
            return;
        }

        const micOk = await ensureMicPermission();
        if (!micOk) {
            UIModule.showMessage(this.i18n.audio_mic_required_rx || 'Microphone permission is required to start receiving.', 'warning');
            return;
        }

        this._initInFlight = true;

        // FORCE FRESH START: Clear any existing instances
        if (this.recordingInstance) {
            this.recordingInstance = null;
        }
        if (this.playbackInstance) {
            this.playbackInstance = null;
        }

        // Reset transmission state explicitly
        this.isTransmitting = false;

        try {
            if (!this.ggwaveReady) {
                UIModule.showMessage(this.i18n.audio_initializing || 'Initializing audio system...', 'info');
                const ok = await this.initialize();
                if (!ok) throw new Error('GGWave init failed');
            }

            UIModule.showMessage(this.i18n.audio_requesting_mic || 'Requesting microphone access...', 'info');

            // First get the media stream to determine its sample rate
            this.userStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false,
                    channelCount: 1,
                    sampleRate: { ideal: 48000 }
                }
            });

            // Get the actual sample rate from the stream
            const track = this.userStream.getAudioTracks()[0];
            const settings = track.getSettings();
            const streamSampleRate = settings.sampleRate || 44100;


            // Close any existing recording context (but preserve userStream)
            if (this.audioWorkletNode) {
                try { this.audioWorkletNode.disconnect(); this.audioWorkletNode.port.close(); } catch { }
                this.audioWorkletNode = null;
            }
            if (this.recorder) {
                try { this.recorder.disconnect(); } catch { }
                this.recorder = null;
            }
            if (this.mediaStreamNode) {
                try { this.mediaStreamNode.disconnect(); } catch { }
                this.mediaStreamNode = null;
            }
            if (this.recordingInstance) { this.recordingInstance = null; }
            if (this.recordingContext && this.recordingContext.state !== 'closed') {
                try { await this.recordingContext.close(); } catch { }
            }
            this.recordingContext = null;

            // Create new recording context with NO sample rate constraint
            const AC = window.AudioContext || window.webkitAudioContext;
            this.recordingContext = new AC(); // Let browser choose optimal rate


            if (this.recordingContext.state === 'suspended') {
                await this.recordingContext.resume();
            }

            // Wait for context to stabilize
            await new Promise(requestAnimationFrame);

            // Initialize GGWave instance
            this.recordingInstance = this.ggwave.init();
            if (!this.recordingInstance || this.recordingInstance === 0) {
                throw new Error('GGWave recording instance init failed');
            }


            // Verify userStream is still valid
            if (!this.userStream || this.userStream.getTracks().length === 0) {
                throw new Error('MediaStream became invalid');
            }

            // Create the media source node
            try {
                this.mediaStreamNode = this.recordingContext.createMediaStreamSource(this.userStream);
            } catch (contextError) {
                console.warn('[Audio] Context creation failed, recreating with fresh stream:', contextError);

                // Stop current stream and get a new one
                this.userStream.getTracks().forEach(t => t.stop());

                // Get fresh stream
                this.userStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        autoGainControl: false,
                        noiseSuppression: false,
                        channelCount: 1,
                        sampleRate: { ideal: this.recordingContext.sampleRate } // Match context rate
                    }
                });

                this.mediaStreamNode = this.recordingContext.createMediaStreamSource(this.userStream);
            }

            // Set up audio processing
            if (this.recordingContext.audioWorklet) {
                await this.ensureAudioWorklet();

                this.audioWorkletNode = new AudioWorkletNode(this.recordingContext, 'ggwave-processor');

                this.audioWorkletNode.port.onmessage = (event) => {
                    if (!this.isReceiving) return;
                    if (event.data.type === 'audiodata') {
                        const samples = event.data.samples;

                        try {
                            const decoded = this.ggwave.decode(this.recordingInstance, samples);
                            if (decoded && decoded !== this._lastDecoded) {
                                this._lastDecoded = decoded;
                                this.onTextDecoded(decoded, UIModule);
                            }
                        } catch (err) {
                            console.error('[Audio] decode failed:', err);
                        }
                    }
                };

                this.mediaStreamNode.connect(this.audioWorkletNode);
            } else {
                // Fallback to ScriptProcessorNode for older browsers
                console.warn('[Audio] AudioWorklet not available, using deprecated ScriptProcessorNode');
                const bufferSize = 2048;
                this.recorder = this.recordingContext.createScriptProcessor(bufferSize, 1, 1);

                this.recorder.onaudioprocess = (e) => {
                    if (!this.isReceiving) return;
                    const samples = e.inputBuffer.getChannelData(0);

                    try {
                        const decoded = this.ggwave.decode(this.recordingInstance, samples);
                        if (decoded && decoded !== this._lastDecoded) {
                            this._lastDecoded = decoded;
                            this.onTextDecoded(decoded, UIModule);
                        }
                    } catch (err) {
                        console.error('[Audio] decode failed:', err);
                    }
                };

                this.mediaStreamNode.connect(this.recorder);
                // Connect to destination to prevent garbage collection
                this.recorder.connect(this.recordingContext.destination);
            }

            this.isReceiving = true;
            UIModule.showMessage(this.i18n.audio_listening || 'Listening for audio data… Play the transmission near this device.', 'info');
        } catch (error) {
            console.error('[Audio] Reception failed:', error);
            let msg = this.i18n.audio_start_failed_prefix || 'Audio reception failed: ';
            if (error.name === 'NotAllowedError') msg += this.i18n.audio_mic_denied || 'Microphone permission denied.';
            else if (error.name === 'NotFoundError') msg += this.i18n.audio_no_mic || 'No microphone found.';
            else msg += error.message;
            UIModule.showMessage(msg, 'danger');
            this.isReceiving = false;
            this._closeRxNodes();
        } finally {
            this._initInFlight = false;
        }
    }

    async stopReceiving(UIModule = null) {
        this.isReceiving = false;
        this._lastDecoded = null;
        if (this.rxTimer) { clearTimeout(this.rxTimer); this.rxTimer = null; }

        // Auto-process payload if we have UIModule and received data
        if (UIModule) {
            const processed = this.processReceivedPayload(UIModule);
            if (processed) {
            }
        }

        await this._closeRecordingContext();
    }

    async onTextDecoded(text, UIModule) {
        const f = parseFrame(text);
        if (!f) return;


        // Validate frame sequence numbers
        if (f.seq < 0 || f.total < 1 || f.seq > f.total + 1) {
            console.warn('[Audio] Invalid frame sequence:', f.seq, '/', f.total);
            return;
        }

        // Always extend timeout when we receive any valid frame
        this.armRxTimeout(UIModule);

        if (f.payload === 'BEGIN' && f.seq === 0) {
            this.resetRxSession();
            this.rxHash4 = f.hash4;
            this.rxTotal = f.total;
            UIModule.showMessage((this.i18n.audio_starting_frames || '🎧 Starting reception: expecting {total} frames...').replace('{total}', this.rxTotal), 'info');
            return;
        }

        if (f.payload === 'END') {
            UIModule.showMessage(this.i18n.audio_assembling_frames || '📦 All frames received, processing...', 'info');
            await this.finalizeIfComplete(UIModule);
            return;
        }

        // Handle session mismatch - be more strict about hash consistency
        if (this.rxHash4 && f.hash4 !== this.rxHash4) {
            console.warn('[Audio] Hash mismatch! Expected:', this.rxHash4, 'Got:', f.hash4);
            UIModule.showMessage(this.i18n.audio_session_mismatch || '⚠️ Session mismatch detected, restarting reception...', 'warning');
            this.resetRxSession();
            // Don't return - process this frame as start of new session
        }

        if (!this.rxHash4) this.rxHash4 = f.hash4;
        if (!this.rxTotal) this.rxTotal = f.total;

        // Validate frame belongs to current session
        if (this.rxTotal && f.total !== this.rxTotal) {
            console.warn('[Audio] Frame total mismatch! Expected:', this.rxTotal, 'Got:', f.total);
            return;
        }

        if (f.seq >= 1 && f.seq <= f.total) {
            if (!this.rxChunks.has(f.seq)) {
                this.rxChunks.set(f.seq, f.payload);
                this.updateReceptionStatus(UIModule);
            } else {
            }
        }

        await this.finalizeIfComplete(UIModule);
    }

    async transmitChunked(data, payloadPerFrame, hash4, UIModule, opts = {}) {
        const repeats = typeof opts.repeats === 'number' ? opts.repeats : REPEATS;
        const frameGap = typeof opts.frameGap === 'number' ? opts.frameGap : FRAME_GAP_MS;
        const duplicate = !!opts.duplicate;

        const chunks = chunkString(data, payloadPerFrame);
        const total = chunks.length;


        // BEGIN frame
        const begin = frameHeader(0, total, hash4) + 'BEGIN';
        await playTextFrame(this, begin, repeats);
        if (duplicate) {
            await waitMs(80);
            await playTextFrame(this, begin, repeats);
        }
        await waitMs(frameGap);

        // Data frames
        for (let i = 0; i < total; i++) {
            const seq = i + 1;
            const frame = frameHeader(seq, total, hash4) + chunks[i];
            UIModule.showMessage((this.i18n.audio_transmitting || 'Transmitting ({seq}/{total})...').replace('{seq}', seq).replace('{total}', total), 'info');
            try {
                await playTextFrame(this, frame, repeats);
                if (duplicate) {
                    await waitMs(80);
                    await playTextFrame(this, frame, repeats);
                }
            } catch (e) {
                console.warn(`[Audio] Frame ${seq} failed, retrying once`, e);
                await waitMs(frameGap);
                await playTextFrame(this, frame, repeats);
            }
            await waitMs(frameGap);
        }

        // END frame
        const end = frameHeader(total + 1, total, hash4) + 'END';
        await playTextFrame(this, end, repeats);
        if (duplicate) {
            await waitMs(80);
            await playTextFrame(this, end, repeats);
        }

        UIModule.showMessage(this.i18n.audio_tx_complete || 'Audio transmission completed!', 'success');
    }


    // Create audio payload in same format as QR codes for consistency
    createAudioPayload(mode, encryptedText, stealthMode) {
        return stealthMode
            ? `CipherBrick|${mode}|stealth|${encryptedText}`
            : `CipherBrick|${mode}|${encryptedText}`;
    }

    // Parse received audio payload (same format as QR)
    parseAudioPayload(text) {
        if (!text.startsWith('CipherBrick|')) return null;

        const parts = text.split('|');
        if (parts.length < 3) return null;

        const mode = parts[1].toLowerCase();
        let stealth = false;
        let payload = '';

        if (parts[2].toLowerCase() === 'stealth') {
            stealth = true;
            payload = parts.slice(3).join('|');
        } else {
            payload = parts.slice(2).join('|');
        }

        if (!['encrypt', 'decrypt'].includes(mode)) return null;
        return { mode, payload, stealth };
    }

    processReceivedPayload(UIModule) {
        const receivedTextEl = document.getElementById('receivedText');
        if (!receivedTextEl || !receivedTextEl.value) return false;

        const payload = receivedTextEl.value.trim();

        // Use the same parsing logic as QR codes
        const parsed = this.parseAudioPayload(payload);
        if (!parsed) {
            return false;
        }


        // Handle stealth mode FIRST — sync mode dropdown and storage to match payload type
        if (parsed.stealth) {
            sessionStorage.setItem("stealthMode", "true");
            localStorage.setItem("cb.simplifiedMode", "true");
            localStorage.setItem("cb.hardwareKeyMode", "false");
            const modeSelect = document.getElementById("modeSelect");
            if (modeSelect) modeSelect.value = "simple";
        } else {
            sessionStorage.setItem("stealthMode", "false");
            localStorage.setItem("cb.simplifiedMode", "false");
            const modeSelect = document.getElementById("modeSelect");
            if (modeSelect && modeSelect.value === "simple") modeSelect.value = "standard";
        }

        // Update stealth UI
        if (UIModule.updateStealthUI) {
            UIModule.updateStealthUI();
        }

        // CRITICAL: Switch mode BEFORE clearing form and populating input
        if (parsed.mode === 'encrypt') {
            // We received encrypted data, so we need to switch to decrypt mode

            // Find the decrypt button and click it to properly switch modes
            const decryptBtn = document.getElementById('decryptBtn');
            if (decryptBtn) {
                decryptBtn.click(); // This will call app.setMode('decrypt') and clear form
            }

            // Now populate the input field AFTER mode switch
            setTimeout(() => {
                const inputTextEl = document.getElementById('inputText');
                if (inputTextEl) {
                    inputTextEl.value = parsed.payload;
                }
            }, 50); // Small delay to ensure mode switch completes first

        } else if (parsed.mode === 'decrypt') {
            // If we received decrypted data, we might want to stay in encrypt mode or switch as needed
            const inputTextEl = document.getElementById('inputText');
            if (inputTextEl) inputTextEl.value = parsed.payload;
        }

        // Clear the received payload text (no longer needed)
        receivedTextEl.value = '';

        // Close the audio modal
        this.closeAudioModal();

        UIModule.showMessage(
            (this.i18n.audio_payload_applied || 'Audio payload processed and applied! Mode: decrypt, Simple: {stealth}')
                .replace('{stealth}', parsed.stealth ? (this.i18n.yes || 'Yes') : (this.i18n.no || 'No')),
            'success'
        );

        return true;
    }

    closeAudioModal() {
        // Close the QR modal which contains the audio tools
        const qrModalEl = document.getElementById('qrModal');
        if (qrModalEl) {
            try {
                const qrModal = bootstrap.Modal.getInstance(qrModalEl) || new bootstrap.Modal(qrModalEl);
                qrModal.hide();
            } catch (error) {
                console.warn('[Audio] Failed to close QR modal:', error);
            }
        }

        // Also collapse the audio accordion section
        const collapseAudioEl = document.getElementById('collapseAudio');
        if (collapseAudioEl && collapseAudioEl.classList.contains('show')) {
            try {
                const bsCollapse = bootstrap.Collapse.getInstance(collapseAudioEl) || new bootstrap.Collapse(collapseAudioEl, { toggle: false });
                bsCollapse.hide();
            } catch (error) {
                console.warn('[Audio] Failed to collapse audio accordion:', error);
            }
        }
    }

    async completeReset() {

        // Reset reception state
        this.resetRxSession();
        this._lastDecoded = null;
        this.rxActive = false;

        // Clear any lingering timers
        if (this.rxTimer) {
            clearTimeout(this.rxTimer);
            this.rxTimer = null;
        }

        // CRITICAL: Reset ALL state flags
        this.isTransmitting = false;
        this.isReceiving = false;
        this._initInFlight = false;

        // NUCLEAR OPTION: Complete audio context and instance cleanup
        await this._closeRecordingContext();
        await this._closePlaybackContext();

        // Reset the ggwave ready flag to force complete reinitialization
        this.ggwaveReady = false;
        this.ggwave = null;
        this.playbackInstance = null;
        this.recordingInstance = null;

        // Clear any UI elements
        const receivedTextArea = document.getElementById('receivedAudioPayload');
        if (receivedTextArea) {
            receivedTextArea.value = '';
        }

    }
}