// /js/modules/session.js
export class SessionModule {
    static idleTimer = null;
    static sessionCountdown = null;

    static resetIdleTimer(UIModule, updateStatusBarCallback, getI18n = () => ({})) {
        clearTimeout(this.idleTimer);
        const minutes = parseInt(document.getElementById("idleTimeout").value) || 5;
        const timeoutMs = minutes * 60 * 1000;

        // Set expiration timestamp globally
        window.sessionExpiresAt = Date.now() + timeoutMs;

        // Schedule actual clearing
        this.idleTimer = setTimeout(() => {
            document.getElementById("key").value = "";
            document.getElementById("salt").value = "";
            document.getElementById("inputText").value = "";
            document.getElementById("outputText").value = "";
            sessionStorage.removeItem("cipherKey");
            sessionStorage.removeItem("cipherSalt");
            const s = getI18n();
            UIModule.showMessage(s.session_expired || "Session expired due to inactivity. All sensitive fields have been cleared.", "warning");
        }, timeoutMs);

        // Live countdown updater
        clearInterval(this.sessionCountdown);
        this.sessionCountdown = setInterval(() => {
            const now = Date.now();
            if (now >= window.sessionExpiresAt) {
                clearInterval(this.sessionCountdown);
                window.sessionExpiresAt = null;
            }
            updateStatusBarCallback();
        }, 1000);
    }

    static initializeIdleTimer(UIModule, updateStatusBarCallback, getI18n = () => ({})) {
        ["click", "mousemove", "keypress", "touchstart"].forEach(evt => {
            document.addEventListener(evt, () => this.resetIdleTimer(UIModule, updateStatusBarCallback, getI18n));
        });

        this.resetIdleTimer(UIModule, updateStatusBarCallback, getI18n);
    }

    static clearSensitiveData() {
        document.getElementById("key").value = "";
        document.getElementById("salt").value = "";
        document.getElementById("inputText").value = "";
        document.getElementById("outputText").value = "";
        sessionStorage.removeItem("cipherKey");
        sessionStorage.removeItem("cipherSalt");
    }

    static initializeSessionSecurity() {
        // Reset stealth mode on refresh for security
        sessionStorage.removeItem("stealthMode");

        // Clear sensitive inputs on load
        this.clearSensitiveData();

        // Reset clipboard modal checkbox state on load
        const skipCheckbox = document.getElementById("skipClipboardModalCheckbox");
        if (skipCheckbox) skipCheckbox.checked = false;
    }
}