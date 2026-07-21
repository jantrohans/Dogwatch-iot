export type UserRole = 'admin' | 'owner';

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
}

export type PostureType = 'standing' | 'sitting' | 'lying-side' | 'lying-chest' | 'running' | 'scratching';
export type ActivityStateType = 'resting' | 'walking' | 'running' | 'scratching';

export interface MPU6050Data {
  accelX: number;
  accelY: number;
  accelZ: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  steps: number;
  activeMinutes: number;
  posture: PostureType;
  activityState: ActivityStateType;
}

export interface MAX30102Data {
  heartRate: number;
  spo2: number;
  hrv: number;
}

export interface MLX90614Data {
  bodyTemp: number;
  ambientTemp: number;
}

export interface TelemetryData {
  dogId: string;
  timestamp: string;
  mpu6050: MPU6050Data;
  max30102: MAX30102Data;
  mlx90614: MLX90614Data;
}

export interface DogSettings {
  minHeartRate: number;
  maxHeartRate: number;
  minSpO2: number;
  minTemp: number;
  maxTemp: number;
}

export interface Dog {
  id: string;
  name: string;
  breed: string;
  age: number;
  weight: number;
  ownerId: string;
  ownerName?: string;
  photoUrl?: string;
  settings: DogSettings;
}

export interface Alert {
  id: string;
  dogId: string;
  dogName: string;
  type: 'heart_rate' | 'spo2' | 'fever' | 'hypothermia' | 'fall' | 'heatstroke';
  severity: 'warning' | 'critical';
  message: string;
  timestamp: string;
  resolved: boolean;
}
