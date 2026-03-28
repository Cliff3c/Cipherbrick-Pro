// /js/modules/qrmodal.js

import { UIModule } from './ui.js';
import { QRModule } from './qr.js';

/**
 * QRModalModule - Handles QR code modal display, scanning, and native image sharing
 *
 * Features:
 * - Modal-based QR code scanner using html5-qrcode
 * - Native image viewer for Capacitor apps
 * - QR code sharing (save/share) with platform-specific handling
 * - Automatic payload parsing for CipherBrick QR codes
 */
export class QRModalModule {
    constructor(app) {
        this.app = app;

        // QR modal scanner state
        this._qr = {
            html5: null,             // html5-qrcode instance
            modal: null,             // bootstrap Modal instance
            isOpen: false,
            isRunning: false
        };
    }

    get i18n() { return this.app?.i18nStrings || {}; }

    // ============ UTILITY FUNCTIONS ============

    getCap() {
        return window.Capacitor || {};
    }

    isNativeEnv() {
        const Cap = window.Capacitor;
        if (!Cap) {
            return false;
        }

        try {
            if (typeof Cap.isNativePlatform === 'function') {
                return Cap.isNativePlatform();
            }
            const plat = (typeof Cap.getPlatform === 'function') ? Cap.getPlatform() : Cap.platform;
            return plat === 'android' || plat === 'ios';
        } catch (e) {
            return false;
        }
    }

    getFilesystem() {
        const Cap = this.getCap();
        return Cap.Filesystem || Cap.Plugins?.Filesystem;
    }

    getShare() {
        const Cap = this.getCap();
        return Cap.Share || Cap.Plugins?.Share;
    }

    isDataUrl(str) {
        return typeof str === 'string' && str.startsWith('data:image/');
    }

    dataUrlToBase64(dataUrl) {
        // Extract "AAAA..." from "data:image/png;base64,AAAA..."
        return dataUrl.split(',')[1] ?? '';
    }

    // ============ IMAGE VIEWER ============

