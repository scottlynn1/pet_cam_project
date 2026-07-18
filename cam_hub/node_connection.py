import asyncio
import json
import websockets
import time

class NodeConnection:
    def __init__(self, device_manager, stream_manager, SERVER_ID):
        self.ws = None
        self.device_manager = device_manager
        self.stream_manager = stream_manager
        self.server_id = SERVER_ID
        self.tapo_device = None
        self.client = None

    async def add_tapo_device(self, device, client):
        print('adding device')
        self.tapo_device = device
        self.client = client
        device = await asyncio.wait_for(self.client.p110(self.tapo_device), timeout=1.5)
        info = await device.get_device_info()
        print(info.device_on)
        if info.device_on:
            await self.ws.send(json.dumps({"type": "tapo_data", "data": "on"}))
        else:
            await self.ws.send(json.dumps({"type": "tapo_data", "data": "off"}))


    async def connect(self, uri):
        while True:
            try:
                async with websockets.connect(uri) as ws:
                    self.ws = ws
                    self.device_manager.comm_socket = ws
                    print(f"connecting to node server")
                    await ws.send(json.dumps({
                        "type": "init_conn", 
                        "role": "py_server", 
                        "hubID": self.server_id, 
                        "devices": self.device_manager.list()
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

        if msg["type"] == "tapo_cmd":
            device = await asyncio.wait_for(self.client.p110(self.tapo_device), timeout=1.5)
            if msg["data"] == "on":
                await device.on()
                await self.ws.send(json.dumps({"type": "tapo_data", "data": "on"}))

            if msg["data"] == "off":
                await device.off()
                await self.ws.send(json.dumps({"type": "tapo_data", "data": "off"}))
            return
            
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




            elif msg["type"] == "set_cam_name":
                device["cam_name"] = msg["name"]
                await device["ws"].send(json.dumps(msg))
                if self.device_manager.comm_socket:
                    await self.device_manager.comm_socket.send(json.dumps({
                        "type": "sync_data",
                        "devices": self.device_manager.list(),
                        "hubID": self.server_id
                    }))

            elif msg["type"] == "init_stream":
                print(f"init stream cmd recieved, passing to stream manager")
                await self.stream_manager.start(msg["device"], msg["socket_id"])
        else:
            print("device not found in device registery")    