// /js/modules/ui.js
export class UIModule {
    static updateModeUI(currentMode) {
        const encryptBtn = document.getElementById("encryptBtn");
        const decryptBtn = document.getElementById("decryptBtn");
        const runBtn = document.getElementById("processButton");

        if (!encryptBtn || !decryptBtn || !runBtn) {
            console.warn("updateModeUI(): Required elements not found.");
            return;
        }

        // Remove all styling first
        encryptBtn.className = "btn";
        decryptBtn.className = "btn";

        if (currentMode === "encrypt") {
            encryptBtn.classList.add("btn-success", "mode-button-active");
            decryptBtn.classList.add("btn-outline-secondary");
        } else {
            decryptBtn.classList.add("btn-success", "mode-button-active");
            encryptBtn.classList.add("btn-outline-secondary");
        }
    }

    static showMessage(message, type = "info", duration = 5000) {
        const box = document.getElementById("messageBox");

        // Clear any existing timeout
        if (box.dismissTimeout) {
            clearTimeout(box.dismissTimeout);
            box.dismissTimeout = null;
        }

        // Reset classes and content
        box.className = `alert alert-${type} mt-2 fade show`;
        box.textContent = message;
        box.classList.remove("d-none");

        // Auto-dismiss if duration is set
        if (duration > 0) {
            box.dismissTimeout = setTimeout(() => {
                box.classList.remove("show");
                setTimeout(() => {
                    box.classList.add("d-none");
                }, 300); // Allow fade out
            }, duration);
        }
    }

    static updateKeyStrengthUI(result, i18nStrings) {
        const strengthText = document.getElementById("keyStrengthText");
        const strengthBar = document.getElementById("keyStrengthBar");

        if (!strengthText || !strengthBar) return;

        // Reset bar classes
        strengthBar.classList.remove("weak", "moderate", "strong");

        let strength = result.strength;
        if (strength === "–") {
            strengthBar.classList.add("weak");
        } else if (strength === "Weak") {
            strengthBar.classList.add("weak");
        } else if (strength === "Moderate") {
            strengthBar.classList.add("moderate");
        } else {
            strengthBar.classList.add("strong");
        }

        strengthText.setAttribute("data-i18n", `strength_${strength.toLowerCase()}`);
        strengthText.textContent = i18nStrings[`strength_${strength.toLowerCase()}`] || strength;

        strengthBar.style.width = `${result.percent}%`;
    }

    static updateStealthUI() {
        const stealthEnabled = sessionStorage.getItem("stealthMode") === "true";
        const saltField = document.getElementById("salt").parentElement;
        // Hardware Key Mode hides the salt field itself — don't override it
        if (localStorage.getItem('cb.hardwareKeyMode') === 'true') {
            saltField.style.display = 'none';
            return;
        }
        saltField.style.display = stealthEnabled ? "none" : "block";
    }

    static updateInputCharacterCount(inputLength, currentMode) {
        const charCountEl = document.getElementById("inputCharCount");
        const qrLimitNote = document.getElementById("qrLimitNote");

        if (!charCountEl || !qrLimitNote) return;

        charCountEl.textContent = inputLength;

        if (inputLength > 500 && currentMode === "encrypt") {
            charCountEl.classList.add("text-danger");
            qrLimitNote.style.display = "block";
        } else {
            charCountEl.classList.remove("text-danger");
            qrLimitNote.style.display = "none";
        }
    }

    static switchToTab(tabName) {
        const tabInput = document.getElementById("tabInput");
        const tabOutput = document.getElementById("tabOutput");
        const inputContainer = document.getElementById("inputTextContainer");
        const outputContainer = document.getElementById("outputTextContainer");

        if (!tabInput || !tabOutput || !inputContainer || !outputContainer) return;

        if (tabName === "input") {
            inputContainer.style.display = "block";
            outputContainer.style.display = "none";
        } else if (tabName === "output") {
            inputContainer.style.display = "none";
            outputContainer.style.display = "block";
        }
    }

    static updateQRButtons() {
        const hasOutput = document.getElementById("outputText").value.trim() !== "";

        const toggleBtn = (btnId, shouldEnable) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            btn.disabled = !shouldEnable;
            btn.classList.toggle("disabled", !shouldEnable);
        };

