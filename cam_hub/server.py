import asyncio
import websockets
import json
import aiohttp
import time

PORT = 5000
NODE_URL = 'wss://project4.scottlynn.live/ws'
CAM_URL = "http://esp32cam.local/stream/"
SERVER_ID = 123

class DeviceManager:
    def __init__(self):
        self.devices = {}
        self.comm_socket = None
        self.watchdog_task = None

    def start_watchdog(self):
        if not self.watchdog_task:
            self.watchdog_task = asyncio.create_task(self.watchdog_loop())
    def stop_watchdog(self):
        if self.watchdog_task:
            self.watchdog_task.cancel()
            self.watchdog_task = None

    async def watchdog_loop(self, interval=60.0):
        try:
            while True:
                await asyncio.sleep(30.0)
                if not self.devices:
                    break
                for device in list(self.devices.values()):
                    elapsed = time.time() - device["last_sent_time"]
                    if device.get("status") == "on" and elapsed > interval:
                        print(f"Safety Trigger! No message sent for {elapsed:.1f}s")
                        try:
                            await device["ws"].send(json.dumps(
                                { "type": "laser_cmd", "role": "hub", "data": "off", "clientID": "pyserver"}
                            ))
                            device["status"] = "off"
                            # Reset the timer so we don't spam the safety check
                            device["last_sent_time"] = time.time()
                        except Exception as e:
                            print(f"Watchdog failed to send command: {e}")
                            break
        finally:
            self.watchdog_task = None
            
    async def register(self, stream_id, role, websocket):
        print(f"registering device: {role} with stream_id: {stream_id}")
        self.devices[stream_id] = {
            "ws": websocket,
            "role": role,
            "status": "off",
            "client_user": None,
            "pending_connection": False,
            "last_sent_time": time.time()
        }

        self.start_watchdog()

        device = self.devices[stream_id]

        if self.comm_socket:
            print(f"sending device list update for devices: {self.list()}")
            await self.comm_socket.send(json.dumps({
                "type": "sync_data",
                "devices": self.list(),
		            "hubID": SERVER_ID
            }))

        async for msg in websocket:
            msg = json.loads(msg)
            if msg["type"] != "status_update":
                return
            device["status"] = msg["status"]
            if msg["status"] == "on":
                device["client_user"] = msg["clientID"]
                device["last_sent_time"] = time.time()
                device["pending_connection"] = False
            elif msg["status"] == "off":
                device["client_user"] = None
            if self.comm_socket:
                await self.comm_socket.send(json.dumps({"type": "confirmation", "data": "success", "clientID": msg["clientID"]}))
                print(f"device status for device: {msg["role"]} changed to {msg["status"]} by clientID: {msg["clientID"]}")
            else:
                print("comm_socket closed early")
    
    async def unregister(self, stream_id):
        removed_device = self.devices.pop(stream_id, None)
        if removed_device is not None:
            print(f"unregistering device: {removed_device["role"]} with stream_id: {stream_id}")
            if self.comm_socket:
                await self.comm_socket.send(json.dumps({
                    "type": "sync_data",
                    "devices": self.list(),
                        "hubID": SERVER_ID
                }))
        if not self.devices:
            self.stop_watchdog()

    def get(self, stream_id):
        return self.devices.get(stream_id)

    def list(self):
        return list(self.devices.keys())
    

class StreamManager:
    def __init__(self):
        self.active_streams = {}
        self.session = None # We will initialize this later

    async def get_session(self):
        # Lazy initialization of a single shared session
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession()
        return self.session

    async def start(self, device_id, socket_id):
        if device_id in self.active_streams:
            print(f"device: {device_id} already in active streams")
            return
        task = asyncio.create_task(self._stream(device_id, socket_id))
        self.active_streams[device_id] = task

    # maybe add better closing logic for ws_stream closed from upstream?
    async def _stream(self, device_id, socket_id):
        ws_stream = None
        session = await self.get_session() # Use the SHARED session
        try:
            ws_stream = await websockets.connect(NODE_URL)

            await ws_stream.send(json.dumps({
                "type": "init_stream", "role": "py_server", "hubID": SERVER_ID, "device": device_id, "socket_id": socket_id
                }))
            print(f"starting ws video stream for device: {device_id}")
            async with session.get(f"{CAM_URL}{device_id}") as resp:
                async for chunk in resp.content.iter_chunked(4096):
                    await ws_stream.send(chunk)

        except Exception as e:
            print(f"Stream socket error: {e}")
        finally:
            if ws_stream:
                print(f"closing and removing stream from active streams for device: {device_id}")
                await ws_stream.close()
            self.active_streams.pop(device_id, None)


