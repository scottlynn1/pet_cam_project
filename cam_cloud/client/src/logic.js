import { wsService } from "./wsService.js";
import { elms } from "./domElements.js"
import { servoController } from './servoController.js';
import { isLoggedIn, logoutActions, loginAttemptEvent, loginActions } from "./session.js";

// and fix issue with multiple tabs in same browser attempting to control one
// fix cam_hal cam_hal: FB-OVF

const appState = {
  isLoggedIn: false,
  activeFeed: false,
  laserActive: false,
  renamingDevice: false,
  devices: [],
  deviceID: null,
  loginError: false,
  errorContent: '',
  feedSource: '',
};

function renderUI() {
  elms.menus.form.classList.toggle('hidden', appState.isLoggedIn);
  elms.menus.device.classList.toggle('hidden', !appState.isLoggedIn);
  elms.typewriter.classList.toggle('removed', !appState.isLoggedIn);
  
  elms.feedFrame.classList.toggle('active', appState.activeFeed);
  elms.sections.feed.classList.toggle('hidden', !appState.activeFeed);
  elms.sections.control.classList.toggle('hidden', !appState.activeFeed);
  if (!appState.activeFeed) elms.feedFrame.src = "";
  if (appState.activeFeed) elms.typewriter.classList.add('removed');
  
  
  elms.controller.classList.toggle('hidden', !appState.laserActive);
  elms.laserStart.classList.toggle('hidden', appState.laserActive);
  elms.laserWrapper.classList.toggle('hidden', appState.laserActive);
  
  elms.menus.renameWrapper.classList.toggle('hidden', !appState.renamingDevice);
  elms.toggleRenameBtn.classList.toggle('hidden', appState.renamingDevice);

  elms.errorDisplay.textContent = appState.loginError ? err.message : '';
  elms.errorDisplay.style.color = appState.loginError ? 'red' : 'white';

  populateCameraList(appState.devices);

  if (appState.isLoggedIn) elms.loginForm.reset();
}

function sendLaserOffCmd(e) {
  if (e.detail.deviceID) {
    wsService.send({ type: "laser_cmd", role: "client", data: "off", device: e.detail.deviceID, hubID: 123});
    appState.deviceID = null;
  }
}

window.addEventListener('app:logout', sendLaserOffCmd);
window.addEventListener('device:switch', sendLaserOffCmd);
window.addEventListener('feed:stop', sendLaserOffCmd);
window.addEventListener('laser:stop', sendLaserOffCmd);
window.addEventListener('user:login', wsService.open(handleWsMessage));
window.addEventListener('user:login', () => {
  elms.typewriter.forEach((singleLetter) => {
    typeLetter(singleLetter);
  })
})
window.addEventListener("forceLogout", (event) => {
  logoutActions();
});


isLoggedIn().then((loggedIn) => {
  loggedIn ? loginActions(login) : logoutActions(appState, renderUI);
})

elms.menus.loginForm.addEventListener('submit', e => {
  loginAttemptEvent(e, appState, renderUI);
});


function populateCameraList(cameras) {
  while (elms.camList.firstChild) {
    elms.camList.removeChild(elms.camList.firstChild);
  }
  
  for (let camera of cameras) {
    let cam = document.createElement("option")
    cam.value = camera.id
    cam.text = camera.name
    elms.camList.appendChild(cam)
  }
}


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
  window.dispatchEvent(new CustomEvent('device:switch', {
      detail: { deviceId: appState.deviceID }
    }));
  appState.deviceID = event.target.value;
  appState.activeFeed = true;
  appState.laserActive = false;
  elms.camNameInput.value = event.target.options[event.target.selectedIndex].text;
  appState.feedSource = `${location.protocol}//${window.location.hostname}/stream?deviceID=${appState.deviceID}`;
});


elms.feedStop.addEventListener("click", () => {
  appState.activeFeed = false;
  document.getElementById('default-select').selected = true;
  window.dispatchEvent(new CustomEvent('feed:stop', {
    detail: { deviceId: appState.deviceID }
  }));
  appState.laserActive = false;
  appState.renamingDevice = false;
  appState.deviceID = null;
});

const stopLaserAction = () => {
  console.log('Laser stop button clicked on click event');
  window.dispatchEvent(new CustomEvent('laser:stop', {
    detail: { deviceId: appState.deviceID }
  }));
  appState.laserActive = false;
}

elms.laserStop.addEventListener("click", stopLaserAction);
elms.laserStop.addEventListener("touchend", stopLaserAction);

elms.laserStart.addEventListener("click", async (e) => {
  try {
    const response = await sendAndAwait(wsService.instance);
    if (response.data == "fail") window.alert("laser already being controlled");
    else if (response.data == "success") {
      appState.laserActive = true;
    }
  } catch (err) {
    console.error(err);
    window.alert("Connection error: The device did not respond in time")
  }
});


function sendAndAwait(wsObj, timeout = 5000) {
  return new Promise ((resolve, reject) => {
    wsObj.send({ type: "laser_cmd", role: "client", data: "on", device: appState.deviceID, hubID: 123})
    const timer = setTimeout(() => {
      wsObj.instance.removeEventListener("message", handler)
      reject(new Error("Timeout: No response from device"))
    }, timeout)
    const handler = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type == "confirmation" && msg.data != "timeout") {
          clearTimeout(timer)
          wsObj.instance.removeEventListener("message", handler);
          resolve(msg);
        }
      } catch (err) {
        console.error("Error parsing JSON:", err)
      }
    }
    wsObj.instance.addEventListener("message", handler)
  })
}


elms.renameToggleBtn.addEventListener("click", () => {
  if (appState.renamingDevice == false) appState.renamingDevice = true;
  else appState.renamingDevice = false;
})


elms.camNameSave.addEventListener("click", () => {
  elms.camNameInput.value.trim();
  if (!newName || !appState.deviceID) return;
  wsService.send({ type: "set_cam_name", device: appState.deviceID, name: newName });
  const selected = elms.camList.options[elms.camList.selectedIndex];
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

elms.feedFrame.onload = () => {
  setTimeout(() => {
    elms.feedframe.classList.add('active');
  }, 300); // small intentional delay for effect
};

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

