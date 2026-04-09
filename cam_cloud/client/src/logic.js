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

feedstopButton.addEventListener("click", () => {
  feedframe.setAttribute("src", "");
  feedstopButton.style.display = "none";
  control.style.display = "none";
  laserButton.style.display = "none";
  feedframe.style.display = "none";
  laserstopButton.style.display = "none"
  ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", target: streamId, hubID: 123}));
});

function waitForNextMessage(ws) {
  return new Promise ((resolve) => {
    const handler = (event) => {
      const data = JSON.parse(event.data)
      console.log(data)
      if (data.type == "confirmation") {
        ws.removeEventListener("message", handler);
        resolve(data);
      }
    }

    ws.addEventListener("message", handler)
  })
}

laserButton.addEventListener("click", async (e) => {
  ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "on", device: streamId, hubID: 123}));
  const response = await waitForNextMessage(ws);
  console.log(response)
  if (response.data == "fail") window.alert("laser already being controlled");
  else if (response.data == "success") {
    control.style.display = "block";
    laserButton.style.display = "none";
    laserstopButton.style.display = "block";
  }
});

laserstopButton.addEventListener("click", () => {
  ws.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device: streamId, hubID: 123}));
  control.style.display = "none";
  laserstopButton.style.display = "none";
  laserButton.style.display = "block";
});

async function getData() {
  console.log('fetching...');
  const url = import.meta.env.PROD ? `https://${window.location.host}/device_list?hubID=123` : `http://${window.location.hostname}:3000/device_list?hubID=123`;
  try {
    const response = await fetch(url, {
      credentials: "include"
    });
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
    ws = new WebSocket (URL);
    ws.onopen = () => {
      console.log("connected to server")
      ws.send(JSON.stringify({
        type: "init_conn",
        role: "client",
        target: "node_server",
        hubID: 123
      }))
    };
  } catch (error) {
    console.error(error.message);
  }
}

const attach = (event) => {
  console.log("event-triggered")
  streamId = event.target.value;
  feedframe.style.display = "block"
  laserButton.style.display = "block"
  feedframe.setAttribute("src", `${location.protocol}//${window.location.hostname}/stream?streamId=${streamId}&hubID=123`)
  feedstopButton.style.display = "block"
}


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
    ws.send(JSON.stringify({ 
      type: "servo_cmd", 
      role: "client", 
      data: { x, y }, 
      target: streamId
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
  console.log(x);
  console.log(y);
})

control.addEventListener("touchmove", e => {
  e.preventDefault();
  let rect = control.getBoundingClientRect();
  [...e.touches].forEach(touch => {
    let x = (touch.clientX - rect.left) / rect.width;
    let y = (touch.clientY - rect.top) / rect.height;
    sendServoData(x, y)
    console.log(x)
    console.log(y)
  })
})

control.addEventListener("touchend", (e) => {
  e.preventDefault();
  let rect = control.getBoundingClientRect();
  let x = (e.changedTouches[0].clientX - rect.left) / rect.width;
  let y = (e.changedTouches[0].clientY - rect.top) / rect.height;
  sendServoData(x, y)
  console.log(x);
  console.log(y);
})
