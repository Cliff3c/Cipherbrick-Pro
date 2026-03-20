// /js/script.js - Final simplified version
import { CipherBrickApp } from './modules/app.js';

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    const app = new CipherBrickApp();
    window.app = app;
    await app.initialize();
});