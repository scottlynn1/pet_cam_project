import { wsService } from "./wsService.js";
import {datafetchService} from "./datafetchService.js";
import { elms } from "./domElements.js"

// and fix issue with multiple tabs in same browser attempting to control one
// fix cam_hal cam_hal: FB-OVF

const camNameInput = document.getElementById('cam-name-input');
const camNameSave = document.getElementById('cam-name-save');
const toggleRenameBtn = document.getElementById('toggle-rename-btn');

const appState = {
  isLoggedIn: false,
  activeFeed: false,
  laserActive: false,
  renamingDevice: false,
  devices: []
};

function renderUI() {
  elms.menus.form.classList.toggle('hidden', appState.isLoggedIn);
  elms.menus.device.classList.toggle('hidden', !appState.isLoggedIn);
  elms.typewriter.classList.toggle('removed', !appState.isLoggedIn);

  elms.feedFrame.classList.toggle('active', appState.activeFeed);
  elms.sections.feed.classList.toggle('hidden', !appState.activeFeed);
  elms.sections.control.classList.toggle('hidden', !appState.activeFeed);

  
  elms.controller.classList.toggle('hidden', !appState.laserActive);
  elms.laserStart.classList.toggle('hidden', appState.laserActive);
  elms.laserWrapper.classList.toggle('hidden', appState.laserActive);

  elms.menus.renameWrapper.classList.toggle('hidden', !appState.renamingDevice);
  elms.toggleRenameBtn.classList.toggle('hidden', appState.renamingDevice);
}

function logoutActions() {
  appState.activeFeed = false;
  appState.laserActive = false;
  appState.renamingDevice = false;
  appState.isLoggedIn = false;
  devices = [];
  feedframe.src = "";
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
    }
  }
  loginForm.reset();
  renderUI();
}

function loginActions() {
  El2typElements.forEach((singleElm) => {
    El2typ(singleElm);
  });
  loginForm.reset();
  feedframe.src = "";
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  }
  appState.isLoggedIn = true;
  appState.activeFeed = false;
  appState.renamingDevice = false;
  appState.laserActive = false;
  renderUI();
}

function getValidToken() {
  let token = localStorage.getItem('jwt_token');
  
  if (!token) {
    logoutActions();
    return
  }

  return token;
}

let token = getValidToken();
if (token) {
      wsService(token, UpdateUI);
      let cameras = datafetchService(token);
      populateCameraList(cameras)
      appState.isLoggedIn = true;
      renderUI();
    }

elms.menus.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(loginForm);
  const payload = Object.fromEntries(formData.entries());
  
  try {
    const response = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    
    if (data.token) {
      localStorage.setItem('jwt_token', data.token);
      wsService(token, UpdateUI);
      const cameras = datafetchService(token);
      populateCameraList(cameras)
      appState.isLoggedIn = true;
      loginActions();
      renderUI();
    }
  } catch (err) {
    console.error('Login Error:', err.message);  

    if (elms.errorDisplay) {
      errorDisplay.textContent = err.message;
      errorDisplay.style.color = 'red';
    }
  }
});


function populateCameraList(cameras) {
    while (cameralist.options.length > 1) {
        cameralist.remove(cameralist.options.length - 1);
    }

    for (let camera of cameras) {
      let cam = document.createElement("option")
      cam.value = camera.id
      cam.text = camera.name
      cameralist.appendChild(cam)
    }

    if (cameralist) {
      cameralist.addEventListener("change", initiatefeed);
    }
}

function UpdateUI(event) {
  const message = JSON.parse(event.data);
  if (message.type == "confirmation" && message.data == "timeout") {
    appState.laserActive = false
  }
  if (message.type == "error") {
    loginActions();
  }
}

const initiatefeed = async (event) => {
  deviceID = event.target.value;
  appState.activeFeed = true;
  appState.laserActive = false;
  typewriter.classList.add('removed');
  camNameInput.value = event.target.options[event.target.selectedIndex].text;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  }
  let token = await getValidToken();
  feedframe.setAttribute("src", `${location.protocol}//${window.location.hostname}/stream?deviceID=${deviceID}&token=${token}`);
}


feedstopButton.addEventListener("click", () => {
  feedframe.setAttribute("src", "");
  document.getElementById('default-select').selected = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  }
  appState.laserActive = false;
  appState.activeFeed = false;
  appState.renamingDevice = false;
  deviceID = null;
});

