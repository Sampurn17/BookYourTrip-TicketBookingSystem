const crypto = require('crypto');

// Crockford-ish alphabet without look-alike characters (0/O, 1/I/L).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function generatePnr(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `BYT${out}`;
}

module.exports = { generatePnr };
