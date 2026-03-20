// /js/modules/qr.js

export class QRModule {
    static parseCipherBrickQR(text) {
        if (!text.startsWith("CipherBrick|")) return null;

        const parts = text.split("|");
        if (parts.length < 3) return null;

        const mode = parts[1].toLowerCase();
        let stealth = false;
        let payload = "";

        if (parts[2].toLowerCase() === "stealth") {
            stealth = true;
            payload = parts.slice(3).join("|");
        } else {
            payload = parts.slice(2).join("|");
        }

        if (!["encrypt", "decrypt"].includes(mode)) return null;
        return { mode, payload, stealth };
    }

    static generateQRCodePNG(text, callback) {
        const tmpDiv = document.createElement("div");
        tmpDiv.style.position = "absolute";
        tmpDiv.style.left = "-9999px";
        tmpDiv.style.visibility = "hidden";
        document.body.appendChild(tmpDiv);

        const size = 448;
        const padding = 20;

        const qr = new QRCode(tmpDiv, {
            text: text,
            width: size,
            height: size,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });

        setTimeout(() => {
            try {
                const canvas = tmpDiv.querySelector("canvas");
                if (!canvas) throw new Error("Canvas not found");

                const paddedSize = size + padding * 2;
                const paddedCanvas = document.createElement("canvas");
                paddedCanvas.width = paddedSize;
                paddedCanvas.height = paddedSize;
                const ctx = paddedCanvas.getContext("2d");

                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, paddedSize, paddedSize);
                ctx.drawImage(canvas, padding, padding, size, size);

                const dataURL = paddedCanvas.toDataURL("image/png");
                callback(dataURL);
            } catch (err) {
                console.error("❌ QR code PNG generation failed:", err);
            } finally {
                document.body.removeChild(tmpDiv);
            }
        }, 300);
    }

    static generateQRCodeSVG(text, containerId) {
        const qrContainer = document.getElementById(containerId);
        qrContainer.innerHTML = "";

        new QRCode(qrContainer, {
            text: text,
            width: 320,
            height: 320,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H,
            render: "svg"
        });

        setTimeout(() => {
            const svg = qrContainer.querySelector("svg");
            if (svg) {
                svg.setAttribute("aria-label", "QR Code SVG");
            }
        }, 100);
    }

    static showQRPreview() {
        document.getElementById("qrPreviewHeader").style.display = "block";
        document.getElementById("qrPreviewFooter").style.display = "block";
        document.getElementById("qrOutput").style.display = "flex";
    }

    static hideQRPreview() {
        document.getElementById("qrPreviewHeader").style.display = "none";
        document.getElementById("qrPreviewFooter").style.display = "none";
        document.getElementById("qrOutput").style.display = "none";
        document.getElementById("qrOutput").innerHTML = "";
    }

    static createQRPayload(mode, encryptedText, stealthMode) {
        return stealthMode
            ? `CipherBrick|${mode}|stealth|${encryptedText}`
            : `CipherBrick|${mode}|${encryptedText}`;
    }

    static generateQRCode(currentMode, UIModule, i18nStrings = {}) {
        if (document.getElementById("inputText").value.length > 500) {
            UIModule.showMessage(i18nStrings.qr_input_too_long || "Input too long for QR code generation. Limit is 500 characters.", "warning");

            const qrModalEl = document.getElementById("qrModal");
            const qrModal = bootstrap.Modal.getInstance(qrModalEl) || new bootstrap.Modal(qrModalEl);
            if (qrModal) qrModal.hide();

            return;
        }

        if (currentMode !== "encrypt") {
            UIModule.showMessage(i18nStrings.qr_encrypt_mode_only || "QR Code generation is only available in Encrypt mode.", "warning");
            return;
        }

        const encryptedText = document.getElementById("outputText").value;
        const generateBtn = document.getElementById("generateQRButton");
        const copyBtn = document.getElementById("copyQRButton");
        const saveBtn = document.getElementById("saveQRButton");
        const openBtn = document.getElementById("openQRTabButton");
        const qrContainer = document.getElementById("qrOutput");

        const disableButtons = () => {
            [generateBtn, copyBtn, saveBtn, openBtn].forEach(btn => {
                if (btn) {
                    btn.disabled = true;
                    btn.classList.add("disabled");
                }
            });
        };

        const enableButtons = () => {
            [generateBtn, copyBtn, saveBtn, openBtn].forEach(btn => {
                if (btn) {
                    btn.disabled = false;
                    btn.classList.remove("disabled");
                }
            });
        };

        if (!encryptedText) {
            UIModule.showMessage(i18nStrings.qr_nothing_to_generate || "Nothing to generate. Please encrypt a message first.", "warning");
            disableButtons();
            return;
        }

        const stealth = sessionStorage.getItem("stealthMode") === "true";
        const qrPayload = this.createQRPayload(currentMode, encryptedText, stealth);
        qrContainer.innerHTML = "";

        const qrMode = sessionStorage.getItem("qrMode") || "png";

        if (qrMode === "svg") {
            this.generateQRCodeSVG(qrPayload, "qrOutput");
            this.showQRPreview();
            enableButtons();
        } else {
            this.generateQRCodePNG(qrPayload, (imgSrc) => {
                const imgEl = document.createElement("img");
                imgEl.src = imgSrc;
                imgEl.onload = () => {
                    imgEl.style.maxWidth = "90vw";
                    imgEl.style.maxHeight = "90vw";
                    imgEl.style.width = "100%";
                    imgEl.style.height = "auto";
                    imgEl.style.display = "block";
                    imgEl.style.margin = "0 auto 1rem auto";
                    imgEl.classList.add("fade-in");
                };

                qrContainer.appendChild(imgEl);
                this.showQRPreview();
                enableButtons();
            });
        }
    }
}

