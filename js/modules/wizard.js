// /js/modules/wizard.js
import { UIModule } from './ui.js';
import { ClipboardModule } from './clipboard.js';

export class WizardModule {
    constructor(app) {
        this.app = app;
        this._handlersInitialized = false;
        this.state = {
            keyPair: null,
            publicKeyB64: '',
            privateKeyB64: '',
            aesKey: '',
            salt: '',
            shareString: '',
            currentFlow: null,
            currentStep: 1  // Track current wizard step (1=Keys, 2=Exchange, 3=Done)
        };
        this.updateModalBehavior = null;
    }

    get i18n() { return this.app?.i18nStrings || {}; }

    initialize() {
        const modalEl = document.getElementById('keyExchangeModal');
        if (!modalEl) {
            console.warn('[Wizard] Modal element not found during initialization');
            return;
        }

        // Check if modal is already open
        const isModalOpen = modalEl.classList.contains('show');

        if (isModalOpen) {
            this.initializeUI();
            this._handlersInitialized = true;
        }

        // Set up handlers when modal is shown in the future
        modalEl.addEventListener('show.bs.modal', () => {
            if (!this._handlersInitialized) {
                this.initializeUI();
                this._handlersInitialized = true;
            }
            this.restoreKeysFromSession();
            this.updateKeyStatus();
        });
    }

    initializeUI() {
        const modalEl = document.getElementById('keyExchangeModal');
        if (!modalEl) {
            console.error('[Wizard] Modal not found');
            return;
        }

        const modal = bootstrap.Modal.getOrCreateInstance(modalEl, {
            backdrop: true,
            keyboard: true
        });

        // Modal behavior updates
        this.updateModalBehavior = () => {
            if (this.state.currentFlow) {
                modal._config.backdrop = 'static';
                modal._config.keyboard = false;
            } else {
                modal._config.backdrop = true;
                modal._config.keyboard = true;
            }
        };

        // Restore keys on modal open
        modalEl.addEventListener('show.bs.modal', () => {
            this.restoreKeysFromSession();
            this.updateKeyStatus();
        });

        // Setup all event handlers
        this.setupKeyManagementHandlers();
        this.setupExchangeHandlers();
        this.setupDialogHandlers();
        this.setupInputValidation();

        // Initial key status
        this.updateKeyStatus();

        // Preserve credentials on modal close
        modalEl.addEventListener('hidden.bs.modal', () => {
            const preservedCredentials = {
                aesKey: this.state.aesKey,
                salt: this.state.salt
            };
            this.resetExchangeUI();
            if (preservedCredentials.aesKey || preservedCredentials.salt) {
                this.state.aesKey = preservedCredentials.aesKey;
                this.state.salt = preservedCredentials.salt;
            }
        });
    }

    // ============ KEY MANAGEMENT HANDLERS ============
    setupKeyManagementHandlers() {
        // Handle key option cards (Generate / Import)
        const keyOptionCards = document.querySelectorAll('.key-option-card');

        keyOptionCards.forEach(card => {
            const action = card.getAttribute('data-action');

            card.addEventListener('click', () => {
                if (action === 'generate') {
                    this.handleGenerateKeys();
                } else if (action === 'import') {
                    this.showImportSection();
                }
            });
        });

        // Confirm import (Load Keys button)
        document.getElementById('doImportKeys')?.addEventListener('click', async () => {
            await this.handleImportKeys();
        });

        // Cancel import
        document.getElementById('cancelImport')?.addEventListener('click', () => {
            this.hideImportSection();
        });

        // Back from export
        document.getElementById('backToOptions')?.addEventListener('click', () => {
            this.hideExportSection();
        });

        // Copy generated keys
        document.getElementById('copyGeneratedPrivateKey')?.addEventListener('click', async () => {
            const privKeyEl = document.getElementById('generatedPrivateKey');
            if (privKeyEl?.value) {
                await this.copyToClipboard(privKeyEl.value, this.i18n.wizard_privkey_copied || 'Private key copied! Keep it secure.');
            }
        });

        document.getElementById('copyGeneratedPublicKey')?.addEventListener('click', async () => {
            const pubKeyEl = document.getElementById('generatedPublicKey');
            if (pubKeyEl?.value) {
                await this.copyToClipboard(pubKeyEl.value, this.i18n.wizard_pubkey_copied || 'Public key copied! Share this with others.');
            }
        });

        // Download keys
        document.getElementById('downloadKeys')?.addEventListener('click', () => {
            this.downloadKeyPair();
        });

        // Proceed with generated keys
        document.getElementById('proceedWithKeys')?.addEventListener('click', () => {
            this.hideExportSection();
            this.updateKeyStatus();
            UIModule.showMessage(this.i18n.wizard_keys_ready || 'Keys are ready! You can now exchange credentials.', 'success');
        });

        // Clear keys
        document.getElementById('clearKeys')?.addEventListener('click', () => {
            this.clearAllKeys();
            this.updateKeyStatus();
        });

        // Copy current public key
        document.getElementById('copyCurrentPublicKey')?.addEventListener('click', async () => {
            if (this.state.publicKeyB64) {
                await this.copyToClipboard(this.state.publicKeyB64, this.i18n.wizard_pubkey_copied || 'Your public key copied! Share this with others.');
            }
        });
    }

