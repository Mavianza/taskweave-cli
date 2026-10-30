export function sum(values) {
  if (!Array.isArray(values) || !values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new TypeError('Masukan harus berupa array angka finite.');
  }
  return values.reduce((total, value) => total + value, 0);
}
