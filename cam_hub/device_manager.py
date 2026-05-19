import asyncio
import json
import time

class DeviceManager:
    def __init__(self, SERVER_ID):
        self.devices = {}
        self.comm_socket = None
        self.watchdog_task = None
        self.server_id = SERVER_ID

    async def watchdog_loop(self, interval=60.0):
        try:
          while True:
              await asyncio.sleep(30.0)
              if not self.devices:
                  break
              print("checking for devices with laser left on")
              for device in self.devices.values():
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
                          continue
        finally:
            print("watchdog loop ended")
            self.watchdog_task = None

    def start_watchdog(self):
        if not self.watchdog_task:
            print("starting watchdog")
            self.watchdog_task = asyncio.create_task(self.watchdog_loop())

    def stop_watchdog(self):
        if self.watchdog_task:
            print("stoping watchdog")
            self.watchdog_task.cancel()
            
    async def register(self, stream_id, role, websocket, cam_name=None):
        print(f"registering device: {role} with stream_id: {stream_id}")
        self.devices[stream_id] = {
            "ws": websocket,
            "role": role,
            "cam_name": cam_name if cam_name else stream_id,
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
		            "hubID": self.server_id
            }))

        async for msg in websocket:
            msg = json.loads(msg)
            client = device["client_user"]
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
                if msg["clientID"] == "pyserver":
                    await self.comm_socket.send(json.dumps({"type": "confirmation", "data": "timeout", "clientID": client}))
                else:
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
                        "hubID": self.server_id
                }))
        if not self.devices:
            self.stop_watchdog()

    def get(self, stream_id):
        return self.devices.get(stream_id)

    def list(self):
        return [{"id": sid, "name": dev["cam_name"]} for sid, dev in self.devices.items()]