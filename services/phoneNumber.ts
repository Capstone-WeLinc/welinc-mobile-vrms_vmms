export function normalizePhoneNumber(value: string): string {
  const number = value.trim().replace(/[\s()-]/g, "");
  if (/^09\d{9}$/.test(number)) return `+63${number.slice(1)}`;
  if (/^639\d{9}$/.test(number)) return `+${number}`;
  return number;
}

export function isValidPhoneNumber(value: string): boolean {
  return /^\+639\d{9}$/.test(normalizePhoneNumber(value));
}
