const throttleMS = 50;
const threshold = 0.02;
let lastSentX = -1;
let lastSentY = -1;
let lastSendTime = 0;

// A simple array of subscriber callback functions
const listeners = [];

export const servoController = {
  // Allow other files to register a callback function without importing this module
  onServoMove(callback) {
    if (typeof callback === 'function') {
      listeners.push(callback);
    }
  },

  init(controllerElement) {
    if (!controllerElement) return;

    const processInput = (e, touchIndex = 0, isChanged = false) => {
      e.preventDefault();
      const rect = controllerElement.getBoundingClientRect();
      const touch = isChanged ? e.changedTouches[touchIndex] : e.touches[touchIndex];
      
      const rawX = (touch.clientX - rect.left) / rect.width;
      const rawY = (touch.clientY - rect.top) / rect.height;
      
      const now = Date.now();
      const hasMovedEnough = Math.abs(rawX - lastSentX) > threshold || Math.abs(rawY - lastSentY) > threshold;
      
      if (now - lastSendTime > throttleMS && hasMovedEnough) {
        const normalizedX = 90 - Math.round(rawX * 90);
        const normalizedY = Math.round(rawY * 90);

        for (let i = 0; i < listeners.length; i++) {
          listeners[i](normalizedX, normalizedY);
        }

        lastSentX = rawX;
        lastSentY = rawY;
        lastSendTime = now;
      }
    };

    controllerElement.addEventListener("touchstart", e => processInput(e, 0, false));
    
    controllerElement.addEventListener("touchmove", e => {
      e.preventDefault();
      // Only process the primary touch to keep calculations ultra-light
      if (e.touches.length > 0) {
        processInput(e, 0, false);
      }
    });

    controllerElement.addEventListener("touchend", e => processInput(e, 0, true));
  }
};