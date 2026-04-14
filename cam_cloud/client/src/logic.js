const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const URL = import.meta.env.PROD ? `${protocol}://${window.location.host}/ws` : `${protocol}://${window.location.hostname}:3000`

let streamId;
let ws;
const container = document.getElementById("container");
const feedstopButton = document.getElementById("feedstop");
const laserstopButton = document.getElementById("laserstop");
const laserButton = document.getElementById('laser-button');
const control = document.getElementById("control");
const feedframe = document.getElementById("feed");

async function getValidToken() {
  let token = localStorage.getItem('relay_token');
  
  if (!token) {
    const response = await fetch('http://localhost:3000/get-token');
    const data = await response.json();
    token = data.token;
    localStorage.setItem('relay_token', token);
  }
  return token;
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
    };
  } catch (error) {
    console.error(error.message);
  }
}

getData();

feedstopButton.addEventListener("click", () => {
  feedframe.setAttribute("src", "");
  document.getElementById('default-select').selected = true;
  control.style.display = "none";
  laserButton.style.display = "none";
  feedframe.style.display = "none";
  laserstopButton.style.display = "none";
  feedstopButton.style.display = "none";
  ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: streamId, hubID: 123}));
});
// need to add timeout for no response from hub or esp32
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

laserButton.addEventListener("click", async (e) => {
  try {
    ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "on", device: streamId, hubID: 123}));
    const response = await waitForNextMessage(ws);
    console.log(response)
    if (response.data == "fail") window.alert("laser already being controlled");
    else if (response.data == "success") {
      control.style.display = "block";
      laserButton.style.display = "none";
      laserstopButton.style.display = "block";
    }
  } catch (err) {
    console.error(err);
    window.alert("Connection error: The device did not respond in time")
  }
});
// maybe add delay here or wait for success confirmation logic before showing activat laser button?
laserstopButton.addEventListener("click", () => {
  ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: streamId, hubID: 123}));
  control.style.display = "none";
  laserstopButton.style.display = "none";
  laserButton.style.display = "block";
});


const attach = (event) => {
  console.log("event-triggered")
  streamId = event.target.value;
  feedframe.style.display = "block"
  laserButton.style.display = "block"
  let token = localStorage.getItem('relay_token');
  feedframe.setAttribute("src", `${location.protocol}//${window.location.hostname}/stream?streamId=${streamId}&hubID=123&token=${token}`)
  feedstopButton.style.display = "block"
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
      device: streamId
    }))
    lastSentX = x;
    lastSentY = y;
    lastSendTime = now;
  }
}

control.addEventListener("touchstart", e => {
  e.preventDefault();
  let rect = control.getBoundingClientRect();
  let x = (e.touches[0].clientX - rect.left) / rect.width;
  let y = (e.touches[0].clientY - rect.top) / rect.height;
  sendServoData(x, y);
})

control.addEventListener("touchmove", e => {
  e.preventDefault();
  let rect = control.getBoundingClientRect();
  [...e.touches].forEach(touch => {
    let x = (touch.clientX - rect.left) / rect.width;
    let y = (touch.clientY - rect.top) / rect.height;
    sendServoData(x, y)
  })
})

control.addEventListener("touchend", (e) => {
  e.preventDefault();
  let rect = control.getBoundingClientRect();
  let x = (e.changedTouches[0].clientX - rect.left) / rect.width;
  let y = (e.changedTouches[0].clientY - rect.top) / rect.height;
  sendServoData(x, y)
})
