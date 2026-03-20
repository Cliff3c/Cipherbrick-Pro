// /js/modules/audiotransmission.js

import { UIModule } from './ui.js';

/**
 * AudioTransmissionModule - Handles audio transmission and reception functionality
 *
 * Features:
 * - Transmit encrypted messages via audio
 * - Receive and decode audio messages
 * - Audio listener UI management
 * - Audio system refresh and state management
 * - Listen button lock/unlock controls
 */
export class AudioTransmissionModule {
    constructor(app) {
        this.app = app;
    }

    get i18n() { return this.app?.i18nStrings || {}; }

    /**
     * Transmit encrypted message via audio
     * Only available in encrypt mode with encrypted output
     */
    async transmitAudio() {
        const encryptBtn = document.getElementById("encryptBtn");
        if (!encryptBtn.classList.contains("mode-button-active")) {
            UIModule.showMessage(this.i18n.audio_tx_encrypt_only || "Audio transmission is only available in Encrypt mode.", "warning");
            return;
        }

        const encryptedMessage = document.getElementById("outputText").value;
        if (!encryptedMessage) {
            UIModule.showMessage(this.i18n.audio_no_encrypted_msg || "No encrypted message found. Please run encryption first.", "warning");
            return;
        }

        const stealth = sessionStorage.getItem("stealthMode") === "true";
        const payload = this.app.audioModule.createAudioPayload("encrypt", encryptedMessage, stealth);

        await this.app.audioModule.transmitData(payload, UIModule);
    }

    /**
     * Start audio reception
     */
    async startAudioReception() {
        await this.app.audioModule.startReceiving(UIModule);
    }

    /**
     * Stop audio reception and hide receiver UI
     */
    async stopAudioReception() {

        // Hide the receiver UI
        const rcvr = document.getElementById('audioReceiver');
        if (rcvr) rcvr.style.display = 'none';

        // Perform reset of audio module
        if (this.app.audioModule && typeof this.app.audioModule.completeReset === 'function') {
            this.app.audioModule.completeReset();
        }

        await this.app.audioModule.stopReceiving(UIModule);
        UIModule.showMessage(this.i18n.audio_reception_stopped || "Audio reception stopped.", "info");

        // Don't lock the listen button - user should be able to try again
        this.updateListenUI();
    }

    /**
     * Stop audio and refresh the entire page
     * Used when audio system needs a complete reset
     */
    async stopAndRefreshAudio() {
        if (this.app._audioTeardown) return;         // ignore double clicks
        this.app._audioTeardown = true;              // enter teardown
        this.lockListenUntilRefresh();               // prevent Listen before refresh
        this.updateListenUI();

        try {
            // Hide the receiver UI immediately
            const rcvr = document.getElementById('audioReceiver');
            if (rcvr) rcvr.style.display = 'none';

            // Belt & suspenders: full stop + deep reset hooks, if present
            if (this.app.audioModule?.completeReset) {
                try { this.app.audioModule.completeReset(); } catch (e) { console.warn(e); }
            }
            await this.app.audioModule.stopReceiving(UIModule);
        } catch (e) {
            console.warn('[Audio] Stop & Refresh teardown issue:', e);
        } finally {
            // Use the existing, reliable refresh path (saves state and reloads)
            this.refreshForAudio();
        }
    }

    /**
     * Handle audio data received from the audio module
     * Parses payload, updates UI, and switches to decrypt mode
     */
    handleReceivedAudioData(data) {

        const parsed = this.app.audioModule.parseAudioPayload(data);
        if (parsed) {
            // Handle stealth mode — sync mode dropdown and storage to match payload type
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
            UIModule.updateStealthUI();

            // Clean form except key/salt
            UIModule.clearForm(true, true, this.app.i18nStrings);

            // Force to decrypt mode
            this.app.setMode("decrypt");

            // Fill input with received payload
            document.getElementById("inputText").value = parsed.payload;

            // CRITICAL: Reset audio module state completely
            this.app.audioModule.resetRxSession();
            this.app.audioModule._lastDecoded = null;

            // Stop audio reception and hide the receiver
            this.stopAudioReception();
            document.getElementById('audioReceiver').style.display = 'none';

            // SUCCESS: Clear the "has listened" flag so next time works normally
            sessionStorage.removeItem('hasListenedForAudio');

            UIModule.showMessage(this.i18n.audio_received_success || "Audio data received successfully. Mode set to decrypt. Please fill in key/salt fields.", "success");

            // Lock listening until Refresh (prevents double-listen in the same session)
            this.lockListenUntilRefresh();
        } else {
            // If not CipherBrick format, just put raw data in input
            document.getElementById("inputText").value = data;

            // Still reset state even for non-CipherBrick data
            this.app.audioModule.resetRxSession();
            this.app.audioModule._lastDecoded = null;

            // Also clear the flag for non-CipherBrick data
            sessionStorage.removeItem('hasListenedForAudio');

            UIModule.showMessage(this.i18n.audio_not_cipherbrick || "Audio data received, but not in expected CipherBrick format.", "warning");
        }
    }

    /**
     * Toggle the audio listener UI visibility
     * Hides other input areas when showing audio receiver
     */
    toggleAudioListener() {
        // Hide other input areas
        const payloadArea = document.getElementById('payloadInputArea');
        if (payloadArea) payloadArea.style.display = 'none';

        const receiverDiv = document.getElementById('audioReceiver');
        const isVisible = receiverDiv.style.display !== 'none';

        if (!isVisible) {
            receiverDiv.style.display = 'block';
            this.startContextAudioReception();
        } else {
            this.stopAudioReception();
            receiverDiv.style.display = 'none';
        }
    }

