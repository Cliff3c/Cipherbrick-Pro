// /js/modules/validation.js
const COMMON_WORDS = [
    'password','passw0rd','p@ssword','welcome','admin','login','letmein','qwerty',
    'monkey','dragon','master','shadow','sunshine','princess','batman','superman',
    'football','baseball','soccer','trustno1','iloveyou','summer','winter','spring',
    'autumn','hello','access','michael','jennifer','charlie','thomas','jessica',
    'pepper','hunter','joshua','robert','daniel','starwars','mustang',];
const KEYBOARD_SEQS = ['qwerty','qwertz','asdfgh','zxcvbn','12345','67890','abcdef','123456','654321','098765'];

export class ValidationModule {
    static calculateKeyStrength(key) {
        if (!key) return { score: 0, strength: "–", percent: 0 };

        let score = 0;
        const lower = key.toLowerCase();

        // Complexity scoring
        if (key.length >= 8) score++;
        if (key.length >= 12) score++;
        if (/[a-z]/.test(key) && /[A-Z]/.test(key)) score++;
        if (/\d/.test(key)) score++;
        if (/[^A-Za-z0-9]/.test(key)) score++;

        // Penalty: contains a common word base
        if (COMMON_WORDS.some(w => lower.includes(w))) score -= 2;

        // Penalty: contains a keyboard sequence (forward or reverse)
        if (KEYBOARD_SEQS.some(s => lower.includes(s) || lower.includes(s.split('').reverse().join('')))) score -= 2;

        // Penalty: contains a year (19xx or 20xx)
        if (/(19|20)\d{2}/.test(key)) score -= 1;

        // Penalty: 3+ repeated characters in a row
        if (/(.)\1{2,}/.test(key)) score -= 1;

        score = Math.max(score, 0);

        let strength = "–";
        let percent = 0;

        if (score <= 2) {
            strength = "Weak";
            percent = 25;
        } else if (score <= 4) {
            strength = "Moderate";
            percent = 60;
        } else {
            strength = "Strong";
            percent = 100;
        }

        return { score, strength, percent };
    }

    static validateInput(input, mode) {
        const errors = [];
        if (!input || input.trim().length === 0) {
            errors.push(`${mode === 'encrypt' ? 'Message' : 'Encrypted data'} is required`);
        }
        if (mode === 'encrypt' && input.length > 500) {
            errors.push('Message exceeds 500 character limit');
        }
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    static validateKey(key) {
        if (!key || key.trim().length === 0) {
            return { isValid: false, error: 'Key is required' };
        }

        return { isValid: true };
    }

    static validateSalt(salt, stealthMode = false) {
        if (stealthMode) {
            return { isValid: true }; // Salt not needed in stealth mode
        }

        if (!salt || salt.trim().length === 0) {
            return { isValid: false, error: 'Salt is required when not in stealth mode' };
        }

        return { isValid: true };
    }
}