    // ============ EXCHANGE HANDLERS ============
    setupExchangeHandlers() {
        // Manage loaded keys
        document.getElementById('manageLoadedKeys')?.addEventListener('click', () => {
            this.showKeyManagementDialog();
        });

        // Copy exchange public key
        document.getElementById('copyExchangePublicKey')?.addEventListener('click', async () => {
            if (this.state.publicKeyB64) {
                await this.copyToClipboard(this.state.publicKeyB64, this.i18n.wizard_pubkey_copied_person || 'Your public key copied! Share this with the other person.');
            }
        });

        // Handle role cards (Send / Receive)
        const roleCards = document.querySelectorAll('.role-card');

        roleCards.forEach(card => {
            const role = card.getAttribute('data-role');

            card.addEventListener('click', () => {
                this.showFlowSection(role);
            });
        });

        // Create share string
        document.getElementById('createShareString')?.addEventListener('click', async () => {
            await this.handleCreateShareString();
        });

        // Edit send inputs
        document.getElementById('editSendInputs')?.addEventListener('click', () => {
            this.setSendInputsCollapsed(false);
        });

        // Copy share string
        document.getElementById('copyShareString')?.addEventListener('click', async () => {
            const shareStringEl = document.getElementById('finalShareString');
            if (shareStringEl?.value) {
                await this.copyToClipboard(shareStringEl.value, this.i18n.wizard_sharestring_copied || 'Share string copied! Send this to the recipient.');
            }
        });

        // Decrypt share string
        document.getElementById('decryptShareString')?.addEventListener('click', async () => {
            await this.handleDecryptShareString();
        });

        // Edit receive inputs
        document.getElementById('editReceiveInputs')?.addEventListener('click', () => {
            this.setReceiveInputsCollapsed(false);
        });

        // Inject into app
        document.getElementById('injectIntoApp')?.addEventListener('click', async () => {
            await this.handleInjectIntoApp();
        });

        // Copy sender's AES key
        document.getElementById('copySenderKey')?.addEventListener('click', async () => {
            const keyEl = document.getElementById('senderAESKey');
            if (keyEl?.value) {
                await this.copyToClipboard(keyEl.value, this.i18n.wizard_aeskey_copied || 'Your AES key copied!');
            }
        });

        // Copy sender's salt
        document.getElementById('copySenderSalt')?.addEventListener('click', async () => {
            const saltEl = document.getElementById('senderSalt');
            if (saltEl?.value) {
                await this.copyToClipboard(saltEl.value, this.i18n.wizard_salt_copied || 'Your salt copied!');
            }
        });

        // Copy final share string (alternative button)
        document.getElementById('copyFinalShareString')?.addEventListener('click', async () => {
            const shareStringEl = document.getElementById('finalShareString');
            if (shareStringEl?.value) {
                await this.copyToClipboard(shareStringEl.value, this.i18n.wizard_sharestring_copied || 'Share string copied! Send this to the recipient.');
            }
        });

        // Inject sender credentials into CipherBrick
        document.getElementById('injectSenderCredentials')?.addEventListener('click', async () => {
            await this.handleInjectSenderCredentials();
        });

        // Start over
        document.getElementById('startOver')?.addEventListener('click', () => {
            this.resetExchangeUI();
            this.showExchangeStep();
        });
    }

