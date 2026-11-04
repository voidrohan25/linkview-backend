import crypto from 'crypto';

/**
 * Generates a cryptographically secure 6-digit numeric OTP (100000 - 999999).
 */
export function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Computes SHA-256 hash of the OTP for secure database storage.
 */
export function hashOtp(otp) {
  if (typeof otp !== 'string') {
    otp = String(otp);
  }
  return crypto.createHash('sha256').update(otp.trim()).digest('hex');
}

/**
 * Compares an entered OTP against a stored hash using timing-safe comparison to prevent timing attacks.
 */
export function verifyOtpHash(enteredOtp, storedHash) {
  if (!enteredOtp || !storedHash) return false;
  const enteredHash = hashOtp(enteredOtp);

  const bufA = Buffer.from(enteredHash, 'hex');
  const bufB = Buffer.from(storedHash, 'hex');

  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
