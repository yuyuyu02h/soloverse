import { PRIVATE_APP } from './deployment';

// HTTPS only. The derived credential is password-equivalent: never persist/log
// it, and still require the server's independent, randomly salted verifier.
export async function loginCredentials(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  if (!PRIVATE_APP) return { email:normalized, password };
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode('SoloVerse:password:v1:'+normalized),iterations:600000},key,256);
  const encoded = btoa(String.fromCharCode(...new Uint8Array(bits))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return { email:normalized, password:encoded, passwordFormat:'client-pbkdf2-v1' };
}
