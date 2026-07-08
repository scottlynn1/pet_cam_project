import {datafetchService} from "./datafetchService.js";

export async function isLoggedIn() {
  try {
    const response = await fetch('/auth_status');
    return response.ok;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export async function loginAttemptEvent(e, appState, renderCallback) {
  e.preventDefault();
  const form = e.currentTarget; 
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  
  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Login failed');    
    }
  
    appState.loginError = false;
    loginActions(appState, renderCallback);
    
  } catch (err) {
    console.error('Login Error:', err.message);  
    
    appState.loginError = true;
    appState.errorContent = err.message;
    renderCallback();
  }
}

export function logoutActions(appState, renderCallback) {
  appState.activeFeed = false;
  appState.laserActive = false;
  appState.renamingDevice = false;
  appState.isLoggedIn = false;
  appState.loginError = false;
  appState.errorContent = "";
  appState.devices = [];
  window.dispatchEvent(new CustomEvent('app:logout', {
      detail: { deviceId: appState.deviceID }
    }));
  renderCallback();
}

async function loginActions(appState, renderCallback) {
  appState.isLoggedIn = true;
  appState.activeFeed = false;
  appState.renamingDevice = false;
  appState.laserActive = false;
  appState.loginError = false;
  appState.errorContent = "";
  window.dispatchEvent(new CustomEvent('user:login'));
  appState.devices = await datafetchService();
  renderCallback();
}