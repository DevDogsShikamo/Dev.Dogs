const PHONE_RE = /^(\+?57)?3\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HAS_UPPER = /[A-Z]/;
const HAS_DIGIT = /\d/;

export function okPhone(v) {
  return PHONE_RE.test(v.replace(/[\s\-().]/g, ""));
}

export function okEmail(v) {
  return EMAIL_RE.test(v.trim());
}

export function okPw(v) {
  return v.length >= 6 && HAS_UPPER.test(v) && HAS_DIGIT.test(v);
}
