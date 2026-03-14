const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const url = import.meta.env.PROD ? `${protocol}://${window.location.host}/ws` : `${protocol}://${window.location.hostname}:3000`
const ws = new WebSocket (url);

ws.onopen = () => {
  console.log("connected to server")
  ws.send(JSON.stringify({
    type: "init_conn",
    role: "client",
    target: "node_server"
  }))
};
ws.onmessage = (e) => {
  let device_data = JSON.parse(e.data) 
  console.log(device_data.data)
  // do something with device_data.data
  // update UI dropdown menu of cameras to choose from
}


let streamId;
const container = document.getElementById("container");
const control = document.getElementById("control");
const displayButton = document.getElementById("camselect");
const feedstopButton = document.getElementById("feedstop");
const feedframe = document.getElementById("feed");

displayButton.addEventListener("click", () => {
  console.log("event-triggered")
  streamId = 1;
  feedframe.setAttribute("src", `${location.protocol}//${window.location.host}/stream?streamId=1`)
  displayButton.style.display = "none"
  feedstopButton.style.display = "block"
})

feedstopButton.addEventListener("click", () => {
  feedframe.setAttribute("src", "")
  displayButton.style.display = "block"
  feedstopButton.style.display = "none"
})


// ws.onmessage = (event) => {
//   const msg = JSON.parse(event.data);
//   console.log(msg)
// }

control.addEventListener("touchstart", e => {
  e.preventDefault();
  let rect = control.getBoundingClientRect();
  let x = (e.touches[0].clientX - rect.left) / rect.width;
  let y = (e.touches[0].clientY - rect.top) / rect.height;
  ws.send(JSON.stringify({ type: "servo_cmd", role: "client", data: { x, y }, target: streamId}))
  console.log(x);
  console.log(y);
})

control.addEventListener("touchmove", e => {
  e.preventDefault();
  let rect = control.getBoundingClientRect();
  [...e.touches].forEach(touch => {
    let x = (touch.clientX - rect.left) / rect.width;
    let y = (touch.clientY - rect.top) / rect.height;
    ws.send(JSON.stringify({ type: "servo_cmd", role: "client", data: { x, y }, target: streamId}))
    console.log(x)
    console.log(y)
  })
})

control.addEventListener("touchend", (e) => {
  e.preventDefault();
  let rect = control.getBoundingClientRect();
  let x = (e.changedTouches[0].clientX - rect.left) / rect.width;
  let y = (e.changedTouches[0].clientY - rect.top) / rect.height;
  ws.send(JSON.stringify({ type: "servo_cmd", role: "client", data: { x, y }, target: streamId}))
  console.log(x);
  console.log(y);
})
