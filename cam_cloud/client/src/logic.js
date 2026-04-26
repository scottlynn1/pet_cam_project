const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const URL = import.meta.env.PROD ? `${protocol}://${window.location.host}/ws` : `${protocol}://${window.location.hostname}:3000`

//need to add logic to reflect disconnected streams from either frontend, backend or device and switching off of laser and removal of user from device.
//need to refresh expired jwt's and more secure storage on frontend
//need to impliment login with rate limiting and 2fa
//need to clean up disconnection logic

let deviceID;
let ws;
const feedstopButton = document.getElementById("feedstop");
const laserstopButton = document.getElementById("laser-stop");
const laserstartButton = document.getElementById('laser-start');
const controller = document.getElementById("controller");
const feedsection = document.getElementById("feed-section");
const feedframe = document.getElementById("feed");

async function getValidToken() {
  let token = localStorage.getItem('relay_token');
  
  if (!token) {
    const response = await fetch(`https://${window.location.host}/get-token`);
    console.log(response);
    const data = await response.json();
    token = data.token;
    localStorage.setItem('relay_token', token);
  }
  return token;
}

function UpdateUI(event) {
  const message = JSON.parse(event.data);
  if (message.type == "confirmation" && message.data == "timeout") {
    controller.classList.add('hidden')
    laserstartButton.classList.remove('hidden');
    laserwrapper.classList.remove('hidden');
  }

}

async function getData() {
  console.log('fetching...');
  const token = await getValidToken();
  const url = import.meta.env.PROD ? `https://${window.location.host}/device_list?hubID=123&token=${token}` : `http://${window.location.hostname}:3000/device_list?hubID=123&token=${token}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }
    console.log(response)
    const result = await response.json();
    console.log(result);
    let cameralist = document.getElementById("cam-select")
    cameralist.addEventListener("change", attach)
    for (let camera of result.data) {
      let cam = document.createElement("option")
      cam.value = cam.text = camera
      cameralist.appendChild(cam)
    }
    const urlwithtoken = `${URL}?token=${token}`
    ws = new WebSocket (urlwithtoken);
    ws.onopen = () => {
      console.log("connected to server")
      ws.send(JSON.stringify({
        type: "init_conn",
        role: "client",
        device: "node_server",
        hubID: 123
      }))
      setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);
    };
    ws.addEventListener('message', UpdateUI);
  } catch (error) {
    console.error(error.message);
  }
}

getData();

feedstopButton.addEventListener("click", () => {
  feedframe.setAttribute("src", "");
  feedframe.classList.remove('active');
  document.getElementById('default-select').selected = true;
  controller.classList.add('hidden');
  laserstartButton.classList.add('hidden');
  laserwrapper.classList.add('hidden');
  feedsection.classList.add('hidden');
  ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
});
feedframe.onload = () => {
  setTimeout(() => {
    feedframe.classList.add('active');
  }, 300); // small intentional delay
};

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

laserstartButton.addEventListener("click", async (e) => {
  try {
    ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "on", device: deviceID, hubID: 123}));
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
// maybe add delay here or wait for success confirmation logic before showing activat laser button?
laserstopButton.addEventListener("click", () => {
  ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  controller.classList.add('hidden');
  laserstartButton.classList.remove('hidden');
  laserwrapper.classList.remove('hidden');
});


const attach = (event) => {
  console.log("event-triggered");
  deviceID = event.target.value;
  feedsection.classList.remove('hidden');
  controller.classList.add('hidden');
  ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: deviceID, hubID: 123}));
  let token = localStorage.getItem('relay_token');
  feedframe.classList.remove('active');
  laserstartButton.classList.remove('hidden');
  laserwrapper.classList.remove('hidden');
  feedframe.setAttribute("src", `${location.protocol}//${window.location.hostname}/stream?deviceID=${deviceID}&hubID=123&token=${token}`);
  // setTimeout(() => {
  //   feedframe.classList.add('active');
  // }, 500);
}



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
    ws.send(JSON.stringify({ 
      type: "servo_cmd", 
      role: "client", 
      data: { x, y }, 
      device: deviceID
    }))
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
