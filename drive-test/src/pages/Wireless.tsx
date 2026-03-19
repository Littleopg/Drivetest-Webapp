import { useState, useEffect, useMemo, Suspense, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Grid, TransformControls, Html } from '@react-three/drei' 
import { useLocation } from 'react-router-dom'
import * as THREE from 'three' 

import { CameraController } from '../component_wireless/CameraController'
import { BuildingModel } from '../component_wireless/BuildingModel'
import { HeatmapOverlay } from '../component_wireless/HeatmapOverlay'
import type { AccessPoint } from '../component_wireless/HeatmapOverlay'

import { WirelessUI } from '../component_wireless/WirelessUI' 

import { Legend, RSRP_LEGEND_ITEMS, WIFI_LEGEND_ITEMS } from '../component_map/legend'

import JSZip from 'jszip';

const WALL_LOSS_DB = 15; 

interface ReferencePoint {
  id: string;
  position: [number, number, number];
  label: string;
}

interface BuildingModelData {
  id: string; filename: string; label: string; modelPath: string; scale: number; rotation: [number, number, number];
}

interface CsvDataPoint {
  index: number;
  timestamp: string;
  deltaX: number;
  deltaZ: number;
  rssi: number;
  net_op_name: string;
  band: string;
  lat: number;
  long: number;
  speed: string;
  baro_pressure: string;
  baro_rel_alt: string;
  baro_floor: string;
  altitude: string;
  gps_rel_alt: string;
  gps_floor: string;
  [key: string]: any;
}

export interface LocalAccessPoint extends AccessPoint {
  frequency?: number;
}


const INITIAL_APS: LocalAccessPoint[] = []

// --- HELPER FUNCTIONS ---

const renderValue = (val: any, suffix = '') => {
    if (val === undefined || val === null || val === '' || val === '—' || val === 'null' || val === 'N/A') return 'N/A';
    return `${val}${suffix}`;
};

const getFirstValid = (...values: any[]) => {
    return values.find(v => v !== undefined && v !== null && String(v).trim() !== '' && v !== '—' && v !== 'null' && v !== 'N/A');
};

// --- UNIFIED COLOR HELPERS ---
const findColorStr = (rsrp: number, networkType: string = 'cellular') => {
    const items = networkType === 'wifi' ? WIFI_LEGEND_ITEMS : RSRP_LEGEND_ITEMS;
    const item = items.find((i) => rsrp >= i.threshold);
    return item ? item.color : (networkType === 'wifi' ? '#9b59b6' : '#ff0000');
};
// --- HEATMAP GRADIENT COLOR CALCULATOR FOR UE POINTS ---
const getHeatmapColor = (rssi: number) => {
    const min = -120;
    const max = -50;
    const clamped = Math.max(min, Math.min(max, rssi));
    const t = (clamped - min) / (max - min);

    const color = new THREE.Color();
    if (t < 0.2) {
        color.setRGB(0.6, 0.35, 0.7).lerp(new THREE.Color(0.8, 0.2, 0.2), t / 0.2);
    } else if (t < 0.4) {
        color.setRGB(0.8, 0.2, 0.2).lerp(new THREE.Color(1, 0.5, 0.2), (t - 0.2) / 0.2);
    } else if (t < 0.6) {
        color.setRGB(1, 0.5, 0.2).lerp(new THREE.Color(1, 0.9, 0.2), (t - 0.4) / 0.2);
    } else if (t < 0.8) {
        color.setRGB(1, 0.9, 0.2).lerp(new THREE.Color(0.5, 1, 0.5), (t - 0.6) / 0.2);
    } else {
        color.setRGB(0.5, 1, 0.5).lerp(new THREE.Color(0.18, 0.8, 0.44), (t - 0.8) / 0.2);
    }
    return `#${color.getHexString()}`;
};

// FIX: This now uses the Heatmap continuous scale logic for labels
const getUEQualityLabel = (rssi: number) => {
    if (rssi > -65) return "Excellent";
    if (rssi > -75) return "Good";
    if (rssi > -85) return "Fair";
    if (rssi > -95) return "Poor";
    return "Very Poor";
};

const getSignalQuality = (rssi: number, networkType: string = 'cellular') => {
    const items = networkType === 'wifi' ? WIFI_LEGEND_ITEMS : RSRP_LEGEND_ITEMS;
    const item = items.find((i) => rssi >= i.threshold);
    if (item) {
        const match = item.label.match(/\(([^)]+)\)/);
        return { text: match ? match[1] : 'Unknown', color: item.color };
    }
    return { text: 'Bad', color: networkType === 'wifi' ? '#9b59b6' : '#ff0000' };
};

// --- RENDERER: NOW HANDLES SWAPPED X/Z AXES ---
interface CsvPointsRendererProps {
  origin: [number, number, number] | null;
  data: CsvDataPoint[];
  networkType: 'cellular' | 'wifi';
  selectedReportNum: string | null;
  onSelectReport: (report: string | null) => void;
}

