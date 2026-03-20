// /js/modules/app.js
import { CryptoModule } from './crypto.js';
import { ValidationModule } from './validation.js';
import { UIModule } from './ui.js';
import { SettingsModule } from './settings.js';
import { I18nModule } from './i18n.js';
import { QRModule } from './qr.js';
import { ClipboardModule } from './clipboard.js';
import { SessionModule } from './session.js';
import { AudioModule } from './audio.js';
import { KeyExchangeModule } from './keyexchange.js';
import { WizardModule } from './wizard.js';
import { QRModalModule } from './qrmodal.js';
import { PayloadModule } from './payload.js';
import { AudioTransmissionModule } from './audiotransmission.js';

// ---- Audio TX Protocol setting (localStorage-backed) ----
const CB_TX_PROTOCOL_KEY = 'cb.txProtocol';
const CB_TX_PROTOCOL_DEFAULT = 'GGWAVE_PROTOCOL_AUDIBLE_FASTEST';

function getTxProtocolSetting() {
    try { return localStorage.getItem(CB_TX_PROTOCOL_KEY) || CB_TX_PROTOCOL_DEFAULT; }
    catch { return CB_TX_PROTOCOL_DEFAULT; }
}

function setTxProtocolSetting(val) {
    try { localStorage.setItem(CB_TX_PROTOCOL_KEY, String(val)); }
    catch { }
}

export class CipherBrickApp {
    constructor() {
        this.currentMode = 'encrypt';
        this.currentLang = 'en';
        this.i18nStrings = {};
        this.audioModule = new AudioModule(this);
        this.qrModal = new QRModalModule(this);
        this.payload = new PayloadModule(this);
        this.audioTx = new AudioTransmissionModule(this);
        this.hasProcessed = false;
        this.uiModule = UIModule;
        this._audioTeardown = false;
        this._busy = false;
        this.keyx = null;
        this.wizard = null;  // Will be initialized after keyx is set up

        // Initialize global timer variables
        window.clipboardCountdown = null;
        window.sessionCountdown = null;
        window.clipboardExpiresAt = null;
        window.sessionExpiresAt = null;
    }

    async initialize() {
        console.log('[CipherBrick] Initializing application...');

        // Initialize session security
        SessionModule.initializeSessionSecurity();

        // Load + apply + set <html lang/dir> + persist
        this.currentLang = I18nModule.getStoredLanguage() || document.documentElement.lang || 'en';
        this.i18nStrings = await I18nModule.setLanguage(this.currentLang);

        // Setup UI
        this.setupLanguageSelector();
        this.setupEventListeners();
        this.setupServiceWorker();
        this.setupQRCodeLibrary();

        // Setup Advance Key Functionality
        this.keyx = new KeyExchangeModule(this);

        // Initialize Wizard after keyx
        this.wizard = new WizardModule(this);
        this.wizard.initialize();

        // Load settings and initialize UI state
        SettingsModule.loadSettings();
        this.setupAdvancedModeUI();
        UIModule.updateStealthUI();
        await this.setMode('encrypt');  // Add await since setMode is async

        // Initialize timers
        this.updateStatusBar();
        SessionModule.initializeIdleTimer(UIModule, () => this.updateStatusBar(), () => this.i18nStrings);
        setInterval(() => this.updateStatusBar(), 1000);

        // Sync Audio TX Protocol selector (UI ↔ localStorage)
        const txSel = document.getElementById('cb-setting-txProtocol');
        if (txSel) {
            // set initial value from storage (or default)
            txSel.value = getTxProtocolSetting();
            // persist on change and refresh app for clean audio state
            txSel.addEventListener('change', () => {
                const oldProtocol = getTxProtocolSetting();
                const newProtocol = txSel.value;

                // Save the new setting
                setTxProtocolSetting(newProtocol);

                // Refresh app if protocol changed (ensures clean audio state)
                if (oldProtocol !== newProtocol) {
                    this.audioTx.refreshForAudio();
                }
            });
            // optional: soft warning if ultrasound selected on likely low sample-rate devices
            const maybeWarnUltrasound = () => {
                if (txSel.value.includes('ULTRASOUND')) {
                    try {
                        const AC = window.AudioContext || window.webkitAudioContext;
                        const ctx = new AC();
                        const sr = ctx.sampleRate;
                        ctx.close();
                        if (sr < 48000) {
                            console.warn('[CipherBrick] Ultrasound selected; device sampleRate=' + sr + ' may reduce reliability.');
                        }
                    } catch { }
                }
            };
            maybeWarnUltrasound();
            txSel.addEventListener('change', maybeWarnUltrasound);
        }

        console.log('[CipherBrick] Application initialized successfully');

        // Restore app state if available (after audio refresh)
        this.audioTx.restoreAppState();
        this.audioTx.updateListenUI();
    }

    setupServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('service-worker.js')
                .then(reg => console.log('Service Worker registered with scope:', reg.scope))
                .catch(err => console.log('Service Worker registration failed:', err));
        }
    }

    setupQRCodeLibrary() {
        // Define QRCode.CorrectLevel if not defined
        if (typeof QRCode !== 'undefined' && typeof QRCode.CorrectLevel === 'undefined') {
            QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };
        }
    }

    setupLanguageSelector() {
        const languageSelector = document.getElementById("languageSelect");
        if (languageSelector) {
            // Ensure dropdown matches currentLang at startup
            languageSelector.value = this.currentLang;

            // Handle changes
            languageSelector.addEventListener("change", async (e) => {
                const selectedLang = e.target.value;
                I18nModule.setStoredLanguage(selectedLang);
                this.currentLang = selectedLang;
                this.i18nStrings = await I18nModule.loadTranslations(this.currentLang);
                I18nModule.applyTranslations(this.i18nStrings);
            });
        }
    }

    setupEventListeners() {
        // Core action buttons
        document.getElementById("encryptBtn").addEventListener("click", () => this.setMode("encrypt"));
        document.getElementById("decryptBtn").addEventListener("click", () => this.setMode("decrypt"));
        document.getElementById("processButton").addEventListener("click", () => this.process());

        // Update copy button to handle both old and new structure
        const copyBtn = document.getElementById("copyButton");
        if (copyBtn) {
            copyBtn.addEventListener("click", () =>
                ClipboardModule.copyToClipboard(null, UIModule, () => this.updateStatusBar(), this.i18nStrings));
        }

        const keyExchangeBtn = document.getElementById('keyExchangeBtn');
        if (keyExchangeBtn) {
            keyExchangeBtn.addEventListener('click', () => {
                // The modal will open automatically due to data-bs-toggle="modal"
                // Reset wizard state when opening
                if (this.wizard?.state) {
                    // Don't reset completely, just clear the current flow
                    this.wizard.state.currentFlow = null;
                }
            });
        }

        document.getElementById("clearButton").addEventListener("click", () => {
            this.hasProcessed = false;
            // Run UI helpers first
            UIModule.clearForm(false, false, this.i18nStrings);
            UIModule.updateContextActions(this.currentMode, this.hasProcessed);
            UIModule.resetContextUI();

            // Hide output container when clearing
            const outputContainer = document.getElementById('outputTextContainer');
            if (outputContainer) outputContainer.style.display = 'none';

            // Bring the inputs back into view
            const grp = document.getElementById('encryptFormFields');
            if (grp) {
                try {
                    const inst = bootstrap.Collapse.getOrCreateInstance(grp, { toggle: false });
                    inst.show();
                } catch (e) { /* ignore */ }
            }

            // Reset context sections based on current mode
            if (this.currentMode === 'encrypt') {
                const after = document.getElementById('encryptAfterActions');
                const before = document.getElementById('encryptBeforeActions');
                if (after) after.style.display = 'none';
                if (before) before.style.display = 'block';
            } else {
                // NEW: Handle decrypt mode reset
                const decryptAfter = document.getElementById('decryptAfterActions');
                const decryptBefore = document.getElementById('decryptBeforeActions');
                if (decryptAfter) decryptAfter.style.display = 'none';
                if (decryptBefore) decryptBefore.style.display = 'block';
            }

            // Clear output box
            const out = document.getElementById('outputText');
            if (out) out.value = '';

            // Also nuke advanced Key Exchange memory + fields
            this._clearKxMemory?.();
            this._clearKxUIFields?.();
        });

        // Key visibility toggle
        document.getElementById('toggleKeyVisibility')?.addEventListener('click', () => {
            const keyInput = document.getElementById('key');
            const icon = document.getElementById('keyVisibilityIcon');

            if (keyInput.type === 'password') {
                keyInput.type = 'text';
                icon.textContent = '🙈'; // Hide icon
                keyInput.setAttribute('title', 'Key is visible');
            } else {
                keyInput.type = 'password';
                icon.textContent = '👁️'; // Show icon
                keyInput.setAttribute('title', 'Key is hidden');
            }
        });

        let keyVisibilityTimeout;

        document.getElementById('key')?.addEventListener('input', () => {
            const keyInput = document.getElementById('key');
            if (keyInput.type === 'text') {
                // Auto-hide after 10 seconds of no typing
                clearTimeout(keyVisibilityTimeout);
                keyVisibilityTimeout = setTimeout(() => {
                    if (keyInput.type === 'text') {
                        document.getElementById('toggleKeyVisibility').click();
                    }
                }, 10000);
            }
        });

        // Toggle button for Encrypt Fields after successful run
        document.getElementById('toggleInputsBtn')?.addEventListener('click', () => {
            const grp = document.getElementById('encryptFormFields');
            if (!grp) return;
            const isExpanded = grp.classList.contains('show'); // true when visible
            this.setEncryptInputsCollapsed(isExpanded); // collapse if expanded, expand if collapsed
        });

        // Settings buttons
        document.getElementById("saveSettingsBtn").addEventListener("click", () => this.saveSettings());
        document.getElementById("resetSettingsBtn").addEventListener("click", () => this.resetSettings());

        const generatePayloadBtn = document.getElementById("generatePayloadButton");
        if (generatePayloadBtn) {
            generatePayloadBtn.addEventListener("click", () => this.payload.generatePayloadString());
        }

        // QR save and preview buttons (only if they exist)
        this.setupQRButtons();

        // Input handlers
        this.setupInputHandlers();

        // Tab switching
        this.setupTabSwitching();

        // Stealth mode toggle
        document.getElementById("stealthModeToggle").addEventListener("change", function () {
            const enabled = this.checked;
            sessionStorage.setItem("stealthMode", enabled ? "true" : "false");
            UIModule.updateStealthUI();
        });

        // Clipboard clear confirmation
        document.getElementById("confirmClearClipboard").addEventListener("click", async () => {
            await ClipboardModule.clearClipboardManually(UIModule, this.i18nStrings);
        });

        // Event delegation for modal buttons
        document.addEventListener('click', (event) => {
            if (event.target.id === 'transmitAudioButton') {
                event.preventDefault();
                this.audioTx.transmitAudio();
            } else if (event.target.id === 'receiveAudioButton') {
                event.preventDefault();
                this.audioTx.startAudioReception();
            } else if (event.target.id === 'stopAudioButton') {
                event.preventDefault();
                this.audioTx.stopAudioReception();
            }
        });

        // Add the new context event listeners
        this.setupContextEventListeners();

        // === QR Modal wiring (delegated) ===
        document.addEventListener('click', async (e) => {
            // Open modal + generate QR
            const gen = e.target.closest('#generateQRBtn');
            if (gen) {
                const output = document.getElementById('outputText')?.value || '';
                const input = document.getElementById('inputText')?.value || '';
                if (input.length > 500) return UIModule.showMessage(this.i18nStrings.qr_original_too_long || 'Original message too long for QR code (500 character limit).', 'warning');

                const stealth = sessionStorage.getItem('stealthMode') === 'true';
                const payload = QRModule.createQRPayload('encrypt', output, stealth);

                // Render QR into the modal
                const holder = document.getElementById('qrModalPreview');
                if (holder) {
                    holder.innerHTML = '';
                    QRModule.generateQRCodePNG(payload, (imgSrc) => {
                        const img = document.createElement('img');
                        img.src = imgSrc;
                        img.width = 256; img.height = 256;
                        img.style.border = '2px solid #2d2d2d';
                        img.style.borderRadius = '8px';
                        holder.appendChild(img);
                    });
                }

                // Show the modal
                const el = document.getElementById('qrModal');
                const modal = bootstrap.Modal.getOrCreateInstance(el);
                this.qrModal.setupQRModalButtons();
                modal.show();
                return;
            }

            // UNIVERSAL Copy from modal
            if (e.target.closest('#qrModalCopy')) {
                const img = document.querySelector('#qrModalPreview img');
                if (!img) return UIModule.showMessage(this.i18nStrings.qr_nothing_to_copy || 'No QR to copy.', 'warning');

                const native = this.qrModal.isNativeEnv();
                if (native) {
                    // Capacitor: Image copying not reliable, inform user
                    UIModule.showMessage(this.i18nStrings.qr_copy_not_supported || 'Image copying not supported. Use Save/Share instead.', 'info');
                    return;
                }

                // Browser: Your working code
                try {
                    const blob = await (await fetch(img.src)).blob();
                    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                    UIModule.showMessage(this.i18nStrings.qr_copied || 'QR copied to clipboard!', 'success');
                } catch (err) {
                    console.error(err);
                    UIModule.showMessage(this.i18nStrings.qr_copy_failed || 'Failed to copy QR.', 'danger');
                }
                return;
            }

            // Save/Share handler - creates proper binary PNG
            if (e.target.closest('#qrModalSave')) {
                const img = document.querySelector('#qrModalPreview img');
                if (!img) return UIModule.showMessage(this.i18nStrings.qr_nothing_to_save || 'No QR to save.', 'warning');

                const native = this.qrModal.isNativeEnv();
                if (native) {
                    const Filesystem = this.qrModal.getFilesystem();
                    const Share = this.qrModal.getShare();

                    if (Filesystem && Share) {
                        try {
                            // Create a canvas to ensure we have proper PNG binary data
                            const canvas = document.createElement('canvas');
                            const ctx = canvas.getContext('2d');

                            // Create a new image element to load the QR
                            const sourceImg = new Image();
                            sourceImg.crossOrigin = 'anonymous';

                            // Capture qrModal reference for use in onload callback
                            const qrModal = this.qrModal;
                            const i18n = this.i18nStrings;

                            sourceImg.onload = async function () {
                                try {
                                    const isNative = qrModal.isNativeEnv();

                                    if (!isNative) {
                                        // Web environment
                                        if (navigator.share && navigator.canShare) {
                                            const response = await fetch(sourceImg.src);
                                            const blob = await response.blob();
                                            const file = new File([blob], 'cipherbrick_qr.png', { type: 'image/png' });

                                            if (navigator.canShare({ files: [file] })) {
                                                await navigator.share({
                                                    title: 'CipherBrick QR Code',
                                                    files: [file]
                                                });
                                                UIModule.showMessage(i18n.qr_shared || 'QR shared successfully!', 'success');
                                                return;
                                            }
                                        }

                                        const a = document.createElement('a');
                                        a.href = sourceImg.src;
                                        a.download = 'cipherbrick_qr.png';
                                        document.body.appendChild(a);
                                        a.click();
                                        document.body.removeChild(a);
                                        UIModule.showMessage(i18n.qr_downloaded || 'QR downloaded!', 'success');
                                        return;
                                    }

                                    // NATIVE - Use custom native plugin
                                    console.log('Using native Android ImageShare plugin...');

                                    await qrModal.shareImageNative(sourceImg.src);

                                    UIModule.showMessage(i18n.qr_shared || 'QR shared successfully!', 'success');

                                } catch (shareErr) {
                                    console.error('Share failed:', shareErr);

                                    if (shareErr.message === 'Share canceled') {
                                        UIModule.showMessage(i18n.qr_share_canceled || 'Share canceled', 'info');
                                    } else {
                                        UIModule.showMessage((i18n.qr_share_failed || 'Share failed: {error}').replace('{error}', shareErr.message), 'danger');
                                    }
                                }
                            };

                            sourceImg.onerror = () => {
                                UIModule.showMessage(i18n.qr_process_failed || 'Failed to process QR image', 'danger');
                            };

                            sourceImg.src = img.src;

                        } catch (err) {
                            console.error('Capacitor share setup failed:', err);
                            UIModule.showMessage((this.i18nStrings.qr_share_failed || 'Share failed: {error}').replace('{error}', err.message), 'danger');
                        }
                    }
                    return;
                }

                // Browser code unchanged
                const a = document.createElement('a');
                a.href = img.src;
                a.download = 'cipherbrick_qr.png';
                a.click();
                return;
            }

            // UNIVERSAL View from modal
            if (e.target.closest('#qrModalView')) {
                const img = document.querySelector('#qrModalPreview img');
                if (!img) return UIModule.showMessage(this.i18nStrings.qr_nothing_to_view || 'No QR to view.', 'warning');

                const native = this.qrModal.isNativeEnv();
                if (native) {
                    // CAPACITOR: Use improved in-app viewer with proper colors
                    this.qrModal.showInAppImageViewer(img.src);
                    UIModule.showMessage(this.i18nStrings.qr_fullscreen || 'QR displayed in full screen', 'success');
                    return;
                }

                // BROWSER: Your working new tab code
                const w = window.open();
                w.document.write(`
        <html>
            <head><title>QR Code</title></head>
            <body style="margin:0; background:#818080; display:flex; justify-content:center; align-items:center; height:100vh;">
                <img src="${img.src}" width="512" height="512" alt="CipherBrick QR Code">
            </body>
        </html>
    `);
                return;
            }
        });

        // ---- QR Scan Modal controls ----
        const scanQRBtn = document.getElementById('scanQRBtn');
        if (scanQRBtn) {
            scanQRBtn.addEventListener('click', () => {
                this.qrModal.openQRModal();
            });
        }

        // Handle modal close button (X)
        document.getElementById('qrScanModalCloseBtn')?.addEventListener('click', () => {
            this.qrModal.closeQRModal();
        });

        window.addEventListener('cb:clipboard-cleared', () => {
            // wipe only sensitive, short-lived fields in the Key Exchange UI
            this._clearKxTransientFields?.();
            UIModule.showMessage(this.i18nStrings.clipboard_wiped || "Clipboard cleared. Ephemeral key-exchange data wiped.", "info");
        });
    }

    // Add the context event listeners setup as its own method
    setupContextEventListeners() {
        // ENCRYPT MODE: After encryption actions
        document.getElementById('copyOutputBtn')?.addEventListener('click', async () => {
            const outputText = document.getElementById('outputText')?.value;
            if (outputText) {
                ClipboardModule.copyToClipboard(outputText, UIModule, () => this.updateStatusBar(), this.i18nStrings);
            }
        });

        document.getElementById('copyQRBtn')?.addEventListener('click', async () => {
            const qrImg = document.querySelector("#qrPreview img");
            if (!qrImg) {
                UIModule.showMessage(this.i18nStrings.qr_generate_first || "No QR Code found. Generate one first!", "warning");
                return;
            }
            try {
                const response = await fetch(qrImg.src);
                const blob = await response.blob();
                await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                UIModule.showMessage(this.i18nStrings.qr_image_copied || "QR Code image copied to clipboard!", "success");
            } catch (err) {
                UIModule.showMessage(this.i18nStrings.qr_image_copy_error || "Error copying QR Code image.", "danger");
                console.error(err);
            }
        });

        document.getElementById('saveQRBtn')?.addEventListener('click', () => {
            const qrImage = document.querySelector("#qrPreview img");
            if (!qrImage) {
                UIModule.showMessage(this.i18nStrings.qr_generate_first || "No QR Code found. Generate one first!", "warning");
                return;
            }
            const link = document.createElement("a");
            link.href = qrImage.src;
            link.download = "cipherbrick_qr.png";
            link.click();
            UIModule.showMessage(this.i18nStrings.qr_code_downloaded || "QR Code downloaded!", "success");
        });

        document.getElementById('viewQRBtn')?.addEventListener('click', () => {
            const qrImage = document.querySelector("#qrPreview img");
            if (!qrImage || !qrImage.src) {
                UIModule.showMessage(this.i18nStrings.qr_generate_first || "No QR Code found. Generate one first!", "warning");
                return;
            }
            const w = window.open();
            w.document.write(`
                <html>
                    <head><title>QR Code Preview</title></head>
                    <body style="margin:0; background:#818080; display:flex; justify-content:center; align-items:center; height:100vh;">
                        <img src="${qrImage.src}" width="512" height="512" alt="CipherBrick QR Code">
                    </body>
                </html>
            `);
        });

        document.getElementById('generatePayloadBtn')?.addEventListener('click', () => {
            this.payload.generatePayloadString();
        });

        document.getElementById('transmitAudioBtn')?.addEventListener('click', async () => {
            await this.audioTx.transmitAudio();
        });

        document.getElementById('showPayloadInputBtn')?.addEventListener('click', () => {
            this.payload.togglePayloadInput();
        });

        document.getElementById('usePayloadBtn')?.addEventListener('click', () => {
            this.payload.usePayloadString();
        });

        document.getElementById('listenAudioBtn')?.addEventListener('click', () => {
            if (this.audioTx.isListenLocked()) {
                UIModule.showMessage(this.i18nStrings.audio_already_received || 'You already received audio. Click "Refresh Audio System" to listen again.', 'info');
                return;
            }
            this.audioTx.toggleAudioListener();
            this.audioTx.updateListenUI(); // reflect active receiving state
        });

        document.getElementById('stopListenBtn')?.addEventListener('click', async () => {
            await this.audioTx.stopAndRefreshAudio();  // new helper below
        });

        document.getElementById('refreshAudioBtn')?.addEventListener('click', () => {
            this.audioTx.refreshForAudio();
        });

        // DECRYPT MODE: After decryption actions
        document.getElementById('copyDecryptedBtn')?.addEventListener('click', async () => {
            const outputText = document.getElementById('outputText')?.value;
            if (outputText) {
                ClipboardModule.copyToClipboard(outputText, UIModule, () => this.updateStatusBar(), this.i18nStrings);
            }
        });

        document.getElementById('toggleInputsDecryptBtn')?.addEventListener('click', () => {
            const grp = document.getElementById('encryptFormFields');
            if (!grp) return;
            const isExpanded = grp.classList.contains('show');
            this.setEncryptInputsCollapsed(isExpanded);
        });

        this.audioTx.updateListenUI(); // paint initial state
    }

    setupAdvancedModeUI() {
        const advancedToggle = document.getElementById('advancedModeToggle');
        const simplifiedToggle = document.getElementById('stealthModeToggle'); // or whatever the ID is
        const advancedGroup = document.getElementById('advancedToolGroup');

        if (!advancedToggle || !simplifiedToggle || !advancedGroup) return;

        // Restore state
        const isAdvancedOn = localStorage.getItem('cb.advancedMode') === 'true';
        const isSimplifiedOn = localStorage.getItem('cb.simplifiedMode') === 'true'; // Update this key name

        advancedToggle.checked = isAdvancedOn;
        simplifiedToggle.checked = isSimplifiedOn;
        advancedGroup.classList.toggle('d-none', !isAdvancedOn);

        // Mutual exclusion logic
        const updateToggleStates = () => {
            if (advancedToggle.checked) {
                simplifiedToggle.disabled = true;
                simplifiedToggle.closest('.form-check').classList.add('text-muted');
            } else {
                simplifiedToggle.disabled = false;
                simplifiedToggle.closest('.form-check').classList.remove('text-muted');
            }

            if (simplifiedToggle.checked) {
                advancedToggle.disabled = true;
                advancedToggle.closest('.form-check').classList.add('text-muted');
            } else {
                advancedToggle.disabled = false;
                advancedToggle.closest('.form-check').classList.remove('text-muted');
            }
        };

        // Advanced mode toggle handler
        advancedToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            localStorage.setItem('cb.advancedMode', enabled ? 'true' : 'false');
            advancedGroup.classList.toggle('d-none', !enabled);

            if (enabled && simplifiedToggle.checked) {
                // Force simplified mode off
                simplifiedToggle.checked = false;
                localStorage.setItem('cb.simplifiedMode', 'false');
                // Trigger stealth mode update
                sessionStorage.setItem('stealthMode', 'false');
                UIModule.updateStealthUI();
            }

            updateToggleStates();
        });

        // Simplified mode toggle handler  
        simplifiedToggle.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            localStorage.setItem('cb.simplifiedMode', enabled ? 'true' : 'false');
            sessionStorage.setItem('stealthMode', enabled ? 'true' : 'false');

            if (enabled && advancedToggle.checked) {
                // Force advanced mode off
                advancedToggle.checked = false;
                localStorage.setItem('cb.advancedMode', 'false');
                advancedGroup.classList.add('d-none');
            }

            updateToggleStates();
            UIModule.updateStealthUI();
        });

        // Initial state update
        updateToggleStates();
    }

    setupQRButtons() {
        const saveQRBtn = document.getElementById("saveQRButton");
        if (saveQRBtn) {
            saveQRBtn.addEventListener("click", () => {
                const qrImage = document.querySelector("#qrOutput img");
                if (!qrImage) return;
                const link = document.createElement("a");
                link.href = qrImage.src;
                link.download = "cipherbrick_qr.png";
                link.click();
            });
        }

        const openQRBtn = document.getElementById("openQRTabButton");
        if (openQRBtn) {
            openQRBtn.addEventListener("click", () => {
                const qrImage = document.querySelector("#qrOutput img");
                if (!qrImage || !qrImage.src) return;
                const w = window.open();
                w.document.write(`
                    <html>
                        <head><title>QR Code Preview</title></head>
                        <body style="margin:0; background:#818080; display:flex; justify-content:center; align-items:center; height:100vh;">
                            <img src="${qrImage.src}" width="512" height="512" alt="CipherBrick QR Code">
                        </body>
                    </html>
                `);
            });
        }

        // Hide QR preview initially (only if they exist)
        const qrPreviewHeader = document.getElementById("qrPreviewHeader");
        const qrPreviewFooter = document.getElementById("qrPreviewFooter");
        const qrOutput = document.getElementById("qrOutput");
        if (qrPreviewHeader) qrPreviewHeader.style.display = "none";
        if (qrPreviewFooter) qrPreviewFooter.style.display = "none";
        if (qrOutput) qrOutput.style.display = "none";
    }

    setupInputHandlers() {
        // Character counter
        document.getElementById("inputText").addEventListener("input", () => {
            const input = document.getElementById("inputText").value;
            UIModule.updateInputCharacterCount(input.length, this.currentMode);
        });

        // Key strength indicator
        document.getElementById("key").addEventListener("input", () => {
            const key = document.getElementById("key").value;
            const result = ValidationModule.calculateKeyStrength(key);
            UIModule.updateKeyStrengthUI(result, this.i18nStrings);
        });

        // Clipboard permission warmer
        const clipboardTimeoutInput = document.getElementById("clipboardTimeout");
        if (clipboardTimeoutInput) {
            clipboardTimeoutInput.addEventListener("change", () => {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(" ").then(() => {
                        console.log("[Clipboard] Permission refreshed via timeout field");
                    }).catch(err => {
                        console.warn("[Clipboard] Permission refresh failed:", err);
                    });
                }
            });
        }
    }

    setupTabSwitching() {
        const tabInput = document.getElementById("tabInput");
        const tabOutput = document.getElementById("tabOutput");
        if (tabInput && tabOutput) {
            tabInput.addEventListener("click", () => UIModule.switchToTab("input"));
            tabOutput.addEventListener("click", () => UIModule.switchToTab("output"));
        }
    }

    async setMode(mode) {
        UIModule.clearForm(true, false, this.i18nStrings);
        this.currentMode = mode;
        this.hasProcessed = false;

        // Stop QR modal scanner if running
        if (this.qrModal && this.qrModal.stopQRModalScan) {
            await this.qrModal.stopQRModalScan();
        }

        // Clear audio flag etc.
        sessionStorage.removeItem('hasListenedForAudio');
        await this.audioTx.forceAudioModuleReset();

        UIModule.updateModeUI(this.currentMode);
        UIModule.updateContextActions(this.currentMode, this.hasProcessed);
        UIModule.resetContextUI();

        // Update the input label based on mode
        const inputLabel = document.getElementById("inputLabel");
        if (inputLabel) {
            if (mode === 'encrypt') {
                inputLabel.textContent = this.i18nStrings.input_label_encrypt || "Message to Encrypt:";
                inputLabel.setAttribute('data-i18n', 'input_label_encrypt');
            } else {
                inputLabel.textContent = this.i18nStrings.input_label_decrypt || "Encrypted Message:";
                inputLabel.setAttribute('data-i18n', 'input_label_decrypt');
            }
        }

        // Ensure form fields are visible when switching modes
        const grp = document.getElementById('encryptFormFields');
        if (grp) {
            try {
                const inst = bootstrap.Collapse.getOrCreateInstance(grp, { toggle: false });
                inst.show(); // Always show inputs when switching modes
            } catch (e) { }
        }

        // Hide output container when switching modes (start fresh)
        const outputContainer = document.getElementById('outputTextContainer');
        if (outputContainer) outputContainer.style.display = 'none';

        // Reset action sections for both modes
        if (mode === 'encrypt') {
            const after = document.getElementById('encryptAfterActions');
            const before = document.getElementById('encryptBeforeActions');
            if (after) after.style.display = 'none';
            if (before) before.style.display = 'block';

            // Hide decrypt actions
            const decryptAfter = document.getElementById('decryptAfterActions');
            const decryptBefore = document.getElementById('decryptBeforeActions');
            if (decryptAfter) decryptAfter.style.display = 'none';
            if (decryptBefore) decryptBefore.style.display = 'none';
        } else {
            // NEW: Handle decrypt mode setup
            const decryptAfter = document.getElementById('decryptAfterActions');
            const decryptBefore = document.getElementById('decryptBeforeActions');
            if (decryptAfter) decryptAfter.style.display = 'none';
            if (decryptBefore) decryptBefore.style.display = 'block';

            // Hide encrypt actions
            const after = document.getElementById('encryptAfterActions');
            const before = document.getElementById('encryptBeforeActions');
            if (after) after.style.display = 'none';
            if (before) before.style.display = 'none';
        }

        // Clear output box
        const out = document.getElementById('outputText');
        if (out) out.value = '';
    }

    _closeSettingsModalSafely() {
        const el = document.getElementById('settingsModal');
        if (!el) return;
        const modal = bootstrap.Modal.getInstance(el) || new bootstrap.Modal(el);
        modal.hide();

        // Safety cleanup after the hide animation
        setTimeout(() => {
            document.querySelectorAll('.modal-backdrop').forEach(n => n.remove());
            document.body.classList.remove('modal-open');
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('padding-right');
        }, 200);
    }

    saveSettings() {
        SettingsModule.saveSettings();
        UIModule.showMessage(this.i18nStrings.settings_saved || "Settings saved and will persist across sessions.", "success");
        this._closeSettingsModalSafely();   // <-- use the new helper
    }

    resetSettings() {
        SettingsModule.resetSettings();
        try { localStorage.removeItem(CB_TX_PROTOCOL_KEY); } catch { }
        const txSel2 = document.getElementById('cb-setting-txProtocol');
        if (txSel2) txSel2.value = CB_TX_PROTOCOL_DEFAULT;

        // Reset both modes
        localStorage.removeItem('cb.advancedMode');
        localStorage.removeItem('cb.simplifiedMode');

        const advToggle = document.getElementById('advancedModeToggle');
        const simplifiedToggle = document.getElementById('stealthModeToggle');
        const advGrp = document.getElementById('advancedToolGroup');

        if (advToggle) {
            advToggle.checked = false;
            advToggle.disabled = false;
            advToggle.closest('.form-check')?.classList.remove('text-muted');
        }
        if (simplifiedToggle) {
            simplifiedToggle.checked = false;
            simplifiedToggle.disabled = false;
            simplifiedToggle.closest('.form-check')?.classList.remove('text-muted');
        }
        if (advGrp) advGrp.classList.add('d-none');

        UIModule.updateStealthUI();
        this._clearKxMemory?.();
        this._clearKxUIFields?.();
        UIModule.showMessage(this.i18nStrings.settings_reset_done || "Settings reset to default values.", "info");
        this._closeSettingsModalSafely();
    }

    setEncryptInputsCollapsed(collapsed) {
        const grp = document.getElementById('encryptFormFields');
        const btn = document.getElementById('toggleInputsBtn');
        if (!grp) return;

        try {
            const inst = bootstrap.Collapse.getOrCreateInstance(grp, { toggle: false });
            if (collapsed) inst.hide(); else inst.show();
        } catch (e) { /* ignore if bootstrap not ready */ }

        if (btn) {
            btn.setAttribute('aria-expanded', String(!collapsed));
            btn.textContent = collapsed ? '✏️ Edit Inputs' : '⬆️ Hide Inputs';
        }
    }

    async process() {
        if (this._busy) return;

        const mode = this.currentMode;
        const key = document.getElementById("key").value.trim();
        const salt = document.getElementById("salt").value.trim();
        const input = document.getElementById("inputText").value;
        const outputField = document.getElementById("outputText");
        const runBtn = document.getElementById('processButton');

        UIModule.showMessage("", "info", 0);

        const stealthMode = sessionStorage.getItem("stealthMode") === "true";
        const keyValidation = ValidationModule.validateKey(key);
        const saltValidation = ValidationModule.validateSalt(salt, stealthMode);
        const inputValidation = ValidationModule.validateInput(input, mode);

        if (!keyValidation.isValid) { UIModule.showMessage(keyValidation.error, "warning"); return; }
        if (!saltValidation.isValid) { UIModule.showMessage(saltValidation.error, "warning"); return; }
        if (!inputValidation.isValid) { UIModule.showMessage(inputValidation.errors.join(', '), "warning"); return; }

        this._busy = true;
        runBtn?.setAttribute('disabled', 'true');

        try {
            // Show output container (hidden initially to save space)
            const outputContainer = document.getElementById('outputTextContainer');
            if (outputContainer) outputContainer.style.display = 'block';

            if (mode === "encrypt") {
                const encrypted = await CryptoModule.encrypt(key, salt, input);
                outputField.value = encrypted;

                this.setEncryptInputsCollapsed(true); // collapse
                document.getElementById('encryptBeforeActions')?.style && (document.getElementById('encryptBeforeActions').style.display = 'none');
                document.getElementById('encryptAfterActions')?.style && (document.getElementById('encryptAfterActions').style.display = 'block');

                document.getElementById('outputTextContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                document.getElementById('outputText')?.focus();

                UIModule.showMessage(this.i18nStrings.encrypt_complete || "Encryption complete.", "success");
            } else {
                // DECRYPT MODE - Apply same collapsing behavior as encrypt
                const decrypted = await CryptoModule.decrypt(key, salt, input);
                outputField.value = decrypted;

                // NEW: Collapse input fields after successful decryption
                this.setEncryptInputsCollapsed(true);

                // NEW: Hide decrypt before actions, show after actions
                document.getElementById('decryptBeforeActions')?.style && (document.getElementById('decryptBeforeActions').style.display = 'none');
                document.getElementById('decryptAfterActions')?.style && (document.getElementById('decryptAfterActions').style.display = 'block');

                // NEW: Scroll to output for better UX
                document.getElementById('outputTextContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                document.getElementById('outputText')?.focus();

                UIModule.showMessage(this.i18nStrings.decrypt_successful || "Decryption successful.", "success");
            }

            UIModule.updateQRButtons();
            this.hasProcessed = true;
            UIModule.updateContextActions(this.currentMode, this.hasProcessed);
        } catch (err) {
            // Re-open inputs on error for both modes
            this.setEncryptInputsCollapsed(false);

            if (mode === "encrypt") {
                document.getElementById('encryptBeforeActions')?.style && (document.getElementById('encryptBeforeActions').style.display = 'block');
                document.getElementById('encryptAfterActions')?.style && (document.getElementById('encryptAfterActions').style.display = 'none');
            } else {
                // NEW: Show decrypt before actions on error
                document.getElementById('decryptBeforeActions')?.style && (document.getElementById('decryptBeforeActions').style.display = 'block');
                document.getElementById('decryptAfterActions')?.style && (document.getElementById('decryptAfterActions').style.display = 'none');
            }

            outputField.value = `Error: ${err.message}`;
            console.error(err);
            UIModule.showMessage(this.i18nStrings.processing_error || "An error occurred during processing. Check console.", "danger");
            UIModule.updateQRButtons();
        } finally {
            this._busy = false;
            runBtn?.removeAttribute('disabled');
        }
    }

    updateStatusBar() {
        UIModule.updateStatusBar(window.clipboardExpiresAt, window.sessionExpiresAt, this.i18nStrings);
    }

    // --- tiny helpers ---
    _bytesToB64(buf) {
        return btoa(String.fromCharCode(...new Uint8Array(buf)));
    }
    _b64ToBytes(b64) {
        return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    }
    _randBytesB64(n = 32) {
        const a = new Uint8Array(n);
        crypto.getRandomValues(a);
        return this._bytesToB64(a.buffer);
    }
    _randSalt(len = 16) {
        const cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const rnd = new Uint8Array(len);
        crypto.getRandomValues(rnd);
        let s = '';
        for (let i = 0; i < len; i++) s += cs[rnd[i] % cs.length];
        return s;
    }
    async _exportPkcs8B64(privKey) { // optional: show private for export/debug section
        const pkcs8 = await crypto.subtle.exportKey('pkcs8', privKey);
        return this._bytesToB64(pkcs8);
    }
    _clearKxMemory() {
        // Reset internal state
        this._kx = {
            myKeyPair: null,
            myPubB64: '',
            myPrivPkcs8B64: ''
        };

        // Clear all related UI fields if they exist
        const ids = [
            'publicKeyOutput', 'privateKeyOutput',
            'kxAESKey', 'kxSalt',
            'recipientPublicKey', 'encryptedPayload',
            'senderPublicKey', 'receivedEncryptedPayload',
            'decryptedAESKey', 'decryptedSalt',
            'kxImportPrivatePkcs8', 'kxImportPublic'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }

    _clearKxUIFields() {
        const ids = [
            'publicKeyOutput', 'privateKeyOutput',
            'kxImportPrivatePkcs8', 'kxImportPublic',
            'kxAESKey', 'kxSalt',
            'recipientPublicKey', 'encryptedPayload',
            'senderPublicKey', 'receivedEncryptedPayload',
            'decryptedAESKey', 'decryptedSalt'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }

    _clearKxTransientFields() {
        [
            'kxAESKey', 'kxSalt',
            'encryptedPayload', 'receivedEncryptedPayload',
            'decryptedAESKey', 'decryptedSalt'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }
}