    // ============ DIALOG HANDLERS ============
    setupDialogHandlers() {
        // Copy dialog public key
        document.getElementById('copyDialogPublicKey')?.addEventListener('click', async () => {
            const dialogPubKeyEl = document.getElementById('dialogPublicKey');
            if (dialogPubKeyEl?.value) {
                await this.copyToClipboard(dialogPubKeyEl.value, this.i18n.wizard_pubkey_copied_dialog || 'Public key copied!');
            }
        });

        // Clear keys from dialog
        document.getElementById('clearKeysDialog')?.addEventListener('click', () => {
            this.clearAllKeys();
            this.updateKeyStatus();
            this.showKeyManagementStep();
            UIModule.showMessage(this.i18n.wizard_keys_cleared || 'Keys cleared successfully!', 'success');
        });

        // Generate new keys from dialog
        document.getElementById('generateNewKeysDialog')?.addEventListener('click', () => {
            this.clearAllKeys();
            this.updateKeyStatus();
            this.showKeyManagementStep();
            setTimeout(() => this.handleGenerateKeys(), 200);
        });

        // Import different keys from dialog
        document.getElementById('importDifferentKeys')?.addEventListener('click', () => {
            this.clearAllKeys();
            this.updateKeyStatus();
            this.showKeyManagementStep();
            setTimeout(() => this.showImportSection(), 200);
        });
    }

    // ============ INPUT VALIDATION ============
    setupInputValidation() {
        // Validate recipient public key for send flow
        const recipientKeyEl = document.getElementById('recipientPublicKey');
        const createShareBtn = document.getElementById('createShareString');

        if (recipientKeyEl && createShareBtn) {
            const validateSendInputs = () => {
                const hasRecipientKey = recipientKeyEl.value.trim().length > 0;
                createShareBtn.disabled = !hasRecipientKey;
            };

            recipientKeyEl.addEventListener('input', validateSendInputs);
            recipientKeyEl.addEventListener('paste', () => setTimeout(validateSendInputs, 10));

            // Initial validation
            validateSendInputs();
        }

        // Validate sender public key and share string for receive flow
        const senderKeyEl = document.getElementById('senderPublicKey');
        const shareStringEl = document.getElementById('receivedShareString');
        const decryptBtn = document.getElementById('decryptShareString');

        if (senderKeyEl && shareStringEl && decryptBtn) {
            const validateReceiveInputs = () => {
                const hasSenderKey = senderKeyEl.value.trim().length > 0;
                const hasShareString = shareStringEl.value.trim().length > 0;
                const isValid = hasSenderKey && hasShareString;
                decryptBtn.disabled = !isValid;
            };

            senderKeyEl.addEventListener('input', validateReceiveInputs);
            senderKeyEl.addEventListener('paste', () => setTimeout(validateReceiveInputs, 10));
            shareStringEl.addEventListener('input', validateReceiveInputs);
            shareStringEl.addEventListener('paste', () => setTimeout(validateReceiveInputs, 10));

            // Initial validation
            validateReceiveInputs();
        }
    }

    // ============ KEY MANAGEMENT METHODS ============
    async handleGenerateKeys() {
        try {
            this.state.keyPair = await this.app.keyx.generateKeyPair();
            this.state.publicKeyB64 = await this.app.keyx.exportPublicKey(this.state.keyPair.publicKey);
            this.state.privateKeyB64 = await this.exportPrivateKeyB64(this.state.keyPair.privateKey);

            this.showExportSection();
            this.saveKeysToSession();
            UIModule.showMessage(this.i18n.wizard_keys_generated || 'New key pair generated successfully!', 'success');
        } catch (error) {
            console.error('[Wizard] Key generation failed:', error);
            this.showError((this.i18n.wizard_keys_generate_failed || 'Failed to generate keys: {error}').replace('{error}', error.message));
        }
    }

    async handleImportKeys() {
        try {
            const privKeyEl = document.getElementById('importPrivateKey');
            const pubKeyEl = document.getElementById('importPublicKey');

            const privKeyB64 = privKeyEl?.value.trim() || '';
            const pubKeyB64 = pubKeyEl?.value.trim() || '';

            if (!privKeyB64 || !pubKeyB64) {
                this.showError(this.i18n.wizard_paste_both_keys || 'Please paste both private and public keys');
                return;
            }

            const privateKey = await this.app.keyx.importPrivateKeyPkcs8(privKeyB64);
            const publicKey = await this.app.keyx.importPublicKeyAuto(pubKeyB64);

            this.state.keyPair = { privateKey, publicKey };
            this.state.publicKeyB64 = pubKeyB64;
            this.state.privateKeyB64 = privKeyB64;

            this.hideImportSection();
            this.saveKeysToSession();
            this.updateKeyStatus();
            UIModule.showMessage(this.i18n.wizard_keys_imported || 'Keys imported successfully!', 'success');
        } catch (error) {
            console.error('[Wizard] Key import failed:', error);
            this.showError(this.i18n.wizard_keys_import_failed || 'Failed to import keys. Make sure they are valid ECDH P-256 keys.');
        }
    }

