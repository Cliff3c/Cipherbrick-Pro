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
                    el.setAttribute('data-original-text', el.innerText);
                }

                const originalText = el.getAttribute('data-original-text');
                const match = originalText.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|[^\w\s])+/u);

                if (match) {
                    // Use original emoji + new translation
                    el.innerText = `${match[0]} ${strings[key]}`;
                } else {
                    // No emoji, just use the translation
                    el.innerText = strings[key];
                }
            } else if (key) {
                console.warn(`[I18n] Missing translation for key: ${key}`);
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
            "audio_tx_tip_label": "Tip:",
            "audio_tx_tip_desc": "If \"Fastest\" modes are silent or slow, try \"Fast\" modes instead. Hardware capabilities vary between devices.",
            "save_settings": "Save Settings",
            "reset_settings": "Restore Defaults",
            "help_title": "Help & About",
            "help_intro_title": "CipherBrick Pro",
            "help_intro_desc": "is a secure, offline encryption tool designed for privacy-first communication.",
            "help_algo_label": "Encryption:",
            "help_algo_desc": "AES-256-GCM (military-grade, with built-in tamper detection)",
            "help_model_label": "Security Model:",
            "help_model_desc": "Nothing is stored or sent — all encryption happens locally in your browser or mobile app",
            "help_responsibility_label": "Your Responsibility:",
            "help_responsibility_desc": "If you lose your key or salt, messages cannot be recovered",
            "help_clipboard_label": "Clipboard Auto-Clear:",
            "help_clipboard_desc": "Sensitive data is cleared after a timer expires",
            "help_qr_limit_label": "QR Code Limit:",
            "help_qr_limit_desc": "Long messages may not fit — character limit enforced for compatibility",
            "help_final_note": "To decrypt a message, the recipient must use the exact same key and salt. CipherBrick does not store or recover lost values.",
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
            "clipboard_wiped": "Clipboard cleared. Ephemeral key-exchange data wiped.",

            "session_expired": "Session expired due to inactivity. All sensitive fields have been cleared.",

            "settings_saved": "Settings saved and will persist across sessions.",
            "settings_reset_done": "Settings reset to default values.",

            "encrypt_complete": "Encryption complete.",
            "decrypt_successful": "Decryption successful.",
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
            "audio_payload_applied": "Audio payload processed and applied! Mode: decrypt, Stealth: {stealth}",
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
            "payload_loaded": "Payload loaded successfully."
        };
    }
}