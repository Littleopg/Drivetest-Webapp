import { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';

// Updated: Lowest color stop is now -120 (Purple)
const COLOR_STOPS = [
  { rssi: -50, r: 46, g: 204, b: 113 },   // Green
  { rssi: -65, r: 124, g: 243, b: 161 },  // Light Green
  { rssi: -75, r: 255, g: 214, b: 110 },  // Yellow
  { rssi: -85, r: 255, g: 178, b: 124 },  // Orange
  { rssi: -95, r: 255, g: 107, b: 107 },  // Red
  { rssi: -120, r: 155, g: 89, b: 182 }   // Purple
];

const WALL_LOSS_DB = 15;       
  

export const RSSI_LEGEND_ITEMS = [
  { threshold: -64, color: '#7CF3A1', label: 'Excellent (> -65)' },
  { threshold: -74, color: '#FFD66E', label: 'Good (-65 to -75)' },
  { threshold: -84, color: '#FFB27C', label: 'Fair (-75 to -85)' },
  { threshold: -94, color: '#FF6B6B', label: 'Poor (-85 to -95)' },
  { threshold: -120, color: '#9B59B6', label: 'Very Poor (< -95)' }
];

const lerp = (start: number, end: number, t: number) => start * (1 - t) + end * t;

const getSmoothColor = (rssi: number) => {
  if (rssi >= COLOR_STOPS[0].rssi) { const c = COLOR_STOPS[0]; return [c.r, c.g, c.b, 200]; }
  if (rssi <= COLOR_STOPS[COLOR_STOPS.length - 1].rssi) { const c = COLOR_STOPS[COLOR_STOPS.length - 1]; return [c.r, c.g, c.b, 0]; }

  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const upper = COLOR_STOPS[i];
    const lower = COLOR_STOPS[i + 1];
    if (rssi <= upper.rssi && rssi > lower.rssi) {
      const t = (rssi - lower.rssi) / (upper.rssi - lower.rssi);
      return [
        Math.round(lerp(lower.r, upper.r, t)),
        Math.round(lerp(lower.g, upper.g, t)),
        Math.round(lerp(lower.b, upper.b, t)),
        220 // Opacity
      ];
    }
  }
  return [0, 0, 0, 0];
};

const calculateFSPL = (distance: number, freqMHz: number) => {
  const d = Math.max(distance, 0.1); 
  return 20 * Math.log10(d) + 20 * Math.log10(freqMHz) - 27.56;
};

export interface AccessPoint {
  id: string; 
  position: [number, number, number]; 
  txPower: number; 
  label?: string;
  floor?: string; 
  frequency?: number; // Add this property
}

interface HeatmapOverlayProps {
  width: number; 
  depth: number; 
  aps: AccessPoint[]; 
  visible: boolean;
  resolution?: number; 
  cutoff?: number; 
  obstacles?: THREE.Object3D | null; 
  heatmapHeight?: number; 
  hiddenApId?: string | null; 
  networkType?: string; 
}

export function HeatmapOverlay({ 
  width, depth, aps, visible, 
  resolution = 2, cutoff = -200, obstacles, heatmapHeight = 0.5, hiddenApId,
  networkType = 'wifi' 
}: HeatmapOverlayProps) {
  
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!visible || aps.length === 0 || networkType !== 'wifi') { 
      setTexture(null); 
      return; 
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const canvasWidth = Math.floor(width * resolution);
    const canvasHeight = Math.floor(depth * resolution);
    canvas.width = canvasWidth; canvas.height = canvasHeight;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const imgData = ctx.createImageData(canvasWidth, canvasHeight);
    const data = imgData.data;

    const raycaster = new THREE.Raycaster();
    const apVec = new THREE.Vector3();     
    const deviceVec = new THREE.Vector3(); 
    const direction = new THREE.Vector3(); 

    const worldNormal = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();

    const boundaryRaycaster = new THREE.Raycaster();
    const boundaryOrigin = new THREE.Vector3();
    const downVector = new THREE.Vector3(0, -1, 0);

    for (let py = 0; py < canvasHeight; py++) {
      for (let px = 0; px < canvasWidth; px++) {
        const worldX = (px / resolution) - (width / 2);
        const worldZ = (py / resolution) - (depth / 2);
        
        if (obstacles) {
            boundaryOrigin.set(worldX, 100, worldZ); 
            boundaryRaycaster.set(boundaryOrigin, downVector);
            const boundaryHits = boundaryRaycaster.intersectObject(obstacles, true);
            if (boundaryHits.length === 0) continue; 
        }

        deviceVec.set(worldX, heatmapHeight, worldZ); 
        
        // Math baseline kept slightly below cutoff so edge signals can be calculated
        let strongestRSSI = -200; 

        for (const ap of aps) {
          apVec.set(ap.position[0], ap.position[1], ap.position[2]);
          const distance = apVec.distanceTo(deviceVec);
          
          // USE PER-AP FREQUENCY (Fallback to 2400 if undefined)
          const apFreq = ap.frequency || 2400;
          const pathLoss = calculateFSPL(distance, apFreq);
          let rssi = ap.txPower - pathLoss;

          if (rssi > cutoff && obstacles) {
             direction.subVectors(deviceVec, apVec).normalize();
             raycaster.set(apVec, direction);
             raycaster.far = distance; 
             const hits = raycaster.intersectObject(obstacles, true);
             
             for (const hit of hits) {
                if (hit.face) {
                    normalMatrix.getNormalMatrix(hit.object.matrixWorld);
                    worldNormal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
                        rssi -= WALL_LOSS_DB;
                }
             }
          }
          if (rssi > strongestRSSI) strongestRSSI = rssi;
        }

        if (strongestRSSI > cutoff) { 
           const [r, g, b, a] = getSmoothColor(strongestRSSI);
           const index = (py * canvasWidth + px) * 4;
           data[index] = r; data[index + 1] = g; data[index + 2] = b; data[index + 3] = a;          
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    const newTex = new THREE.CanvasTexture(canvas);
    newTex.magFilter = THREE.LinearFilter; 
    newTex.minFilter = THREE.LinearFilter;
    newTex.generateMipmaps = false;
    setTexture(newTex);

  }, [width, depth, aps, visible, resolution, cutoff, obstacles, heatmapHeight, networkType]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, heatmapHeight, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial 
          map={visible && networkType === 'wifi' ? texture : null} 
          transparent opacity={visible && texture && networkType === 'wifi' ? 0.8 : 0} 
          side={THREE.DoubleSide} depthWrite={false} 
        />
      </mesh>
    </group>
  );
}