    /**
     * Start audio reception in the context area
     */
    async startContextAudioReception() {
        try {
            await this.app.audioModule.startReceiving(UIModule);
            this.updateListenUI();
        } catch (error) {
            console.error("[Audio] Failed to start reception:", error);
            UIModule.showMessage((this.i18n.audio_start_failed || "Failed to start audio reception: {error}").replace('{error}', error.message), "danger");
        }
    }

    /**
     * Force a complete reset of the audio module
     * Destroys and recreates the audio module instance
     */
    async forceAudioModuleReset() {

        // Completely destroy and recreate the audio module
        if (this.app.audioModule) {
            try {
                await this.app.audioModule.stopReceiving(UIModule);
                await this.app.audioModule._closeRecordingContext();
                await this.app.audioModule._closePlaybackContext();
            } catch (e) {
                console.warn('[App] Error during audio module cleanup:', e);
            }
        }

        // Import and create a fresh AudioModule instance
        const { AudioModule } = await import('./audio.js');
        this.app.audioModule = new AudioModule(this.app);
    }

    /**
     * Save current app state to sessionStorage
     * Used before refreshing the page to preserve user data
     */
    saveAppState() {
        const state = {
            currentMode: this.app.currentMode,
            keyValue: document.getElementById('key')?.value || '',
            saltValue: document.getElementById('salt')?.value || '',
            inputText: document.getElementById('inputText')?.value || '',
            outputText: document.getElementById('outputText')?.value || '',
            stealthMode: sessionStorage.getItem("stealthMode") === "true",
            clipboardTimeout: document.getElementById('clipboardTimeout')?.value || '30',
            idleTimeout: document.getElementById('idleTimeout')?.value || '5',
            txProtocol: localStorage.getItem('cb.txProtocol') || 'GGWAVE_PROTOCOL_AUDIBLE_FASTEST'
        };
        sessionStorage.setItem('cipherBrickAppState', JSON.stringify(state));
    }

    /**
     * Restore app state from sessionStorage
     * Called after page refresh to restore user data
     */
    restoreAppState() {
        const stateJson = sessionStorage.getItem('cipherBrickAppState');
        if (!stateJson) return;

        try {
            const state = JSON.parse(stateJson);

            // Restore mode FIRST (this will clear forms)
            this.app.setMode(state.currentMode);

            // Then restore form values AFTER mode is set
            if (state.keyValue) document.getElementById('key').value = state.keyValue;
            if (state.saltValue) document.getElementById('salt').value = state.saltValue;
            if (state.inputText) document.getElementById('inputText').value = state.inputText;
            if (state.outputText) document.getElementById('outputText').value = state.outputText;

            // Restore settings
            if (state.clipboardTimeout) document.getElementById('clipboardTimeout').value = state.clipboardTimeout;
            if (state.idleTimeout) document.getElementById('idleTimeout').value = state.idleTimeout;

            // Restore stealth mode — sync mode dropdown and storage
            sessionStorage.setItem("stealthMode", state.stealthMode ? "true" : "false");
            localStorage.setItem("cb.simplifiedMode", state.stealthMode ? "true" : "false");
            const modeSelect = document.getElementById("modeSelect");
            if (modeSelect) modeSelect.value = state.stealthMode ? "simple" : "standard";

            // Restore protocol setting
            localStorage.setItem('cb.txProtocol', state.txProtocol);
            const txSelect = document.getElementById('cb-setting-txProtocol');
            if (txSelect) txSelect.value = state.txProtocol;

            // Clean up the saved state
            sessionStorage.removeItem('cipherBrickAppState');

            // Show a friendly message
            UIModule.showMessage(this.i18n.audio_refreshed || "🔄 Audio system refreshed - ready to continue!", "info");
        } catch (e) {
            console.warn('Could not restore app state:', e);
        }
    }

    /**
     * Smart refresh for audio issues
     * Saves state and reloads the page
     */
    refreshForAudio() {
        UIModule.showMessage(this.i18n.audio_refreshing || "🔄 Refreshing audio system to ensure reliability...", "info");
        this.saveAppState();

        // Small delay to let user see the message
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    }

    /**
     * Check if listen button is locked
     * Currently always returns false to allow retries
     */
    isListenLocked() {
        return false; // Always return false so button is never locked
    }

    /**
     * Lock the listen button until page refresh
     * Currently disabled to allow retries
     */
    lockListenUntilRefresh() {
        // Do nothing - we don't want to lock the button
    }

    /**
     * Unlock the listen button
     */
    unlockListen() {
        sessionStorage.removeItem('cb.listenLocked');
        this.updateListenUI();
    }

    /**
     * Update the listen button UI state
     * Disables listen button while receiving, enables stop button
     */
    updateListenUI() {
        const listenBtn = document.getElementById('listenAudioBtn');
        const stopBtn = document.getElementById('stopListenBtn');

        if (!listenBtn) return;

        const isReceiving = !!(this.app.audioModule && this.app.audioModule.isReceiving);

        // Never hide the listen button, only disable it while receiving
        listenBtn.disabled = isReceiving;

        // Stop should be enabled only while receiving
        if (stopBtn) stopBtn.disabled = !isReceiving;
    }
}
