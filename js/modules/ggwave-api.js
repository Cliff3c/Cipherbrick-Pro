export function buildGGWaveFacade(Module) {
    if (!Module) throw new Error('GGWave Module is undefined');

    const malloc = Module._malloc?.bind(Module);
    const free = Module._free?.bind(Module);
    const HEAPU8v = () => Module.HEAPU8;
    const HEAPF32v = () => Module.HEAPF32;
    if (!malloc || !free || !Module.HEAPU8 || !Module.HEAPF32) {
        throw new Error('Missing malloc/free/HEAP views on Module');
    }

    // --- C bindings (new stable wrappers) ---
    const c_params_size = Module.cwrap('ggwave_params_size', 'number', []);
    const c_params_defaults = Module.cwrap('ggwave_params_defaults', 'number', ['number', 'number']);
    const c_params_tune = Module.cwrap('ggwave_params_set_txrx_48k_f32', 'number', ['number', 'number']);
    const c_init_from_buf = Module.cwrap('ggwave_init_from_buf', 'number', ['number', 'number']);
    const c_init_preset = Module.cwrap('ggwave_init_txrx_48k_f32', 'number', []);

    // Library wrappers that match the current header
    const c_encode = Module.cwrap('ggwave_encode_capi', 'number',
        ['number', 'number', 'number', 'number', 'number', 'number', 'number']);
    const c_decode_f32 = Module.cwrap('ggwave_decode_f32_capi', 'number',
        ['number', 'number', 'number', 'number', 'number']);

    function init() {
        // 1) Try the one-shot preset initializer (no params buffer)
        try {
            const inst1 = c_init_preset ? c_init_preset() : 0;
            if (inst1) {
                // Optional TX probe (same as before)
                const probe = new TextEncoder().encode('hi');
                const probePtr = malloc(probe.length); HEAPU8v().set(probe, probePtr);
                const sizeBytes = c_encode(inst1, probePtr, probe.length, 1, 25, 0, 1);
                free(probePtr);
                if (sizeBytes > 0 && sizeBytes < (1 << 20)) {
                    return inst1;
                }
                console.warn('[GGWave] preset init returned instance, but TX probe failed; will try buffer path');
            } else {
                console.warn('[GGWave] preset init returned 0; will try buffer path');
            }
        } catch (e) {
            console.warn('[GGWave] preset init threw, will try buffer path:', e);
        }

        // 2) Fallback: params buffer path with explicit checks
        const sz = c_params_size();
        if (sz <= 0 || sz > 512) throw new Error(`Unexpected ggwave_params_size(): ${sz}`);
        const ptr = malloc(sz);
        HEAPU8v().fill(0, ptr, ptr + sz);

        const rcDefaults = c_params_defaults(ptr, sz);
        const rcTune = c_params_tune(ptr, sz);

        const inst = c_init_from_buf(ptr, sz);
        free(ptr);
        if (!inst) throw new Error('ggwave_init_from_buf() returned 0');

        // TX probe (as before)
        const probe = new TextEncoder().encode('hi');
        const probePtr = malloc(probe.length); HEAPU8v().set(probe, probePtr);

        const sizeBytes = c_encode(inst, probePtr, probe.length, 1, 25, 0, 1);
        if (sizeBytes <= 0 || sizeBytes > 1 << 20) {
            free(probePtr);
            throw new Error('TX disabled or invalid size on defaults (buffer path)');
        }
        const outPtr = malloc(sizeBytes);
        const n = c_encode(inst, probePtr, probe.length, 1, 25, outPtr, 0);
        free(outPtr); free(probePtr);
        if (n <= 0) throw new Error('TX failed on probe (buffer path)');

        return inst;
    }


    // Encode: two-step per current GGWave API (query size, then fill)
    function encode(instance, text, protocolId, volume = 25) {
        const bytes = new TextEncoder().encode(text);
        const msgPtr = malloc(bytes.length); HEAPU8v().set(bytes, msgPtr);

        const sizeBytes = c_encode(instance | 0, msgPtr, bytes.length, protocolId | 0, volume | 0, 0, 1);
        if (sizeBytes <= 0 || sizeBytes > 1 << 22) {
            free(msgPtr);
            throw new Error('encode query failed');
        }

        const outPtr = malloc(sizeBytes);
        const n = c_encode(instance | 0, msgPtr, bytes.length, protocolId | 0, volume | 0, outPtr, 0);
        if (n <= 0) {
            free(outPtr); free(msgPtr);
            throw new Error('encode failed');
        }

        const out = new Uint8Array(Module.HEAPU8.buffer, outPtr, n);
        const copy = new Uint8Array(out);
        free(outPtr); free(msgPtr);
        return copy; // int16 PCM bytes (since sampleFormatOut = I16)
    }

    // Decode: pass Float32 samples directly; library returns payload bytes
    function decode(instance, float32Samples) {
        const count = float32Samples.length;
        if (!count) return '';
        const sampPtr = malloc(count * 4);
        HEAPF32v().set(float32Samples, sampPtr >> 2);

        const OUT_MAX = 4096;
        const outPtr = malloc(OUT_MAX);
        const n = c_decode_f32(instance | 0, sampPtr, count | 0, outPtr, OUT_MAX | 0);
        free(sampPtr);

        if (n <= 0) { free(outPtr); return ''; }

        const msgBytes = new Uint8Array(Module.HEAPU8.subarray(outPtr, outPtr + n));
        free(outPtr);

        try { return new TextDecoder().decode(msgBytes); }
        catch { return Module.UTF8ArrayToString(msgBytes, 0, n); }
    }

    // Optional helper for your audio path (unchanged usage)
    function int16BytesToF32(int16Bytes) {
        const view = new DataView(int16Bytes.buffer, int16Bytes.byteOffset, int16Bytes.byteLength);
        const n = int16Bytes.byteLength >> 1;
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
        return out;
    }
    function encodeFloat32(instance, text, protocolId = 1, volume = 25) {
        const pcmBytes = encode(instance, text, protocolId, volume);
        return pcmBytes && pcmBytes.length ? int16BytesToF32(pcmBytes) : null;
    }

    // Build a robust ProtocolId map by scanning Module constants and adding synonyms.
    const ProtocolId = (() => {
        const out = {};
        // Use any nested map if present
        if (Module.ProtocolId && typeof Module.ProtocolId === 'object') {
            Object.assign(out, Module.ProtocolId);
        }
        // Scan top-level Module for numeric PROTOCOL constants
        for (const k of Object.keys(Module)) {
            const v = Module[k];
            if (typeof v !== 'number') continue;
            if (!/PROTOCOL/i.test(k)) continue;

            // Original key
            if (out[k] == null) out[k] = v;

            // Map TX_ variant <-> non-TX variant
            // e.g., GGWAVE_TX_PROTOCOL_ULTRASOUND_FAST -> GGWAVE_PROTOCOL_ULTRASOUND_FAST
            const parts = k.split(/PROTOCOL_/i);
            if (parts[1]) {
                const uiToken = 'GGWAVE_PROTOCOL_' + parts[1];
                if (out[uiToken] == null) out[uiToken] = v;
            }
            if (/^GGWAVE_PROTOCOL_/i.test(k)) {
                const txVariant = k.replace(/^GGWAVE_PROTOCOL_/i, 'GGWAVE_TX_PROTOCOL_');
                if (out[txVariant] == null) out[txVariant] = v;
            }
        }
        return out;
    })();

    function getDefaultParameters() {
        // These match what we set via params_tune (48k F32 in, I16 out, RX+TX)
        return {
            sampleRateInp: 48000,
            sampleRateOut: 48000,
            sampleRate: 48000,
            sampleFormatInp: 'F32',
            sampleFormatOut: 'I16',
            operatingMode: 'RX_AND_TX',
        };
    }

    return { Module, ProtocolId, init, encode, encodeFloat32, decode, getDefaultParameters };
}