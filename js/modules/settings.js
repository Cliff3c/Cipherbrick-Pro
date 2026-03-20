// /js/modules/settings.js
export class SettingsModule {
    static defaultSettings = {
        clipboardTimeout: 30,
        idleTimeout: 5,
        stealthMode: false
    };

    static loadSettings() {
        const stored = localStorage.getItem("cipherbrickSettings");
        const settings = stored ? JSON.parse(stored) : this.defaultSettings;

        const clipboardTimeoutEl = document.getElementById("clipboardTimeout");
        const idleTimeoutEl = document.getElementById("idleTimeout");
        const stealthToggleEl = document.getElementById("stealthModeToggle");

        if (clipboardTimeoutEl) clipboardTimeoutEl.value = settings.clipboardTimeout;
        if (idleTimeoutEl) idleTimeoutEl.value = settings.idleTimeout;
        if (stealthToggleEl) stealthToggleEl.checked = settings.stealthMode;

        sessionStorage.setItem("stealthMode", settings.stealthMode.toString());
        
        return settings;
    }

    static saveSettings() {
        const clipboardTimeoutEl = document.getElementById("clipboardTimeout");
        const idleTimeoutEl = document.getElementById("idleTimeout");
        const stealthToggleEl = document.getElementById("stealthModeToggle");

        const settings = {
            clipboardTimeout: parseInt(clipboardTimeoutEl?.value) || 30,
            idleTimeout: parseInt(idleTimeoutEl?.value) || 5,
            stealthMode: stealthToggleEl?.checked || false
        };

        localStorage.setItem("cipherbrickSettings", JSON.stringify(settings));
        return settings;
    }

    static resetSettings() {
        localStorage.removeItem("cipherbrickSettings");
        return this.loadSettings();
    }

    static closeSettingsModal() {
        const settingsModalEl = document.getElementById("settingsModal");
        const settingsModal = bootstrap.Modal.getInstance(settingsModalEl);
        if (settingsModal) settingsModal.hide();
    }
}