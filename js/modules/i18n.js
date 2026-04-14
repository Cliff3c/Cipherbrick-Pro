export class I18nModule {
    static async loadTranslations(lang = "en") {
        try {
            // Load from correct path: /lang/ not /js/lang/
            const response = await fetch(`./lang/${lang}.json`);

            if (!response.ok) {
                console.warn(`[I18n] Failed to load ${lang}.json (${response.status}), using fallback`);
                return this.getFallbackTranslations();
            }

            const translations = await response.json();
            return translations;

        } catch (error) {
            console.error('[I18n] Error loading translations:', error);
            return this.getFallbackTranslations();
        }
    }

    static applyTranslations(strings) {
        // Translate visible text (preserving emojis or extra formatting)
        document.querySelectorAll("[data-i18n]").forEach(el => {
            const key = el.getAttribute("data-i18n");
            if (strings[key]) {
                // Get the ORIGINAL/DEFAULT content from HTML, not current content
                // Store original content in a data attribute on first run
                if (!el.hasAttribute('data-original-text')) {
                    el.setAttribute('data-original-text', el.textContent);
                }

                const originalText = el.getAttribute('data-original-text');
                const match = originalText.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})+/u);

                if (match) {
                    // Use original emoji + new translation
                    el.textContent = `${match[0]} ${strings[key]}`;
                } else {
                    // No emoji, just use the translation
                    el.textContent = strings[key];
                }
            } else if (key) {
                console.warn(`[I18n] Missing translation for key: ${key}`);
            }
        });

        // Translate rich HTML content
        document.querySelectorAll("[data-i18n-html]").forEach(el => {
            const key = el.getAttribute("data-i18n-html");
            if (strings[key]) {
                el.innerHTML = strings[key];
            } else if (key) {
                console.warn(`[I18n] Missing html translation for key: ${key}`);
            }
        });

        // Translate placeholders
        document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
            const key = el.getAttribute("data-i18n-placeholder");
            if (strings[key]) {
                el.setAttribute("placeholder", strings[key]);
            } else if (key) {
                console.warn(`[I18n] Missing placeholder translation for key: ${key}`);
            }
        });

        // Handle optgroup labels
        document.querySelectorAll('optgroup[data-i18n]').forEach(optgroup => {
            const key = optgroup.getAttribute('data-i18n');
            if (strings[key]) {
                optgroup.label = strings[key];
            }
        });

        if (strings.title) document.title = strings.title;
    }

    /**
     * Template formatter — replaces {key} placeholders with values from vars.
     * Usage: I18nModule.format("Hello {name}!", { name: "World" }) → "Hello World!"
     */
    static format(template, vars = {}) {
        if (!template) return template;
        return template.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? vars[key] : `{${key}}`));
    }

    static getStoredLanguage() {
        return localStorage.getItem("preferredLanguage") || "en";
    }

    static setStoredLanguage(lang) {
        localStorage.setItem("preferredLanguage", lang);
    }

    // Languages that should render Right-To-Left (future-proofing)
    static RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);

    static updateDocumentLanguage(langCode) {
        document.documentElement.lang = langCode || 'en';
        document.documentElement.dir = this.RTL_LANGS.has(langCode) ? 'rtl' : 'ltr';
    }

    /**
     * Public entry to change language:
     * - loads /lang/<code>.json
     * - applies translations atomically
     * - updates <html lang> and direction
     * - stores preference
     */
    static async setLanguage(langCode = 'en') {
        const dict = await this.loadTranslations(langCode);
        this.applyTranslations(dict);
        this.updateDocumentLanguage(langCode);
        try { this.setStoredLanguage(langCode); } catch { }
        return dict;
    }

    /**
     * Initialize at app startup. Uses stored preference,
     * else current <html lang>, else 'en'.
     */
    static async init() {
        let code = 'en';
        try {
            code = this.getStoredLanguage() || document.documentElement.lang || 'en';
        } catch { }
        return this.setLanguage(code);
    }

    // Comprehensive fallback with all translation keys
    static getFallbackTranslations() {
        return {
            "title": "CipherBrick Pro",
            "select_mode_label": "Select Mode:",
            "mode_encrypt": "Encrypt",
            "mode_decrypt": "Decrypt",
            "key_label": "Key:",
            "salt_label": "Salt:",
            "run": "Run",
            "copy": "Copy",
            "reset": "Reset",
            "input_label": "Message to Encrypt:",
            "input_label_encrypt": "Message to Encrypt:",
            "input_label_decrypt": "Encrypted Message:",
            "output_label": "Output:",
            "btn_settings": "Settings",
            "card_title": "Encryption / Decryption -",
            "char_count_label_2": "Character Count:",
            "qr_limit_warning": "Message exceeds 500 character limit. Please shorten your message.",
            "encrypt_ready": "Ready to encrypt...",
            "decrypt_complete": "Decrypted successfully!",
            "encrypt_success": "Encrypted! Choose an option:",
            "decrypt_btn_qr": "QR",
            "decrypt_btn_payload": "Payload",
            "decrypt_btn_audio": "Audio",
            "use_payload_btn": "Use This Payload",
            "listening_for_audio": "Listening for audio...",
            "stop_listening_btn": "Stop Listening",
            "btn_copy": "Copy",
            "btn_qr": "QR",
            "btn_payload": "Payload",
            "btn_audio": "Audio",
            "edit_inputs_btn": "Edit Inputs",
            "strength_label": "Strength:",
            "clipboard_security": "Clipboard Security",
            "settings_idle_timeout": "Session Timeout (minutes):",
            "settings_stealth_toggle": "Enable Stealth Mode (Obfuscate Salt)",
            "audio_tx_protocol_label": "Audio TX Protocol",
            "audio_tx_group_audible": "Audible",
            "audio_tx_group_ultrasound": "Ultrasound (device-dependent)",
            "audio_tx_normal": "Normal (reliable, clear audio)",
            "audio_tx_fast": "Fast (balanced, clear audio)",
            "audio_tx_fastest": "Fastest (high freq, may be silent)",
            "audio_tx_ultrasound_normal": "[Ultrasound] Normal (silent)",
            "audio_tx_ultrasound_fast": "[Ultrasound] Fast (silent)",
            "audio_tx_ultrasound_fastest": "[Ultrasound] Fastest (varies by device)",
            "save_settings": "Save Settings",
            "reset_settings": "Restore Defaults",
            "qr_modal_title": "QR Code",
            "qr_modal_copy": "Copy",
            "qr_modal_save": "Save",
            "qr_modal_view": "View",
            "qr_scan_modal_title": "Scan QR Code",
            "qr_scan_instruction": "Point camera at QR code to scan automatically",
            "modal_close": "Close",
            "clipboard_modal_checkbox": "Don't show this again (this session)",
            "clipboard_clear_now": "Clear Clipboard Now",
            "placeholder.input": "Enter your message",
            "placeholder.payload": "Paste encrypted payload here...",
            "placeholder.key": "Enter encryption key",
            "placeholder.salt": "Enter salt",

            "clipboard_nothing_to_copy": "Nothing to copy. The output field is empty.",
            "clipboard_copied_seconds": "Copied! Clipboard will be cleared in {seconds} seconds.",
            "clipboard_copy_error": "Error copying to clipboard.",
            "clipboard_manually_cleared": "Clipboard manually cleared.",
            "clipboard_clear_failed": "Clipboard could not be cleared. Try copying something else.",
            "clipboard_wiped": "Clipboard cleared.",

            "session_expired": "Session expired due to inactivity. All sensitive fields have been cleared.",

            "settings_saved": "Settings saved and will persist across sessions.",
            "settings_reset_done": "Settings reset to default values.",

            "encrypt_complete": "Encryption complete.",
            "decrypt_successful": "Decryption successful.",
            "wrong_mode_hint": "This payload requires {mode} mode. Go to Settings to switch modes and try again.",
            "processing_error": "An error occurred during processing. Check console.",

            "qr_original_too_long": "Original message too long for QR code (500 character limit).",
            "qr_nothing_to_copy": "No QR to copy.",
            "qr_copy_not_supported": "Image copying not supported. Use Save/Share instead.",
            "qr_copied": "QR copied to clipboard!",
            "qr_copy_failed": "Failed to copy QR.",
            "qr_nothing_to_save": "No QR to save.",
            "qr_shared": "QR shared successfully!",
            "qr_downloaded": "QR downloaded!",
            "qr_share_canceled": "Share canceled",
            "qr_share_failed": "Share failed: {error}",
            "qr_process_failed": "Failed to process QR image",
            "qr_nothing_to_view": "No QR to view.",
            "qr_fullscreen": "QR displayed in full screen",
            "qr_generate_first": "No QR Code found. Generate one first!",
            "qr_image_copied": "QR Code image copied to clipboard!",
            "qr_image_copy_error": "Error copying QR Code image.",
            "qr_code_downloaded": "QR Code downloaded!",

            "qr_encrypt_mode_only": "QR Code generation is only available in Encrypt mode.",
            "qr_nothing_to_generate": "Nothing to generate. Please encrypt a message first.",
            "qr_input_too_long": "Input too long for QR code generation. Limit is 500 characters.",

            "qrscanner_not_found": "QR scanner modal not found",
            "qrscanner_start_failed": "Failed to start camera. Please check permissions and try again.",
            "qrscanner_container_not_found": "QR scanner container not found",
            "qrscanner_success": "QR code scanned successfully!",
            "qrscanner_process_error": "Error processing QR code content",
            "qrscanner_access_prefix": "Failed to access camera. ",
            "qrscanner_not_allowed": "Please allow camera access and try again.",
            "qrscanner_no_camera": "No camera found on this device.",
            "qrscanner_in_use": "Camera is being used by another application.",
            "qrscanner_constraints": "Camera constraints not supported.",

            "audio_tx_encrypt_only": "Audio transmission is only available in Encrypt mode.",
            "audio_no_encrypted_msg": "No encrypted message found. Please run encryption first.",
            "audio_reception_stopped": "Audio reception stopped.",
            "audio_received_success": "Audio data received successfully. Mode set to decrypt. Please fill in key/salt fields.",
            "audio_not_cipherbrick": "Audio data received, but not in expected CipherBrick format.",
            "audio_start_failed": "Failed to start audio reception: {error}",
            "audio_refreshing": "🔄 Refreshing audio system to ensure reliability...",
            "audio_refreshed": "🔄 Audio system refreshed - ready to continue!",
            "audio_already_received": "You already received audio. Click \"Refresh Audio System\" to listen again.",

            "audio_timeout": "Audio reception timed out after {seconds}s. Resetting.",
            "audio_assembling": "🔄 Assembling received data...",
            "audio_received_chars": "✅ Successfully received {count} characters!",
            "audio_busy": "Audio is busy. Please wait a moment…",
            "audio_mic_required_tx": "Microphone permission is required for audio transmit.",
            "audio_init_failed": "Audio initialization failed.",
            "audio_transmitting": "Transmitting ({seq}/{total})...",
            "audio_tx_complete": "Audio transmission completed!",
            "audio_tx_failed": "Audio transmission failed: {error}",
            "audio_already_listening": "Already listening…",
            "audio_mic_required_rx": "Microphone permission is required to start receiving.",
            "audio_initializing": "Initializing audio system...",
            "audio_requesting_mic": "Requesting microphone access...",
            "audio_listening": "Listening for audio data… Play the transmission near this device.",
            "audio_all_frames": "Progress: {count}/{total} frames received",
            "audio_assembling_frames": "📦 All frames received, processing...",
            "audio_session_mismatch": "⚠️ Session mismatch detected, restarting reception...",
            "audio_payload_applied": "Audio payload processed and applied! Mode: decrypt, Simple: {stealth}",
            "audio_starting_frames": "🎧 Starting reception: expecting {total} frames...",
            "audio_start_failed_prefix": "Audio reception failed: ",
            "audio_mic_denied": "Microphone permission denied.",
            "audio_no_mic": "No microphone found.",
            "yes": "Yes",
            "no": "No",

            "wizard_keys_ready": "Keys are ready! You can now exchange credentials.",
            "wizard_keys_cleared": "Keys cleared successfully!",
            "wizard_keys_generated": "New key pair generated successfully!",
            "wizard_keys_generate_failed": "Failed to generate keys: {error}",
            "wizard_paste_both_keys": "Please paste both private and public keys",
            "wizard_keys_imported": "Keys imported successfully!",
            "wizard_keys_import_failed": "Failed to import keys. Make sure they are valid ECDH P-256 keys.",
            "wizard_keys_downloaded": "Key pair downloaded! Store it securely.",
            "wizard_cancel_keys": "Cancel",
            "wizard_import_file_label": "Load from file",
            "wizard_import_file_desc": "Select a CipherBrick key export (.json) to auto-fill the fields below, or paste your keys manually.",
            "wizard_file_loaded": "Key file loaded. Review and click Load Keys to confirm.",
            "wizard_file_invalid": "Invalid key file. Please select a valid CipherBrick key export.",
            "wizard_paste_recipient_key": "Please paste the recipient's public key",
            "wizard_share_create_ok": "Share string created successfully!",
            "wizard_share_create_failed": "Failed to create share string: {error}",
            "wizard_paste_share_string_received": "Please paste the share string you received",
            "wizard_invalid_share_format": "Invalid share string format",
            "wizard_paste_sender_key": "Please paste the sender's public key",
            "wizard_share_decrypt_ok": "Share string decrypted successfully!",
            "wizard_share_decrypt_failed": "Failed to decrypt share string. Check that you pasted it correctly and that it was meant for your keys.",
            "wizard_no_credentials": "No credentials available to inject.",
            "wizard_credentials_decrypt_ready": "Credentials injected into CipherBrick! Ready to decrypt messages.",
            "wizard_credentials_encrypt_ready": "Credentials injected into CipherBrick! Ready to encrypt messages.",
            "wizard_copy_failed": "Copy failed",
            "wizard_privkey_copied": "Private key copied! Keep it secure.",
            "wizard_pubkey_copied": "Public key copied! Share this with others.",
            "wizard_pubkey_copied_person": "Your public key copied! Share this with the other person.",
            "wizard_sharestring_copied": "Share string copied! Send this to the recipient.",
            "wizard_aeskey_copied": "Your AES key copied!",
            "wizard_salt_copied": "Your salt copied!",
            "wizard_pubkey_copied_dialog": "Public key copied!",

            "payload_encrypt_only": "Payload generation is only available in Encrypt mode.",
            "payload_no_encrypted": "No encrypted message found. Please run encryption first.",
            "payload_invalid": "Invalid payload. Paste the text string generated by CipherBrick's Payload button.",
            "payload_loaded": "Payload loaded successfully.",

            "settings_hk_toggle": "Enable Hardware Key Mode (Beta)",
            "settings_hk_desc": "Use a FIDO2/WebAuthn hardware security key (YubiKey, Titan, etc.) for encryption",

            "hk_detecting": "🔑 Detecting hardware key…",
            "hk_detected": "✅ Hardware key detected",
            "hk_detected_prf": "🔐 Hardware key active — stable keys enabled",
            "hk_detected_ephemeral": "⚠️ Ephemeral keys — cross-session decryption not supported. On desktop, use Chrome or Edge for stable keys.",
            "hk_not_supported": "FIDO2/WebAuthn is not supported in this browser.",
            "hk_prf_not_supported": "Hardware Key Mode requires PRF support, which is unavailable in this browser. On desktop, use Chrome or Edge. On iOS, use a device passkey instead.",
            "hk_prf_device_not_supported": "This device's passkeys do not support Hardware Key Mode. Update to iOS 17.4+ or the latest Android version, or use a dedicated hardware security key.",
            "hk_error": "Hardware key error: {error}",
            "hk_discovering": "🔍 Looking for existing key… select it if prompted, or cancel to register new.",
            "hk_discovering_platform": "🔍 Looking for existing passkey… select it if prompted, or cancel to register new.",
            "hk_registering": "🔑 Registering… touch your key when prompted",
            "hk_touch_again": "✅ Registered! Touch your key once more to activate…",
            "hk_your_public_key": "Your Public Key",
            "hk_public_key_copied": "Public key copied to clipboard!",
            "hk_recipient_key_label": "Recipient's Public Key",
            "hk_recipient_key_placeholder": "Paste recipient's public key (base64)",
            "hk_sender_key_label": "Sender's Public Key (auto-extracted)",
            "hk_payload_label": "Encrypted Payload (CBHK1)",
            "hk_payload_placeholder": "Paste CBHK1 encrypted payload here…",
            "hk_encrypt_success": "Message encrypted with hardware key!",
            "hk_ephemeral_encrypt_warning": "⚠️ Ephemeral session — this payload can only be decrypted in this browser session. Once you close the tab, the private key is gone. On desktop, use Chrome or Edge for stable cross-session keys.",
            "hk_decrypt_success": "Message decrypted successfully!",
            "hk_invalid_payload": "Invalid payload format — expected a CBHK1 encrypted string.",
            "hk_decrypt_failed": "Decryption failed — wrong key or corrupted payload.",
            "hk_wrong_key": "Wrong hardware key — this message was not encrypted for your key.",
            "hk_no_recipient_key": "Please enter the recipient's public key.",
            "hk_no_message": "Please enter a message to encrypt.",
            "hk_no_payload": "Please paste the encrypted payload to decrypt.",
            "hk_no_private_key": "Hardware key session not initialized. Please detect your key first.",
            "hk_user_cancelled": "Hardware key operation was cancelled.",
            "hk_key_removed": "Hardware key was removed. Please reinsert and retry.",
            "hk_reply_btn": "↩️ Reply (use sender's key)",
            "hk_activate_key": "🔑 Activate Hardware Key",
            "hk_activate_key_desc": "Insert or tap your hardware key, then click to initialize your session for encrypting and decrypting.",
            "hk_choose_title": "Choose Authenticator",
            "hk_choose_subtitle": "How would you like to activate Hardware Key mode?",
            "hk_choose_hardware_label": "Hardware Security Key",
            "hk_choose_hardware_desc": "YubiKey or any FIDO2/WebAuthn security key",
            "hk_choose_device_label": "This Device",
            "hk_choose_device_desc": "Passkey using biometrics, PIN, or screen lock",

            "hkke_option": "Use Hardware Key",
            "hkke_option_desc": "Tap your FIDO2 key for stable, cross-session identity",
            "hkke_activating": "🔑 Activating hardware key…",
            "hkke_active": "🔐 Hardware key active — stable keys loaded",
            "hkke_activation_failed": "Hardware key activation failed: {error}",
            "hkke_no_hw_key": "Please activate your hardware key first",
            "hkke_no_recipient_key": "Please enter the recipient's public key",
            "hkke_no_payload": "Please paste the exchange string",
            "hkke_invalid_payload": "Invalid format — expected a CBHKX1 exchange string",
            "hkke_create_failed": "Failed to create exchange string: {error}",
            "hkke_decrypt_failed": "Failed to extract Key & Salt: {error}",
            "hkke_created_ok": "Exchange string created.",
            "hkke_decrypted_ok": "Key & Salt extracted successfully.",
            "hkke_send_title": "Send Key & Salt",
            "hkke_receive_title": "Receive Key & Salt",
            "hkke_recipient_key_label": "Recipient's Public Key:",
            "hkke_exchange_string_label": "Exchange String (CBHKX1):",
            "hkke_create_btn": "Create Exchange String",
            "hkke_decrypt_btn": "Extract Key & Salt",
            "hkke_auto_extract_note": "Sender's public key is extracted automatically.",
            "placeholder.hkke_recipient_key": "Paste the recipient's public key…",
            "placeholder.hkke_received_string": "Paste the CBHKX1 exchange string here…",

            "mode_label": "Mode",
            "mode_standard": "Standard",
            "mode_simple": "Simple",
            "mode_hkpm": "HKPM",
            "mode_standard_default": "Standard (Default)",
            "mode_hkpm_full": "HKPM (Hardware Key)",
            "settings_security_section": "Timers",
            "settings_timers_desc": "Clears clipboard and ends the session after inactivity.",
            "settings_advanced_section": "Audio",
            "settings_audio_desc": "Protocol used when transmitting encrypted messages via audio.",
            "settings_mode_section": "Mode",
            "settings_help_link": "❓ Help & Documentation",
            "mode_standard_desc": "Key + salt. Both are required for encryption.",
            "mode_simple_desc": "Salt is auto-generated from your key. Only a key is needed.",
            "mode_hkpm_desc": "Encryption requires a FIDO2 hardware security key (e.g. YubiKey).",
            "help_word": "Help",

            "help_svg_plaintext": "plaintext",
            "help_svg_message": "Message",
            "help_svg_secret": "secret",
            "help_svg_key_salt": "Key + Salt",
            "help_svg_key_derivation": "key derivation",
            "help_svg_output": "output",
            "help_svg_hw_key": "Hardware Security Key",
            "help_svg_stable_identity": "stable identity",
            "help_svg_share_openly": "share openly",
            "help_svg_public_key": "Public Key",
            "help_svg_stays_in_hardware": "stays in hardware",
            "help_svg_private_key": "Private Key",
            "help_svg_anyone_encrypt": "anyone can encrypt messages to you",
            "help_svg_only_you_decrypt": "only you decrypt (touch required)",
            "help_svg_keep_secret": "keep secret",
            "help_svg_shared_secret": "Same Shared Secret \u2192 Key + Salt"
        };
    }
}