class NodeConnection:
    def __init__(self, device_manager, stream_manager):
        self.ws = None
        self.device_manager = device_manager
        self.stream_manager = stream_manager

    async def connect(self, uri):
        while True:
            try:
                async with websockets.connect(uri) as ws:
                    # maybe add logic here to send off command to all lasers if commands not recieved for more than a period of time ? for all devices in on status
                    self.ws = ws
                    self.device_manager.comm_socket = ws
                    print(f"connecting to node server")
                    await ws.send(json.dumps({
                        "type": "init_conn", 
                        "role": "py_server", 
                        "hubID": SERVER_ID, 
                        "devices": device_manager.list()
                      }))


                    async for msg in ws:
                        await self._handle(msg)

            except websockets.exceptions.ConnectionClosed as e:
                print(f"Command socket closed: {e.code} - {e.reason}")

            except Exception as e:
                print(f"Command socket error: {e}")

            finally:
                print("Cleaning up comm ws connection for node server")
                self.ws = None
                self.device_manager.comm_socket = None
            
            await asyncio.sleep(5)

    
    async def _handle(self, message):
        msg = json.loads(message)
        print(f"message recieved from node server:\n  {msg}")
        device = self.device_manager.get(msg["device"])
        if device:
            if msg["type"] == "laser_cmd":
                if device["pending_connection"] or (device["client_user"] is not None and msg["clientID"] != device["client_user"]):
                    print(f"Laser for device: {device["role"]} already in {msg["data"]} state")
                    await self.ws.send(json.dumps({"type": "confirmation", "data": "fail", "clientID": msg["clientID"]}))
                else:      
                    print(f"sending laser cmd of {msg["data"]} to {device["role"]}")
                    if msg["data"] == "on":
                        device["pending_connection"] = True
                    await device["ws"].send(json.dumps(msg))

            elif msg["type"] == "servo_cmd":
                if msg["clientID"] == device["client_user"]:
                  print(f"sending servo cmd data to device: {device['role']}")
                  await device["ws"].send(json.dumps(msg))
                  device["last_sent_time"] = time.time()
                else:
                    print("servo cmd failed, device being controlled by another user")


            elif msg["type"] == "init_stream":
                print(f"init stream cmd recieved, passing to stream manager")
                await self.stream_manager.start(msg["device"], msg["socket_id"])
        else:
            print("device not found in device registery")    

            
device_manager = DeviceManager()
stream_manager = StreamManager()
node_connection = NodeConnection(device_manager, stream_manager)


async def listen(websocket):
    print("ESP32 connecting")
    streamId = None
    try:
      await websocket.send(json.dumps({
          "type":"init_conn",
          "role":"py_server"
      }))
      print("init msg sent")
      msg = await websocket.recv()
      device_data = json.loads(msg)
      if device_data.get("type") == "init_conn":
          print("init_conn recieved from ", device_data["role"])
          streamId = str(device_data["streamId"])
          print("Registering: ", device_data["role"], " with streamId: ", streamId)
          await device_manager.register(streamId, device_data["role"], websocket)
      else:
          print("first message not 'init_conn'")
          raise Exception("message recieved not 'init_conn'")
    except websockets.exceptions.ConnectionClosed as e:
        print(f"ESP32 disconnected: {e.code} - {e.reason}")
    except Exception as e:
        print(f"CRITICAL ERROR: {e}")

    finally:
        if streamId and streamId in device_manager.list():
            print("Unregistering device with streamId: ", streamId)
            await device_manager.unregister(streamId)

async def start_server():
    server = await websockets.serve(
        listen,
        "0.0.0.0",
        PORT,
        ping_interval=20,
        ping_timeout=20
    )
    print(f"WebSocket server listening on {PORT}")
    await server.wait_closed()

async def main():
    await asyncio.gather(
      start_server(),
      node_connection.connect(NODE_URL)
    )

if __name__ == "__main__":
    asyncio.run(main())


