import { io } from 'socket.io-client'
const socket = io('http://localhost:3000')
socket.on('connect', () => {
  console.log(`You connected with id: ${socket.id}`)
})

const control = document.getElementById("control");

control.addEventListener("touchstart", e => {
  e.preventDefault();
  console.log(e.touches[0].clientX);
  console.log(e.touches[0].clientY);
})
control.addEventListener("touchmove", e => {
  e.preventDefault();
  [...e.touches].forEach(touch => {
    socket.emit('custom-event', touch.clientX)
    socket.emit('custom-event', touch.clientY)
  })
})
control.addEventListener("touchend", (e) => {
  e.preventDefault();
  console.log(e.touches[0].clientX);
  console.log(e.touches[0].clientY);
})