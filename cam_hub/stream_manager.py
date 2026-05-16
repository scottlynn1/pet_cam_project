import asyncio
import aiohttp
import json
import websockets
import logging
import time

class StreamManager:
    def __init__(self, NODE_URL, CAM_URL, SERVER_ID):
        self.active_streams = {}
        self.session = None # We will initialize this later
        self.server_id = SERVER_ID
        self.node_url = NODE_URL
        self.cam_url = CAM_URL

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
        try:
          session = await self.get_session() # Use the SHARED session
          ws_stream = await websockets.connect(self.node_url)
          await ws_stream.send(json.dumps({
              "type": "init_stream", 
              "role": "py_server", 
              "hubID": self.server_id, 
              "device": device_id, 
              "socket_id": socket_id
              }))
          while True:
            try:
              async with session.get(f"{self.cam_url}{device_id}.local/stream") as resp:
                  if resp.status != 200:
                      logging.warning("Bad response: %s", resp.status)
                      await asyncio.sleep(1)
                      continue
                  
                  try:
                    async for chunk in resp.content.iter_chunked(4096):
                        start = time.time()
                        await ws_stream.send(chunk)
                        elapsed = time.time() - start

                        if elapsed > 0.02:
                            logging.warning(f"WS slow send: {elapsed:.3f}s")

                        if ws_stream.transport:
                            buf = ws_stream.transport.get_write_buffer_size()
                            if buf > 1024 * 1024:
                                logging.warning(f"WS buffer high: {buf}")
                    print("HTTP STREAM CLOSED")
                  except websockets.exceptions.ConnectionClosed:
                      logging.warning("WS closed, reconnecting... break")
                      break

            except Exception as e:
                logging.error("Stream socket error: %s", e, exc_info=True)
                await asyncio.sleep(1)
        except Exception as e:
            logging.error("stream socket connection error: %s", e)
        finally:
            if ws_stream:
                print(f"closing and removing stream from active streams for device: {device_id}")
                await ws_stream.close()
            self.active_streams.pop(device_id, None)