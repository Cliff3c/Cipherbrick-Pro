// /js/modules/validation.js
export class ValidationModule {
    static calculateKeyStrength(key) {
        let score = 0;

        // Complexity scoring
        if (key.length >= 8) score++;
        if (key.length >= 12) score++;
        if (/[a-z]/.test(key) && /[A-Z]/.test(key)) score++;
        if (/\d/.test(key)) score++;
        if (/[^A-Za-z0-9]/.test(key)) score++;

        // Penalty for common patterns
        const commonPattern = /\b\d{4}[-\/]\d{2}[-\/]\d{2}\b|([A-Z][a-z]+ \d{1,2}, \d{4})/;
        if (commonPattern.test(key)) score = Math.max(score - 2, 0);

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