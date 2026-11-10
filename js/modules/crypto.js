// /js/modules/crypto.js
// Password-mode ciphertext format versions.
//
//   v1: <body>         PBKDF2-SHA256, 100,000 iterations (no marker; every message before v2)
//   v2: CB2:<body>     PBKDF2-SHA256, 600,000 iterations
//
// <body> is unchanged between versions: base64(iv[12] || AES-256-GCM ciphertext+tag),
// with the base64 salt interleaved in Simple (stealth) mode.
//
// The marker is not authenticated separately and does not need to be: the iteration
// count feeds the key, so a ciphertext relabelled to another version fails the GCM tag.
//
// To add a version: add its iteration count here and bump ENCRYPT_VERSION. Never
// remove or change an existing entry, or old messages stop decrypting.
const KDF_ITERATIONS = { 1: 100000, 2: 600000 };
const ENCRYPT_VERSION = 2;
const VERSION_PREFIX = /^CB(\d+):/i; // ':' is not a base64 character, so v1 bodies never match

export class CryptoModule {
    static get UNSUPPORTED_VERSION() { return 'CB_UNSUPPORTED_VERSION'; }

    // Splits a ciphertext string into its format version and body.
    // Throws an error with code UNSUPPORTED_VERSION for a version this build does not know.
    static parseVersion(data) {
        const text = data.trim();
        const match = text.match(VERSION_PREFIX);
        if (!match) return { version: 1, body: text };

        const version = Number(match[1]);
        if (version === 1 || KDF_ITERATIONS[version] === undefined) {
            const err = new Error(`Unsupported ciphertext version: CB${match[1]}`);
            err.code = this.UNSUPPORTED_VERSION;
            throw err;
        }
        return { version, body: text.slice(match[0].length) };
    }

    static async getKeyMaterial(password) {
        const enc = new TextEncoder();
        return crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
    }

    static async deriveKey(keyMaterial, saltBytes, version) {
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: saltBytes, iterations: KDF_ITERATIONS[version], hash: "SHA-256" },
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
        const key = await this.deriveKey(keyMaterial, saltBytes, ENCRYPT_VERSION);
        const enc = new TextEncoder();
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(message));
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);

        const base64Cipher = btoa(String.fromCharCode(...combined));
        const body = stealthMode ? this.sprinkleSaltIntoCipher(base64Cipher, saltBytes) : base64Cipher;
        return `CB${ENCRYPT_VERSION}:${body}`;
    }

    static async decrypt(keyStr, saltStr, data) {
        const stealthMode = sessionStorage.getItem("stealthMode") === "true";
        const { version, body } = this.parseVersion(data);
        let saltBytes, cipherTextClean;

        if (stealthMode) {
            const extracted = this.extractSaltAndCipher(body);
            saltBytes = extracted.salt;
            cipherTextClean = extracted.cleanCipher;
        } else {
            saltBytes = new TextEncoder().encode(saltStr);
            cipherTextClean = body;
        }

        const raw = Uint8Array.from(atob(cipherTextClean), c => c.charCodeAt(0));
        const iv = raw.slice(0, 12);
        const ciphertext = raw.slice(12);

        const keyMaterial = await this.getKeyMaterial(keyStr);
        const key = await this.deriveKey(keyMaterial, saltBytes, version);
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