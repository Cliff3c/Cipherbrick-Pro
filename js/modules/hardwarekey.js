// js/modules/hardwarekey.js
// Hardware Key Mode — FIDO2/WebAuthn ECDH encryption using physical security keys.
// Primary path: PRF extension → deterministic P-256 key pair (stable public key across sessions)
// Fallback: WebAuthn presence verification + software ECDH (ephemeral key per session)

export class HardwareKeyModule {
    // Private fields — key material never leaves memory
    #privateKey = null;   // CryptoKey (non-extractable)
    #publicKey = null;    // CryptoKey
    #prfSupported = false;
    #initialized = false;

    // PKCS8 DER prefix for P-256 ECPrivateKey without embedded public key (35 bytes)
    // Structure: SEQUENCE { INTEGER 0, AlgorithmIdentifier(P-256), OCTET STRING { ECPrivateKey { v1, OCTET STRING(32) } } }
    static #PKCS8_PREFIX = new Uint8Array([
        0x30, 0x41,                                                       // SEQUENCE, 65 bytes
        0x02, 0x01, 0x00,                                                 // INTEGER 0 (version)
        0x30, 0x13,                                                       // SEQUENCE (AlgorithmIdentifier), 19 bytes
        0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,           // OID ecPublicKey
        0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,     // OID P-256
        0x04, 0x27,                                                       // OCTET STRING, 39 bytes
        0x30, 0x25,                                                       // SEQUENCE (ECPrivateKey), 37 bytes
        0x02, 0x01, 0x01,                                                 // INTEGER 1 (ECPrivateKey version)
        0x04, 0x20,                                                       // OCTET STRING, 32 bytes (private key follows)
    ]);

    // Fixed PRF salt — deterministic so same hardware key always yields same ECDH key pair
    static #PRF_SALT = new TextEncoder().encode('CipherBrick-HK-v1');

    constructor(app) {
        this.app = app;
        this.crypto = window.crypto;
    }

    get i18n() { return this.app?.i18nStrings || {}; }
    get keyx() { return this.app?.keyx; }

    // ── Public API ────────────────────────────────────────────────────────────

    isSupported() {
        return !!(window.PublicKeyCredential && navigator.credentials);
    }

    // Detects/registers hardware key; derives deterministic ECDH key pair via PRF.
    // Updates #hkStatusBar in the UI as it progresses.
    // Flow: existing credential → single authenticate call (1 touch).
    //       new credential     → register with eval (1 touch if browser returns PRF in create),
    //                            or register (touch 1) + authenticate (touch 2).
    // If PRF is unavailable or fails → throws hk_prf_not_supported (no ephemeral fallback).
    async detectAndRegister() {
        if (!this.isSupported()) {
            this.#setStatus('error', this.i18n.hk_not_supported || 'FIDO2/WebAuthn is not supported in this browser.');
            return false;
        }

        this.#setStatus('detecting', this.i18n.hk_detecting || 'Detecting hardware key…');

        try {
            const storedId = localStorage.getItem('hk.credentialId');
            const credentialId = storedId ? Uint8Array.from(atob(storedId), c => c.charCodeAt(0)) : null;
            const prfPreviouslyFailed = localStorage.getItem('hk.prfFailed') === 'true';

            if (prfPreviouslyFailed) {
                // PRF is known to not work in this browser/key combo — fail clearly
                throw new Error('hk_prf_not_supported');
            } else if (credentialId) {
                // Known credential on this device — fast path (1 touch)
                return await this.#authenticateExisting(credentialId);
            } else {
                // Android's WebAuthn implementation only discovers Google-synced passkeys via
                // allowCredentials:[] — it never enumerates hardware key credentials.  Discovery
                // would always show "No passkeys available", forcing the user through a confusing
                // extra UI step before falling through to registration anyway.  Skip discovery on
                // Android and register directly.  On desktop/iOS, try discovery first so a key
                // already registered on another device is found rather than re-registered.
                const isAndroid = /android/i.test(navigator.userAgent);
                if (isAndroid) {
                    return await this.#registerThenAuthenticate();
                }
                return await this.#discoverThenRegister();
            }

        } catch (err) {
            this.#initialized = false;
            this.#privateKey = null;
            this.#publicKey = null;
            this.#handleDetectError(err);
            return false;
        }
    }

    // Returns the current session public key as base64 SPKI.
    async getPublicKey() {
        if (!this.#publicKey) return null;
        return await this.keyx.exportPublicKeySpki(this.#publicKey);
    }

    // Returns the current key pair if already initialized, otherwise activates the hardware key first.
    // Allows the wizard to reuse an active HKPM session without a second touch.
    async getOrActivate() {
        if (this.#initialized && this.#privateKey && this.#publicKey) {
            return { privateKey: this.#privateKey, publicKey: this.#publicKey };
        }
        await this.detectAndRegister();
        return { privateKey: this.#privateKey, publicKey: this.#publicKey };
    }

    // Encrypts plaintext for a recipient. Returns CBHK1:<base64(JSON)> string.
    async encryptMessage(recipientPubKeyB64, plaintext) {
        if (!this.#privateKey || !this.#publicKey) {
            throw new Error('hk_no_private_key');
        }

        const recipientPubKey = await this.keyx.importPublicKeyAuto(recipientPubKeyB64);
        const aesKey = await this.keyx.deriveAESKey(this.#privateKey, recipientPubKey);
        const encrypted = await this.keyx.encryptMessageWithAESKey(aesKey, plaintext);
        const senderPublicKey = await this.getPublicKey();

        const payload = {
            version: 'CBHK1',
            senderPublicKey,
            encrypted,
        };

        return 'CBHK1:' + btoa(JSON.stringify(payload));
    }

    // Decrypts a CBHK1:<base64(JSON)> string. Returns { plaintext, senderPublicKey }.
    async decryptMessage(cbhk1String) {
        if (!this.#privateKey) {
            throw new Error('hk_no_private_key');
        }

        const parsed = this.#parsePayload(cbhk1String);
        const senderPubKey = await this.keyx.importPublicKeyAuto(parsed.senderPublicKey);
        const aesKey = await this.keyx.deriveAESKey(this.#privateKey, senderPubKey);
        const plaintext = await this.keyx.decryptMessageWithAESKey(aesKey, parsed.encrypted);

        // Cache sender key for Reply convenience
        sessionStorage.setItem('hk.lastSenderPublicKey', parsed.senderPublicKey);

        return { plaintext, senderPublicKey: parsed.senderPublicKey };
    }

    // Called by app.js process() when HK mode is active.
    async process() {
        const mode = this.app.currentMode;
        const UIModule = this.app.uiModule;

        if (mode === 'encrypt') {
            await this.#processEncrypt(UIModule);
        } else {
            await this.#processDecrypt(UIModule);
        }
    }

    // Clears all HK session data from memory and sessionStorage.
    clearSession() {
        this.#privateKey = null;
        this.#publicKey = null;
        this.#initialized = false;
        sessionStorage.removeItem('hk.myPublicKey');
        sessionStorage.removeItem('hk.recipientPublicKey');
        sessionStorage.removeItem('hk.lastSenderPublicKey');
        this.#setStatus('detecting', this.i18n.hk_detecting || '🔑 Tap your hardware key to get started');
        this.#updatePublicKeyDisplay(null);
        const replyRow = document.getElementById('hkReplyRow');
        if (replyRow) replyRow.style.display = 'none';
    }

    // ── Encrypt / Decrypt process handlers ───────────────────────────────────

    async #processEncrypt(UIModule) {
        const recipientInput = document.getElementById('hkRecipientKeyInput');
        const inputText = document.getElementById('inputText');
        const outputField = document.getElementById('outputText');
        const runBtn = document.getElementById('processButton');

        const recipientKey = recipientInput?.value.trim() || '';
        const message = inputText?.value || '';

        UIModule.showMessage('', 'info', 0);

        if (!recipientKey) {
            UIModule.showMessage(this.i18n.hk_no_recipient_key || 'Please enter the recipient\'s public key.', 'warning');
            return;
        }
        if (!message.trim()) {
            UIModule.showMessage(this.i18n.hk_no_message || 'Please enter a message to encrypt.', 'warning');
            return;
        }
        if (message.length > 500) {
            UIModule.showMessage(this.i18n.qr_original_too_long || 'Message is too long (max 500 characters).', 'warning');
            return;
        }

        // Hardware key must be initialized — do not auto-trigger WebAuthn here
        if (!this.#initialized) {
            UIModule.showMessage(this.i18n.hk_no_private_key || 'Please click "Activate Hardware Key" first to initialize your hardware key session.', 'warning');
            return;
        }

        if (this.app._busy) return;
        this.app._busy = true;
        runBtn?.setAttribute('disabled', 'true');

        try {
            sessionStorage.setItem('hk.recipientPublicKey', recipientKey);

            const payload = await this.encryptMessage(recipientKey, message);
            outputField.value = payload;

            // Collapse inputs, show output actions (same as normal encrypt flow)
            this.app.setEncryptInputsCollapsed(true);
            const encBefore = document.getElementById('encryptBeforeActions');
            const encAfter = document.getElementById('encryptAfterActions');
            if (encBefore) encBefore.style.display = 'none';
            if (encAfter) encAfter.style.display = 'block';

            const outContainer = document.getElementById('outputTextContainer');
            if (outContainer) outContainer.style.display = 'block';
            outContainer?.scrollIntoView({ behavior: 'smooth', block: 'start' });

            UIModule.showMessage(this.i18n.hk_encrypt_success || 'Message encrypted with hardware key!', 'success');
            UIModule.updateQRButtons();
            this.app.hasProcessed = true;
            UIModule.updateContextActions(this.app.currentMode, this.app.hasProcessed);

        } catch (err) {
            this.#handleOperationError(err, UIModule);
            this.app.setEncryptInputsCollapsed(false);
            const encBefore = document.getElementById('encryptBeforeActions');
            const encAfter = document.getElementById('encryptAfterActions');
            if (encBefore) encBefore.style.display = 'block';
            if (encAfter) encAfter.style.display = 'none';
        } finally {
            this.app._busy = false;
            runBtn?.removeAttribute('disabled');
        }
    }

    async #processDecrypt(UIModule) {
        const inputField = document.getElementById('inputText');
        const outputField = document.getElementById('outputText');
        const runBtn = document.getElementById('processButton');

        const cbhk1String = inputField?.value.trim() || '';

        UIModule.showMessage('', 'info', 0);

        if (!cbhk1String) {
            UIModule.showMessage(this.i18n.hk_no_payload || 'Please paste the encrypted payload to decrypt.', 'warning');
            return;
        }
        if (!cbhk1String.startsWith('CBHK1:')) {
            UIModule.showMessage(this.i18n.hk_invalid_payload || 'Invalid payload format — expected a CBHK1 encrypted string.', 'warning');
            return;
        }

        // Hardware key must be initialized — do not auto-trigger WebAuthn here
        if (!this.#initialized) {
            UIModule.showMessage(this.i18n.hk_no_private_key || 'Please click "Activate Hardware Key" first to initialize your hardware key session.', 'warning');
            return;
        }

        if (this.app._busy) return;
        this.app._busy = true;
        runBtn?.setAttribute('disabled', 'true');

        try {
            const { plaintext, senderPublicKey } = await this.decryptMessage(cbhk1String);
            outputField.value = plaintext;

            // Show sender key for reference
            this.#showSenderKey(senderPublicKey);

            // Show Reply button row
            const replyRow = document.getElementById('hkReplyRow');
            if (replyRow) replyRow.style.display = 'block';

            // Collapse inputs, show decrypt after-actions
            this.app.setEncryptInputsCollapsed(true);
            const decBefore = document.getElementById('decryptBeforeActions');
            const decAfter = document.getElementById('decryptAfterActions');
            if (decBefore) decBefore.style.display = 'none';
            if (decAfter) decAfter.style.display = 'block';

            const outContainer = document.getElementById('outputTextContainer');
            if (outContainer) outContainer.style.display = 'block';
            outContainer?.scrollIntoView({ behavior: 'smooth', block: 'start' });

            UIModule.showMessage(this.i18n.hk_decrypt_success || 'Message decrypted successfully!', 'success');
            UIModule.updateQRButtons();
            this.app.hasProcessed = true;
            UIModule.updateContextActions(this.app.currentMode, this.app.hasProcessed);

        } catch (err) {
            this.#handleOperationError(err, UIModule);
            this.app.setEncryptInputsCollapsed(false);
            const decBefore = document.getElementById('decryptBeforeActions');
            const decAfter = document.getElementById('decryptAfterActions');
            if (decBefore) decBefore.style.display = 'block';
            if (decAfter) decAfter.style.display = 'none';
        } finally {
            this.app._busy = false;
            runBtn?.removeAttribute('disabled');
        }
    }

    // ── PRF / key derivation internals ────────────────────────────────────────

    // Single credentials.get() for an already-stored credential.
    // If the credential is gone, clears stored ID and falls through to fresh registration.
    async #authenticateExisting(credentialId) {
        try {
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: this.crypto.getRandomValues(new Uint8Array(32)),
                    allowCredentials: [{ id: credentialId, type: 'public-key', transports: ['usb', 'nfc', 'ble', 'hybrid', 'internal'] }],
                    userVerification: 'preferred',
                    extensions: { prf: { eval: { first: HardwareKeyModule.#PRF_SALT } } },
                },
            });

            const prfResults = assertion.getClientExtensionResults()?.prf?.results;
            if (prfResults?.first) {
                await this.#deriveKeyPairFromPRF(new Uint8Array(prfResults.first));
                this.#prfSupported = true;
                return await this.#finalizeSetup();
            }

            // Credential present but PRF not in results — PRF not supported on this credential
            throw new Error('hk_prf_not_supported');

        } catch (err) {
            if (err.name === 'NotAllowedError') throw err; // User cancelled — propagate
            if (err.name === 'SecurityError') throw err;   // Origin mismatch — propagate
            if (err.message === 'hk_prf_not_supported') throw err; // Already classified — propagate
            if (err.name === 'OperationError') {
                // PRF computation failed on an existing credential
                localStorage.setItem('hk.prfFailed', 'true');
                throw new Error('hk_prf_not_supported');
            }
            // Other errors (InvalidStateError, etc.): credential likely missing — re-register
            localStorage.removeItem('hk.credentialId');
            return await this.#registerThenAuthenticate();
        }
    }

    // Tries to discover an existing CipherBrick credential on the hardware key before
    // registering a new one.  This enables cross-device use: a credential registered on
    // the laptop is stored on the physical key (resident/discoverable); tapping the same
    // key on mobile finds it automatically and derives the identical PRF key pair.
    //
    // UX: the browser shows a credential-selection prompt.  If the key already has a
    // CipherBrick credential, the user selects it and touches.  If not (new user), the
    // user cancels the empty dialog, and we fall through to fresh registration.
    async #discoverThenRegister() {
        this.#setStatus('detecting',
            this.i18n.hk_discovering ||
            'Looking for existing key… select it if prompted, or cancel to register new.');

        try {
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: this.crypto.getRandomValues(new Uint8Array(32)),
                    allowCredentials: [],  // Empty = find any discoverable credential for this RP
                    userVerification: 'preferred',
                    extensions: { prf: { eval: { first: HardwareKeyModule.#PRF_SALT } } },
                },
            });

            // Found an existing credential — cache its ID so future sessions skip discovery
            const credId = new Uint8Array(assertion.rawId);
            localStorage.setItem('hk.credentialId', btoa(String.fromCharCode(...credId)));

            const prfResults = assertion.getClientExtensionResults()?.prf?.results;
            if (prfResults?.first) {
                await this.#deriveKeyPairFromPRF(new Uint8Array(prfResults.first));
                return await this.#finalizeSetup();
            }

            // Credential found but PRF not returned — unsupported combination
            localStorage.setItem('hk.prfFailed', 'true');
            throw new Error('hk_prf_not_supported');

        } catch (err) {
            if (err.message === 'hk_prf_not_supported') throw err;
            if (err.name === 'OperationError') {
                localStorage.setItem('hk.prfFailed', 'true');
                throw new Error('hk_prf_not_supported');
            }
            if (err.name === 'SecurityError') throw err;
            // NotAllowedError = user cancelled or no discoverable credentials exist
            // Either way, proceed with fresh registration
            return await this.#registerThenAuthenticate();
        }
    }

    // Registers a new credential with the PRF extension (touch 1), then waits and
    // performs a second credentials.get() to obtain the actual PRF output (touch 2).
    // Stores the credential ID after registration so retries skip re-registration.
    async #registerThenAuthenticate() {
        this.#setStatus('detecting', this.i18n.hk_registering || '🔑 Registering… touch your key when prompted');

        const rpId = window.location.hostname || 'localhost';
        const credential = await navigator.credentials.create({
            publicKey: {
                challenge: this.crypto.getRandomValues(new Uint8Array(32)),
                rp: { name: 'CipherBrick Pro', id: rpId },
                user: {
                    id: this.crypto.getRandomValues(new Uint8Array(16)),
                    name: 'cipherbrick-user',
                    displayName: 'CipherBrick User',
                },
                pubKeyCredParams: [
                    { type: 'public-key', alg: -7 },   // ES256 (P-256)
                    { type: 'public-key', alg: -257 }, // RS256 (fallback)
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'cross-platform', // Force hardware key; prevents Android from routing to Google account sync
                    userVerification: 'preferred',
                    residentKey: 'required',     // Discoverable — same credential findable on any device
                    requireResidentKey: true,    // CTAP 2.0 compatibility alias
                },
                extensions: { prf: { eval: { first: HardwareKeyModule.#PRF_SALT } } },
            },
        });

        const credId = new Uint8Array(credential.rawId);
        const extResults = credential.getClientExtensionResults();
        const prfResults = extResults?.prf?.results;
        const prfEnabled = extResults?.prf?.enabled ?? false;

        // Persist credential ID now — a retry will skip re-registration and go straight to get()
        localStorage.setItem('hk.credentialId', btoa(String.fromCharCode(...credId)));

        // Some browsers (Chrome, newer Firefox) return PRF output directly in create() — use it
        // immediately if available (single-touch flow, avoids the second get() call entirely).
        if (prfResults?.first) {
            await this.#deriveKeyPairFromPRF(new Uint8Array(prfResults.first));
            this.#prfSupported = true;
            return await this.#finalizeSetup();
        }

        if (!prfEnabled) {
            // Authenticator registered but PRF not supported — feature requires PRF
            throw new Error('hk_prf_not_supported');
        }

        // PRF is enabled but no output yet — tell the user to touch once more, then call get()
        this.#setStatus('detecting', this.i18n.hk_touch_again || '✅ Registered! Touch your key once more to activate…');
        await new Promise(r => setTimeout(r, 1500));

        return await this.#authenticateForPRF(credId);
    }

    // Single credentials.get() call targeting a specific credential.
    // Called as the second step of first-time registration — does NOT retry on failure.
    // If PRF computation fails (browser/key incompatibility), throws hk_prf_not_supported.
    async #authenticateForPRF(credentialId) {
        try {
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: this.crypto.getRandomValues(new Uint8Array(32)),
                    allowCredentials: [{ id: credentialId, type: 'public-key', transports: ['usb', 'nfc', 'ble', 'hybrid', 'internal'] }],
                    userVerification: 'preferred',
                    extensions: { prf: { eval: { first: HardwareKeyModule.#PRF_SALT } } },
                },
            });

            const prfResults = assertion.getClientExtensionResults()?.prf?.results;
            if (prfResults?.first) {
                await this.#deriveKeyPairFromPRF(new Uint8Array(prfResults.first));
                this.#prfSupported = true;
                return await this.#finalizeSetup();
            }

            // PRF enabled on registration but no output in response — PRF not functional
            localStorage.setItem('hk.prfFailed', 'true');
            throw new Error('hk_prf_not_supported');

        } catch (err) {
            if (err.name === 'NotAllowedError') throw err; // User cancelled — propagate
            if (err.message === 'hk_prf_not_supported') throw err; // Already classified — propagate
            // OperationError: PRF computation failed (browser/authenticator incompatibility).
            // Record the failure so future sessions skip the 2-touch cycle and fail immediately.
            localStorage.setItem('hk.prfFailed', 'true');
            throw new Error('hk_prf_not_supported');
        }
    }

    // Common post-setup: marks initialized, caches public key in sessionStorage, updates UI.
    async #finalizeSetup() {
        this.#initialized = true;
        this.#prfSupported = true;
        localStorage.removeItem('hk.prfFailed'); // PRF working — clear any previous failure flag
        const pubKeyB64 = await this.getPublicKey();
        sessionStorage.setItem('hk.myPublicKey', pubKeyB64);
        await this.#updatePublicKeyDisplay(pubKeyB64);
        this.#setStatus('active-prf', this.i18n.hk_detected_prf || '🔐 Hardware key active — stable keys enabled');
        return true;
    }

    // Derives a deterministic P-256 ECDH key pair from 32-byte PRF output.
    async #deriveKeyPairFromPRF(prfOutput) {
        // Normalize via HKDF to ensure well-distributed key material
        const hkdfBase = await this.crypto.subtle.importKey(
            'raw', prfOutput, 'HKDF', false, ['deriveBits']
        );
        const keyBits = await this.crypto.subtle.deriveBits(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: new Uint8Array(32), // all-zero salt
                info: new TextEncoder().encode('CipherBrick-ECDH-P256'),
            },
            hkdfBase,
            256
        );
        const keyBytes = new Uint8Array(keyBits);

        // Build PKCS8 DER structure
        const pkcs8 = new Uint8Array(HardwareKeyModule.#PKCS8_PREFIX.length + 32);
        pkcs8.set(HardwareKeyModule.#PKCS8_PREFIX);
        pkcs8.set(keyBytes, HardwareKeyModule.#PKCS8_PREFIX.length);

        const ecAlgo = { name: 'ECDH', namedCurve: 'P-256' };

        // Import as extractable to get x,y for public key derivation
        const tempPrivKey = await this.crypto.subtle.importKey('pkcs8', pkcs8, ecAlgo, true, ['deriveKey', 'deriveBits']);
        const jwk = await this.crypto.subtle.exportKey('jwk', tempPrivKey);

        // Reconstruct public key from JWK coordinates
        this.#publicKey = await this.crypto.subtle.importKey(
            'jwk',
            { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
            ecAlgo,
            true,
            []
        );

        // Re-import private key as non-extractable for actual use
        this.#privateKey = await this.crypto.subtle.importKey('pkcs8', pkcs8, ecAlgo, false, ['deriveKey', 'deriveBits']);
    }

    // ── Payload parsing ───────────────────────────────────────────────────────

    #parsePayload(cbhk1String) {
        if (!cbhk1String.startsWith('CBHK1:')) {
            throw new Error('hk_invalid_payload');
        }
        try {
            const json = atob(cbhk1String.slice(6));
            const parsed = JSON.parse(json);
            if (parsed.version !== 'CBHK1' || !parsed.senderPublicKey || !parsed.encrypted) {
                throw new Error('hk_invalid_payload');
            }
            return parsed;
        } catch (err) {
            if (err.message === 'hk_invalid_payload') throw err;
            throw new Error('hk_invalid_payload');
        }
    }

    // ── UI helpers ────────────────────────────────────────────────────────────

    #setStatus(state, message) {
        const bar = document.getElementById('hkStatusBar');
        if (!bar) return;

        bar.className = 'hk-status-bar mb-3';
        bar.textContent = message;

        if (state === 'detecting') {
            bar.classList.add('hk-status-detecting');
        } else if (state === 'active-prf') {
            bar.classList.add('hk-status-active');
        } else if (state === 'active-ephemeral') {
            bar.classList.add('hk-status-ephemeral');
        } else if (state === 'error') {
            bar.classList.add('hk-status-error');
        }
    }

    async #updatePublicKeyDisplay(pubKeyB64) {
        const keyText = document.getElementById('hkMyKeyText');
        const keyContainer = document.getElementById('hkPublicKeyContainer');
        const getKeyContainer = document.getElementById('hkGetKeyContainer');

        if (!pubKeyB64) {
            if (keyContainer) keyContainer.style.display = 'none';
            if (getKeyContainer) getKeyContainer.style.display = 'block';
            return;
        }

        if (keyText) {
            keyText.textContent = pubKeyB64.slice(0, 20) + '…' + pubKeyB64.slice(-8);
            keyText.dataset.fullKey = pubKeyB64;
        }
        if (keyContainer) keyContainer.style.display = 'block';
        if (getKeyContainer) getKeyContainer.style.display = 'none';
    }

    #showSenderKey(senderPublicKey) {
        const container = document.getElementById('hkSenderKeyContainer');
        const keyText = document.getElementById('hkSenderKeyText');
        if (container) container.style.display = 'block';
        if (keyText) {
            keyText.textContent = senderPublicKey.slice(0, 20) + '…' + senderPublicKey.slice(-8);
            keyText.dataset.fullKey = senderPublicKey;
        }
    }

    // ── Error handling ────────────────────────────────────────────────────────

    #handleDetectError(err) {
        if (err.name === 'NotAllowedError') {
            this.#setStatus('error', this.i18n.hk_user_cancelled || 'Hardware key operation was cancelled.');
        } else if (err.name === 'NotSupportedError' || err.name === 'SecurityError') {
            this.#setStatus('error', this.i18n.hk_not_supported || 'FIDO2/WebAuthn is not supported in this browser.');
        } else if (err.message === 'hk_prf_not_supported') {
            this.#setStatus('error', this.i18n.hk_prf_not_supported || 'PRF support required for Hardware Key Mode. Please use Chrome or Edge.');
        } else {
            const msg = (this.i18n.hk_error || 'Hardware key error: {error}').replace('{error}', err.message);
            this.#setStatus('error', msg);
        }
    }

    #handleOperationError(err, UIModule) {
        let msg;
        if (err.message === 'hk_no_private_key') {
            msg = this.i18n.hk_no_private_key || 'Hardware key session not initialized. Please detect your key first.';
        } else if (err.message === 'hk_invalid_payload') {
            msg = this.i18n.hk_invalid_payload || 'Invalid payload format — expected a CBHK1 encrypted string.';
        } else if (err.name === 'NotAllowedError') {
            msg = this.i18n.hk_user_cancelled || 'Hardware key operation was cancelled.';
        } else if (err.name === 'InvalidStateError') {
            msg = this.i18n.hk_key_removed || 'Hardware key was removed. Please reinsert and retry.';
        } else if (err.name === 'OperationError') {
            msg = this.i18n.hk_decrypt_failed || 'Decryption failed — wrong key or corrupted payload.';
        } else {
            msg = this.i18n.hk_decrypt_failed || 'Decryption failed — wrong key or corrupted payload.';
        }
        UIModule.showMessage(msg, 'danger');
    }
}
