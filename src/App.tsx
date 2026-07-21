import React, { useState, useEffect } from 'react';
import { 
  Dog as DogIcon, 
  Activity, 
  Heart, 
  Thermometer, 
  Plus, 
  Settings, 
  LogOut, 
  AlertTriangle, 
  Check, 
  X,
  Trash2, 
  ShieldAlert,
  Moon,
  Info,
  Building2,
  Edit3,
  UserCheck,
  Zap
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { supabase } from './supabase';

// ---- TYPE DEFINITIONS ----
type UserRole = 'admin' | 'owner';

interface UserType {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
}

type PostureType = 'standing' | 'sitting' | 'lying-side' | 'lying-chest' | 'running' | 'scratching';
type ActivityStateType = 'resting' | 'walking' | 'running' | 'scratching';

interface DogSettings {
  minHeartRate: number;
  maxHeartRate: number;
  minSpO2: number;
  minTemp: number;
  maxTemp: number;
}

interface Dog {
  id: string;
  name: string;
  breed: string;
  age: number;
  weight: number;
  ownerId: string;
  ownerName?: string;
  settings: DogSettings;
}

interface TelemetryData {
  dogId: string;
  timestamp: string;
  mpu6050: {
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
  };
  max30102: {
    heartRate: number;
    spo2: number;
    hrv: number;
  };
  mlx90614: {
    bodyTemp: number;
    ambientTemp: number;
  };
}

type AlertType = 'heart_rate' | 'spo2' | 'fever' | 'hypothermia' | 'heatstroke' | 'fall';
type AlertSeverity = 'warning' | 'critical';

interface Alert {
  id: string;
  dogId: string;
  dogName: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  timestamp: string;
  resolved: boolean;
}
// ---- END TYPE DEFINITIONS ----


function App() {
  // --- USERS & AUTH STATE ---
  const [registeredUsers, setRegisteredUsers] = useState<UserType[]>([]);
  const [currentUser, setCurrentUser] = useState<UserType | null>(() => {
    const stored = localStorage.getItem('dogwatch_user');
    return stored ? JSON.parse(stored) : null;
  });

  // --- DOGS STATE ---
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [selectedDogId, setSelectedDogId] = useState<string>('');

  const [telemetryHistory, setTelemetryHistory] = useState<Record<string, TelemetryData[]>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);


  // Auth Screen toggles & form state
  const [authRole, setAuthRole] = useState<UserRole>('admin');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authFullName, setAuthFullName] = useState('');
  const [authError, setAuthError] = useState('');

  // Modals state
  const [isAddDogOpen, setIsAddDogOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Add Dog Form inputs (Admin)
  const [newDogName, setNewDogName] = useState('');
  const [newDogBreed, setNewDogBreed] = useState('');
  const [newDogAge, setNewDogAge] = useState('');
  const [newDogWeight, setNewDogWeight] = useState('');
  const [newDogOwnerUsername, setNewDogOwnerUsername] = useState('willy');

  // Edit Dog Profile Form inputs (Admin)
  const [editingDogId, setEditingDogId] = useState('');
  const [editDogName, setEditDogName] = useState('');
  const [editDogBreed, setEditDogBreed] = useState('');
  const [editDogAge, setEditDogAge] = useState('');
  const [editDogWeight, setEditDogWeight] = useState('');
  const [editDogOwnerUsername, setEditDogOwnerUsername] = useState('');

  // Settings Edit inputs (Thresholds)
  const [editMinHR, setEditMinHR] = useState('');
  const [editMaxHR, setEditMaxHR] = useState('');
  const [editMinSpO2, setEditMinSpO2] = useState('');
  const [editMinTemp, setEditMinTemp] = useState('');
  const [editMaxTemp, setEditMaxTemp] = useState('');

  // General App settings
  const [tempUnit, setTempUnit] = useState<'C' | 'F'>('C');
  const [activeTab, setActiveTab] = useState<'realtime' | 'mpu6050' | 'max30102' | 'mlx90614'>('realtime');

  // --- ROLE BASED DOG FILTERING ---
  const isAdmin = currentUser?.role === 'admin';

  // Admin sees ALL dogs; Owner ONLY sees dogs assigned to them by Admin
  const userDogs = dogs.filter(d => {
    if (isAdmin) return true;
    return (
      d.ownerId === currentUser?.id ||
      (d.ownerName && d.ownerName.toLowerCase() === currentUser?.username.toLowerCase())
    );
  });

  // Current active selected dog object
  const activeDog = userDogs.find(d => d.id === selectedDogId) || userDogs[0];

  // --- SUPABASE DATA FETCHING & REALTIME ---
  useEffect(() => {
    const fetchData = async () => {
      // Fetch Users
      const { data: usersData } = await supabase.from('users').select('*');
      if (usersData) setRegisteredUsers(usersData as UserType[]);

      // Fetch Dogs
      const { data: dogsData } = await supabase.from('dogs').select('*');
      if (dogsData) {
        // Parse settings which might be stored as JSON if we added it to schema, 
        // but wait, in SQL we didn't add settings column! We need default settings for now.
        const parsedDogs = dogsData.map(d => ({
          ...d,
          settings: {
            minHeartRate: 70,
            maxHeartRate: 130,
            minSpO2: 94,
            minTemp: 37.8,
            maxTemp: 39.5
          }
        })) as Dog[];
        setDogs(parsedDogs);
      }
    };

    fetchData();
  }, []);

  // Fetch initial telemetry for the selected dog
  useEffect(() => {
    if (!selectedDogId) return;

    const fetchInitialTelemetry = async () => {
      const { data } = await supabase
        .from('telemetry')
        .select('*')
        .eq('dog_id', selectedDogId)
        .order('timestamp', { ascending: false })
        .limit(30);

      if (data && data.length > 0) {
        const formattedData: TelemetryData[] = data.reverse().map(row => ({
          dogId: row.dog_id,
          timestamp: row.timestamp,
          mpu6050: {
            accelX: row.accel_x || 0,
            accelY: row.accel_y || 0,
            accelZ: row.accel_z || 0,
            gyroX: row.gyro_x || 0,
            gyroY: row.gyro_y || 0,
            gyroZ: row.gyro_z || 0,
            steps: row.steps || 0,
            activeMinutes: row.active_minutes || 0,
            posture: row.posture || 'standing',
            activityState: row.activity_state || 'resting'
          },
          max30102: {
            heartRate: row.heart_rate || 0,
            spo2: row.spo2 || 0,
            hrv: row.hrv || 0
          },
          mlx90614: {
            bodyTemp: row.body_temp || 0,
            ambientTemp: row.ambient_temp || 0
          }
        }));

        setTelemetryHistory(prev => ({
          ...prev,
          [selectedDogId]: formattedData
        }));
      }
    };

    fetchInitialTelemetry();
  }, [selectedDogId]);

  // Realtime Subscription for Telemetry
  useEffect(() => {
    if (!activeDog) return;

    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'telemetry',
          filter: `dog_id=eq.${activeDog.id}`
        },
        (payload) => {
          const row = payload.new;
          const newTelemetry: TelemetryData = {
            dogId: row.dog_id,
            timestamp: row.timestamp,
            mpu6050: {
              accelX: row.accel_x || 0,
              accelY: row.accel_y || 0,
              accelZ: row.accel_z || 0,
              gyroX: row.gyro_x || 0,
              gyroY: row.gyro_y || 0,
              gyroZ: row.gyro_z || 0,
              steps: row.steps || 0,
              activeMinutes: row.active_minutes || 0,
              posture: row.posture || 'standing',
              activityState: row.activity_state || 'resting'
            },
            max30102: {
              heartRate: row.heart_rate || 0,
              spo2: row.spo2 || 0,
              hrv: row.hrv || 0
            },
            mlx90614: {
              bodyTemp: row.body_temp || 0,
              ambientTemp: row.ambient_temp || 0
            }
          };

          checkThresholds(newTelemetry);

          setTelemetryHistory(prevHist => {
            const dogHist = prevHist[activeDog.id] || [];
            const newHist = [...dogHist, newTelemetry];
            if (newHist.length > 30) newHist.shift();
            
            return {
              ...prevHist,
              [activeDog.id]: newHist
            };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeDog]);


  // Keep selectedDogId valid when switching users or editing dogs
  useEffect(() => {
    if (userDogs.length > 0) {
      if (!userDogs.some(d => d.id === selectedDogId)) {
        setSelectedDogId(userDogs[0].id);
      }
    } else {
      setSelectedDogId('');
    }
  }, [currentUser, dogs]);

  // Sync edit settings fields when opening settings modal or changing active dog
  useEffect(() => {
    if (activeDog) {
      setEditMinHR(activeDog.settings.minHeartRate.toString());
      setEditMaxHR(activeDog.settings.maxHeartRate.toString());
      setEditMinSpO2(activeDog.settings.minSpO2.toString());
      setEditMinTemp(activeDog.settings.minTemp.toString());
      setEditMaxTemp(activeDog.settings.maxTemp.toString());
    }
  }, [activeDog, isSettingsOpen]);


  // --- THRESHOLD CHECKING LOGIC ---
  const checkThresholds = (data: TelemetryData) => {
    if (!activeDog) return;
    const settings = activeDog.settings;
    const newAlerts: Omit<Alert, 'id' | 'timestamp' | 'resolved'>[] = [];

    if (data.max30102.heartRate > settings.maxHeartRate) {
      newAlerts.push({
        dogId: activeDog.id,
        dogName: activeDog.name,
        type: 'heart_rate',
        severity: data.max30102.heartRate > settings.maxHeartRate + 25 ? 'critical' : 'warning',
        message: `${activeDog.name}'s Heart Rate is critically high at ${data.max30102.heartRate} BPM (Limit: ${settings.maxHeartRate} BPM)`
      });
    } else if (data.max30102.heartRate < settings.minHeartRate) {
      newAlerts.push({
        dogId: activeDog.id,
        dogName: activeDog.name,
        type: 'heart_rate',
        severity: data.max30102.heartRate < settings.minHeartRate - 15 ? 'critical' : 'warning',
        message: `${activeDog.name}'s Heart Rate is low at ${data.max30102.heartRate} BPM (Limit: ${settings.minHeartRate} BPM)`
      });
    }

    if (data.max30102.spo2 < settings.minSpO2) {
      newAlerts.push({
        dogId: activeDog.id,
        dogName: activeDog.name,
        type: 'spo2',
        severity: data.max30102.spo2 < 90 ? 'critical' : 'warning',
        message: `${activeDog.name}'s Blood Oxygen level (SpO2) dropped to ${data.max30102.spo2}%! (Normal: >${settings.minSpO2}%)`
      });
    }

    if (data.mlx90614.bodyTemp > settings.maxTemp) {
      newAlerts.push({
        dogId: activeDog.id,
        dogName: activeDog.name,
        type: 'fever',
        severity: data.mlx90614.bodyTemp > 40.0 ? 'critical' : 'warning',
        message: `${activeDog.name} has a fever! Body temp is ${data.mlx90614.bodyTemp}°C (${(data.mlx90614.bodyTemp * 1.8 + 32).toFixed(1)}°F)`
      });
    } else if (data.mlx90614.bodyTemp < settings.minTemp) {
      newAlerts.push({
        dogId: activeDog.id,
        dogName: activeDog.name,
        type: 'hypothermia',
        severity: data.mlx90614.bodyTemp < 37.0 ? 'critical' : 'warning',
        message: `${activeDog.name} shows signs of hypothermia. Temp is ${data.mlx90614.bodyTemp}°C (${(data.mlx90614.bodyTemp * 1.8 + 32).toFixed(1)}°F)`
      });
    }

    if (data.mlx90614.ambientTemp > 32.0 && data.mlx90614.bodyTemp > 39.2 && data.mpu6050.activityState === 'running') {
      newAlerts.push({
        dogId: activeDog.id,
        dogName: activeDog.name,
        type: 'heatstroke',
        severity: 'critical',
        message: `HEATSTROKE DANGER: High ambient temp (${data.mlx90614.ambientTemp}°C) coupled with running activity. Seek shade!`
      });
    }

    const accelMagnitude = Math.sqrt(
      data.mpu6050.accelX * data.mpu6050.accelX +
      data.mpu6050.accelY * data.mpu6050.accelY +
      data.mpu6050.accelZ * data.mpu6050.accelZ
    );
    if (accelMagnitude > 3.0) {
      newAlerts.push({
        dogId: activeDog.id,
        dogName: activeDog.name,
        type: 'fall',
        severity: 'critical',
        message: `CRITICAL ALERT: Sudden high impact (fall/collision) detected for ${activeDog.name}!`
      });
    }

    const now = Date.now();
    const filteredAlerts = newAlerts.filter(newA => {
      return !alerts.some(existing => 
        existing.dogId === newA.dogId && 
        existing.type === newA.type && 
        !existing.resolved &&
        (now - new Date(existing.timestamp).getTime()) < 15000
      );
    });

    if (filteredAlerts.length > 0) {
      const timestamp = new Date().toISOString();
      const resolvedList = filteredAlerts.map((a) => ({
        ...a,
        id: crypto.randomUUID(),
        timestamp,
        resolved: false
      }));

      setAlerts(prev => [
        ...resolvedList,
        ...prev
      ].slice(0, 50));
    }
  };

  const handleResolveAlert = (alertId: string) => {
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, resolved: true } : a));
  };

  const handleClearAllAlerts = () => {
    setAlerts([]);
  };

  // --- ACTIONS & HANDLERS ---

  // Auth Submit (Login / Register)
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUsername.trim()) {
      setAuthError('Username wajib diisi!');
      return;
    }

    const cleanUsername = authUsername.trim().toLowerCase();

    if (authMode === 'login') {
      const existing = registeredUsers.find(u => u.username.toLowerCase() === cleanUsername);

      if (existing) {
        setCurrentUser(existing);
        localStorage.setItem('dogwatch_user', JSON.stringify(existing));
      } else {
        // Auto create user with chosen role in Supabase
        const userId = `user-${cleanUsername}`;
        const newUser: UserType = {
          id: userId,
          username: cleanUsername,
          fullName: authFullName.trim() || (authRole === 'admin' ? `Admin (${cleanUsername})` : `Pemilik (${cleanUsername})`),
          role: authRole
        };
        const { error } = await supabase.from('users').insert(newUser);
        if (!error) {
          setRegisteredUsers(prev => [...prev, newUser]);
          setCurrentUser(newUser);
          localStorage.setItem('dogwatch_user', JSON.stringify(newUser));
        } else {
          setAuthError('Gagal membuat akun di database.');
        }
      }
    } else {
      // Register new account
      const existing = registeredUsers.find(u => u.username.toLowerCase() === cleanUsername);
      if (existing) {
        setAuthError(`Username "${cleanUsername}" sudah terdaftar. Silakan gunakan tab Sign In.`);
        return;
      }

      const userId = `user-${cleanUsername}`;
      const newUser: UserType = {
        id: userId,
        username: cleanUsername,
        fullName: authFullName.trim() || (authRole === 'admin' ? `Admin (${cleanUsername})` : `Pemilik (${cleanUsername})`),
        role: authRole
      };
      const { error } = await supabase.from('users').insert(newUser);
      if (!error) {
        setRegisteredUsers(prev => [...prev, newUser]);
        setCurrentUser(newUser);
        localStorage.setItem('dogwatch_user', JSON.stringify(newUser));
      } else {
        setAuthError('Gagal membuat akun di database.');
      }
    }

    setAuthError('');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('dogwatch_user');
  };

  // Add Dog Submit (Admin Only)
  const handleAddDog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDogName.trim() || !newDogBreed.trim() || !newDogAge || !newDogWeight) return;

    const dogId = `dog-${newDogName.toLowerCase().replace(/\\s+/g, '-')}-${Date.now()}`;
    const cleanOwner = newDogOwnerUsername.trim().toLowerCase() || 'willy';
    let targetOwnerId = `user-${cleanOwner}`;

    const existingOwner = registeredUsers.find(u => u.username.toLowerCase() === cleanOwner);
    if (existingOwner) {
      targetOwnerId = existingOwner.id;
    } else {
      const newOwner: UserType = {
        id: targetOwnerId,
        username: cleanOwner,
        fullName: `${cleanOwner} (Pemilik)`,
        role: 'owner'
      };
      await supabase.from('users').insert(newOwner);
      setRegisteredUsers(prev => [...prev, newOwner]);
    }

    const newDogRecord = {
      id: dogId,
      name: newDogName.trim(),
      breed: newDogBreed.trim(),
      age: parseFloat(newDogAge),
      weight: parseFloat(newDogWeight),
      ownerId: targetOwnerId,
      ownerName: cleanOwner
    };
    
    const { error } = await supabase.from('dogs').insert(newDogRecord);

    if (!error) {
      const newDogState: Dog = {
        ...newDogRecord,
        settings: {
          minHeartRate: 70,
          maxHeartRate: 130,
          minSpO2: 94,
          minTemp: 37.8,
          maxTemp: 39.5
        }
      };
      setDogs([...dogs, newDogState]);
      setSelectedDogId(dogId);
      
      setTelemetryHistory(prev => ({
        ...prev,
        [dogId]: []
      }));
  
      setNewDogName('');
      setNewDogBreed('');
      setNewDogAge('');
      setNewDogWeight('');
      setNewDogOwnerUsername('willy');
      setIsAddDogOpen(false);
    }
  };

  // Open Edit Profile Modal (Admin Only)
  const handleOpenEditProfile = (dogToEdit: Dog) => {
    setEditingDogId(dogToEdit.id);
    setEditDogName(dogToEdit.name);
    setEditDogBreed(dogToEdit.breed);
    setEditDogAge(dogToEdit.age.toString());
    setEditDogWeight(dogToEdit.weight.toString());
    setEditDogOwnerUsername(dogToEdit.ownerName || dogToEdit.ownerId.replace('user-', ''));
    setIsEditProfileOpen(true);
  };

  // Save Edited Dog Profile (Admin Only)
  const handleSaveEditProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDogId) return;

    const cleanOwner = editDogOwnerUsername.trim().toLowerCase();
    let targetOwnerId = `user-${cleanOwner}`;

    const existingOwner = registeredUsers.find(u => u.username.toLowerCase() === cleanOwner);
    if (existingOwner) {
      targetOwnerId = existingOwner.id;
    } else if (cleanOwner) {
      const newOwner: UserType = {
        id: targetOwnerId,
        username: cleanOwner,
        fullName: `${cleanOwner} (Pemilik)`,
        role: 'owner'
      };
      await supabase.from('users').insert(newOwner);
      setRegisteredUsers(prev => [...prev, newOwner]);
    }

    const updateRecord = {
      name: editDogName.trim(),
      breed: editDogBreed.trim(),
      age: parseFloat(editDogAge),
      weight: parseFloat(editDogWeight),
      ownerId: targetOwnerId,
      ownerName: cleanOwner
    };

    const { error } = await supabase.from('dogs').update(updateRecord).eq('id', editingDogId);

    if (!error) {
      const updatedDogs = dogs.map(d => {
        if (d.id === editingDogId) {
          return { ...d, ...updateRecord };
        }
        return d;
      });
  
      setDogs(updatedDogs);
      setIsEditProfileOpen(false);
    }
  };

  // Delete Dog Profile (Admin Only)
  const handleDeleteDog = async (dogId: string) => {
    if (!isAdmin) return;
    if (confirm('Apakah Anda yakin ingin menghapus profil anjing ini dari sistem Dog Hotel?')) {
      const { error } = await supabase.from('dogs').delete().eq('id', dogId);
      
      if (!error) {
        const updated = dogs.filter(d => d.id !== dogId);
        setDogs(updated);
        if (selectedDogId === dogId && updated.length > 0) {
          setSelectedDogId(updated[0].id);
        } else if (updated.length === 0) {
          setSelectedDogId('');
        }
      }
    }
  };

  // Save Settings Submit (Sensor Thresholds)
  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDog) return;

    const updatedDogs = dogs.map(d => {
      if (d.id === activeDog.id) {
        return {
          ...d,
          settings: {
            minHeartRate: parseInt(editMinHR),
            maxHeartRate: parseInt(editMaxHR),
            minSpO2: parseInt(editMinSpO2),
            minTemp: parseFloat(editMinTemp),
            maxTemp: parseFloat(editMaxTemp)
          }
        };
      }
      return d;
    });

    setDogs(updatedDogs);
    setIsSettingsOpen(false);
  };

  // --- DATA GETTERS & CONVERTERS ---
  const activeHistory = (activeDog && telemetryHistory[activeDog.id]) || [];
  const latestTelemetry = activeHistory[activeHistory.length - 1];

  const formatTemp = (celsius: number) => {
    if (tempUnit === 'F') {
      return `${(celsius * 1.8 + 32).toFixed(1)}°F`;
    }
    return `${celsius.toFixed(1)}°C`;
  };

  // Filter active alerts for visible dogs
  const visibleDogIds = userDogs.map(d => d.id);
  const activeAlerts = alerts.filter(a => visibleDogIds.includes(a.dogId) && !a.resolved);

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // --- RENDERING AUTH VIEW ---
  if (!currentUser) {
    return (
      <div className="auth-container">
        <div className="auth-card glass-card">
          <div className="logo-container" style={{ justifyContent: 'center', marginBottom: '1.25rem' }}>
            <DogIcon size={32} className="logo-dog" />
            <span className="logo-text">DOGWATCH</span>
          </div>

          <h2 className="auth-title">Portal Akses Dashboard</h2>
          <p className="auth-subtitle">Pilih jenis akun untuk masuk ke sistem monitoring Smartwatch Anjing</p>

          {/* Role Selection Tabs */}
          <div className="role-selector">
            <button 
              type="button"
              className={`role-btn ${authRole === 'admin' ? 'active-admin' : ''}`}
              onClick={() => setAuthRole('admin')}
            >
              <Building2 size={16} />
              <span>Dog Hotel (Admin)</span>
            </button>
            <button 
              type="button"
              className={`role-btn ${authRole === 'owner' ? 'active-owner' : ''}`}
              onClick={() => setAuthRole('owner')}
            >
              <UserCheck size={16} />
              <span>Pemilik Anjing (User)</span>
            </button>
          </div>

          <form onSubmit={handleAuthSubmit}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input 
                type="text" 
                className="form-input" 
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                placeholder={authRole === 'admin' ? 'e.g. admin' : 'e.g. willy atau budi'}
                required
              />
            </div>
            
            {authMode === 'register' && (
              <div className="form-group">
                <label className="form-label">Nama Lengkap / Nama Hotel</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={authFullName}
                  onChange={(e) => setAuthFullName(e.target.value)}
                  placeholder={authRole === 'admin' ? 'e.g. Dog Hotel Petcare Grand' : 'e.g. Willy Suraya'}
                />
              </div>
            )}

            {authError && (
              <div style={{ color: 'var(--color-critical)', fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>
                {authError}
              </div>
            )}

            <button type="submit" className="btn-primary" style={{ marginTop: '0.5rem' }}>
              {authMode === 'login' 
                ? (authRole === 'admin' ? 'Masuk sebagai Dog Hotel Admin' : 'Masuk sebagai Pemilik Anjing')
                : (authRole === 'admin' ? 'Daftar Akun Dog Hotel Admin' : 'Daftar Akun Pemilik Anjing')}
            </button>
          </form>

          <div className="auth-switch">
            {authMode === 'login' ? (
              <>
                Belum memiliki akun?{' '}
                <span className="auth-link" onClick={() => setAuthMode('register')}>
                  Daftar Sekarang
                </span>
              </>
            ) : (
              <>
                Sudah memiliki akun?{' '}
                <span className="auth-link" onClick={() => setAuthMode('login')}>
                  Sign In
                </span>
              </>
            )}
          </div>

        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* HEADER */}
      <header className="app-header">
        <div className="logo-container">
          <DogIcon size={28} className="logo-dog" />
          <span className="logo-text">DOGWATCH</span>
        </div>
        <div className="header-actions">
          <div className={`user-badge ${isAdmin ? 'badge-admin' : 'badge-owner'}`}>
            {isAdmin ? <Building2 size={16} /> : <UserCheck size={16} />}
            <span>
              {isAdmin ? '🏨 Admin:' : '👤 Pemilik:'} <strong>{currentUser.fullName}</strong>
            </span>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={16} />
            <span>Keluar</span>
          </button>
        </div>
      </header>

      {/* DASHBOARD BODY */}
      <div className="dashboard-container">
        
        {/* SIDE DOG SELECTOR BAR */}
        <aside className="side-panel">
          <div className="panel-header">
            <span className="panel-title">{isAdmin ? 'Semua Anjing di Hotel' : 'Anjing Saya'}</span>
            <span className="user-badge" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}>
              {userDogs.length} Ekor
            </span>
          </div>
          
          <div className="dog-list">
            {userDogs.map(d => {
              const isSelected = d.id === (activeDog?.id || selectedDogId);
              const dogHist = telemetryHistory[d.id] || [];
              const lastPacket = dogHist[dogHist.length - 1];
              const isSleeping = lastPacket?.mpu6050.activityState === 'resting';
              
              return (
                <div key={d.id} style={{ position: 'relative' }}>
                  <button 
                    className={`dog-card-btn ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedDogId(d.id)}
                  >
                    <div className="dog-avatar">
                      {d.name.charAt(0)}
                    </div>
                    <div className="dog-info">
                      <span className="dog-name">{d.name}</span>
                      <span className="dog-breed">{d.breed}</span>
                      <span className="owner-tag">
                        👤 {d.ownerName || d.ownerId.replace('user-', '')}
                      </span>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      {isSleeping ? (
                        <Moon size={12} style={{ color: 'var(--accent-purple)' }} />
                      ) : (
                        <Activity size={12} style={{ color: 'var(--accent-cyan)' }} />
                      )}
                      <div className={`pulse-dot ${
                        alerts.some(a => a.dogId === d.id && !a.resolved && a.severity === 'critical')
                          ? 'pulse-critical'
                          : alerts.some(a => a.dogId === d.id && !a.resolved && a.severity === 'warning')
                          ? 'pulse-warning'
                          : ''
                      }`} />
                    </div>
                  </button>

                  {/* Delete dog profile button (ADMIN ONLY) */}
                  {isAdmin && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDog(d.id);
                      }}
                      style={{
                        position: 'absolute',
                        right: '-6px',
                        top: '-6px',
                        background: 'var(--color-critical-bg)',
                        border: '1px solid rgba(239,68,68,0.3)',
                        borderRadius: '50%',
                        width: '22px',
                        height: '22px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-critical)',
                        cursor: 'pointer',
                        fontSize: '9px',
                        opacity: 0,
                        transition: 'opacity 0.2s',
                        zIndex: 10
                      }}
                      className="delete-dog-badge"
                      title="Hapus Profil Anjing (Admin)"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}

                  <style dangerouslySetInnerHTML={{__html: `
                    div:hover > .delete-dog-badge { opacity: 1 !important; }
                  `}} />
                </div>
              );
            })}

            {/* Add Dog button (ADMIN ONLY) */}
            {isAdmin ? (
              <button className="btn-add-dog" onClick={() => setIsAddDogOpen(true)}>
                <Plus size={16} />
                <span>Tambah Anjing Baru</span>
              </button>
            ) : (
              <div style={{ padding: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: '8px' }}>
                🔒 Mode Pemilik: Anda hanya dapat memantau anjing yang ditugaskan oleh Dog Hotel Admin.
              </div>
            )}
          </div>

          {/* TELEMETRY ALERT LOGS QUICK LOG */}
          <div className="glass-card alerts-card" style={{ flex: 1, marginTop: '0.5rem' }}>
            <div className="alerts-header">
              <span className="alerts-title">Peringatan Kesehatan</span>
              {activeAlerts.length > 0 && (
                <span className="alerts-count critical">{activeAlerts.length}</span>
              )}
            </div>

            <div className="alerts-list">
              {activeAlerts.length === 0 ? (
                <div className="empty-alerts">
                  <Check size={24} style={{ color: 'var(--color-success)' }} />
                  <span>Kondisi anjing aman dan stabil!</span>
                </div>
              ) : (
                activeAlerts.map(alert => (
                  <div key={alert.id} className={`alert-item severity-${alert.severity}`}>
                    <AlertTriangle size={16} className="alert-icon" />
                    <div className="alert-content">
                      <span className="alert-msg">{alert.message}</span>
                      <span className="alert-time">{formatTime(alert.timestamp)}</span>
                    </div>
                    <button 
                      className="alert-resolve-btn" 
                      onClick={() => handleResolveAlert(alert.id)}
                      title="Selesaikan Peringatan"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {alerts.length > 0 && (
              <button 
                onClick={handleClearAllAlerts} 
                style={{ 
                  background: 'transparent', 
                  border: 'none', 
                  color: 'var(--text-muted)', 
                  fontSize: '0.75rem', 
                  cursor: 'pointer', 
                  textAlign: 'right',
                  marginTop: '0.5rem'
                }}
              >
                Bersihkan Log Peringatan
              </button>
            )}
          </div>
        </aside>

        {/* MAIN PANEL */}
        {activeDog ? (
          <main className="main-content">
            
            {/* ACTIVE DOG TITLE BANNER */}
            <section className="glass-card dog-profile-summary">
              <div className="summary-left">
                <div className="summary-avatar">
                  {activeDog.name.charAt(0)}
                </div>
                <div className="summary-details">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <h2>{activeDog.name}</h2>
                    <span className="owner-tag" style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem' }}>
                      👤 Pemilik: <strong>{activeDog.ownerName || activeDog.ownerId.replace('user-', '')}</strong>
                    </span>
                  </div>
                  <div className="summary-meta">
                    <div className="meta-item">
                      <span>Ras/Jenis:</span>
                      <strong style={{ color: 'var(--text-primary)' }}>{activeDog.breed}</strong>
                    </div>
                    <div className="meta-item">
                      <span>Usia:</span>
                      <strong style={{ color: 'var(--text-primary)' }}>{activeDog.age} Thn</strong>
                    </div>
                    <div className="meta-item">
                      <span>Berat:</span>
                      <strong style={{ color: 'var(--text-primary)' }}>{activeDog.weight} kg</strong>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="summary-right">
                <button 
                  className="toggle-unit-btn"
                  onClick={() => setTempUnit(prev => prev === 'C' ? 'F' : 'C')}
                >
                  <span>Suhu: °{tempUnit}</span>
                </button>

                {/* Edit Profile Button (ADMIN ONLY) */}
                {isAdmin && (
                  <button 
                    className="btn-settings"
                    onClick={() => handleOpenEditProfile(activeDog)}
                    title="Edit Profil & Pemilik Anjing (Admin)"
                    style={{ color: 'var(--accent-cyan)' }}
                  >
                    <Edit3 size={18} />
                  </button>
                )}

                {/* Sensor Settings Button (ADMIN ONLY) */}
                {isAdmin && (
                  <button 
                    className="btn-settings"
                    onClick={() => setIsSettingsOpen(true)}
                    title="Atur Batas Ambang Sensor (Admin)"
                  >
                    <Settings size={18} />
                  </button>
                )}
              </div>
            </section>

            {/* LIVE TELEMETRY VITAL STATS DISPLAY */}
            {latestTelemetry ? (
              <section className="metrics-grid">
                
                {/* 1. HEART RATE */}
                <div className="glass-card metric-card card-heart-rate">
                  <div className="metric-header">
                    <span>Detak Jantung (MAX30102)</span>
                    <div className="metric-icon-box">
                      <Heart size={18} fill="currentColor" />
                    </div>
                  </div>
                  <div className="metric-value-container">
                    <span className="metric-value">{latestTelemetry.max30102.heartRate}</span>
                    <span className="metric-unit">BPM</span>
                  </div>
                  <div className="metric-footer">
                    {latestTelemetry.max30102.heartRate > activeDog.settings.maxHeartRate ? (
                      <span className="metric-footer-danger">● Tinggi / Stres (Batas: {activeDog.settings.maxHeartRate})</span>
                    ) : latestTelemetry.max30102.heartRate < activeDog.settings.minHeartRate ? (
                      <span className="metric-footer-warning">● Lemah (Batas: {activeDog.settings.minHeartRate})</span>
                    ) : (
                      <span className="metric-footer-success">● Normal (70-120 BPM)</span>
                    )}
                  </div>
                </div>

                {/* 2. SPO2 OXYGEN */}
                <div className="glass-card metric-card card-spo2">
                  <div className="metric-header">
                    <span>Saturasi Oksigen (MAX30102)</span>
                    <div className="metric-icon-box">
                      <Activity size={18} />
                    </div>
                  </div>
                  <div className="metric-value-container">
                    <span className="metric-value">{latestTelemetry.max30102.spo2}</span>
                    <span className="metric-unit">%</span>
                  </div>
                  <div className="metric-footer">
                    {latestTelemetry.max30102.spo2 < activeDog.settings.minSpO2 ? (
                      <span className="metric-footer-danger">● Peringatan Hipoksia (&lt;{activeDog.settings.minSpO2}%)</span>
                    ) : (
                      <span className="metric-footer-success">● Oksigen Optimal</span>
                    )}
                  </div>
                </div>

                {/* 3. TEMPERATURE */}
                <div className="glass-card metric-card card-temperature">
                  <div className="metric-header">
                    <span>Suhu Tubuh (MLX90614)</span>
                    <div className="metric-icon-box">
                      <Thermometer size={18} />
                    </div>
                  </div>
                  <div className="metric-value-container">
                    <span className="metric-value">
                      {tempUnit === 'F' 
                        ? (latestTelemetry.mlx90614.bodyTemp * 1.8 + 32).toFixed(1)
                        : latestTelemetry.mlx90614.bodyTemp.toFixed(1)
                      }
                    </span>
                    <span className="metric-unit">°{tempUnit}</span>
                  </div>
                  <div className="metric-footer">
                    {latestTelemetry.mlx90614.bodyTemp > activeDog.settings.maxTemp ? (
                      <span className="metric-footer-danger">● Demam (Batas: {formatTemp(activeDog.settings.maxTemp)})</span>
                    ) : latestTelemetry.mlx90614.bodyTemp < activeDog.settings.minTemp ? (
                      <span className="metric-footer-warning">● Hipotermia (Batas: {formatTemp(activeDog.settings.minTemp)})</span>
                    ) : (
                      <span className="metric-footer-success">● Suhu Normal ({formatTemp(38.3)} - {formatTemp(39.2)})</span>
                    )}
                  </div>
                </div>

                {/* 4. ACTIVITY & POSTURE */}
                <div className="glass-card metric-card card-activity">
                  <div className="metric-header">
                    <span>Postur & Aktivitas (MPU6050)</span>
                    <div className="metric-icon-box">
                      <DogIcon size={18} />
                    </div>
                  </div>
                  <div className="metric-value-container">
                    <span className="metric-value" style={{ fontSize: '1.75rem', textTransform: 'capitalize' }}>
                      {latestTelemetry.mpu6050.activityState}
                    </span>
                  </div>
                  <div className="metric-footer" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <span>Postur: <strong style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>{latestTelemetry.mpu6050.posture.replace('-', ' ')}</strong></span>
                    <span className="metric-footer-success">{latestTelemetry.mpu6050.steps} langkah</span>
                  </div>
                </div>

              </section>
            ) : (
              <div className="glass-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                Menunggu paket telemetri dari Smartwatch ESP32...
              </div>
            )}

            {/* CHARTS SECTION */}
            <section className="dashboard-mid">
              
              {/* HISTORICAL CHARTS CARD */}
              <div className="glass-card chart-card">
                <div className="chart-title-area">
                  <span className="chart-title">Riwayat Tren Kesehatan</span>
                  <div className="chart-controls">
                    <button 
                      className={`chart-tab-btn ${activeTab === 'realtime' ? 'active' : ''}`}
                      onClick={() => setActiveTab('realtime')}
                    >
                      Metrik Utama
                    </button>
                    <button 
                      className={`chart-tab-btn ${activeTab === 'mpu6050' ? 'active' : ''}`}
                      onClick={() => setActiveTab('mpu6050')}
                    >
                      MPU6050 (Gerak)
                    </button>
                    <button 
                      className={`chart-tab-btn ${activeTab === 'max30102' ? 'active' : ''}`}
                      onClick={() => setActiveTab('max30102')}
                    >
                      MAX30102 (Pulsa)
                    </button>
                    <button 
                      className={`chart-tab-btn ${activeTab === 'mlx90614' ? 'active' : ''}`}
                      onClick={() => setActiveTab('mlx90614')}
                    >
                      MLX90614 (Suhu)
                    </button>
                  </div>
                </div>

                <div className="chart-wrapper">
                  <ResponsiveContainer width="100%" height="100%">
                    {activeTab === 'realtime' ? (
                      <AreaChart data={activeHistory.map(h => ({
                        time: formatTime(h.timestamp),
                        heartRate: h.max30102.heartRate,
                        spo2: h.max30102.spo2,
                        bodyTemp: tempUnit === 'F' ? parseFloat((h.mlx90614.bodyTemp * 1.8 + 32).toFixed(1)) : h.mlx90614.bodyTemp
                      }))}>
                        <defs>
                          <linearGradient id="colorHR" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--color-critical)" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="var(--color-critical)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} />
                        <YAxis stroke="var(--text-muted)" fontSize={10} />
                        <Tooltip contentStyle={{ background: '#141A26', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }} />
                        <Area type="monotone" dataKey="heartRate" name="Heart Rate (BPM)" stroke="var(--color-critical)" fillOpacity={1} fill="url(#colorHR)" strokeWidth={2} />
                        <Area type="monotone" dataKey="bodyTemp" name={`Body Temp (°${tempUnit})`} stroke="var(--color-warning)" fill="none" strokeWidth={2} />
                      </AreaChart>
                    ) : activeTab === 'mpu6050' ? (
                      <AreaChart data={activeHistory.map(h => ({
                        time: formatTime(h.timestamp),
                        accelX: h.mpu6050.accelX,
                        accelY: h.mpu6050.accelY,
                        accelZ: h.mpu6050.accelZ,
                        steps: h.mpu6050.steps
                      }))}>
                        <defs>
                          <linearGradient id="colorAccel" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--accent-orange)" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="var(--accent-orange)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} />
                        <YAxis stroke="var(--text-muted)" fontSize={10} />
                        <Tooltip contentStyle={{ background: '#141A26', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }} />
                        <Area type="monotone" dataKey="accelZ" name="Accel Z (G)" stroke="var(--accent-orange)" fillOpacity={1} fill="url(#colorAccel)" strokeWidth={2} />
                        <Area type="monotone" dataKey="accelX" name="Accel X (G)" stroke="var(--accent-purple)" fill="none" strokeWidth={1} />
                        <Area type="monotone" dataKey="accelY" name="Accel Y (G)" stroke="var(--accent-teal)" fill="none" strokeWidth={1} />
                      </AreaChart>
                    ) : activeTab === 'max30102' ? (
                      <AreaChart data={activeHistory.map(h => ({
                        time: formatTime(h.timestamp),
                        heartRate: h.max30102.heartRate,
                        spo2: h.max30102.spo2,
                        hrv: h.max30102.hrv
                      }))}>
                        <defs>
                          <linearGradient id="colorHRV" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--accent-purple)" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="var(--accent-purple)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} />
                        <YAxis stroke="var(--text-muted)" fontSize={10} />
                        <Tooltip contentStyle={{ background: '#141A26', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }} />
                        <Area type="monotone" dataKey="spo2" name="SpO2 (%)" stroke="var(--accent-cyan)" fill="none" strokeWidth={2} />
                        <Area type="monotone" dataKey="hrv" name="HRV (ms)" stroke="var(--accent-purple)" fillOpacity={1} fill="url(#colorHRV)" strokeWidth={2} />
                      </AreaChart>
                    ) : (
                      <AreaChart data={activeHistory.map(h => ({
                        time: formatTime(h.timestamp),
                        bodyTemp: tempUnit === 'F' ? parseFloat((h.mlx90614.bodyTemp * 1.8 + 32).toFixed(1)) : h.mlx90614.bodyTemp,
                        ambientTemp: tempUnit === 'F' ? parseFloat((h.mlx90614.ambientTemp * 1.8 + 32).toFixed(1)) : h.mlx90614.ambientTemp
                      }))}>
                        <defs>
                          <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--color-warning)" stopOpacity={0.4}/>
                            <stop offset="95%" stopColor="var(--color-warning)" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} />
                        <YAxis stroke="var(--text-muted)" fontSize={10} />
                        <Tooltip contentStyle={{ background: '#141A26', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }} />
                        <Area type="monotone" dataKey="bodyTemp" name={`Body Temp (°${tempUnit})`} stroke="var(--color-warning)" fillOpacity={1} fill="url(#colorTemp)" strokeWidth={2} />
                        <Area type="monotone" dataKey="ambientTemp" name={`Ambient Temp (°${tempUnit})`} stroke="var(--accent-purple)" fill="none" strokeWidth={2} />
                      </AreaChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </div>

              {/* HARDWARE OVERVIEW / SENSORS SUMMARY */}
              <div className="glass-card chart-card" style={{ gap: '0.75rem' }}>
                <span className="chart-title">Status Perangkat Smartwatch</span>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', height: '100%', justifyContent: 'center' }}>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Activity size={16} style={{ color: 'var(--accent-orange)' }} />
                      <span style={{ fontSize: '0.85rem' }}>MPU6050 (Gerak/Aktivitas)</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: '600' }}>ONLINE</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Heart size={16} style={{ color: 'var(--color-critical)' }} />
                      <span style={{ fontSize: '0.85rem' }}>MAX30102 (Pulsa/SpO2)</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: '600' }}>ONLINE</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Thermometer size={16} style={{ color: 'var(--color-warning)' }} />
                      <span style={{ fontSize: '0.85rem' }}>MLX90614 (Suhu IR)</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: '600' }}>ONLINE</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Zap size={16} style={{ color: 'var(--accent-cyan)' }} />
                      <span style={{ fontSize: '0.85rem' }}>Baterai ESP32 Collar</span>
                    </div>
                    <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--accent-cyan)' }}>3.84 V (87%)</span>
                  </div>

                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.5rem' }}>
                    <Info size={12} />
                    <span>ESP32 siap menerima / mengirim telemetri via MQTT.</span>
                  </div>
                </div>
              </div>
            </section>
            
          </main>
        ) : (
          /* EMPTY PACK STATE */
          <div className="glass-card empty-dashboard">
            <div className="empty-icon-box">
              <DogIcon size={64} style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="empty-title">
              <h2>{isAdmin ? 'Belum Ada Anjing Terdaftar' : 'Belum Ada Anjing Ditugaskan'}</h2>
            </div>
            <p className="empty-desc">
              {isAdmin 
                ? 'Sistem Dog Hotel belum memiliki profil anjing. Silakan tambahkan profil anjing pertama Anda dan hubungkan ke akun pemilik.' 
                : `Akun Anda terdaftar sebagai Pemilik Anjing (${currentUser.fullName}). Pihak Dog Hotel Admin belum menugaskan anjing ke akun Anda. Silakan minta admin untuk mendaftarkan anjing Anda.`}
            </p>

            {isAdmin && (
              <button className="btn-primary" onClick={() => setIsAddDogOpen(true)} style={{ maxWidth: '220px' }}>
                Tambah Profil Anjing Pertama
              </button>
            )}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <footer style={{ borderTop: 'var(--glass-border)', padding: '1.5rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', background: 'rgba(11, 15, 23, 0.5)', marginTop: 'auto' }}>
        &copy; {new Date().getFullYear()} Dogwatch Smart Collar Systems. Powered by ESP32 IoT & Dog Hotel Management.
      </footer>

      {/* --- ADD DOG MODAL (ADMIN ONLY) --- */}
      {isAddDogOpen && isAdmin && (
        <div className="modal-overlay">
          <div className="glass-card modal-content">
            <div className="modal-header">
              <h3>Tambah Anjing Baru (Admin)</h3>
              <button className="modal-close-btn" onClick={() => setIsAddDogOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleAddDog}>
              <div className="form-group">
                <label className="form-label">Nama Anjing</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newDogName}
                  onChange={(e) => setNewDogName(e.target.value)}
                  placeholder="e.g. Rocky"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Ras / Jenis Anjing</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newDogBreed}
                  onChange={(e) => setNewDogBreed(e.target.value)}
                  placeholder="e.g. Husky / Poodle"
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Usia (Tahun)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    min="0.1"
                    className="form-input" 
                    value={newDogAge}
                    onChange={(e) => setNewDogAge(e.target.value)}
                    placeholder="e.g. 2.5"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Berat (Kg)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    min="0.1"
                    className="form-input" 
                    value={newDogWeight}
                    onChange={(e) => setNewDogWeight(e.target.value)}
                    placeholder="e.g. 14.5"
                    required
                  />
                </div>
              </div>

              {/* Assign Owner Username */}
              <div className="form-group">
                <label className="form-label">Username Pemilik Anjing (Akses User)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newDogOwnerUsername}
                  onChange={(e) => setNewDogOwnerUsername(e.target.value)}
                  placeholder="e.g. willy atau budi"
                  required
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                  💡 User dengan username ini yang nanti dapat memantau anjing ini saat login.
                </span>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setIsAddDogOpen(false)}>
                  Batal
                </button>
                <button type="submit" className="btn-primary">
                  Buat Profil Anjing
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- EDIT DOG PROFILE MODAL (ADMIN ONLY) --- */}
      {isEditProfileOpen && isAdmin && (
        <div className="modal-overlay">
          <div className="glass-card modal-content">
            <div className="modal-header">
              <h3>Edit Profil & Pemilik Anjing</h3>
              <button className="modal-close-btn" onClick={() => setIsEditProfileOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveEditProfile}>
              <div className="form-group">
                <label className="form-label">Nama Anjing</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={editDogName}
                  onChange={(e) => setEditDogName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Ras / Jenis Anjing</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={editDogBreed}
                  onChange={(e) => setEditDogBreed(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Usia (Tahun)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    className="form-input" 
                    value={editDogAge}
                    onChange={(e) => setEditDogAge(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Berat (Kg)</label>
                  <input 
                    type="number" 
                    step="0.1"
                    className="form-input" 
                    value={editDogWeight}
                    onChange={(e) => setEditDogWeight(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Username Pemilik (Akses User Monitoring)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={editDogOwnerUsername}
                  onChange={(e) => setEditDogOwnerUsername(e.target.value)}
                  placeholder="e.g. willy atau budi"
                  required
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>
                  💡 Ganti username ini untuk mengalihkan hak akses monitoring ke pemilik lain.
                </span>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setIsEditProfileOpen(false)}>
                  Batal
                </button>
                <button type="submit" className="btn-primary">
                  Simpan Perubahan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- SETTINGS / THRESHOLDS MODAL (ADMIN ONLY) --- */}
      {isSettingsOpen && activeDog && isAdmin && (
        <div className="modal-overlay">
          <div className="glass-card modal-content">
            <div className="modal-header">
              <h3>Batas Ambang Peringatan {activeDog.name}</h3>
              <button className="modal-close-btn" onClick={() => setIsSettingsOpen(false)}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSaveSettings}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', padding: '0.75rem', background: 'var(--color-warning-bg)', borderRadius: '8px', border: '1px solid rgba(245,158,11,0.2)', fontSize: '0.8rem', color: 'var(--color-warning)' }}>
                <ShieldAlert size={16} />
                <span>Atur batas aman parameter vital untuk memicu peringatan otomatis di dashboard.</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Min Detak Jantung (BPM)</label>
                  <input 
                    type="number" 
                    className="form-input"
                    value={editMinHR}
                    onChange={(e) => setEditMinHR(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Max Detak Jantung (BPM)</label>
                  <input 
                    type="number" 
                    className="form-input"
                    value={editMaxHR}
                    onChange={(e) => setEditMaxHR(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Min Oksigen SpO2 (%)</label>
                <input 
                  type="number" 
                  min="50" 
                  max="100" 
                  className="form-input"
                  value={editMinSpO2}
                  onChange={(e) => setEditMinSpO2(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Min Suhu Tubuh (°C)</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    className="form-input"
                    value={editMinTemp}
                    onChange={(e) => setEditMinTemp(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Max Suhu Tubuh (°C)</label>
                  <input 
                    type="number" 
                    step="0.1" 
                    className="form-input"
                    value={editMaxTemp}
                    onChange={(e) => setEditMaxTemp(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setIsSettingsOpen(false)}>
                  Batal
                </button>
                <button type="submit" className="btn-primary">
                  Simpan Batas Ambang
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
