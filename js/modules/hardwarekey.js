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

    // P-256 (secp256r1) curve parameters — used to compute the public key point (x,y) = d*G.
    // Required because WebKit rejects PKCS8 without embedded public key and JWK without x,y.
    static #P256_P  = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;
    static #P256_N  = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    static #P256_GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
    static #P256_GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

    // Compute (x,y) = scalar * G on P-256.  Used once per activation to derive the public key
    // so we can build a complete JWK (d + x + y) that all browsers accept.
    static #p256ScalarMul(dBytes) {
        const p = HardwareKeyModule.#P256_P;
        const n = HardwareKeyModule.#P256_N;

        // Reduce a to [0, p-1]
        const mod = a => ((a % p) + p) % p;

        // Modular inverse via Extended Euclidean Algorithm — O(log p), much faster than Fermat
        const inv = a => {
            let [r0, r1] = [p, mod(a)];
            let [s0, s1] = [0n, 1n];
            while (r1) {
                const q = r0 / r1;
                [r0, r1] = [r1, r0 - q * r1];
                [s0, s1] = [s1, s0 - q * s1];
            }
            return mod(s0);
        };

        // Point doubling (a = −3 for P-256 built into the numerator)
        const dbl = ([x, y]) => {
            const lam = mod((3n * x * x - 3n) * inv(2n * y));
            const nx  = mod(lam * lam - 2n * x);
            return [nx, mod(lam * (x - nx) - y)];
        };

        // Point addition
        const add = ([x1, y1], [x2, y2]) => {
            if (x1 === x2) return (y1 === y2) ? dbl([x1, y1]) : null;
            const lam = mod((y2 - y1) * inv(x2 - x1));
            const nx  = mod(lam * lam - x1 - x2);
            return [nx, mod(lam * (x1 - nx) - y1)];
        };

        // Scalar as BigInt
        const d = BigInt('0x' + Array.from(dBytes).map(b => b.toString(16).padStart(2, '0')).join(''));
        if (d < 1n || d >= n) throw new Error('hk_key_derivation_error'); // astronomically rare

        // Double-and-add scalar multiplication
        let R = null;
        let pt = [HardwareKeyModule.#P256_GX, HardwareKeyModule.#P256_GY];
        let k = d;
        while (k > 0n) {
            if (k & 1n) R = R ? add(R, pt) : pt;
            pt = dbl(pt);
            k >>= 1n;
        }

        // Convert coordinates to 32-byte Uint8Array
        const toBytes32 = v => {
            const hex = v.toString(16).padStart(64, '0');
            return Uint8Array.from({ length: 32 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
        };
        return { x: toBytes32(R[0]), y: toBytes32(R[1]) };
    }

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

            if (credentialId && !prfPreviouslyFailed) {
                // Known credential on this device with no prior PRF failure — fast path (1 touch)
                return await this.#authenticateExisting(credentialId);
            } else {
                // No stored credential, or a prior failure — ask the user whether they are using
                // a hardware security key (cross-platform) or a device passkey (platform), then
                // route accordingly.  Hardware key path tries discovery first so a credential
                // registered on another device is found before re-registering.
                const attachment = await this.#showAuthenticatorChoice();
                if (attachment === 'platform') {
                    // Switching to device passkey — clear any hardware key state so the platform
                    // credential is registered fresh and stored as the new credential.
                    localStorage.removeItem('hk.prfFailed');
                    localStorage.removeItem('hk.credentialId');
                    localStorage.removeItem('hk.attachment');
                    return await this.#registerThenAuthenticate('platform');
                }
                // Hardware key path — if PRF previously failed, fail fast without another touch
                if (prfPreviouslyFailed) {
                    throw new Error('hk_prf_not_supported');
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
        const storedAttachment = localStorage.getItem('hk.attachment') || 'cross-platform';
        const transports = storedAttachment === 'platform'
            ? ['internal']
            : ['usb', 'nfc', 'ble', 'hybrid', 'internal'];
        try {
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: this.crypto.getRandomValues(new Uint8Array(32)),
                    allowCredentials: [{ id: credentialId, type: 'public-key', transports }],
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

    // Shows a modal asking whether the user wants to use a hardware security key
    // (cross-platform) or a device passkey (platform).  Returns a Promise that
    // resolves to the chosen authenticatorAttachment string.
    #showAuthenticatorChoice() {
        return new Promise((resolve) => {
            const modalEl = document.getElementById('hkAuthChoiceModal');
            const modal = new bootstrap.Modal(modalEl);

            const onHardware = () => { cleanup(); resolve('cross-platform'); };
            const onDevice   = () => { cleanup(); resolve('platform'); };

            const cleanup = () => {
                document.getElementById('hkChoiceHardware').removeEventListener('click', onHardware);
                document.getElementById('hkChoiceDevice').removeEventListener('click', onDevice);
                modal.hide();
            };

            document.getElementById('hkChoiceHardware').addEventListener('click', onHardware);
            document.getElementById('hkChoiceDevice').addEventListener('click', onDevice);
            modal.show();
        });
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
    async #registerThenAuthenticate(attachment = 'cross-platform') {
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
                    authenticatorAttachment: attachment, // 'cross-platform' = hardware key; 'platform' = device passkey
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

        // Persist credential ID and attachment type — a retry skips re-registration and uses
        // the correct transport list (platform → internal only; cross-platform → all transports).
        localStorage.setItem('hk.credentialId', btoa(String.fromCharCode(...credId)));
        localStorage.setItem('hk.attachment', attachment);

        // Some browsers (Chrome, newer Firefox) return PRF output directly in create() — use it
        // immediately if available (single-touch flow, avoids the second get() call entirely).
        if (prfResults?.first) {
            await this.#deriveKeyPairFromPRF(new Uint8Array(prfResults.first));
            this.#prfSupported = true;
            return await this.#finalizeSetup();
        }

        if (!prfEnabled) {
            // Authenticator registered but PRF not supported — feature requires PRF.
            // For platform credentials, clear stored state so the modal reappears on the next
            // attempt (user can switch to hardware key).  For cross-platform, mark prfFailed so
            // we skip the 2-touch cycle on future sessions.
            if (attachment === 'platform') {
                localStorage.removeItem('hk.credentialId');
                localStorage.removeItem('hk.attachment');
                throw new Error('hk_prf_device_not_supported');
            }
            localStorage.setItem('hk.prfFailed', 'true');
            throw new Error('hk_prf_not_supported');
        }

        // PRF is enabled but no output yet — tell the user to touch once more, then call get()
        this.#setStatus('detecting', this.i18n.hk_touch_again || '✅ Registered! Touch your key once more to activate…');
        await new Promise(r => setTimeout(r, 1500));

        return await this.#authenticateForPRF(credId, attachment);
    }

    // Single credentials.get() call targeting a specific credential.
    // Called as the second step of first-time registration — does NOT retry on failure.
    // If PRF computation fails (browser/key incompatibility), throws hk_prf_not_supported.
    // attachment: 'platform' restricts transports to ['internal'] so iOS goes straight to Face ID
    // rather than showing the cross-device QR/selector UI.
    async #authenticateForPRF(credentialId, attachment = 'cross-platform') {
        const transports = attachment === 'platform'
            ? ['internal']
            : ['usb', 'nfc', 'ble', 'hybrid', 'internal'];
        try {
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: this.crypto.getRandomValues(new Uint8Array(32)),
                    allowCredentials: [{ id: credentialId, type: 'public-key', transports }],
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

            // PRF enabled on registration but no output in response — PRF not functional.
            if (attachment === 'platform') {
                localStorage.removeItem('hk.credentialId');
                localStorage.removeItem('hk.attachment');
                throw new Error('hk_prf_device_not_supported');
            }
            localStorage.setItem('hk.prfFailed', 'true');
            throw new Error('hk_prf_not_supported');

        } catch (err) {
            if (err.name === 'NotAllowedError') throw err;
            if (err.message === 'hk_prf_not_supported') throw err;
            if (err.message === 'hk_prf_device_not_supported') throw err;
            // OperationError: PRF computation failed.
            if (attachment === 'platform') {
                localStorage.removeItem('hk.credentialId');
                localStorage.removeItem('hk.attachment');
                throw new Error('hk_prf_device_not_supported');
            }
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
    // Uses JWK import (d + x + y) for cross-browser compatibility — WebKit rejects PKCS8
    // without an embedded public key, and JWK without x,y.  We compute (x,y) = d*G via
    // our own minimal P-256 scalar multiplication above.
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
        const dBytes = new Uint8Array(keyBits);

        // Compute public key point (x,y) = d*G — required for JWK import on all browsers
        const { x, y } = HardwareKeyModule.#p256ScalarMul(dBytes);

        const b64u = bytes => btoa(String.fromCharCode(...bytes))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        const ecAlgo = { name: 'ECDH', namedCurve: 'P-256' };

        this.#publicKey = await this.crypto.subtle.importKey(
            'jwk',
            { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) },
            ecAlgo, true, []
        );
        this.#privateKey = await this.crypto.subtle.importKey(
            'jwk',
            { kty: 'EC', crv: 'P-256', d: b64u(dBytes), x: b64u(x), y: b64u(y) },
            ecAlgo, false, ['deriveKey', 'deriveBits']
        );
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
        } else if (err.message === 'hk_prf_device_not_supported') {
            this.#setStatus('error', this.i18n.hk_prf_device_not_supported || 'This device\'s passkeys do not support Hardware Key Mode. Update to iOS 17.4+ or the latest Android, or use a dedicated hardware security key.');
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
