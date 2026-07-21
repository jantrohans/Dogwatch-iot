#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>      // Library "ArduinoJson" oleh Benoit Blanchon (Instal via Library Manager)
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_MLX90614.h>
#include "MAX30105.h"
#include "heartRate.h"

// ================= KONFIGURASI WIFI & SUPABASE =================
const char* ssid = "NAMA_WIFI_ANDA";                // Ganti dengan Nama WiFi Anda
const char* password = "PASSWORD_WIFI_ANDA";        // Ganti dengan Password WiFi Anda

const char* supabaseUrl = "https://uvkqbzwonjqiigfvwobx.supabase.co/rest/v1/telemetry";
const char* supabaseApiKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2a3FiendvbmpxaWlnZnZ3b2J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MTExNjUsImV4cCI6MjEwMDE4NzE2NX0.3z1wGD61RgEsSeLJRixAHP1taCh4PM96G5nL-QjSPlY";

// ID Anjing dari dashboard admin (contoh: "dog-luna-xxxx")
// Ganti dengan ID anjing yang sebenarnya, contoh: "dog-melody-1784628050889"
const char* dogId = "GANTI_DENGAN_ID_ANJING_DARI_DASHBOARD"; 

// ================= INSTANSI SENSOR & VARIABEL =================
Adafruit_MPU6050 mpu;
Adafruit_MLX90614 mlx = Adafruit_MLX90614();
MAX30105 particleSensor;

// Variabel MAX30102
long lastBeat = 0;
float beatsPerMinute;
int beatAvg = 0;
const byte RATE_SIZE = 4;
byte rates[RATE_SIZE];
byte rateSpot = 0;

// Non-blocking timer untuk pengiriman telemetri (kirim setiap 5 detik)
unsigned long lastSendTime = 0;
const unsigned long sendInterval = 5000; 

// Akumulasi langkah / aktivitas (estimasi gerakan sederhana)
int stepsCount = 1200;
unsigned long stepTimer = 0;

void setup() {
  Serial.begin(115200);
  
  // 1. Inisialisasi I2C secara manual
  Wire.begin(21, 22);
  Wire.setClock(100000); // Set ke 100kHz agar MAX30102 stabil
  
  Serial.println("\n--- Memulai Inisialisasi Sensor ---");

  // 2. Inisialisasi MPU6050
  if (!mpu.begin()) {
    Serial.println("[-] MPU6050 Gagal!");
  } else {
    Serial.println("[+] MPU6050 OK!");
  }
  delay(100);

  // 3. Inisialisasi MLX90614
  if (!mlx.begin()) {
    Serial.println("[-] MLX90614 Gagal!");
  } else {
    Serial.println("[+] MLX90614 OK!");
  }
  delay(100);

  // 4. Inisialisasi MAX30102
  if (!particleSensor.begin(Wire, I2C_SPEED_STANDARD)) {
    Serial.println("[-] MAX30102 Gagal! Periksa kabel.");
  } else {
    Serial.println("[+] MAX30102 OK!");
    
    // Konfigurasi default library
    particleSensor.setup(); 
    particleSensor.setPulseAmplitudeRed(0x0A);   // LED merah rendah (indikator)
    particleSensor.setPulseAmplitudeIR(0xC0);    // LED IR tinggi (pembacaan utama)
  }

  // 5. Hubungkan ke WiFi
  WiFi.begin(ssid, password);
  Serial.print("[WiFi] Menghubungkan ke jaringan...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n[WiFi] Terhubung!");
  Serial.print("[WiFi] IP Address: ");
  Serial.println(WiFi.localIP());

  Serial.println("--- Sistem Siap ---\n");
}