    clearAllKeys() {
        this.state.keyPair = null;
        this.state.publicKeyB64 = '';
        this.state.privateKeyB64 = '';
        this.clearKeysFromSession();
        this.hideImportSection();
        this.hideExportSection();

        // Clear import fields
        const importPrivKeyEl = document.getElementById('importPrivateKey');
        const importPubKeyEl = document.getElementById('importPublicKey');
        if (importPrivKeyEl) importPrivKeyEl.value = '';
        if (importPubKeyEl) importPubKeyEl.value = '';
    }

    downloadKeyPair() {
        const keyData = {
            privateKey: this.state.privateKeyB64,
            publicKey: this.state.publicKeyB64,
            generated: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(keyData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cipherbrick-keys.json';
        a.click();
        URL.revokeObjectURL(url);

        UIModule.showMessage(this.i18n.wizard_keys_downloaded || 'Key pair downloaded! Store it securely.', 'info');
    }

    // ============ EXCHANGE METHODS ============
    showFlowSection(role) {
        document.getElementById('sendFlow')?.classList.add('d-none');
        document.getElementById('receiveFlow')?.classList.add('d-none');
        document.getElementById('sendResult')?.classList.add('d-none');
        document.getElementById('receiveResult')?.classList.add('d-none');

        this.setSendInputsCollapsed(false);
        this.setReceiveInputsCollapsed(false);

        if (role === 'send') {
            document.getElementById('sendFlow')?.classList.remove('d-none');
        } else if (role === 'receive') {
            document.getElementById('receiveFlow')?.classList.remove('d-none');
        }

        this.updateModalBehavior?.();
    }

    async handleCreateShareString() {
        try {
            const recipientKeyEl = document.getElementById('recipientPublicKey');
            const recipientPubB64 = recipientKeyEl?.value.trim() || '';

            if (!recipientPubB64) {
                this.showError(this.i18n.wizard_paste_recipient_key || 'Please paste the recipient\'s public key');
                return;
            }

            const recipientPublicKey = await this.app.keyx.importPublicKeyAuto(recipientPubB64);
            const sharedSecret = await this.app.keyx.deriveSharedSecret(this.state.keyPair.privateKey, recipientPublicKey);

            const aesKey = this.generateRandomString(32);
            const salt = this.generateRandomString(16);

            this.state.aesKey = aesKey;
            this.state.salt = salt;

            const payload = JSON.stringify({ key: aesKey, salt: salt });
            const encryptedPayload = await this.encryptWithSharedSecret(payload, sharedSecret);
            const shareString = `CBKS1:${encryptedPayload}`;

            this.state.shareString = shareString;

            // Populate the sender's credentials fields
            const senderKeyEl = document.getElementById('senderAESKey');
            const senderSaltEl = document.getElementById('senderSalt');
            if (senderKeyEl) senderKeyEl.value = aesKey;
            if (senderSaltEl) senderSaltEl.value = salt;

            // Populate the share string field
            const shareStringEl = document.getElementById('finalShareString');
            if (shareStringEl) shareStringEl.value = shareString;

            this.setSendInputsCollapsed(true);
            document.getElementById('sendResult')?.classList.remove('d-none');
            this.updateStepIndicator(3);  // Step 3: Done

            setTimeout(() => {
                document.getElementById('sendResult')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);

            UIModule.showMessage(this.i18n.wizard_share_create_ok || 'Share string created successfully!', 'success');
        } catch (error) {
            console.error('[Wizard] Share string creation failed:', error);
            this.showError((this.i18n.wizard_share_create_failed || 'Failed to create share string: {error}').replace('{error}', error.message));
        }
    }

    async handleDecryptShareString() {
        try {
            const shareStringEl = document.getElementById('receivedShareString');
            const shareString = shareStringEl?.value.trim() || '';

            if (!shareString) {
                this.showError(this.i18n.wizard_paste_share_string_received || 'Please paste the share string you received');
                return;
            }

            if (!shareString.startsWith('CBKS1:')) {
                this.showError(this.i18n.wizard_invalid_share_format || 'Invalid share string format');
                return;
            }

            const encryptedPayload = shareString.substring(6);
            const senderKeyEl = document.getElementById('senderPublicKey');
            const senderPubB64 = senderKeyEl?.value.trim() || '';

            if (!senderPubB64) {
                this.showError(this.i18n.wizard_paste_sender_key || 'Please paste the sender\'s public key');
                return;
            }

            const senderPublicKey = await this.app.keyx.importPublicKeyAuto(senderPubB64);
            const sharedSecret = await this.app.keyx.deriveSharedSecret(this.state.keyPair.privateKey, senderPublicKey);
            const decryptedPayload = await this.decryptWithSharedSecret(encryptedPayload, sharedSecret);
            const { key, salt } = JSON.parse(decryptedPayload);

            this.state.aesKey = key;
            this.state.salt = salt;

            const keyEl = document.getElementById('finalDecryptedKey');
            const saltEl = document.getElementById('finalDecryptedSalt');
            if (keyEl) keyEl.value = key;
            if (saltEl) saltEl.value = salt;

            this.setReceiveInputsCollapsed(true);
            document.getElementById('receiveResult')?.classList.remove('d-none');
            this.updateStepIndicator(3);  // Step 3: Done

            setTimeout(() => {
                document.getElementById('receiveResult')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);

            UIModule.showMessage(this.i18n.wizard_share_decrypt_ok || 'Share string decrypted successfully!', 'success');
        } catch (error) {
            console.error('[Wizard] Decryption failed:', error);
            this.showError(this.i18n.wizard_share_decrypt_failed || 'Failed to decrypt share string. Check that you pasted it correctly and that it was meant for your keys.');
        }
    }

    async handleInjectIntoApp() {
        const keyToInject = this.state.aesKey;
        const saltToInject = this.state.salt;

        if (!keyToInject || !saltToInject) {
            this.showError(this.i18n.wizard_no_credentials || 'No credentials available to inject.');
            return;
        }

        if (this.app.currentMode !== 'decrypt') {
            await this.app.setMode('decrypt');
        }

        const keyEl = document.getElementById('key');
        const saltEl = document.getElementById('salt');
        if (keyEl) keyEl.value = keyToInject;
        if (saltEl) saltEl.value = saltToInject;

        const modal = bootstrap.Modal.getInstance(document.getElementById('keyExchangeModal'));
        if (modal) modal.hide();

        UIModule.showMessage(this.i18n.wizard_credentials_decrypt_ready || 'Credentials injected into CipherBrick! Ready to decrypt messages.', 'success');
    }

    async handleInjectSenderCredentials() {
        const keyToInject = this.state.aesKey;
        const saltToInject = this.state.salt;

        if (!keyToInject || !saltToInject) {
            this.showError(this.i18n.wizard_no_credentials || 'No credentials available to inject.');
            return;
        }

        if (this.app.currentMode !== 'encrypt') {
            await this.app.setMode('encrypt');
        }

        const keyEl = document.getElementById('key');
        const saltEl = document.getElementById('salt');
        if (keyEl) keyEl.value = keyToInject;
        if (saltEl) saltEl.value = saltToInject;

        const modal = bootstrap.Modal.getInstance(document.getElementById('keyExchangeModal'));
        if (modal) modal.hide();

        UIModule.showMessage(this.i18n.wizard_credentials_encrypt_ready || 'Credentials injected into CipherBrick! Ready to encrypt messages.', 'success');
    }

    // ============ UI STATE METHODS ============
    updateStepIndicator(step) {
        // Update state
        this.state.currentStep = step;

        // Get all step elements
        const steps = document.querySelectorAll('.step-indicator');

        steps.forEach((stepEl, index) => {
            const stepNumber = index + 1;

            // Remove all classes
            stepEl.classList.remove('active', 'completed');

            // Add appropriate class
            if (stepNumber < step) {
                stepEl.classList.add('completed');
            } else if (stepNumber === step) {
                stepEl.classList.add('active');
            }
        });
    }

    showImportSection() {
        document.getElementById('keyOptions')?.classList.add('d-none');
        document.getElementById('importSection')?.classList.remove('d-none');
    }

    hideImportSection() {
        document.getElementById('keyOptions')?.classList.remove('d-none');
        document.getElementById('importSection')?.classList.add('d-none');
    }

    showExportSection() {
        const exportSection = document.getElementById('exportSection');
        const privKeyEl = document.getElementById('generatedPrivateKey');
        const pubKeyEl = document.getElementById('generatedPublicKey');

        document.getElementById('keyOptions')?.classList.add('d-none');
        exportSection?.classList.remove('d-none');
        if (privKeyEl) privKeyEl.value = this.state.privateKeyB64;
        if (pubKeyEl) pubKeyEl.value = this.state.publicKeyB64;
    }

    hideExportSection() {
        document.getElementById('keyOptions')?.classList.remove('d-none');
        document.getElementById('exportSection')?.classList.add('d-none');
    }

    showKeyManagementStep() {
        document.getElementById('keyManagementStep')?.classList.remove('d-none');
        document.getElementById('exchangeStep')?.classList.add('d-none');
        document.getElementById('keyManagementDialog')?.classList.add('d-none');
        this.updateStepIndicator(1);  // Step 1: Keys
    }

    showExchangeStep() {
        document.getElementById('keyManagementStep')?.classList.add('d-none');
        document.getElementById('exchangeStep')?.classList.remove('d-none');
        document.getElementById('keyManagementDialog')?.classList.add('d-none');
        this.updateStepIndicator(2);  // Step 2: Exchange
        this.resetExchangeUI();
    }

    showKeyManagementDialog() {
        document.getElementById('keyManagementStep')?.classList.add('d-none');
        document.getElementById('exchangeStep')?.classList.add('d-none');
        document.getElementById('keyManagementDialog')?.classList.remove('d-none');

        const dialogPubKeyEl = document.getElementById('dialogPublicKey');
        if (dialogPubKeyEl) dialogPubKeyEl.value = this.state.publicKeyB64;
    }

    resetExchangeUI() {
        document.getElementById('sendFlow')?.classList.add('d-none');
        document.getElementById('receiveFlow')?.classList.add('d-none');
        document.getElementById('sendResult')?.classList.add('d-none');
        document.getElementById('receiveResult')?.classList.add('d-none');

        this.setSendInputsCollapsed(false);
        this.setReceiveInputsCollapsed(false);

        ['recipientPublicKey', 'senderPublicKey', 'receivedShareString', 'finalShareString', 'finalDecryptedKey', 'finalDecryptedSalt'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
    }

    setSendInputsCollapsed(collapsed) {
        const inputSection = document.getElementById('sendInputSection');
        const editBtn = document.getElementById('editSendInputs');

        if (!inputSection) return;

        inputSection.style.display = collapsed ? 'none' : 'block';
        if (!collapsed) {
            document.getElementById('sendResult')?.classList.add('d-none');
        }

        if (editBtn) {
            const i18n = this.app.i18nStrings || {};
            editBtn.textContent = collapsed
                ? (i18n.wizard_edit_inputs || '✏️ Edit Inputs')
                : (i18n.wizard_hide_inputs || '⬆️ Hide Inputs');
        }
    }

    setReceiveInputsCollapsed(collapsed) {
        const inputSection = document.getElementById('receiveInputSection');
        const editBtn = document.getElementById('editReceiveInputs');

        if (!inputSection) return;

        inputSection.style.display = collapsed ? 'none' : 'block';
        if (!collapsed) {
            document.getElementById('receiveResult')?.classList.add('d-none');
        }

        if (editBtn) {
            const i18n = this.app.i18nStrings || {};
            editBtn.textContent = collapsed
                ? (i18n.wizard_edit_inputs || '✏️ Edit Inputs')
                : (i18n.wizard_hide_inputs || '⬆️ Hide Inputs');
        }
    }

    updateKeyStatus() {
        const statusEl = document.getElementById('keyStatusText');
        const alertEl = document.getElementById('keyStatusAlert');
        const clearBtn = document.getElementById('clearKeys');
        const currentKeySection = document.getElementById('currentKeySection');
        const currentPubKeyEl = document.getElementById('currentPublicKey');

        // Get translated strings from app
        const i18n = this.app.i18nStrings || {};

        if (this.state.keyPair && this.state.publicKeyB64) {
            if (statusEl) {
                statusEl.setAttribute('data-i18n', 'wizard_status_keys_ready');
                statusEl.textContent = i18n.wizard_status_keys_ready || '✅ Keys loaded and ready';
            }
            if (alertEl) alertEl.className = 'alert alert-success';
            if (clearBtn) clearBtn.classList.remove('d-none');
            if (currentKeySection) currentKeySection.classList.remove('d-none');
            if (currentPubKeyEl) currentPubKeyEl.value = this.state.publicKeyB64;

            const exchangePubKeyEl = document.getElementById('exchangePublicKey');
            const dialogPubKeyEl = document.getElementById('dialogPublicKey');
            if (exchangePubKeyEl) exchangePubKeyEl.value = this.state.publicKeyB64;
            if (dialogPubKeyEl) dialogPubKeyEl.value = this.state.publicKeyB64;

            this.showExchangeStep();
        } else {
            if (statusEl) {
                statusEl.setAttribute('data-i18n', 'wizard_status_no_keys');
                statusEl.textContent = i18n.wizard_status_no_keys || 'No keys loaded';
            }
            if (alertEl) alertEl.className = 'alert alert-warning';
            if (clearBtn) clearBtn.classList.add('d-none');
            if (currentKeySection) currentKeySection.classList.add('d-none');
            this.showKeyManagementStep();
        }
    }

    // ============ SESSION STORAGE ============
    saveKeysToSession() {
        if (this.state.keyPair && this.state.publicKeyB64) {
            try {
                sessionStorage.setItem('cbwizard_keys', JSON.stringify({
                    publicKeyB64: this.state.publicKeyB64,
                    privateKeyB64: this.state.privateKeyB64,
                    timestamp: Date.now()
                }));
            } catch (e) {
                console.warn('[Wizard] Could not save keys to session:', e);
            }
        }
    }

    clearKeysFromSession() {
        try {
            sessionStorage.removeItem('cbwizard_keys');
        } catch (e) {
            console.warn('[Wizard] Error clearing keys from session:', e);
        }
    }

    async restoreKeysFromSession() {
        try {
            const saved = sessionStorage.getItem('cbwizard_keys');
            if (saved) {
                const keyData = JSON.parse(saved);
                if (Date.now() - keyData.timestamp < 3600000) {
                    this.state.publicKeyB64 = keyData.publicKeyB64;
                    this.state.privateKeyB64 = keyData.privateKeyB64;

                    if (keyData.privateKeyB64 && keyData.publicKeyB64) {
                        try {
                            const privateKey = await this.app.keyx.importPrivateKeyPkcs8(keyData.privateKeyB64);
                            const publicKey = await this.app.keyx.importPublicKeyAuto(keyData.publicKeyB64);
                            this.state.keyPair = { privateKey, publicKey };
                        } catch (e) {
                            console.warn('[Wizard] Could not reconstruct keys:', e);
                            this.clearKeysFromSession();
                        }
                    }
                } else {
                    this.clearKeysFromSession();
                }
            }
        } catch (e) {
            console.warn('[Wizard] Error restoring keys:', e);
        }
    }

    // ============ UTILITY METHODS ============
    async exportPrivateKeyB64(privateKey) {
        const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
        return btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
    }

    async copyToClipboard(text, message) {
        try {
            await ClipboardModule.copyToClipboard(text, UIModule, () => this.app.updateStatusBar());
            UIModule.showMessage(message, 'success');
        } catch (error) {
            UIModule.showMessage(this.i18n.wizard_copy_failed || 'Copy failed', 'danger');
        }
    }

    showError(message) {
        const errorEl = document.getElementById('wizardError');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.remove('d-none');
            setTimeout(() => errorEl.classList.add('d-none'), 5000);
        }
        console.error('[Wizard Error]', message);
    }

    generateRandomString(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const randomBytes = crypto.getRandomValues(new Uint8Array(length));
        return Array.from(randomBytes, byte => chars[byte % chars.length]).join('');
    }

    async encryptWithSharedSecret(plaintext, sharedSecret) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['encrypt']);
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));

        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv, 0);
        combined.set(new Uint8Array(encrypted), iv.length);

        return btoa(String.fromCharCode(...combined));
    }

    async decryptWithSharedSecret(encryptedB64, sharedSecret) {
        const data = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
        const iv = data.slice(0, 12);
        const ciphertext = data.slice(12);

        const key = await crypto.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, ['decrypt']);
        const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

        return new TextDecoder().decode(decrypted);
    }
}