    showInAppImageViewer(dataUrl) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position:fixed; inset:0; background:#818080; z-index:99999;
            display:flex; align-items:center; justify-content:center; padding:20px;
        `;

        const container = document.createElement('div');
        container.style.cssText = `
            position:relative; max-width:calc(100vw - 40px); max-height:calc(100vh - 40px);
            display:flex; flex-direction:column; align-items:center;
        `;

        // Close button ABOVE the QR code
        const close = document.createElement('button');
        close.textContent = '✕ Close';
        close.style.cssText = `
            margin-bottom:15px; border:none; border-radius:8px;
            padding:12px 20px; background:#333; color:#fff; font-weight:600; font-size:16px;
            cursor:pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            align-self:flex-end;
        `;
        close.onclick = () => document.body.removeChild(overlay);

        const qrContainer = document.createElement('div');
        qrContainer.style.cssText = `
            background:#ffffff; border-radius:12px; padding:20px;
            box-shadow:0 10px 40px rgba(0,0,0,.5);
        `;

        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'QR Code';
        img.style.cssText = `
            display:block; max-width:calc(100vw - 120px); max-height:calc(100vh - 200px);
            width:auto; height:auto;
        `;

        qrContainer.appendChild(img);
        container.appendChild(close);
        container.appendChild(qrContainer);
        overlay.appendChild(container);

        // Background click and escape key handlers
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close.click();
        });

        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                close.click();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);

        document.body.appendChild(overlay);
    }

    // ============ NATIVE IMAGE SHARING ============

    async verifyPNGFile(filename, directory = 'EXTERNAL') {
        try {
            const Filesystem = this.getFilesystem();

            const fileContent = await Filesystem.readFile({
                directory: directory,
                path: filename,
                encoding: 'base64'
            });

            // Verify PNG signature
            const binaryString = atob(fileContent.data.substring(0, 16));
            const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
            const actualBytes = Array.from(binaryString.substring(0, 8)).map(char => char.charCodeAt(0));
            const isValidPNG = pngSignature.every((byte, index) => byte === actualBytes[index]);

            return isValidPNG;

        } catch (err) {
            console.error('PNG verification failed:', err);
            return false;
        }
    }

    async shareImageNative(base64DataUrl) {
        const Cap = this.getCap();

        // Manually register the plugin if not already available
        let ImageShare = Cap.Plugins?.ImageShare;

        if (!ImageShare) {

            // Try using registerPlugin if available
            if (typeof Cap.registerPlugin === 'function') {
                try {
                    ImageShare = Cap.registerPlugin('ImageShare', {
                        web: () => ({
                            shareBase64Image: async () => {
                                throw new Error('Web implementation not available');
                            }
                        })
                    });
                } catch (regErr) {
                    console.error('registerPlugin failed:', regErr);
                }
            }
        }

        if (!ImageShare) {
            throw new Error('Native ImageShare plugin not available - registration failed');
        }

        try {
            const result = await ImageShare.shareBase64Image({
                base64: base64DataUrl,
                title: 'CipherBrick QR Code'
            });
            return true;
        } catch (err) {
            console.error('Native share failed:', err);
            throw err;
        }
    }

    // ============ MODAL BUTTON SETUP ============

    setupQRModalButtons() {
        const native = this.isNativeEnv();
        const copyBtn = document.getElementById('qrModalCopy');
        const saveBtn = document.getElementById('qrModalSave');
        const buttonGroup = document.querySelector('#qrModal .btn-group');

        if (native) {
            // CAPACITOR: Hide copy button completely
            if (copyBtn) {
                copyBtn.style.display = 'none';
            }

            // Change Save button text to "Share" for mobile
            if (saveBtn) {
                saveBtn.textContent = 'Share';
            }

            // Adjust layout for fewer buttons
            if (buttonGroup) {
                buttonGroup.style.gap = '12px';
                buttonGroup.style.justifyContent = 'center';
            }

                    } else {
            // BROWSER: Show all buttons with original names
            if (copyBtn) {
                copyBtn.style.display = 'block';
            }
            if (saveBtn) {
                saveBtn.textContent = 'Save'; // Ensure it says "Save" in browser
            }
                    }
    }

    // ============ QR MODAL SCANNER ============

    openQRModal() {
        if (!this._qr.modal) {
            const el = document.getElementById('qrScanModal');
            if (!el) {
                console.warn('qrScanModal not found');
                UIModule.showMessage(this.i18n.qrscanner_not_found || 'QR scanner modal not found', 'danger');
                return;
            }
            this._qr.modal = bootstrap.Modal.getOrCreateInstance(el, { backdrop: 'static', keyboard: false });

            // Clean up when modal is hidden
            el.addEventListener('hidden.bs.modal', () => {
                this.stopQRModalScan();
                this._qr.isOpen = false;
            });
        }

        this._qr.modal.show();
        this._qr.isOpen = true;

        // Prepare the container with mobile-friendly sizing
        const body = document.getElementById('qrScanModalBody');
        if (body) {
            body.innerHTML = `
            <div id="qr-reader-modal" style="width:100%; max-height:60vh; overflow:hidden;"></div>
            <div class="text-center mt-2">
                <small class="text-muted">Point camera at QR code to scan automatically</small>
            </div>
        `;
        }

        // Start scanning automatically with a small delay
        setTimeout(() => {
            this.startQRModalScan().catch(err => {
                console.error('Failed to start QR scanner:', err);
                UIModule.showMessage(this.i18n.qrscanner_start_failed || 'Failed to start camera. Please check permissions and try again.', 'danger');
                this.closeQRModal();
            });
        }, 500);
    }

    async startQRModalScan() {
        if (this._qr.isRunning) {
            return;
        }

        const targetId = 'qr-reader-modal';
        const container = document.getElementById(targetId);
        if (!container) {
            console.error('QR container not found');
            UIModule.showMessage(this.i18n.qrscanner_container_not_found || 'QR scanner container not found', 'danger');
            return;
        }

        // Stop any existing scanner
        if (this._qr.html5) {
            try {
                await this._qr.html5.stop();
                this._qr.html5.clear();
            } catch (e) {
                console.warn('Error stopping previous scanner:', e);
            }
        }

        // Create new scanner instance
        this._qr.html5 = new Html5Qrcode(targetId, { verbose: false });

        const onSuccess = (decodedText) => {
            try {
                const stealth = sessionStorage.getItem('stealthMode') === 'true';
                let processedText = decodedText;

                // Try to parse as CipherBrick payload
                try {
                    if (QRModule.parsePayload) {
                        const parsed = QRModule.parsePayload(decodedText, stealth);
                        if (parsed && parsed.payload) {
                            processedText = parsed.payload;
                        }
                    }
                } catch (parseError) {
                    console.warn('Failed to parse as new format, trying old format:', parseError);
                }

                // Fallback to old parsing method
                if (processedText === decodedText && QRModule.parseCipherBrickQR) {
                    try {
                        const parsed = QRModule.parseCipherBrickQR(decodedText);
                        if (parsed && parsed.payload) {
                            processedText = parsed.payload;
                            // Handle stealth mode from old format — sync mode dropdown and storage
                            if (parsed.stealth) {
                                sessionStorage.setItem("stealthMode", "true");
                                localStorage.setItem("cb.simplifiedMode", "true");
                                localStorage.setItem("cb.hardwareKeyMode", "false");
                                const modeSelect = document.getElementById("modeSelect");
                                if (modeSelect) modeSelect.value = "simple";
                            } else {
                                sessionStorage.setItem("stealthMode", "false");
                                localStorage.setItem("cb.simplifiedMode", "false");
                                const modeSelect = document.getElementById("modeSelect");
                                if (modeSelect && modeSelect.value === "simple") modeSelect.value = "standard";
                            }
                            UIModule.updateStealthUI();
                        }
                    } catch (parseError2) {
                        console.warn('Failed to parse as old format too:', parseError2);
                    }
                }

                // Set the processed text in the input field
                const inputEl = document.getElementById('inputText');
                if (inputEl) {
                    inputEl.value = processedText;
                }

                // Switch to decrypt mode if not already
                if (this.app.currentMode !== 'decrypt') {
                    this.app.setMode('decrypt');
                }

                // Close the modal automatically on successful scan
                this.closeQRModal();

                // Focus on the key field for user convenience
                setTimeout(() => {
                    document.getElementById('key')?.focus();
                }, 100);

                UIModule.showMessage(this.i18n.qrscanner_success || 'QR code scanned successfully!', 'success', 3000);
            } catch (error) {
                console.error('Error processing QR code:', error);
                UIModule.showMessage(this.i18n.qrscanner_process_error || 'Error processing QR code content', 'danger');
            }
        };

        const onError = (errorMessage) => {
            // Only log significant errors, ignore "No QR code found" messages
            if (!errorMessage.includes('No QR code found') && !errorMessage.includes('NotFoundException')) {
                console.warn('QR scanning error:', errorMessage);
            }
        };

        // Mobile-optimized scan config
        const scanConfig = {
            fps: 10,
            qrbox: function (viewfinderWidth, viewfinderHeight) {
                // Make QR box responsive to screen size
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                const qrboxSize = Math.floor(minEdge * 0.7); // 70% of the smaller dimension
                return {
                    width: qrboxSize,
                    height: qrboxSize,
                };
            },
            aspectRatio: 1.0
        };

        try {
            // Try to get cameras and prefer back camera
            const cameras = await Html5Qrcode.getCameras();
            let selectedCamera = null;

            if (cameras && cameras.length > 0) {
                // Look for back/rear camera first
                selectedCamera = cameras.find(camera =>
                    /back|rear|environment/i.test(camera.label)
                ) || cameras[0]; // fallback to first camera

                await this._qr.html5.start(selectedCamera.id, scanConfig, onSuccess, onError);
            } else {
                // Fallback to constraint-based approach
                await this._qr.html5.start(
                    { facingMode: "environment" },
                    scanConfig,
                    onSuccess,
                    onError
                );
            }

            this._qr.isRunning = true;

            // Apply mobile-friendly styles after camera starts
            setTimeout(() => {
                const videoEl = document.querySelector("#qr-reader-modal video");
                if (videoEl) {
                    videoEl.style.width = "100%";
                    videoEl.style.height = "auto";
                    videoEl.style.maxHeight = "50vh";
                    videoEl.style.objectFit = "cover";
                    videoEl.style.borderRadius = "8px";
                }
                // Style the scan region
                const scanRegion = document.querySelector("#qr-reader-modal__scan_region");
                if (scanRegion) {
                    scanRegion.style.maxHeight = "50vh";
                }
            }, 1000);

        } catch (error) {
            console.error('Failed to start QR scanner:', error);
            const s = this.i18n;
            let errorMessage = s.qrscanner_access_prefix || 'Failed to access camera. ';

            switch (error.name) {
                case 'NotAllowedError':
                    errorMessage += s.qrscanner_not_allowed || 'Please allow camera access and try again.';
                    break;
                case 'NotFoundError':
                    errorMessage += s.qrscanner_no_camera || 'No camera found on this device.';
                    break;
                case 'NotReadableError':
                    errorMessage += s.qrscanner_in_use || 'Camera is being used by another application.';
                    break;
                case 'OverconstrainedError':
                    errorMessage += s.qrscanner_constraints || 'Camera constraints not supported.';
                    break;
                default:
                    errorMessage += error.message;
            }

            UIModule.showMessage(errorMessage, 'danger');
            this.closeQRModal();
        }
    }

    async stopQRModalScan() {
        if (this._qr.html5 && this._qr.isRunning) {
            try {
                await this._qr.html5.stop();
            } catch (error) {
                console.warn('Error stopping QR scanner:', error);
            }
        }
        if (this._qr.html5) {
            try {
                this._qr.html5.clear();
            } catch (error) {
                console.warn('Error clearing QR scanner:', error);
            }
            this._qr.html5 = null;
        }
        this._qr.isRunning = false;
    }

    closeQRModal() {
        // Stop the scanner first
        this.stopQRModalScan();

        // Hide the modal
        if (this._qr.modal) {
            try {
                this._qr.modal.hide();
            } catch (error) {
                console.warn('Error hiding QR modal:', error);
            }
        }
        this._qr.isOpen = false;
    }
}
