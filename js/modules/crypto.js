// /js/modules/crypto.js
export class CryptoModule {
    static async getKeyMaterial(password) {
        const enc = new TextEncoder();
        return crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
    }

    static async deriveKey(keyMaterial, saltBytes) {
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    static async encrypt(keyStr, saltStr, message) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const stealthMode = sessionStorage.getItem("stealthMode") === "true";
        let saltBytes;

        if (stealthMode) {
            saltBytes = crypto.getRandomValues(new Uint8Array(16));
        } else {
            saltBytes = new TextEncoder().encode(saltStr);
        }

        const keyMaterial = await this.getKeyMaterial(keyStr);
        const key = await this.deriveKey(keyMaterial, saltBytes);
        const enc = new TextEncoder();
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(message));
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);

        const base64Cipher = btoa(String.fromCharCode(...combined));
        return stealthMode ? this.sprinkleSaltIntoCipher(base64Cipher, saltBytes) : base64Cipher;
    }

    static async decrypt(keyStr, saltStr, data) {
        const stealthMode = sessionStorage.getItem("stealthMode") === "true";
        let saltBytes, cipherTextClean;

        if (stealthMode) {
            const extracted = this.extractSaltAndCipher(data);
            saltBytes = extracted.salt;
            cipherTextClean = extracted.cleanCipher;
        } else {
            saltBytes = new TextEncoder().encode(saltStr);
            cipherTextClean = data;
        }

        const raw = Uint8Array.from(atob(cipherTextClean), c => c.charCodeAt(0));
        const iv = raw.slice(0, 12);
        const ciphertext = raw.slice(12);

        const keyMaterial = await this.getKeyMaterial(keyStr);
        const key = await this.deriveKey(keyMaterial, saltBytes);
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
        return new TextDecoder().decode(decrypted);
    }

    static sprinkleSaltIntoCipher(cipher, saltBytes) {
        const saltB64 = btoa(String.fromCharCode(...saltBytes));
        let result = "";
        let cipherIdx = 0, saltIdx = 0, i = 0;

        while (cipherIdx < cipher.length || saltIdx < saltB64.length) {
            if (i % 5 === 2 && saltIdx < saltB64.length) {
                result += saltB64[saltIdx++];
            } else if (cipherIdx < cipher.length) {
                result += cipher[cipherIdx++];
            } else {
                result += saltB64[saltIdx++];
            }
            i++;
        }
        return result;
    }

    static extractSaltAndCipher(obfuscated) {
        const totalSalt = 24; // Base64-encoded 16-byte salt
        const totalCipher = obfuscated.length - totalSalt;
        const saltChars = [], cipherChars = [];
        let saltCount = 0, cipherCount = 0;

        for (let i = 0; i < obfuscated.length; i++) {
            if ((i % 5 === 2 && saltCount < totalSalt) || cipherCount >= totalCipher) {
                saltChars.push(obfuscated[i]);
                saltCount++;
            } else {
                cipherChars.push(obfuscated[i]);
                cipherCount++;
            }
        }

        const salt = Uint8Array.from(atob(saltChars.join("")), c => c.charCodeAt(0));
        return { salt, cleanCipher: cipherChars.join("") };
    }
}