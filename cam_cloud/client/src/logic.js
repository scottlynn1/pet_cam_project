import { wsService } from "./wsService.js";
import {datafetchService} from "./datafetchService.js";
import { elms } from "./domElements.js"
import { servoController } from './servoController.js';

// and fix issue with multiple tabs in same browser attempting to control one
// fix cam_hal cam_hal: FB-OVF

const appState = {
  isLoggedIn: false,
  activeFeed: false,
  laserActive: false,
  renamingDevice: false,
  devices: [],
  deviceID: null
};

function renderUI() {
  elms.menus.form.classList.toggle('hidden', appState.isLoggedIn);
  elms.menus.device.classList.toggle('hidden', !appState.isLoggedIn);
  elms.typewriter.classList.toggle('removed', !appState.isLoggedIn);
  
  elms.feedFrame.classList.toggle('active', appState.activeFeed);
  elms.sections.feed.classList.toggle('hidden', !appState.activeFeed);
  elms.sections.control.classList.toggle('hidden', !appState.activeFeed);
  if (!appState.activeFeed) elms.feedFrame.src = "";
  
  
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
  appState.devices = [];
  populateCameraList(appState.devices);
  wsService.send({ type: "laser_cmd", role: "client", data: "off", device: appState.deviceID, hubID: 123});
  loginForm.reset();
  renderUI();
}

function loginActions() {
  El2typElements.forEach((singleElm) => {
    El2typ(singleElm);
  });
  loginForm.reset();
  appState.isLoggedIn = true;
  appState.activeFeed = false;
  appState.renamingDevice = false;
  appState.laserActive = false;
  ws = wsService.open(handleWsMessage);
  appState.devices = datafetchService();
  populateCameraList(appState.devices)
    wsService.send({ type: "laser_cmd", role: "client", data: "off", device: appState.deviceID, hubID: 123});
  renderUI();
}

async function checkStatus () {
  const response = await fetch('/auth_status')
  if (!response.ok) {
    logoutActions();
  } else if (response.ok) {
    loginActions();
  }
}
checkStatus();

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
    
    if (!response.ok) {
      throw Error(response.json().error);
    }
    
    loginActions();
    
  } catch (err) {
    console.error('Login Error:', err.message);  
    
    if (elms.errorDisplay) {
      errorDisplay.textContent = err.message;
      errorDisplay.style.color = 'red';
    }
  }
});


function populateCameraList(cameras) {
  while (elms.camList.options.length > 1) {
    elms.camList.remove(elms.camList.options.length - 1);
  }
  
  for (let camera of cameras) {
    let cam = document.createElement("option")
    cam.value = camera.id
    cam.text = camera.name
    elms.camList.appendChild(cam)
  }
}

window.addEventListener("forceLogout", (event) => {
  logoutActions
});

function handleWsMessage(event) {
  const message = JSON.parse(event.data);
  if (message.type == "confirmation" && message.data == "timeout") {
    appState.laserActive = false
    renderUI();
  }
  if (message.type == "error") {
    logoutActions();
  }
}

elms.camList.addEventListener('change', async (event) => {
  appState.deviceID = event.target.value;
  appState.activeFeed = true;
  appState.laserActive = false;
  elms.typewriter.classList.add('removed');
  elms.camNameInput.value = event.target.options[event.target.selectedIndex].text;
  wsService.send({ type: "laser_cmd", role: "client", data: "off", device: appState.deviceID, hubID: 123});
  feedframe.setAttribute("src", `${location.protocol}//${window.location.hostname}/stream?deviceID=${appState.deviceID}`);
});


elms.feedStop.addEventListener("click", () => {
  feedframe.setAttribute("src", "");
  document.getElementById('default-select').selected = true;
  wsService.send({ type: "laser_cmd", role: "client", data: "off", device: appState.deviceID, hubID: 123});
  appState.laserActive = false;
  appState.activeFeed = false;
  appState.renamingDevice = false;
  appState.deviceID = null;
});

const stopLaserAction = () => {
  console.log('Laser stop button clicked on click event');
  wsService.send({ type: "laser_cmd", role: "client", data: "off", device: appState.deviceID, hubID: 123});
  appState.laserActive = false;
}

elms.laserStop.addEventListener("click", stopLaserAction);
elms.laserStop.addEventListener("touchend", stopLaserAction);

elms.laserStart.addEventListener("click", async (e) => {
  try {
    wsService.send({ type: "laser_cmd", role: "client", data: "on", device: appState.deviceID, hubID: 123});
    const response = await waitForNextMessage(ws);
    if (response.data == "fail") window.alert("laser already being controllerled");
    else if (response.data == "success") {
      appState.laserActive = true;
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

elms.feedFrame.onload = () => {
  setTimeout(() => {
    feedframe.classList.add('active');
  }, 300); // small intentional delay for effect
};

elms.renameToggleBtn.addEventListener("click", () => {
  if (appState.renamingDevice == false) appState.renamingDevice = true;
  else appState.renamingDevice = false;
})


elms.camNameSave.addEventListener("click", () => {
  elms.camNameInput.value.trim();
  if (!newName || !appState.deviceID) return;
  wsService.send({ type: "set_cam_name", device: appState.deviceID, name: newName });
  const select = document.getElementById("cam-select");
  const selected = select.options[select.selectedIndex];
  if (selected) selected.text = newName;
  appState.renamingDevice = false;
});

servoController.init(elms.controller);

servoController.onServoMove((x, y) => {
  wsService.send({ 
    type: "servo_cmd", 
    role: "client", 
    data: { x, y }, 
    device: appState.deviceID
  });
});

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