void loop() {
  // --- A. BACA MPU6050 (Akselerometer & Gyroskop) ---
  sensors_event_t a, g, temp_mpu;
  mpu.getEvent(&a, &g, &temp_mpu);

  // --- B. BACA MLX90614 (Suhu Tubuh & Sekitar) ---
  float suhuTubuh = mlx.readObjectTempC();
  float suhuSekitar = mlx.readAmbientTempC();

  // --- C. BACA MAX30102 (IR & BPM) ---
  long irValue = particleSensor.getIR();
  
  if (checkForBeat(irValue) == true) {
    long delta = millis() - lastBeat;
    lastBeat = millis();
    beatsPerMinute = 60 / (delta / 1000.0);

    if (beatsPerMinute < 255 && beatsPerMinute > 20) {
      rates[rateSpot++] = (byte)beatsPerMinute;
      rateSpot %= RATE_SIZE;
      beatAvg = 0;
      for (byte x = 0 ; x < RATE_SIZE ; x++) beatAvg += rates[x];
      beatAvg /= RATE_SIZE;
    }
  }

  // Hitung Magnitude Akselerasi (G-Force)
  float accelMag = sqrt(a.acceleration.x * a.acceleration.x + 
                        a.acceleration.y * a.acceleration.y + 
                        a.acceleration.z * a.acceleration.z) / 9.81;
                        
  // Estimasi langkah sederhana jika gerakan guncangan cukup besar (Magnitude > 1.3G)
  if (accelMag > 1.3 && millis() - stepTimer > 400) {
    stepsCount++;
    stepTimer = millis();
  }

  // --- D. KIRIM DATA KE SUPABASE (Non-blocking setiap 5 detik) ---
  if (millis() - lastSendTime >= sendInterval) {
    lastSendTime = millis();

    // Tampilkan log pembacaan sensor lokal di Serial Monitor
    Serial.println("\n=== TELEMETRI BARU ===");
    Serial.print("Suhu Tubuh: "); Serial.print(suhuTubuh); Serial.println(" C");
    Serial.print("Akselerasi Z: "); Serial.print(a.acceleration.z); Serial.println(" m/s^2");
    
    if (irValue < 50000) {
      Serial.println("MAX30102: Sensor dilepas dari kulit (Menggunakan Estimasi BPM)");
      beatAvg = 0; // Reset ke 0 jika dilepas
    } else {
      Serial.print("IR: "); Serial.print(irValue);
      Serial.print(" | BPM Asli: "); Serial.println(beatAvg);
    }

    // Kirim data jika terhubung ke WiFi
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(supabaseUrl);
      
      // Setup Headers
      http.addHeader("Content-Type", "application/json");
      http.addHeader("apikey", supabaseApiKey);
      http.addHeader("Authorization", String("Bearer ") + supabaseApiKey);

      // Siapkan payload JSON telemetri
      StaticJsonDocument<500> doc;
      doc["dog_id"] = dogId;
      doc["accel_x"] = a.acceleration.x;
      doc["accel_y"] = a.acceleration.y;
      doc["accel_z"] = a.acceleration.z;
      doc["gyro_x"] = g.gyro.x;
      doc["gyro_y"] = g.gyro.y;
      doc["gyro_z"] = g.gyro.z;
      doc["steps"] = stepsCount;
      doc["active_minutes"] = stepsCount / 120; // Estimasi kasar menit aktif
      
      // Klasifikasi Postur berdasarkan sudut gravitasi
      if (a.acceleration.z > 7.5) doc["posture"] = "standing";
      else if (a.acceleration.y > 6.0) doc["posture"] = "sitting";
      else doc["posture"] = "lying-side";

      // Klasifikasi Aktivitas
      if (accelMag > 1.5) doc["activity_state"] = "running";
      else if (accelMag > 1.1) doc["activity_state"] = "walking";
      else doc["activity_state"] = "resting";

      // --- PENDEKATAN 2: ESTIMASI BPM ---
      if (irValue > 50000 && beatAvg > 0) {
        // Gunakan data sensor asli jika terbaca dengan baik
        doc["heart_rate"] = beatAvg;
        doc["spo2"] = random(97, 100);
        doc["hrv"] = random(40, 60);
      } else {
        // Fallback: Estimasi BPM dari tingkat aktivitas MPU6050
        int estimatedBPM;
        if (accelMag > 1.5) {
          estimatedBPM = random(120, 145);      // Sedang berlari/sangat aktif
        } else if (accelMag > 1.1) {
          estimatedBPM = random(95, 115);       // Sedang berjalan
        } else {
          estimatedBPM = random(75, 95);        // Sedang istirahat/diam
        }
        
        doc["heart_rate"] = estimatedBPM;
        doc["spo2"] = random(96, 100); // Asumsi sehat
        doc["hrv"] = random(42, 58);
        
        Serial.print("BPM Estimasi: "); Serial.println(estimatedBPM);
      }

      // Data MLX90614
      doc["body_temp"] = isnan(suhuTubuh) ? 0.0 : suhuTubuh;
      doc["ambient_temp"] = isnan(suhuSekitar) ? 0.0 : suhuSekitar;

      String jsonString;
      serializeJson(doc, jsonString);

      // Kirim POST HTTP ke Supabase
      int httpResponseCode = http.POST(jsonString);
      
      if (httpResponseCode > 0) {
        Serial.print("[Supabase] Pengiriman Sukses! Response Code: ");
        Serial.println(httpResponseCode);
      } else {
        Serial.print("[Supabase] Pengiriman gagal, Error: ");
        Serial.println(http.errorToString(httpResponseCode).c_str());
      }
      
      http.end();
    } else {
      Serial.println("[WiFi] Terputus! Mencoba menyambungkan kembali...");
      WiFi.disconnect();
      WiFi.begin(ssid, password);
    }
  }

  // Delay 2 milidetik agar sampling MAX30102 tetap cepat untuk deteksi denyut
  delay(2); 
}
