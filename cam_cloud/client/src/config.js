const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
export const WS_URL = import.meta.env.PROD 
  ? `${protocol}://${window.location.host}/ws` 
  : `${protocol}://${window.location.hostname}:3000`;

export const API_URL = import.meta.env.PROD 
  ? `https://${window.location.host}` 
  : `http://${window.location.hostname}:3000`;