const stopLaserAction = () => {
  console.log('Laser stop button clicked on click event');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  }
  appState.laserActive = false;
}

laserstopButton.addEventListener("click", stopLaserAction);
laserstopButton.addEventListener("touchend", stopLaserAction);

laserstartButton.addEventListener("click", async (e) => {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "on", device: deviceID, hubID: 123}));
      const response = await waitForNextMessage(ws);
      if (response.data == "fail") window.alert("laser already being controllerled");
      else if (response.data == "success") {
        appState.laserActive = true;
      }
    } else {
      console.err(err);
      window.alert("Websocket for device is stale, refresh page");
    }
  } catch (err) {
    console.error(err);
    window.alert("Connection error: The device did not respond in time")
  }
});


function waitForNextMessage(ws, timeout = 5000) {
  return new Promise ((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", handler)
      reject(new Error("Timeout: No response from device"))
    }, timeout)
    const handler = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type == "confirmation") {
          clearTimeout(timer)
          ws.removeEventListener("message", handler);
          resolve(data);
        }
      } catch (err) {
        console.error("Error parsing JSON:", err)
      }
    }
    ws.addEventListener("message", handler)
  })
}

feedframe.onload = () => {
  setTimeout(() => {
    feedframe.classList.add('active');
  }, 300); // small intentional delay for effect
};

toggleRenameBtn.addEventListener("click", () => {
  if (appState.renamingDevice == false) appState.renamingDevice = true;
  else appState.renamingDevice = false;
})


camNameSave.addEventListener("click", () => {
  const newName = camNameInput.value.trim();
  if (!newName || !deviceID) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "set_cam_name", device: deviceID, name: newName }));
  }
  const select = document.getElementById("cam-select");
  const selected = select.options[select.selectedIndex];
  if (selected) selected.text = newName;
  appState.renamingDevice = false;
});


let lastSendTime = 0;
const throttleMS = 50;
let lastSentX = -1;
let lastSentY = -1;
const threshold = 0.02;

function sendServoData(y, x) {
  const now = Date.now();
  const hasMovedEnough = Math.abs(x - lastSentX) > threshold || Math.abs(y - lastSentY) > threshold;
  
  if (now - lastSendTime > throttleMS && hasMovedEnough) {
    x = 90 - Math.round(x*90)
    y = Math.round(y*90)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ 
      type: "servo_cmd", 
      role: "client", 
      data: { x, y }, 
      device: deviceID
    }))
  }
    lastSentX = x;
    lastSentY = y;
    lastSendTime = now;
  }
}

controller.addEventListener("touchstart", e => {
  e.preventDefault();
  let rect = controller.getBoundingClientRect();
  let x = (e.touches[0].clientX - rect.left) / rect.width;
  let y = (e.touches[0].clientY - rect.top) / rect.height;
  sendServoData(x, y);
})

controller.addEventListener("touchmove", e => {
  e.preventDefault();
  let rect = controller.getBoundingClientRect();
  [...e.touches].forEach(touch => {
    let x = (touch.clientX - rect.left) / rect.width;
    let y = (touch.clientY - rect.top) / rect.height;
    sendServoData(x, y)
  })
})

controller.addEventListener("touchend", (e) => {
  e.preventDefault();
  let rect = controller.getBoundingClientRect();
  let x = (e.changedTouches[0].clientX - rect.left) / rect.width;
  let y = (e.changedTouches[0].clientY - rect.top) / rect.height;
  sendServoData(x, y)
})

const El2typ = (obj) => {
  let str = obj.innerText;
  obj.innerHTML =
    "<span class='TxtWrape'></span><span class='typeBar'> </span>";
  let optDf = [0, 150]; //Start Delay, Typing speed
  let opt = obj.getAttribute("El2typ").replace(/}|{/gi, "").split(",");
  opt = { ...optDf, ...opt };
  obj.removeAttribute("El2typ");
  setTimeout(() => {
    for (let i = 0; i < str.length; i++) {
      setTimeout(() => {
        obj.querySelector(".TxtWrape").innerHTML += str[i];
        if (i + 1 === str.length) {
          obj.querySelector(".typeBar").remove();
        }
      }, opt[1] * i);
    }
  }, opt[0] *1000);
};
const El2typElements = document.querySelectorAll("[El2typ]");

