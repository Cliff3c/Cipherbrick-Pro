// /js/modules/clipboard.js
export class ClipboardModule {
    static async copyToClipboard(text, UIModule, updateStatusBarCallback, i18nStrings = {}) {
        // If called from a click event, use the default output field.
        if (text instanceof Event || typeof text !== "string" || !text.trim()) {
            text = document.getElementById("outputText").value;
        }

        if (!text) {
            UIModule.showMessage(i18nStrings.clipboard_nothing_to_copy || "Nothing to copy. The output field is empty.", "warning");
            return;
        }

        const timeoutSec = parseInt(document.getElementById("clipboardTimeout").value) || 30;
        const autoClearMs = timeoutSec * 1000;

        try {
            // Use Clipboard API if available.
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                // Fallback for older browsers.
                const tempInput = document.createElement("textarea");
                tempInput.value = text;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand("copy");
                document.body.removeChild(tempInput);
            }

            const copiedMsg = (i18nStrings.clipboard_copied_seconds || "Copied! Clipboard will be cleared in {seconds} seconds.").replace('{seconds}', timeoutSec);
            UIModule.showMessage(copiedMsg, "info");

            // Set expiration timestamp globally
            window.clipboardExpiresAt = Date.now() + autoClearMs;

            if (window.clipboardCountdown) clearInterval(window.clipboardCountdown);

            window.clipboardCountdown = setInterval(() => {
                const now = Date.now();
                const remainingMs = window.clipboardExpiresAt - now;

                if (remainingMs <= 0) {
                    clearInterval(window.clipboardCountdown);
                    window.clipboardExpiresAt = null;
                    updateStatusBarCallback();

                    // Handle clipboard clearing async
                    this.handleClipboardClearTimeout(UIModule, i18nStrings);
                }

                updateStatusBarCallback();
            }, 1000);
        } catch (err) {
            console.error("Copy failed", err);
            UIModule.showMessage(i18nStrings.clipboard_copy_error || "Error copying to clipboard.", "danger");
        }
    }

    static async handleClipboardClearTimeout(UIModule, i18nStrings = {}) {
        const skipModal = sessionStorage.getItem("skipClipboardModal") === "true";

        if (skipModal) {
            try {
                await navigator.clipboard.writeText("");
            } catch (e) {
                console.warn("Auto clipboard clear failed", e);
            }

            // mark timer inactive and update UI
            window.clipboardExpiresAt = null;
            if (typeof UIModule?.updateStatusBar === 'function') {
                // assuming your status bar reads clipboardExpiresAt
                UIModule.updateStatusBar(window.clipboardExpiresAt, window.sessionExpiresAt);
            }

            // fire one event
            try { window.dispatchEvent(new CustomEvent('cb:clipboard-cleared')); } catch { }
            return; // IMPORTANT: stop here
        }

        // Show blocking modal; do NOT clear yet.
        const modalEl = document.getElementById("clipboardClearModal");
        const modal = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl, {
            backdrop: 'static',
            keyboard: false
        });
        modal.show();
    }

    static async clearClipboardManually(UIModule, i18nStrings = {}) {
        try {
            await navigator.clipboard.writeText("");
            UIModule.showMessage(i18nStrings.clipboard_manually_cleared || "Clipboard manually cleared.", "info");
        } catch (err) {
            console.error("Manual clipboard clear failed", err);
            UIModule.showMessage(i18nStrings.clipboard_clear_failed || "Clipboard could not be cleared. Try copying something else.", "danger");
        }

        // Save checkbox preference
        const checkbox = document.getElementById("skipClipboardModalCheckbox");
        if (checkbox && checkbox.checked) {
            sessionStorage.setItem("skipClipboardModal", "true");
        }

        // Close modal
        const modalEl = document.getElementById("clipboardClearModal");
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();

        window.clipboardExpiresAt = null;
        if (typeof UIModule?.updateStatusBar === 'function') {
            UIModule.updateStatusBar(window.clipboardExpiresAt, window.sessionExpiresAt, i18nStrings);
        }
        try { window.dispatchEvent(new CustomEvent('cb:clipboard-cleared')); } catch { }

    }
}
