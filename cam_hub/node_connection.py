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