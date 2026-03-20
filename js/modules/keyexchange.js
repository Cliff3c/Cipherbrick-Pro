// /js/modules/keyexchange.js

export class KeyExchangeModule {
    constructor(app) {
        this.app = app;
        this.crypto = window.crypto || window.msCrypto;
    }

    // Generate an ECDH key pair using P-256 curve
    async generateKeyPair() {
        return await this.crypto.subtle.generateKey({
            name: "ECDH",
            namedCurve: "P-256"
        }, true, ["deriveKey", "deriveBits"]);
    }

    // Export public key to base64 for sharing
    async exportPublicKey(publicKey) {
        const rawKey = await this.crypto.subtle.exportKey("raw", publicKey);
        return btoa(String.fromCharCode(...new Uint8Array(rawKey)));
    }

    // Import a public key from base64
    async importPublicKey(base64) {
        const rawKey = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        return await this.crypto.subtle.importKey(
            "raw",
            rawKey,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            []
        );
    }

    // Derive shared secret (raw bytes) from private key and peer public key
    async deriveSharedSecret(privateKey, peerPublicKey) {
        return await this.crypto.subtle.deriveBits(
            {
                name: "ECDH",
                public: peerPublicKey
            },
            privateKey,
            256  // 256 bits = 32 bytes
        );
    }

    // Derive AES key from private key and peer public key
    async deriveAESKey(privateKey, peerPublicKey) {
        return await this.crypto.subtle.deriveKey(
            {
                name: "ECDH",
                public: peerPublicKey
            },
            privateKey,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
    }

    // Encrypt a plain text message with AES key
    async encryptMessageWithAESKey(aesKey, plainText) {
        const iv = this.crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(plainText);
        const cipher = await this.crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            aesKey,
            encoded
        );
        const result = new Uint8Array(iv.byteLength + cipher.byteLength);
        result.set(iv, 0);
        result.set(new Uint8Array(cipher), iv.byteLength);
        return btoa(String.fromCharCode(...result));
    }

    // Decrypt a base64-encoded AES-GCM message
    async decryptMessageWithAESKey(aesKey, encryptedBase64) {
        const data = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
        const iv = data.slice(0, 12);
        const cipherText = data.slice(12);
        const decrypted = await this.crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            aesKey,
            cipherText
        );
        return new TextDecoder().decode(decrypted);
    }
    
    // /js/modules/keyexchange.js (add to class KeyExchangeModule)
    async exportPublicKeySpki(publicKey) {
        const spki = await this.crypto.subtle.exportKey("spki", publicKey);
        return btoa(String.fromCharCode(...new Uint8Array(spki)));
    }

    async importPublicKeyAuto(base64) {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

        // Try SPKI first (most interoperable)
        try {
            return await this.crypto.subtle.importKey(
                "spki",
                bytes,
                { name: "ECDH", namedCurve: "P-256" },
                true,
                []
            );
        } catch (_) { /* fall through */ }

        // Fallback to raw uncompressed point
        return await this.crypto.subtle.importKey(
            "raw",
            bytes,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            []
        );
    }

    async importPrivateKeyPkcs8(base64) {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        return await this.crypto.subtle.importKey(
            "pkcs8",
            bytes,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey", "deriveBits"]
        );
    }

    async exportPrivateKeyPkcs8(privateKey) {
        const pkcs8 = await this.crypto.subtle.exportKey("pkcs8", privateKey);
        return btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
    }

}
