const bcrypt = require('bcryptjs');
const { webcrypto, timingSafeEqual, randomBytes } = require('node:crypto');
const CLIENT_ITERATIONS = 600000;
const SERVER_ITERATIONS = 100000;
async function derive(password, salt, iterations) {
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return Buffer.from(await webcrypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
// Same standard PBKDF2 pre-derivation as frontend/lib/credentials.ts. This runs
// OFFLINE when provisioning; production Workers never receive the raw password.
async function clientCredential(email, password) {
  return (await derive(password, new TextEncoder().encode('SoloVerse:password:v1:'+email.trim().toLowerCase()), CLIENT_ITERATIONS)).toString('base64url');
}
async function hashPassword(password, email) {
  if (process.env.SOLOVERSE_RUNTIME !== 'cloudflare') return bcrypt.hash(password, 10);
  if (!email) throw new Error('Cloudflare provisioning requires an email');
  const credential = await clientCredential(email,password);
  const salt = randomBytes(16);
  const hash = await derive(credential, salt, SERVER_ITERATIONS);
  return `client-pbkdf2-sha256$${CLIENT_ITERATIONS}$${SERVER_ITERATIONS}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
async function verifyPassword(password, saved, format) {
  if (saved.startsWith('client-pbkdf2-sha256$')) {
    const [algorithm, clientRounds, serverRounds, saltText, hashText, extra] = saved.split('$');
    if (format !== 'client-pbkdf2-v1' || extra || Number(clientRounds)!==CLIENT_ITERATIONS || Number(serverRounds)!==SERVER_ITERATIONS || !/^[A-Za-z0-9_-]{43}$/.test(password) || !/^[A-Za-z0-9_-]{22}$/.test(saltText) || !/^[A-Za-z0-9_-]{43}$/.test(hashText)) return false;
    const actual = await derive(password, Buffer.from(saltText, 'base64url'), SERVER_ITERATIONS);
    const expected = Buffer.from(hashText, 'base64url');
    return actual.length===expected.length && timingSafeEqual(actual,expected);
  }
  if (process.env.SOLOVERSE_RUNTIME === 'cloudflare') return false;
  return bcrypt.compare(password, saved);
}
module.exports = { hashPassword, verifyPassword, clientCredential };
