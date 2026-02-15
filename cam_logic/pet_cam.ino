#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ESPAsyncWebServer.h>
#include "esp_camera.h"
#include <ArduinoJson.h>
#include <Servo.h>
#include <ESPmDNS.h>
#include "camera_pins.h"

const char* ssid = "YOUR_SSID";
const char* password = "YOUR_PASSWORD";
camera_config_t camera_config = {
  .pin_pwdn = PWDN_GPIO_NUM,
  .pin_reset = RESET_GPIO_NUM,
  .pin_xclk = XCLK_GPIO_NUM,
  .pin_sccb_sda = SIOD_GPIO_NUM,
  .pin_sccb_scl = SIOC_GPIO_NUM,
  .pin_d7 = Y9_GPIO_NUM,
  .pin_d6 = Y8_GPIO_NUM,
  .pin_d5 = Y7_GPIO_NUM,
  .pin_d4 = Y6_GPIO_NUM,
  .pin_d3 = Y5_GPIO_NUM,
  .pin_d2 = Y4_GPIO_NUM,
  .pin_d1 = Y3_GPIO_NUM,
  .pin_d0 = Y2_GPIO_NUM,
  .pin_vsync = VSYNC_GPIO_NUM,
  .pin_href = HREF_GPIO_NUM,
  .pin_pclk = PCLK_GPIO_NUM,
  .xclk_freq_hz = 20000000,
  .ledc_timer = LEDC_TIMER_0,
  .ledc_channel = LEDC_CHANNEL_0,
  .pixel_format = PIXFORMAT_JPEG,
  .frame_size = FRAMESIZE_QVGA,  // 320x240, low RAM for ESP32
  .jpeg_quality = 10,
  .fb_count = 1
};


Servo panServo;
Servo tiltServo;

WebSocketsClient ws;

bool streaming = false;

void streamHandler(AsyncWebServerRequest *request) {
  WiFiClient client = request->client();
  while (streaming) {
    camera_fb_t * fb = esp_camera_fb_get();
    if (!fb) continue;
    
    client.printf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", fb->len);
    client.write(fb->buf, fb->len);
    client.print("\r\n");
    esp_camera_fb_return(fb);
    delay(100); // controls FPS
  }
}

void onWsEvent(WStype_t type, uint8_t *payload, size_t len) {
  if (type == WStype_TEXT) {
    StaticJsonDocument<200> doc;
    deserializeJson(doc, payload);

    if (doc["type"] == "servo") {
      float pan = doc["pan"];
      float tilt = doc["tilt"];
      moveServos(pan, tilt);
    }
    
    if (doc["type"] == "video") {
      if (doc["action"] == "start") startStream();
      if (doc["action"] == "stop") stopStream();
    }
  }
}

void setupWebSocket() {
  ws.begin("pi-hub.local", 8080, "/esp32");
  ws.onEvent(onWsEvent);
  ws.setReconnectInterval(3000);
}


void moveServos(float pan, float tilt) {
  panServo.write(pan * 180);
  tiltServo.write(tilt * 180);
}

AsyncWebServer server(80);


void setupHttp() {
  server.on("/stream", HTTP_GET, [](AsyncWebServerRequest *req) {
    req->send_P(200, "multipart/x-mixed-replace; boundary=frame", streamHandler);
  });

  server.begin();
}


void startStream() {
  if (!streaming) {
    esp_camera_init(&camera_config);
    streaming = true;
  }
}

void stopStream() {
  if (streaming) {
    esp_camera_deinit();
    streaming = false;
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("WiFi connected");

  if (!MDNS.begin("esp32cam")) {
    Serial.println("mDNS failed");
  }
  panServo.attach(12); // example GPIO
  tiltServo.attach(13);

  setupWebSocket();
  setupHttp();
}

void loop() {
  ws.loop();
}

// {
//   "type": "servo",
//   "pan": 0.42,
//   "tilt": 0.78
// }

// { "type": "video", "action": "start" }
// { "type": "video", "action": "stop" }

// Core 0:
//  ├── WiFi + WebSocket
//  └── Control handler

// Core 1:
//  ├── Camera task (MJPEG)
//  └── HTTP server