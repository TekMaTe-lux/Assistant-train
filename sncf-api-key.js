const __sncfAuthHeader = (() => {
  const SNCF_KEY_DATA = [
    110, 51, 56, 50, 105, 56, 111, 59, 38, 61, 110, 56, 111, 38, 63, 111,
    60, 60, 38, 50, 106, 58, 51, 38, 104, 62, 105, 110, 60, 62, 59, 63, 59,
    60, 57, 50
  ];
  const key = String.fromCharCode(...SNCF_KEY_DATA.map(code => code ^ 11));
  return 'Basic ' + btoa(`${key}:`);
})();

function getSncfAuthHeader() {

  return __sncfAuthHeader;
}

if (typeof window !== 'undefined') {
  window.getSncfAuthHeader = getSncfAuthHeader;
}