const CsvPointsRenderer = ({ origin, data, networkType, selectedReportNum, onSelectReport }: CsvPointsRendererProps) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  useEffect(() => {
    if (!meshRef.current || !origin || data.length === 0) return;
    
    // Use the first point as the relative 0,0 for the path
    const firstLat = data[0].lat;
    const firstLong = data[0].long;

    data.forEach((pt, i) => {
      // Calculate raw displacement in meters
      const deltaLatMeters = pt.lat - firstLat;
      const deltaLongMeters = pt.long - firstLong;

      // Direct Cartesian Mapping (1 Unit = 1 Meter)
      // Long maps to X-axis, Lat maps to Z-axis
      const posX = origin[0] - deltaLongMeters;
      const posY = origin[1] + (pt.deltaY || 0) + 0.1;
      const posZ = origin[2] - deltaLatMeters; // Subtract to maintain top-to-bottom image mapping
      
      dummy.position.set(posX, posY, posZ);
      
      const isSelected = selectedReportNum === String(pt.index);
      dummy.scale.set(isSelected ? 1.5 : 1, isSelected ? 1.5 : 1, isSelected ? 1.5 : 1);
      
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);

      const ptValue = networkType === 'wifi' ? pt.rssi : (pt.rsrp ?? pt.rssi); 
      const numericVal = (ptValue !== undefined && ptValue !== '—') ? Number(ptValue) : -120;
      
      color.set(findColorStr(numericVal, networkType));

      if (selectedReportNum && !isSelected) {
          color.lerp(new THREE.Color(0x222222), 0.85); 
      }

      meshRef.current!.setColorAt(i, color);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
    meshRef.current.computeBoundingSphere();

  }, [origin, data, dummy, color, selectedReportNum, networkType]);
  
  if (!origin || data.length === 0) return null;

  const handleClick = (e: any) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) {
      const pt = data[e.instanceId];
      onSelectReport(String(pt.index));
    }
  };

  return (
    <instancedMesh 
      key={data.length} 
      ref={meshRef} 
      args={[undefined as any, undefined as any, data.length]} 
      onClick={handleClick}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = 'auto'; }}
    >
      <sphereGeometry args={[0.25, 16, 16]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

const TopViewTrigger = ({ trigger }: { trigger: number }) => {
  const { camera, controls } = useThree() as any;
  useEffect(() => {
    camera.position.set(0, 100, 0); 
    camera.lookAt(0, 0, 1);
    if (controls) { controls.target.set(0, 0, 1); controls.update(); }
  }, [camera, controls, trigger]); 
  return null;
}

const calculateFSPL = (distance: number, freqMHz: number) => {
  const d = Math.max(distance, 0.1);
  return 20 * Math.log10(d) + 20 * Math.log10(freqMHz) - 27.56;
};

export default function Wireless() {
  const location = useLocation() 
  const BACKEND_URL = "http://localhost:5000" 

  const [buildings, setBuildings] = useState<BuildingModelData[]>([])
  const [loading, setLoading] = useState(true)
  const [activeBuildingId, setActiveBuildingId] = useState<string | null>(null)
  const [activeFloor, setActiveFloor] = useState('all')
  const [floorCount, setFloorCount] = useState(1)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [obstacleModel, setObstacleModel] = useState<THREE.Object3D | null>(null);

  const [resetTrigger, setResetTrigger] = useState(0);

  const [aps, setAps] = useState<LocalAccessPoint[]>(INITIAL_APS)
  const [selectedApId, setSelectedApId] = useState<string | null>(null)

  const [refPoints, setRefPoints] = useState<ReferencePoint[]>([])
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null)

  const [csvOrigin, setCsvOrigin] = useState<[number, number, number] | null>(null);
  const [isCsvOriginSelected, setIsCsvOriginSelected] = useState<boolean>(false);
  const [csvData, setCsvData] = useState<CsvDataPoint[]>([]);

  // --- NEW STATES FOR IMAGE HANDLING ---
  const [floorPlanImage, setFloorPlanImage] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState<boolean>(false);
  const [imageScale, setImageScale] = useState<number>(1); // <--- ADD THIS LINE
  
  // --- UPLOAD & NEIGHBOR STATES ---
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [networkType, setNetworkType] = useState<'cellular' | 'wifi'>('wifi');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [neighborData, setNeighborData] = useState<any[]>([]);
  const neighborFileInputRef = useRef<HTMLInputElement>(null);

  // --- REPORT NAVIGATION STATES ---
  const [uniqueReports, setUniqueReports] = useState<string[]>([]);
  const [selectedReportNum, setSelectedReportNum] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState<string>('');

  const [hiddenNeighborReport, setHiddenNeighborReport] = useState<string | null>(null);

  
  
  
  const currentBuilding = useMemo(() => buildings.find(b => b.id === activeBuildingId), [activeBuildingId, buildings])

  const saveApsToBackend = async (newAps: LocalAccessPoint[], buildingFilename: string) => {
    try {
        await fetch(`${BACKEND_URL}/save-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: buildingFilename,
                config: { accessPoints: newAps }
            })
        });
    } catch (err) {
        console.error("Failed to save APs to backend:", err);
    }
  };

  useEffect(() => {
    const fetchModelConfig = async () => {
        if (!currentBuilding) {
            setAps(INITIAL_APS);
            return;
        }
        try {
            const res = await fetch(`${BACKEND_URL}/get-config/${currentBuilding.filename}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.accessPoints) {
                    setAps(data.accessPoints);
                } else {
                    setAps([]); 
                }
            }
        } catch (err) {
            console.error("Failed to fetch model config:", err);
        }
    };
    fetchModelConfig();
  }, [currentBuilding]);
  // Extract ordered Report Numbers and Auto-Select Floor when CSV data loads
  useEffect(() => {
      if (csvData.length > 0) {
          const reports = csvData
              .map(p => String(p.index))
              .filter(r => r !== undefined && r !== null && r !== 'NaN');
          
          const unique = Array.from(new Set(reports)).sort((a, b) => {
              const numA = Number(a); const numB = Number(b);
              if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
              return a.localeCompare(b);
          });
          
          setUniqueReports(unique);

          // Automatically select the first report
          if (unique.length > 0) {
              setSelectedReportNum(unique[0]);
          }

          // --- NEW: AUTOMATICALLY SELECT THE MODEL FLOOR ---
          // Find the first point that has a valid baro_floor value
          const firstValidFloorPoint = csvData.find(p => 
              p.baro_floor !== undefined && 
              p.baro_floor !== null && 
              p.baro_floor !== '—' && 
              String(p.baro_floor).trim() !== ''
          );

          if (firstValidFloorPoint) {
              // Set the active floor to match the barometer floor
              setActiveFloor(String(firstValidFloorPoint.baro_floor));
          }

      } else {
          setUniqueReports([]);
          setSelectedReportNum(null);
          setInputValue('');
          setActiveFloor('all'); // Reset to all floors if data is cleared
      }
  }, [csvData]);

  useEffect(() => {
      setInputValue(selectedReportNum || '');
  }, [selectedReportNum]);

  const handlePrevReport = () => {
      if (!selectedReportNum) return;
      const idx = uniqueReports.indexOf(selectedReportNum);
      if (idx > 0) setSelectedReportNum(uniqueReports[idx - 1]);
  };

  const handleNextReport = () => {
      if (!selectedReportNum) {
          if (uniqueReports.length > 0) setSelectedReportNum(uniqueReports[0]);
          return;
      }
      const idx = uniqueReports.indexOf(selectedReportNum);
      if (idx < uniqueReports.length - 1) setSelectedReportNum(uniqueReports[idx + 1]);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { setInputValue(e.target.value); };

  const handleInputSubmit = () => {
      const trimmed = inputValue.trim();
      if (!trimmed) { setInputValue(selectedReportNum || ''); return; }
      if (trimmed === selectedReportNum) return;
      if (uniqueReports.includes(trimmed)) { setSelectedReportNum(trimmed); } 
      else { setInputValue(selectedReportNum || ''); alert(`Report Number ${trimmed} not found.`); }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
  };

  const activeAps = useMemo(() => {
    if (activeFloor === 'all') return aps;
    return aps.filter(ap => ap.floor === activeFloor || !ap.floor);
  }, [aps, activeFloor]);

  const apsByFloor = useMemo(() => {
    const groups: Record<string, LocalAccessPoint[]> = {};
    activeAps.forEach(ap => {
        const floor = ap.floor || '1';
        if (!groups[floor]) groups[floor] = [];
        groups[floor].push(ap);
    });
    return groups;
  }, [activeAps]);

  useEffect(() => {
      if (activeFloor !== 'all' && selectedApId) {
          const ap = aps.find(a => a.id === selectedApId);
          if (ap && ap.floor !== activeFloor) setSelectedApId(null);
      }
  }, [activeFloor, aps, selectedApId]);

  const measureSignalAt = (position: THREE.Vector3) => {
     if (activeAps.length === 0) return { rssi: -120, dist: 0, bestAp: 'None' };

     const raycaster = new THREE.Raycaster();
     const direction = new THREE.Vector3();
     const apVec = new THREE.Vector3();
     const worldNormal = new THREE.Vector3();
     const normalMatrix = new THREE.Matrix3();

     let bestRSSI = -150; 
     let bestDist = 0;
     let bestApLabel = 'None';

     activeAps.forEach(ap => {
        apVec.set(ap.position[0], ap.position[1], ap.position[2]);
        const dist = apVec.distanceTo(position);

        const apFrequency = ap.frequency || 2400;
        const pathLoss = calculateFSPL(dist, apFrequency);
        let rssi = ap.txPower - pathLoss;

        if (obstacleModel) {
            direction.subVectors(position, apVec).normalize();
            raycaster.set(apVec, direction);
            raycaster.far = dist;
            const hits = raycaster.intersectObject(obstacleModel, true);
            
            hits.forEach(hit => {
                if (hit.face) {
                    normalMatrix.getNormalMatrix(hit.object.matrixWorld);
                    worldNormal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
                    rssi -= WALL_LOSS_DB;
                }
            });
        }

        if (rssi > bestRSSI) {
            bestRSSI = rssi;
            bestDist = dist;
            bestApLabel = ap.label || ap.id;
        }
     });

     return { rssi: Math.max(-120, bestRSSI), dist: bestDist, bestAp: bestApLabel };
  }


  // --- NEW: Fetch APs when the active building changes ---
  useEffect(() => {
    const fetchModelConfig = async () => {
        if (!currentBuilding) {
            setAps(INITIAL_APS);
            return;
        }
        try {
            const res = await fetch(`${BACKEND_URL}/get-config/${currentBuilding.filename}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.accessPoints) {
                    setAps(data.accessPoints);
                } else {
                    setAps([]); // Default to empty if no APs exist yet
                }
            }
        } catch (err) {
            console.error("Failed to fetch model config:", err);
        }
    };
    fetchModelConfig();
  }, [currentBuilding]);

  // --- UPDATED HANDLERS ---
  const handleAddAp = () => {
    const newId = `ap-${Date.now()}`;
    const assignedFloor = activeFloor === 'all' ? '1' : activeFloor;
    const newAp: LocalAccessPoint = { id: newId, position: [0, 5, 0], txPower: 20, label: `AP ${aps.length + 1}`, floor: assignedFloor };
    
    const updatedAps = [...aps, newAp];
    setAps(updatedAps); 
    setSelectedApId(newId); setSelectedRefId(null); setIsCsvOriginSelected(false);
    
    if (currentBuilding) saveApsToBackend(updatedAps, currentBuilding.filename);
  };

  const handleDeleteAp = (id: string) => {
    const updatedAps = aps.filter(ap => ap.id !== id);
    setAps(updatedAps);
    if (selectedApId === id) setSelectedApId(null);
    
    if (currentBuilding) saveApsToBackend(updatedAps, currentBuilding.filename);
  };

  const handleApUpdate = (id: string, field: keyof LocalAccessPoint | 'x' | 'y' | 'z', value: any) => {
    setAps((prev) => {
      const updatedAps = prev.map((ap) => {
        if (ap.id !== id) return ap
        if (field === 'x' || field === 'y' || field === 'z') {
          const newPos = [...ap.position] as [number, number, number]
          if (field === 'x') newPos[0] = parseFloat(value) || 0
          if (field === 'y') newPos[1] = parseFloat(value) || 0
          if (field === 'z') newPos[2] = parseFloat(value) || 0
          return { ...ap, position: newPos }
        }
        return { ...ap, [field]: value }
      });
      
      // Save changes immediately
      if (currentBuilding) saveApsToBackend(updatedAps, currentBuilding.filename);
      return updatedAps;
    })
  };

  const handleAddRefPoint = () => {
      const newId = `ref-${Date.now()}`;
      const newRef: ReferencePoint = { id: newId, position: [5, 2, 5], label: `Pt ${refPoints.length + 1}` };
      setRefPoints([...refPoints, newRef]);
      setSelectedRefId(newId); setSelectedApId(null); setIsCsvOriginSelected(false);
  };

  const handleDeleteRefPoint = (id: string) => {
      setRefPoints(refPoints.filter(r => r.id !== id));
      if (selectedRefId === id) setSelectedRefId(null);
  };

  const handleRefUpdate = (id: string, field: 'label' | 'x' | 'y' | 'z', value: any) => {
    setRefPoints((prev) => prev.map((rp) => {
      if (rp.id !== id) return rp;
      if (field === 'x' || field === 'y' || field === 'z') {
        const newPos = [...rp.position] as [number, number, number];
        if (field === 'x') newPos[0] = parseFloat(value) || 0;
        if (field === 'y') newPos[1] = parseFloat(value) || 0;
        if (field === 'z') newPos[2] = parseFloat(value) || 0;
        return { ...rp, position: newPos };
      }
      return { ...rp, [field]: value };
    }));
  };

  const handleAddCsvOrigin = () => {
      setCsvOrigin([0, 5, 0]);
      setIsCsvOriginSelected(true); setSelectedApId(null); setSelectedRefId(null);
  };

  const handleTypeSelect = (type: 'cellular' | 'wifi') => {
      setNetworkType(type);
      setIsUploadModalOpen(false); 
      if (fileInputRef.current) fileInputRef.current.click();
  };

// --- EXISTING CSV LOGIC EXTRACTED FOR REUSE ---
  const processCsvFile = async (file: File | Blob, filename: string) => {
      const formData = new FormData(); 
      formData.append('file', file, filename);
      const res = await fetch(`${BACKEND_URL}/upload-indoor`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.points;
  };

  const processNeighborCsvFile = async (file: File | Blob, filename: string) => {
      const formData = new FormData(); 
      formData.append('file', file, filename);
      const res = await fetch(`${BACKEND_URL}/upload-neighbor`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.neighbors;
  };

  const processZipFile = async (file: File) => {
      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(file);

      let servingFileBlob: Blob | null = null;
      let neighborFileBlob: Blob | null = null;
      let warnings: string[] = [];

      // Iterate through files
      for (const relativePath in loadedZip.files) {
          const zipEntry = loadedZip.files[relativePath];
          if (zipEntry.dir) continue;

          const fileName = zipEntry.name.toLowerCase();

          if (fileName.endsWith('.csv')) {
              const fileData = await zipEntry.async('blob');
              if (fileName.includes('nei_') || fileName.includes('neighbor')) {
                  neighborFileBlob = fileData;
              } else if (fileName.includes('serv_') || fileName.includes('surv_')) {
                  servingFileBlob = fileData;
              } else {
                  if (!servingFileBlob) servingFileBlob = fileData;
                  else neighborFileBlob = fileData;
              }
          } 
          // --- EXTRACT IMAGE (.PNG, .JPG) ---
          else if (fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
              const blob = await zipEntry.async('blob');
              setFloorPlanImage(URL.createObjectURL(blob)); // Save to state
          } 
          else {
              warnings.push(zipEntry.name);
          }
      }

      if (!servingFileBlob) throw new Error("No valid Serving CSV found inside the ZIP file.");

      // Upload Serving
      const points = await processCsvFile(servingFileBlob, 'serving_extracted.csv');
      setCsvData(points);

      // Upload Neighbor (if exists)
      if (neighborFileBlob) {
          const neighbors = await processNeighborCsvFile(neighborFileBlob, 'neighbor_extracted.csv');
          setNeighborData(neighbors);
      }

      if (warnings.length > 0) {
          console.warn("Skipped unsupported files:", warnings);
      }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !csvOrigin) return;

      setLoading(true); 
      setFloorPlanImage(null); // Clear old image on new upload

      try {
          if (file.name.toLowerCase().endsWith('.zip')) {
              await processZipFile(file);
          } else if (file.name.toLowerCase().endsWith('.csv')) {
              const points = await processCsvFile(file, file.name);
              setCsvData(points);
          } else {
              alert("Please upload a .csv or .zip file.");
          }
      } catch (err: any) { 
          alert(`Failed to process upload: ${err.message || err}`); 
      } finally { 
          setLoading(false);
          if (fileInputRef.current) fileInputRef.current.value = ''; 
      }
  };


  const handleNeighborFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const formData = new FormData(); formData.append('file', file);

      try {
          const res = await fetch(`${BACKEND_URL}/upload-neighbor`, { method: 'POST', body: formData });
          const data = await res.json();
          if (data.error) alert("Error processing Neighbor CSV: " + data.error);
          else {
              setNeighborData(data.neighbors);
              alert(`Successfully loaded ${data.neighbors.length} neighbor records.`);
          }
      } catch (err) { alert("Failed to connect to the backend."); } 
      finally { if (neighborFileInputRef.current) neighborFileInputRef.current.value = ''; }
  };

    const handleClearCsv = () => { 
        setCsvData([]); 
        setNeighborData([]); 
        setFloorPlanImage(null); // <-- Clear image on reset
    };

    const formatTimestamp = (ts: any) => {
    if (!ts || ts === '—' || ts === 'null') return 'N/A';
    const str = String(ts);
    if (str.length === 14) {
        return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)} ${str.slice(8, 10)}:${str.slice(10, 12)}:${str.slice(12, 14)}`;
    }
    return str;
};

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const response = await fetch(`${BACKEND_URL}/api/models?t=${Date.now()}`)
        if (!response.ok) throw new Error("Server Error")
        const jsonData = await response.json()
        const formattedData = Object.entries(jsonData).map(([filename, config]: [string, any], index) => {
          const rX = THREE.MathUtils.degToRad(Number(config.rotateX || 0))
          const rY = THREE.MathUtils.degToRad(Number(config.rotateY || 0))
          const rZ = THREE.MathUtils.degToRad(Number(config.rotateZ || 0))
          return {
            id: `b_${index}`, filename: filename, label: config.label || filename,
            modelPath: `${BACKEND_URL}/static/models/${filename}`, 
            scale: 1, rotation: [rZ, rX, rY] as [number, number, number]
          }
        })
        setBuildings(formattedData)
        setLoading(false)
      } catch (error: any) { setLoading(false) }
    }
    fetchData()
  }, [])
  
  useEffect(() => {
    if (buildings.length > 0 && location.state?.targetModel) {
        const matched = buildings.find(b => b.filename === location.state.targetModel);
        if (matched) setActiveBuildingId(matched.id);
    }
  }, [buildings, location.state])
  
  useEffect(() => { setActiveFloor('all') }, [activeBuildingId])

  const activeAp = useMemo(() => activeAps.find(a => a.id === selectedApId), [activeAps, selectedApId])
  const activeRef = useMemo(() => refPoints.find(r => r.id === selectedRefId), [refPoints, selectedRefId]);

  const lastPosRef = useRef<THREE.Vector3 | null>(null);

  // --- MEMOIZE THE SELECTED POINT DATA FOR THE POPUP ---
  const selectedCsvPoint = useMemo(() => {
      if (selectedReportNum && csvData.length > 0) {
          return csvData.find(p => String(p.index) === selectedReportNum) || null;
      }
      return null;
  }, [selectedReportNum, csvData]);

  useEffect(() => {
      setHiddenNeighborReport(null);
  }, [selectedCsvPoint]);

  if (loading) return <div className="h-screen flex items-center justify-center bg-gray-900 text-white">Loading...</div>

  return (
    <div className="flex flex-col h-screen w-full bg-gray-900 relative">
      
      {/* HIDDEN FILE INPUTS */}
<input 
    type="file" 
    accept=".csv,.zip" // <--- Add .zip here
    ref={fileInputRef} 
    style={{ display: 'none' }} 
    onChange={handleFileSelect} 
/>
<input 
    type="file" 
    accept=".csv" 
    ref={neighborFileInputRef} 
    style={{ display: 'none' }} 
    onChange={handleNeighborFileSelect} 
/>

      {/* NETWORK TYPE SELECTION MODAL */}
      {isUploadModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm z-[1000]">
            <div className="bg-white p-6 rounded-lg shadow-2xl flex flex-col items-center w-80 border border-gray-200">
                <h2 className="text-xl font-bold text-gray-800 mb-2">Select Network Type</h2>
                <p className="text-sm text-gray-500 mb-6 text-center">What type of data are you uploading?</p>
                <div className="flex gap-4 w-full justify-center">
                    <button onClick={() => handleTypeSelect('cellular')} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold w-1/2 transition-colors shadow-md">Cellular</button>
                    <button onClick={() => handleTypeSelect('wifi')} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-bold w-1/2 transition-colors shadow-md">Wi-Fi</button>
                </div>
                <button onClick={() => setIsUploadModalOpen(false)} className="mt-6 text-sm text-gray-400 hover:text-red-500 underline transition-colors">Cancel</button>
            </div>
        </div>
      )}

      <div className="relative flex-1 w-full h-full">
        
        {/* SIDEBAR UI */}
        <WirelessUI 
            buildings={buildings}
            activeBuildingId={activeBuildingId}
            setActiveBuildingId={setActiveBuildingId}
            floorCount={floorCount}
            activeFloor={activeFloor}
            setActiveFloor={setActiveFloor}
            showHeatmap={showHeatmap}
            setShowHeatmap={setShowHeatmap}
            aps={activeAps} 
            selectedApId={selectedApId}
            setSelectedApId={(id) => { setSelectedApId(id); setSelectedRefId(null); setIsCsvOriginSelected(false); }}
            handleApUpdate={handleApUpdate}
            onAddAp={handleAddAp}
            onDeleteAp={handleDeleteAp}
            onResetCamera={() => setResetTrigger(t => t + 1)}
            refPoints={refPoints}
            selectedRefId={selectedRefId}
            onSelectRef={(id) => { setSelectedRefId(id); setSelectedApId(null); setIsCsvOriginSelected(false); }}
            onAddRef={handleAddRefPoint}
            onDeleteRef={handleDeleteRefPoint}
            setNetworkType={setNetworkType} 
            handleRefUpdate={handleRefUpdate} 
            csvOrigin={csvOrigin}
            isCsvOriginSelected={isCsvOriginSelected}
            onSelectCsvOrigin={() => { setIsCsvOriginSelected(true); setSelectedApId(null); setSelectedRefId(null); }}
            onAddCsvOrigin={handleAddCsvOrigin}
            csvDataCount={csvData.length}
            onClearCsv={handleClearCsv}
            networkType={networkType}
            floorPlanImage={floorPlanImage}
            onViewFloorPlan={() => setShowImageModal(true)}
            onInitiateUpload={() => {
                if (!csvOrigin) { alert("Please add a Reference Point first!"); return; }
                setIsUploadModalOpen(true);
            }} 
            onInitiateNeighborUpload={() => {
                if (neighborFileInputRef.current) neighborFileInputRef.current.click();
            }}
        />

        {/* BOTTOM NAV BAR */}
        {uniqueReports.length > 0 && (
          <div className="absolute bottom-18 left-1/2 transform -translate-x-1/2 bg-white bg-opacity-95 px-4 py-2 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.2)] border border-gray-200 flex items-center gap-4 z-20">
              <button onClick={handlePrevReport} disabled={!selectedReportNum || uniqueReports.indexOf(selectedReportNum) <= 0} className="p-1.5 rounded-full hover:bg-gray-200 disabled:opacity-30 transition-colors bg-gray-100" title="Previous Report">
                  <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
              </button>
              
              <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-700 text-sm select-none">Report</span>
                  <input type="text" value={inputValue} onChange={handleInputChange} onBlur={handleInputSubmit} onKeyDown={handleInputKeyDown} placeholder="---" className="w-16 text-center font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-inner"/>
                  <span className="text-xs text-gray-500 font-medium select-none">/ {uniqueReports.length > 0 ? uniqueReports[uniqueReports.length - 1] : 0}</span>
              </div>

              <button onClick={handleNextReport} disabled={selectedReportNum ? uniqueReports.indexOf(selectedReportNum) >= uniqueReports.length - 1 : false} className="p-1.5 rounded-full hover:bg-gray-200 disabled:opacity-30 transition-colors bg-gray-100" title="Next Report">
                  <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
              </button>
          </div>
        )}

        

        {/* --- BOTTOM LEFT: FIXED POPUP UI (SPLIT) --- */}
        {selectedCsvPoint && (() => {
            const pt = selectedCsvPoint as any;
            
            const sigLabel = networkType === 'wifi' ? 'RSSI' : 'RSRP';
            const qualLabel = networkType === 'wifi' ? 'SNR' : 'RSRQ';
            const idLabel = networkType === 'wifi' ? 'BSSID' : 'Cell ID';

            const displayFreq = getFirstValid(pt.Frequency, pt.freq, pt.band, pt.ARFCN);
            const displayId = getFirstValid(pt.bssid, pt.BSSID, pt.mac, pt.MAC, pt.cid_bid, pt['Cell ID'], pt.cell_id);
            const displayQual = getFirstValid(pt.snr, pt.SNR, pt.rsrq, pt.RSRQ);
            const displaySig = getFirstValid(pt.rssi, pt.rsrp, pt.RSRP);
            const displayMode = getFirstValid(pt.tech, pt.Tech, pt.serving_tech);

            const matchingNeighbors = neighborData.filter(n => 
                String(n.report || n['Report Number'] || n['Report No']) === String(pt.index)
            );

            return (
                <>
                    {/* 1. SERVING CELL INFO BOX */}
                    <div 
                        className="absolute bottom-18 left-3 w-64 bg-white p-2.5 rounded-lg shadow-[0_10px_25px_rgba(0,0,0,0.5)] border border-gray-300 cursor-default overflow-y-auto custom-scrollbar z-40"
                        style={{ fontFamily: 'sans-serif', color: '#000', maxHeight: '300px' }}
                    >
                        <div className="absolute top-1.5 right-2 cursor-pointer text-gray-400 hover:text-red-500 font-bold text-sm" onClick={() => setSelectedReportNum(null)}>✕</div>

                        <div style={{ fontSize: '9px', color: '#6b7280', textTransform: 'uppercase', marginBottom: '2px' }}>
                            Report No: {pt.index} <span style={{color:'#1d4ed8', fontWeight:'bold'}}>(Serving)</span>
                        </div>
                        <div style={{ fontWeight: 'bold', color: '#000', marginBottom: '4px', fontSize: '12px', paddingRight: '12px', lineHeight: '1.1' }}>
                            {renderValue(pt.net_op_name)} ({renderValue(displayFreq)})
                        </div>
                        
                        <div style={{ marginBottom: '2px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                            <div><b>{sigLabel}:</b> {renderValue(displaySig, ' dBm')}</div>
                            {networkType !== 'wifi' && (
                                <div><b>{qualLabel}:</b> {renderValue(displayQual, ' dB')}</div>
                            )}
                        </div>
                            
                        <div style={{ marginBottom: '6px', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div><b>{idLabel}:</b> {renderValue(displayId)}</div>
                            {networkType !== 'wifi' && (
                                <div><b>Tech:</b> <span style={{ color: '#4b5563', fontWeight: 600 }}>{renderValue(displayMode)}</span></div>
                            )}
                        </div>
                        
                        <hr style={{ border: 0, borderTop: '1px solid #eee', margin: '4px 0' }}/>
                        
                        <div style={{ fontSize: '10px', lineHeight: '1.4', marginBottom: '6px' }}>
                            <div><b>Time:</b> {formatTimestamp(pt.timestamp || pt.sys_time)}</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span><b>Loc:</b> {Number(pt.lat).toFixed(6)}, {Number(pt.long).toFixed(6)}</span>
                                <span><b>Spd:</b> {renderValue(pt.speed || pt.driving_speed_kmh)} {(pt.speed !== '—' && pt.speed !== undefined && pt.speed !== null) ? 'km/h' : ''}</span>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                            <div style={{ backgroundColor: '#f3f4f6', padding: '4px', borderRadius: '4px', fontSize: '9px', lineHeight: '1.3' }}>
                                <div style={{ fontWeight: 'bold', color: '#555', marginBottom: '1px' }}>Barometer</div>
                                <div>Press: {renderValue(pt.baro_pressure)} {(pt.baro_pressure !== '—' && pt.baro_pressure !== undefined && pt.baro_pressure !== null) ? 'hPa' : ''}</div>
                                <div>Rel Alt: {renderValue(pt.baro_rel_alt)} {(pt.baro_rel_alt !== '—' && pt.baro_rel_alt !== undefined && pt.baro_rel_alt !== null) ? 'm' : ''}</div>
                                <div>Floor: {renderValue(pt.baro_floor)}</div>
                            </div>
                            
                            <div style={{ backgroundColor: '#f3f4f6', padding: '4px', borderRadius: '4px', fontSize: '9px', lineHeight: '1.3' }}>
                                <div style={{ fontWeight: 'bold', color: '#555', marginBottom: '1px' }}>GPS</div>
                                <div>Abs Alt: {renderValue(pt.altitude || pt.gps_abs_alt)} {(pt.altitude !== '—' && pt.altitude !== undefined && pt.altitude !== null) ? 'm' : ''}</div>
                                <div>Rel Alt: {renderValue(pt.gps_rel_alt)} {(pt.gps_rel_alt !== '—' && pt.gps_rel_alt !== undefined && pt.gps_rel_alt !== null) ? 'm' : ''}</div>
                                <div>Floor: {renderValue(pt.gps_floor)}</div>
                            </div>
                        </div>
                    </div>

                    {/* 2. NEIGHBOR TABLE BOX*/}
                    {matchingNeighbors.length > 0 && hiddenNeighborReport !== selectedReportNum && (
                        <div 
                            className="absolute bottom-18 left-[270px] bg-white p-2.5 rounded-lg shadow-[0_10px_25px_rgba(0,0,0,0.5)] border border-gray-300 cursor-default flex flex-col z-40"
                            style={{ fontFamily: 'sans-serif', color: '#000', width: '320px', maxHeight: '300px' }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 'bold', color: '#d97706', marginBottom: '6px', fontSize: '11px', borderBottom: '1px solid #fde68a', paddingBottom: '4px', flexShrink: 0 }}>
                                <span>Neighbor Cells ({matchingNeighbors.length})</span>
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setHiddenNeighborReport(selectedReportNum);
                                    }}
                                    className="text-red-500 hover:text-red-700 font-bold text-sm ml-4 focus:outline-none leading-none"
                                    title="Close Neighbor Table"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="overflow-y-auto overflow-x-auto custom-scrollbar flex-1" style={{ minHeight: 0 }}>
                                <table style={{ textAlign: 'left', fontSize: '10px', whiteSpace: 'nowrap' }}>
                                    <thead style={{ position: 'sticky', top: 0, backgroundColor: 'white', zIndex: 10 }}>
                                        <tr style={{ color: '#6b7280', borderBottom: '1px solid #ccc' }}>
                                            {networkType === 'wifi' ? (
                                                <>
                                                    <th style={{ padding: '2px 6px' }}>SSID</th>
                                                    <th style={{ padding: '2px 6px' }}>MAC</th>
                                                    <th style={{ padding: '2px 6px' }}>{sigLabel}</th>
                                                    <th style={{ padding: '2px 6px' }}>Freq</th>
                                                </>
                                            ) : (
                                                <>
                                                    <th style={{ padding: '2px 6px' }}>PCI</th>
                                                    <th style={{ padding: '2px 6px' }}>ARFCN</th>
                                                    <th style={{ padding: '2px 6px' }}>{sigLabel}</th>
                                                    <th style={{ padding: '2px 6px' }}>{qualLabel}</th>
                                                    <th style={{ padding: '2px 6px' }}>Freq</th>
                                                </>
                                            )}
                                            <th style={{ padding: '2px 6px' }}>Time</th>
                                            <th style={{ padding: '2px 6px' }}>Loc</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {matchingNeighbors.map((n, idx) => {
                                            const nPci = getFirstValid(n.neighbor_pci, n.Neighbor_PCI, n.pci, n.PCI, n.neighbor_ssid, n.SSIDNAME);
                                            const nArfcn = getFirstValid(n.neighbor_bssid, n.neighbor_arfcn, n.Neighbor_ARFCN, n.arfcn, n.ARFCN, n.band, n.freq, n.MAC);
                                            const nRsrp = getFirstValid(n.neighbor_level, n.signalqual, n.neighbor_rsrp, n.Neighbor_RSRP, n.rssi);
                                            const nRsrq = getFirstValid(n.neighbor_rsrq, n.Neighbor_RSRQ, n.rsrq, n.RSRQ, n.snr);
                                            const nFreq = getFirstValid(n.neighbor_freq, n.neighbor_freq_mhz, n.Neighbor_Freq_MHZ, n.Frequency);
                                            
                                            const nTimeRaw = getFirstValid(n.sys_time, n.timestamp, n.Time, n.time);
                                            let nTime = formatTimestamp(nTimeRaw);
                                            if (nTime.includes(' ')) nTime = nTime.split(' ')[1]; // ตัดวันที่เหลือแต่เวลา

                                            const nLatRaw = getFirstValid(n.lat, n.Latitude, n.LAT);
                                            const nLonRaw = getFirstValid(n.long, n.lon, n.Longitude, n.LON);
                                            const nLoc = (nLatRaw !== undefined && nLonRaw !== undefined && nLatRaw !== 'N/A' && nLonRaw !== 'N/A') 
                                                ? `${Number(nLatRaw).toFixed(5)}, ${Number(nLonRaw).toFixed(5)}` 
                                                : 'N/A';
                                            
                                            const nColor = findColorStr(Number(nRsrp), networkType);

                                            return (
                                                <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                                                    <td style={{ padding: '4px 6px' }}>{renderValue(nPci)}</td>
                                                    <td style={{ padding: '4px 6px' }}>{renderValue(nArfcn)}</td>
                                                    <td style={{ padding: '4px 6px', color: nColor, fontWeight: 'bold' }}>{renderValue(nRsrp)}</td>
                                                    {networkType !== 'wifi' && (
                                                        <td style={{ padding: '4px 6px' }}>{renderValue(nRsrq)}</td>
                                                    )}
                                                    <td style={{ padding: '4px 6px' }}>{renderValue(nFreq)}</td>
                                                    <td style={{ padding: '4px 6px' }}>{nTime}</td>
                                                    <td style={{ padding: '4px 6px' }}>{nLoc}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            )
        })()}

      

        <Canvas camera={{ position: [0, 100, 0], fov: 45 }} shadows>
          <ambientLight intensity={0.5} />
          <directionalLight position={[-10, 20, 5]} intensity={1.2} castShadow />
          <directionalLight position={[10, 20, -5]} intensity={1.0} />
          <Grid args={[200, 200]} cellSize={1} sectionSize={10} fadeDistance={100} position={[0, -0.01, 0]} />
          
          <CameraController speed={0.5} />
          <TopViewTrigger trigger={resetTrigger} />

          {currentBuilding && (
             <Suspense fallback={null}>
                <BuildingModel 
                  activeFloor={activeFloor} 
                  modelPath={currentBuilding.modelPath}
                  onLoadFloors={setFloorCount}
                  scale={currentBuilding.scale}
                  rotation={[currentBuilding.rotation[0] + (Math.PI / 2), currentBuilding.rotation[1] + (Math.PI / 2), currentBuilding.rotation[2]]}
                  onModelLoaded={(scene) => setObstacleModel(scene)}
                />

                 {showHeatmap && Object.entries(apsByFloor).map(([floorId, floorAps]) => {
                    const lowestFloorY = Math.min(...floorAps.map(ap => ap.position[1]));
                    const floorHeatmapHeight = Math.max(0.5, lowestFloorY);
                    return (
                        <HeatmapOverlay 
                           key={`heatmap-floor-${floorId}`} width={80} depth={80} 
                           aps={activeAps} visible={showHeatmap} cutoff={-200} 
                           obstacles={obstacleModel} resolution={1} heatmapHeight={floorHeatmapHeight} 
                           networkType={networkType}
                        />
                    );
                 })}
                 
                 {/* Just the points rendering now! */}
                 <CsvPointsRenderer 
                    origin={csvOrigin} 
                    data={csvData} 
                    networkType={networkType}
                    selectedReportNum={selectedReportNum}
                    onSelectReport={setSelectedReportNum}
                 />

                 {csvOrigin && (
                    <group position={csvOrigin} onClick={(e) => { e.stopPropagation(); setIsCsvOriginSelected(true); setSelectedApId(null); setSelectedRefId(null); }}>
                        <mesh position={[0, 1, 0]}>
                            <octahedronGeometry args={[0.4]} />
                            <meshStandardMaterial color="#9b59b6" />
                        </mesh>
                        <mesh position={[0, 0.5, 0]}>
                            <cylinderGeometry args={[0.02, 0.02, 1]} />
                            <meshStandardMaterial color="white" />
                        </mesh>
                        <Html position={[0, 1.8, 0]} center zIndexRange={[100, 0]}>
                            <div className="bg-purple-900/90 text-white text-[10px] px-2 py-1 rounded border border-purple-500 shadow-xl font-bold whitespace-nowrap pointer-events-none">
                                Reference Point
                            </div>
                        </Html>
                    </group>
                 )}

                 {csvOrigin && isCsvOriginSelected && (
                    <TransformControls mode="translate" position={csvOrigin}
                       onObjectChange={(e: any) => { if (e?.target?.object) { if (!lastPosRef.current) lastPosRef.current = new THREE.Vector3(); lastPosRef.current.copy(e.target.object.position); }}}
                       onMouseUp={() => { if (lastPosRef.current) { setCsvOrigin([lastPosRef.current.x, lastPosRef.current.y, lastPosRef.current.z]); lastPosRef.current = null; }}}
                    >
                        <group>
                            <mesh position={[0, 1, 0]}>
                                <octahedronGeometry args={[0.4]} />
                                <meshBasicMaterial color="#9b59b6"  />
                            </mesh>
                        </group>
                    </TransformControls>
                 )}

                 {activeAps.map((ap) => {
                     if (ap.id === selectedApId) return null;
                     return (
                        <group key={ap.id} position={ap.position} onClick={(e) => { e.stopPropagation(); setSelectedApId(ap.id); setSelectedRefId(null); setIsCsvOriginSelected(false); }}>
                           <mesh position={[0, 0.25, 0]}><sphereGeometry args={[0.2, 16, 16]} /><meshStandardMaterial color="#2ecc71" emissive="#27ae60" /></mesh>
                           <mesh position={[0, 0.125, 0]}><cylinderGeometry args={[0.02, 0.02, 0.25]} /><meshStandardMaterial color="white" /></mesh>
                           <Html position={[0, 0.6, 0]} center><div className="bg-black/70 text-white text-[10px] px-1 rounded pointer-events-none">{ap.label}</div></Html>
                        </group>
                     )
                 })}

                 {refPoints.map((rp) => {
                  const isSelected = rp.id === selectedRefId;
                  if (isSelected) return null;

                  const posVec = new THREE.Vector3(rp.position[0], rp.position[1], rp.position[2]);
                  const { rssi, dist, bestAp } = measureSignalAt(posVec);
                  
                  const markerColor = getHeatmapColor(rssi);
                  const qualityText = getUEQualityLabel(rssi); 

                  return (
                      <group key={rp.id} position={rp.position} onClick={(e) => { e.stopPropagation(); setSelectedRefId(rp.id); setSelectedApId(null); setIsCsvOriginSelected(false); }}>
                        <mesh position={[0, 1, 0]}><sphereGeometry args={[0.3, 16, 16]} /><meshStandardMaterial color={markerColor} /></mesh>
                        <mesh position={[0, 0.5, 0]}><cylinderGeometry args={[0.03, 0.01, 1]} /><meshStandardMaterial color="white" /></mesh>
                        <Html position={[0, 1.8, 0]} center zIndexRange={[100, 0]}>
                            <div className="flex flex-col items-center bg-black/90 p-2 rounded border border-white/20 backdrop-blur-md min-w-[80px] shadow-xl">
                              <span className="text-white text-[10px] font-bold mb-1 border-b border-white/20 pb-0.5 w-full text-center">{rp.label}</span>
                              <div className="flex flex-col items-center gap-0 leading-tight">
                                  <span className="text-xs font-mono font-bold" style={{ color: markerColor }}>{rssi.toFixed(0)} dBm</span>
                                  <span className="text-[9px] font-bold uppercase mt-0.5" style={{ color: markerColor }}>{qualityText}</span>
                                  <span className="text-gray-400 text-[8px] mt-0.5 whitespace-nowrap">{dist.toFixed(1)}m <span className="text-gray-500">from</span> {bestAp}</span>
                              </div>
                            </div>
                        </Html>
                      </group>
                  )
                })}
                {networkType === 'wifi' && activeAps.map((ap) => {
                    if (ap.id === selectedApId) return null;
                    return (
                    <group key={ap.id} position={ap.position} onClick={(e) => { e.stopPropagation(); setSelectedApId(ap.id); setSelectedRefId(null); setIsCsvOriginSelected(false); }}>
                        <mesh position={[0, 0.25, 0]}><sphereGeometry args={[0.2, 16, 16]} /><meshStandardMaterial color="#2ecc71" emissive="#27ae60" /></mesh>
                        <mesh position={[0, 0.125, 0]}><cylinderGeometry args={[0.02, 0.02, 0.25]} /><meshStandardMaterial color="white" /></mesh>
                        <Html position={[0, 0.6, 0]} center><div className="bg-black/70 text-white text-[10px] px-1 rounded pointer-events-none">{ap.label}</div></Html>
                    </group>
                    )
                })}

                {/* Hide AP Transform Controls when in Cellular mode */}
                {networkType === 'wifi' && activeAp && (
                <TransformControls 
                    mode="translate" 
                    position={[activeAp.position[0], activeAp.position[1], activeAp.position[2]]}
                    onObjectChange={(e: any) => { 
                        if (e?.target?.object) { 
                            if (!lastPosRef.current) lastPosRef.current = new THREE.Vector3(); 
                            lastPosRef.current.copy(e.target.object.position); 
                        }
                    }}
                    onMouseUp={() => { 
                        if (lastPosRef.current) { 
                            const { x, y, z } = lastPosRef.current; 
                            setAps(prev => {
                                const updated = prev.map(ap => 
                                    ap.id === activeAp.id 
                                        ? { ...ap, position: [x, y, z] as [number, number, number] } 
                                        : ap
                                );
                                
                                if (currentBuilding) saveApsToBackend(updated, currentBuilding.filename);
                                return updated;
                            });
                            
                            lastPosRef.current = null; 
                        }
                    }}
                >
                    <group>
                        <mesh position={[0, 0.25, 0]}>
                            <sphereGeometry args={[0.3, 16, 16]} />
                            <meshBasicMaterial color="#2ecc71" />
                        </mesh>
                    </group>
                </TransformControls>
                )}

                 {activeAp && (
                    <TransformControls 
                        mode="translate" 
                        position={[activeAp.position[0], activeAp.position[1], activeAp.position[2]]}
                        onObjectChange={(e: any) => { 
                            if (e?.target?.object) { 
                                if (!lastPosRef.current) lastPosRef.current = new THREE.Vector3(); 
                                lastPosRef.current.copy(e.target.object.position); 
                            }
                        }}
                        onMouseUp={() => { 
                            if (lastPosRef.current) { 
                                const { x, y, z } = lastPosRef.current; 
                                
                                // ---> THE FIX IS HERE <---
                                setAps(prev => {
                                    const updated = prev.map(ap => 
                                        ap.id === activeAp.id 
                                            ? { ...ap, position: [x, y, z] as [number, number, number] } 
                                            : ap
                                    );
                                    
                                    if (currentBuilding) saveApsToBackend(updated, currentBuilding.filename);
                                    return updated;
                                });
                                
                                lastPosRef.current = null; 
                            }
                        }}
                    >
                        <group>
                            <mesh position={[0, 0.25, 0]}>
                                <sphereGeometry args={[0.3, 16, 16]} />
                                <meshBasicMaterial color="#2ecc71" />
                            </mesh>
                        </group>
                    </TransformControls>
                    )}

                 {activeRef && (
    <TransformControls 
        mode="translate" 
        position={[activeRef.position[0], activeRef.position[1], activeRef.position[2]]}
        onObjectChange={(e: any) => { 
            if (e?.target?.object) { 
                if (!lastPosRef.current) lastPosRef.current = new THREE.Vector3(); 
                lastPosRef.current.copy(e.target.object.position); 
            }
        }}
        onMouseUp={() => { 
            if (lastPosRef.current) { 
                const { x, y, z } = lastPosRef.current; 
                handleRefUpdate(activeRef.id, 'x', x);
                handleRefUpdate(activeRef.id, 'y', y);
                handleRefUpdate(activeRef.id, 'z', z);
                lastPosRef.current = null; 
            }
        }}
    >
        <group>
            
            <mesh position={[0, 0.25, 0]}>
                <sphereGeometry args={[0.3, 16, 16]} />
                <meshBasicMaterial color="#276CF5"  />
            </mesh>

            {(() => {
                const pos = activeRef.position;
                const { rssi, dist, bestAp } = measureSignalAt(new THREE.Vector3(pos[0], pos[1], pos[2]));
                const markerColor = getHeatmapColor(rssi);
                const qualityText = getUEQualityLabel(rssi); 

                return (
                    <Html position={[0, 1.8, 0]} center>
                        <div className="bg-black/90 p-2 rounded text-white text-xs whitespace-nowrap border border-blue-500 shadow-xl min-w-[100px]">
                            <div className="font-bold border-b border-white/20 pb-0.5 mb-0.5 text-center">{activeRef.label} (Moving)</div>
                            <div className="flex justify-between gap-3 text-[10px] mt-1">
                                <span className="text-gray-400">Signal:</span>
                                <span className="font-mono font-bold" style={{ color: markerColor }}>{rssi.toFixed(0)} dBm</span>
                            </div>
                            <div className="flex justify-between gap-3 text-[10px]">
                                <span className="text-gray-400">Quality:</span>
                                <span className="font-bold uppercase" style={{ color: markerColor }}>{qualityText}</span>
                            </div>
                            <div className="flex justify-between gap-3 text-[10px]">
                                <span className="text-gray-400">Dist:</span>
                                <span className="text-white">{dist.toFixed(1)}m from {bestAp}</span>
                            </div>
                        </div>
                    </Html>
                );
            })()}
            
        </group>
    </TransformControls>
)}
                 </Suspense>
              )}
            </Canvas>


      

        {/* --- FLOOR PLAN IMAGE MODAL --- */}
        {showImageModal && floorPlanImage && (
            <div 
                className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/90 backdrop-blur-md p-4" 
                
                onClick={() => { setShowImageModal(false); setImageScale(1); }}
            >
                {/* --- ZOOM CONTROLS TOOLBAR --- */}
                <div 
                    className="w-full max-w-6xl flex justify-between items-center mb-4 px-2"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex items-center gap-3 bg-gray-800/80 p-2.5 rounded-xl border border-gray-600 shadow-lg">
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" /></svg>
                        <span className="text-white text-sm font-bold">Zoom:</span>
                        <input 
                            type="range" min="0.2" max="5" step="0.1" 
                            value={imageScale} 
                            onChange={(e) => setImageScale(parseFloat(e.target.value))}
                            className="w-32 md:w-48 cursor-pointer accent-blue-500"
                        />
                        <span className="text-gray-300 text-xs w-10 text-right">{Math.round(imageScale * 100)}%</span>
                        <button 
                            onClick={() => setImageScale(1)} 
                            className="ml-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold rounded shadow transition-colors"
                        >
                            Reset
                        </button>
                    </div>

                    <button 
                        onClick={() => { setShowImageModal(false); setImageScale(1); }} 
                        className="bg-red-500 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold shadow-xl hover:bg-red-600 transition-colors border-2 border-red-400"
                    >
                        ✕
                    </button>
                </div>

                {/* --- SCROLLABLE IMAGE CONTAINER --- */}
                <div 
                    className="relative bg-black/50 rounded-xl max-w-6xl w-full h-[80vh] overflow-auto custom-scrollbar border border-white/20 shadow-2xl flex items-start justify-center" 
                    onClick={e => e.stopPropagation()} 
                >
                    <img 
                        src={floorPlanImage} 
                        alt="Extracted Floor Plan" 
                        style={{ 
                            width: `${imageScale * 100}%`, 
                            maxWidth: 'none',             
                            height: 'auto'
                        }} 
                        className="transition-all duration-100 ease-out origin-top-left"
                    />
                </div>
                
                <p className="text-gray-400 text-xs mt-3">
                    Tip: Use the slider to zoom in, then drag the scrollbars to pan around the floor plan.
                </p>
            </div>
        )}
            
          </div>
        </div>
    )
}