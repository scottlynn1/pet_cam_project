import { WS_URL } from './config.js';

export async function fetchDeviceList(token) {
  const url = `${API_URL}/device_list?token=${token}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    const contentType = response.headers.get("content-type");
    
    // Catch HTML or plain text error pages instead of crashing the JSON parser
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error(`Server error (${response.status}). Expected JSON but received text/html.`);
    }
    
    const errorResult = await response.json();
    if (errorResult.error === "Invalid or expired token.") {
      throw new Error("AUTH_EXPIRED"); // Use a specific code so the UI layer can react accordingly
    }
    
    throw new Error(errorResult.error || `Response status: ${response.status}`);
  }

  const result = await response.json();
  return result.data; // Return just the raw array of cameras/devices
}