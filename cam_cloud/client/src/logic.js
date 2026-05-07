const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const URL = import.meta.env.PROD ? `${protocol}://${window.location.host}/ws` : `${protocol}://${window.location.hostname}:3000`

//need to add logic to reflect disconnected streams from either frontend or backend
//need to add logic for when device disconnects unexpectedly and remove device from registered devices
//need to confirm and add logging for stream stream stopping on device and device disconnects on pyserver and further upstream
//all of these are likely the same issue


let deviceID;
let ws;
const feedstopButton = document.getElementById("feed-stop");
const laserstopButton = document.getElementById("laser-stop");
const laserstartButton = document.getElementById('laser-start');
const laserwrapper = document.getElementById('laser-wrapper');
const controller = document.getElementById("controller");
const feedsection = document.getElementById("feed-section");
const controlsection = document.getElementById("control-section");
const feedframe = document.getElementById("feed");
const loginForm = document.getElementById('login-form');
const deviceMenu = document.getElementById('device-menu');
const formMenu = document.getElementById('form-menu');
const errorDisplay = document.getElementById('error-message');


function showloginUI() {
  controlsection.classList.add('hidden');
  feedsection.classList.add('hidden');
  deviceMenu.classList.add('hidden');
  feedframe.src = "";
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  }
    }
  formMenu.classList.remove('hidden');
  loginForm.reset();
}

function showloggedinUI() {
  loginForm.reset();
  formMenu.classList.add('hidden');
  feedframe.src = "";
  if (ws && ws.readyState === WebSocket.OPEN) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  }
    }
  deviceMenu.classList.remove('hidden');
  controlsection.classList.add('hidden');
  feedsection.classList.add('hidden');
}



async function getValidToken() {
  let token = localStorage.getItem('jwt_token');
  
  if (!token) {
    showloginUI();
    return
  }
  return token;
}

loginForm.addEventListener('submit', async (e) => {
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
      getData();
    }
  } catch (err) {
    console.error('Login Error:', err.message);  

    if (errorDisplay) {
      errorDisplay.textContent = err.message;
      errorDisplay.style.color = 'red';
    }
  }
});

function UpdateUI(event) {
  const message = JSON.parse(event.data);
  if (message.type == "confirmation" && message.data == "timeout") {
    controller.classList.add('hidden')
    laserstartButton.classList.remove('hidden');
    laserwrapper.classList.remove('hidden');
  }
  if (message.type == "error") {
    showloginUI();
  }
}

function openWs(token) {
  const urlwithtoken = `${URL}?token=${token}`
  ws = new WebSocket (urlwithtoken);
  ws.onopen = () => {
    console.log("connected to server")
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
        type: "init_conn",
        role: "client",
        device: "node_server",
      }))
    }
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      };
    }, 30000);
  ws.addEventListener('message', UpdateUI);
}
}

async function getData() {
  console.log('fetching...');
  const token = await getValidToken();
  if (!token) return;
  const url = import.meta.env.PROD ? `https://${window.location.host}/device_list?token=${token}` : `http://${window.location.hostname}:3000/device_list?token=${token}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Expected JSON but got ${contentType || 'nothing'}. Status: ${response.status}`);
      }
      const result = await response.json();
      if (result.error == "Invalid or expired token.") {
        showloginUI();
        return
      }
      throw new Error(`Response status: ${response.status}`);
    }
    const result = await response.json();
    let cameralist = document.getElementById("cam-select")
    cameralist.addEventListener("change", initiatefeed)
    for (let camera of result.data) {
      let cam = document.createElement("option")
      cam.value = cam.text = camera
      cameralist.appendChild(cam)
    }
    openWs(token)
    showloggedinUI();
  } catch (error) {
    console.error(error.message);
  }
}

const initiatefeed = async (event) => {
  deviceID = event.target.value;
  feedsection.classList.remove('hidden');
  controlsection.classList.remove('hidden');
  controller.classList.add('hidden');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  }
  let token = await getValidToken();
  feedframe.classList.remove('active');
  laserstartButton.classList.remove('hidden');
  laserwrapper.classList.remove('hidden');
  feedframe.setAttribute("src", `${location.protocol}//${window.location.hostname}/stream?deviceID=${deviceID}&token=${token}`);
}
feedstopButton.addEventListener("click", () => {
  feedframe.setAttribute("src", "");
  feedframe.classList.remove('active');
  document.getElementById('default-select').selected = true;
  controller.classList.add('hidden');
  laserstartButton.classList.add('hidden');
  laserwrapper.classList.add('hidden');
  feedsection.classList.add('hidden');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  }
  });

laserstopButton.addEventListener("click", () => {
  console.log('Laser stop button clicked on click event');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  }
    controller.classList.add('hidden');
  laserstartButton.classList.remove('hidden');
  laserwrapper.classList.remove('hidden');
});
laserstopButton.addEventListener("touchend", () => {
  console.log('Laser stop button clicked on touchend event');
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  }
    controller.classList.add('hidden');
  laserstartButton.classList.remove('hidden');
  laserwrapper.classList.remove('hidden');
});
laserstartButton.addEventListener("click", async (e) => {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "on", device: deviceID, hubID: 123}));
   }
      const response = await waitForNextMessage(ws);
    console.log(response)
    if (response.data == "fail") window.alert("laser already being controllerled");
    else if (response.data == "success") {
      laserstartButton.classList.add('hidden');
      laserwrapper.classList.add('hidden');
      controller.classList.remove('hidden');
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

getData();

let lastSendTime = 0;
const throttleMS = 50;
let lastSentX = -1;
let lastSentY = -1;
const threshold = 0.02;

function sendServoData(x, y) {
  const now = Date.now();
  const hasMovedEnough = Math.abs(x - lastSentX) > threshold || Math.abs(y - lastSentY) > threshold;

  if (now - lastSendTime > throttleMS && hasMovedEnough) {
    x = Math.round(x*90)
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