        toggleBtn("generateQRButton", hasOutput);
        toggleBtn("copyQRButton", false); // Always disabled until QR is generated
        toggleBtn("saveQRButton", false);
        toggleBtn("openQRTabButton", false);
    }

    static clearForm(suppressMessage = false, keepKeySalt = false, i18nStrings = {}) {
        if (!keepKeySalt) {
            document.getElementById("key").value = "";
            document.getElementById("salt").value = "";
            sessionStorage.removeItem("cipherKey");
            sessionStorage.removeItem("cipherSalt");
        }

        document.getElementById("inputText").value = "";
        document.getElementById("outputText").value = "";
        document.getElementById("inputLabel").textContent = "Message to Encrypt:";

        // Clear any generated QR code
        const qrContainer = document.getElementById("qrOutput");
        if (qrContainer) qrContainer.innerHTML = "";

        // Disable QR buttons for safety
        const generateBtn = document.getElementById("generateQRButton");
        const copyBtn = document.getElementById("copyQRButton");
        if (generateBtn) generateBtn.disabled = true;
        if (copyBtn) copyBtn.disabled = true;

        this.updateQRButtons();

        // Always show input tab for clarity
        this.switchToTab("input");

        if (!suppressMessage) {
            this.showMessage(i18nStrings["form_cleared"] || "All form fields have been cleared.", "info");
        }

        // Reset character counter and QR warning
        const charCount = document.getElementById("inputCharCount");
        const qrNote = document.getElementById("qrLimitNote");
        if (charCount) {
            charCount.textContent = "0";
            charCount.classList.remove("text-danger");
        }
        if (qrNote) qrNote.style.display = "none";

        // Reset key strength indicator (text, width, color, aria, classes)
        const strengthText = document.getElementById('keyStrengthText');
        const strengthBar = document.getElementById('keyStrengthBar');

        if (strengthText) strengthText.textContent = '–';

        if (strengthBar) {
            // width / value
            strengthBar.style.width = '0%';
            strengthBar.setAttribute('aria-valuenow', '0');

            // remove any strength classes your updater may add
            strengthBar.classList.remove('bg-success', 'bg-warning', 'bg-danger');

            // reset inline color to the neutral gray you use initially
            // (matches your markup: style="background-color: #6c757d")
            strengthBar.style.backgroundColor = '#6c757d';
        }
    }

    static updateStatusBar(clipboardExpiresAt, sessionExpiresAt, i18nStrings) {
        const bar = document.getElementById("statusBar");
        if (!bar) return;

        const now = Date.now();
        const clearRemaining = clipboardExpiresAt ? Math.max(0, Math.ceil((clipboardExpiresAt - now) / 1000)) : null;
        const sessionRemaining = sessionExpiresAt ? Math.max(0, Math.ceil((sessionExpiresAt - now) / 1000)) : null;

        const formatTime = (seconds) => {
            if (seconds === null) return "-";
            const m = Math.floor(seconds / 60);
            const s = seconds % 60;
            return m > 0 ? `${m}m ${s}s` : `${s}s`;
        };

        // Determine active mode: HKPM > Simple > Standard
        let modeName;
        if (localStorage.getItem('cb.hardwareKeyMode') === 'true') {
            modeName = i18nStrings['mode_hkpm'] || 'HKPM';
        } else if (sessionStorage.getItem('stealthMode') === 'true') {
            modeName = i18nStrings['mode_simple'] || 'Simple';
        } else {
            modeName = i18nStrings['mode_standard'] || 'Standard';
        }

        const clearLabel = i18nStrings["ClearLabel"] || "Clear";
        const idleLabel = i18nStrings["IdleLabel"] || "Idle";
        const modeLabel = i18nStrings['mode_label'] || 'Mode';

        bar.textContent = `${clearLabel}: ${formatTime(clearRemaining)} | ${idleLabel}: ${formatTime(sessionRemaining)} | ${modeLabel}: ${modeName}`;
    }

    static updateContextActions(currentMode, hasProcessed) {
        // Hide all context sections first
        const sections = document.querySelectorAll('.context-section');
        sections.forEach(el => el.style.display = 'none');

        // Show appropriate section based on mode and state
        if (currentMode === 'encrypt') {
            if (hasProcessed) {
                const section = document.getElementById('encryptAfterActions');
                if (section) section.style.display = 'block';
            } else {
                const section = document.getElementById('encryptBeforeActions');
                if (section) section.style.display = 'block';
            }
        } else { // decrypt mode
            if (hasProcessed) {
                const section = document.getElementById('decryptAfterActions');
                if (section) section.style.display = 'block';
            } else {
                const section = document.getElementById('decryptBeforeActions');
                if (section) section.style.display = 'block';
            }
        }
    }

    static resetContextUI() {
        // Hide all scanner/input areas
        const qrScanner = document.getElementById('qrScanner');
        const payloadInput = document.getElementById('payloadInputArea');
        const audioReceiver = document.getElementById('audioReceiver');
        const qrActions = document.getElementById('qrActions');

        if (qrScanner) qrScanner.style.display = 'none';
        if (payloadInput) payloadInput.style.display = 'none';
        if (audioReceiver) audioReceiver.style.display = 'none';
        if (qrActions) qrActions.style.display = 'none';
    }

    static updateQRPreview(qrImageSrc) {
        const qrPreview = document.getElementById('qrPreview');
        if (qrPreview && qrImageSrc) {
            qrPreview.innerHTML = `<img src="${qrImageSrc}" width="200" height="200" alt="Generated QR Code" style="border: 2px solid #ccc; border-radius: 8px;">`;
        }
    }
}