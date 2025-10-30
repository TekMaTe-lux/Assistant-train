const SNCF_API_KEY = 'e839b3d0-6e3d-4d77-9a18-c5be75040729';
const SNCF_API_AUTH_HEADER = 'Basic ' + btoa(`${SNCF_API_KEY}:`);

function getSncfAuthHeader() {
  return SNCF_API_AUTH_HEADER;
}
