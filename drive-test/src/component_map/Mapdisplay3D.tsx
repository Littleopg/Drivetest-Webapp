import React, { useRef, useEffect, useState, useMemo } from 'react';
import maplibregl, { Map } from 'maplibre-gl';
import type { CustomLayerInterface } from 'maplibre-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Legend, RSRP_LEGEND_ITEMS, WIFI_LEGEND_ITEMS } from './legend'; 
import type { NetworkType } from '../pages/home';

// --- Static Antenna Sites Data ---
const ANTENNA_SITES = [
  { 
    lat: 13.726932, lng: 100.776645, code: 'EDKLM', 
    name_en: 'FACULTY OF ENGINEERING DEANS OFFICE BUILDING, KMITL', 
    name_th: 'สำนักงานคณบดี คณะวิศวกรรมศาสตร์ สจล.',
    enodeb_id: 650005,
    cell_ids: [101, 102, 103, 107, 108, 111, 117, 121, 122, 123, 127, 128, 137, 171, 177, 221, 222, 223, 227, 228, 237]
  },
  { 
    lat: 13.72759, lng: 100.778382, code: 'LBKLM', 
    name_en: 'CENTRAL LIBRARY KMITL', 
    name_th: 'สำนักหอสมุดกลาง สจล.',
    enodeb_id: 650039,
    cell_ids: [101, 102, 103, 107, 108, 121, 122, 123, 127, 128, 221, 222, 223, 228]
  },
  { 
    lat: 13.729247, lng: 100.775319, code: 'KMTLM', 
    name_en: 'KING MONG KUTS INSUTITUTE TECHNOLOGY LADKRABANG', 
    name_th: 'สถาบันเทคโนโลยีพระจอมเกล้าเจ้าคุณทหารลาดกระบัง',
    enodeb_id: 650017,
    cell_ids: [101, 102, 103, 106, 107, 108, 111, 112, 113, 121, 122, 123, 126, 128, 221, 222, 223, 226, 227, 228]
  },
  { 
    lat: 13.730731, lng: 100.777716, code: 'RAKLM', 
    name_en: 'Rector and Central Administration KMITL', 
    name_th: 'อาคารกรมหลวงฯ สำนักงานอธิการบดี สจล.',
    enodeb_id: 650050,
    cell_ids: [101, 102, 103, 106, 107, 108, 111, 121, 122, 123, 126, 127, 128, 171, 221, 222, 223, 226, 227, 228]
  }
];

// --- Types ---
interface RawDataPoint { [key: string]: any; }
interface GridDataPoint {
  grid_lat?: number | string;
  grid_lon?: number | string;
  grid_size?: number;
  rsrp_avg?: number;
  [key: string]: any;
}

interface MapDisplay3DProps {
  networkType: NetworkType;
  rawDataPoints: RawDataPoint[];
  neighborDataPoints?: any[]; 
  gridDataPoints: GridDataPoint[];
}

const MapDisplay3D: React.FC<MapDisplay3DProps> = ({ 
  networkType,
  rawDataPoints, 
  neighborDataPoints = [], 
  gridDataPoints
}) => {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const gridPopupRef = useRef<maplibregl.Popup | null>(null);
  
  const [activeLayer, setActiveLayer] = useState<'points' | 'grids'>('points');
  const [mapReady, setMapReady] = useState(false);
  
  // --- Report Navigation State ---
  const [uniqueReports, setUniqueReports] = useState<string[]>([]);
  const [selectedReportNum, setSelectedReportNum] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState<string>('');
  
  const [hiddenNeighborReport, setHiddenNeighborReport] = useState<string | null>(null);

  // --- REFS ---
  const antennaMarkersRef = useRef<maplibregl.Marker[]>([]); 

  // Extract ordered Report Numbers when data loads
  useEffect(() => {
      if (rawDataPoints.length > 0) {
          const reports = rawDataPoints
              .map(p => p.report || p['Report Number'])
              .filter(r => r !== undefined && r !== null)
              .map(String);
          
          const unique = Array.from(new Set(reports)).sort((a, b) => {
              const numA = Number(a); const numB = Number(b);
              if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
              return a.localeCompare(b);
          });
          
          setUniqueReports(unique);

          if (unique.length > 0) {
              setSelectedReportNum(unique[0]);
          }

      } else {
          setUniqueReports([]);
          setSelectedReportNum(null);
          setInputValue('');
      }
  }, [rawDataPoints]);

  // Retrieve data for the bottom-left split UI
  const selectedPointData = useMemo(() => {
      if (selectedReportNum && rawDataPoints.length > 0) {
          return rawDataPoints.find(p => String(p.report || p['Report Number']) === selectedReportNum) || null;
      }
      return null;
  }, [selectedReportNum, rawDataPoints]);

  useEffect(() => {
      setHiddenNeighborReport(null);
  }, [selectedPointData]);

  // --- MAP INITIALIZATION ---
  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/bright',
      zoom: 17.5,
      center: [100.775, 13.7273],
      pitch: 60,
      canvasContextAttributes: { antialias: true },
      localIdeographFontFamily: "'Kanit', 'Sarabun', 'Noto Sans Thai', 'sans-serif'"
    });

    mapRef.current = map;

    map.on('load', () => {
      setMapReady(true);
      
      map.addSource('grids', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('neighbor-points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.addLayer({
        id: 'grids-layer',
        type: 'fill',
        source: 'grids',
        layout: { visibility: 'none' }, 
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.6,
          'fill-outline-color': '#ffffff' 
        }
      });

      map.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'points',
        layout: { visibility: 'visible' },
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#00000033',
          'circle-opacity': 1
        }
      });

      // Neighbor Badge Indicator
      map.addLayer({
        id: 'points-neighbor-badge',
        type: 'circle',
        source: 'points',
        filter: ['==', ['get', 'has_neighbors'], true], 
        layout: { visibility: 'visible' },
        paint: {
          'circle-radius': 3,
          'circle-color': '#f59e0b', 
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff', 
          'circle-translate': [4, -4], 
          'circle-opacity': 1,
          'circle-stroke-opacity': 1
        }
      });
    });
  }, []);

  // --- ANTENNA AIS LOGO MARKERS ---
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    antennaMarkersRef.current.forEach(marker => marker.remove());
    antennaMarkersRef.current = [];

    if (networkType !== 'wifi') {
      ANTENNA_SITES.forEach(site => {
        const el = document.createElement('div');
        el.style.width = '36px';
        el.style.height = '36px';
        el.style.backgroundImage = 'url("/124C4D25-025C-4C20-846C-E76C02A0D958.png")';
        el.style.backgroundSize = 'contain';
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundPosition = 'center';
        el.style.cursor = 'pointer';
        el.style.filter = 'drop-shadow(0px 3px 4px rgba(0,0,0,0.4))'; 

        const popupHtml = `
          <div style="font-family: sans-serif; min-width: 150px; color: #333; padding: 4px;">
            <div style="font-weight: bold; font-size: 14px; margin-bottom: 4px; border-bottom: 1px solid #ccc; padding-bottom: 2px;">
              ${site.code}
            </div>
            <div style="font-size: 12px; font-weight: 500; margin-bottom: 4px; line-height: 1.2;">
              ${site.name_en}
            </div>
            <div style="font-size: 11px; color: #666; margin-bottom: 6px; line-height: 1.2;">
              ${site.name_th}
            </div>
            <div style="font-size: 11px; color: #444; margin-bottom: 4px; line-height: 1.4;">
              <strong>eNodeB ID:</strong> ${site.enodeb_id}
            </div>
            <div style="font-size: 11px; color: #444; line-height: 1.4; word-wrap: break-word;">
              <strong>Cell IDs:</strong> ${site.cell_ids.join(', ')}
            </div>
          </div>
        `;

        const popup = new maplibregl.Popup({ offset: 20, closeButton: true, maxWidth: '250px' }).setHTML(popupHtml);
        const marker = new maplibregl.Marker({ element: el }).setLngLat([site.lng, site.lat]).setPopup(popup).addTo(map);

        antennaMarkersRef.current.push(marker);
      });
    }

    return () => {
      antennaMarkersRef.current.forEach(marker => marker.remove());
      antennaMarkersRef.current = [];
    };
  }, [mapReady, networkType]);

  // --- DATA PROCESSING: POINTS ---
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource('points') as maplibregl.GeoJSONSource;
    
    if (source && rawDataPoints.length > 0) {
        const reportsWithNeighbors = new Set(
            neighborDataPoints.map(n => String(n.report || n['Report Number']))
        );

        const features = rawDataPoints.map(p => {
            const { lat, lon } = getCoords(p);
            const rsrp = getRSRP(p);
            const reportNum = String(p.report || p['Report Number']);
            const hasNeighbors = reportsWithNeighbors.has(reportNum);

            if (isNaN(lat) || isNaN(lon)) return null;
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lon, lat] },
                properties: { ...p, rsrp: rsrp, color: findColor(rsrp, networkType), has_neighbors: hasNeighbors }
            };
        }).filter(Boolean); 
        source.setData({ type: 'FeatureCollection', features: features as any });
    }
  }, [rawDataPoints, neighborDataPoints, mapReady, networkType]); 

  // --- DATA PROCESSING: GRIDS ---
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource('grids') as maplibregl.GeoJSONSource;
    
    if (source && gridDataPoints && gridDataPoints.length > 0) {
        const features = gridDataPoints.map(g => {
            const { lat, lon } = getCoords(g);
            const rsrp = getRSRP(g);
            let size = Number(g.grid_size);
            if (isNaN(size) || size <= 0) size = 0.00015;

            const squareCoords = createSquare(lat, lon, size);
            if (!squareCoords) return null;

            return {
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: squareCoords },
                properties: { ...g, rsrp_avg: rsrp, color: findColor(rsrp, networkType) }
            };
        }).filter(Boolean); 

        source.setData({ type: 'FeatureCollection', features: features as any });
    }
  }, [gridDataPoints, mapReady, networkType]);

  // --- CENTRAL NAVIGATION LOGIC (FlyTo & Dimming) ---
  useEffect(() => {
      const map = mapRef.current;
      if (!map || !mapReady) return;

      if (map.getLayer('points-layer')) {
          if (selectedReportNum) {
              map.setPaintProperty('points-layer', 'circle-opacity', [
                  'case',
                  ['==', ['to-string', ['get', 'report']], selectedReportNum], 1,
                  ['==', ['to-string', ['get', 'Report Number']], selectedReportNum], 1,
                  0.15 
              ]);
              map.setPaintProperty('points-layer', 'circle-stroke-width', [
                  'case',
                  ['==', ['to-string', ['get', 'report']], selectedReportNum], 3,
                  ['==', ['to-string', ['get', 'Report Number']], selectedReportNum], 3,
                  1
              ]);
              map.setPaintProperty('points-layer', 'circle-stroke-color', [
                  'case',
                  ['==', ['to-string', ['get', 'report']], selectedReportNum], '#000000',
                  ['==', ['to-string', ['get', 'Report Number']], selectedReportNum], '#000000',
                  '#00000033'
              ]);
              
              if (map.getLayer('points-neighbor-badge')) {
                  map.setPaintProperty('points-neighbor-badge', 'circle-opacity', [
                      'case',
                      ['==', ['to-string', ['get', 'report']], selectedReportNum], 1,
                      ['==', ['to-string', ['get', 'Report Number']], selectedReportNum], 1,
                      0.15 
                  ]);
                  map.setPaintProperty('points-neighbor-badge', 'circle-stroke-opacity', [
                      'case',
                      ['==', ['to-string', ['get', 'report']], selectedReportNum], 1,
                      ['==', ['to-string', ['get', 'Report Number']], selectedReportNum], 1,
                      0.15 
                  ]);
              }
          } else {
              map.setPaintProperty('points-layer', 'circle-opacity', 1);
              map.setPaintProperty('points-layer', 'circle-stroke-width', 1);
              map.setPaintProperty('points-layer', 'circle-stroke-color', '#00000033');
              
              if (map.getLayer('points-neighbor-badge')) {
                  map.setPaintProperty('points-neighbor-badge', 'circle-opacity', 1);
                  map.setPaintProperty('points-neighbor-badge', 'circle-stroke-opacity', 1);
              }
          }
      }

      const neighborSource = map.getSource('neighbor-points') as maplibregl.GeoJSONSource;
      if (neighborSource) {
          if (selectedReportNum && neighborDataPoints.length > 0) {
              const matchingNeighbors = neighborDataPoints.filter(n => 
                  String(n.report || n['Report Number']) === selectedReportNum
              );

              const features = matchingNeighbors.map(n => {
                  const { lat, lon } = getCoords(n);
                  if (isNaN(lat) || isNaN(lon)) return null; 
                  return {
                      type: 'Feature',
                      geometry: { type: 'Point', coordinates: [lon, lat] },
                      properties: n
                  };
              }).filter(Boolean);

              neighborSource.setData({ type: 'FeatureCollection', features: features as any });
          } else {
              neighborSource.setData({ type: 'FeatureCollection', features: [] });
          }
      }

      // Fly to point (Removed native map popup for points)
      if (selectedReportNum) {
          const pointData = rawDataPoints.find(p => String(p.report || p['Report Number']) === selectedReportNum);
          if (pointData) {
              const { lat, lon } = getCoords(pointData);
              map.flyTo({ center: [lon, lat], zoom: map.getZoom() < 18 ? 18 : map.getZoom(), speed: 1.5, essential: true });
          }
      }
  }, [selectedReportNum, mapReady, rawDataPoints, neighborDataPoints]);

  // --- LAYER TOGGLING ---
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    
    const visibility = activeLayer === 'points' ? 'visible' : 'none';

    if (mapRef.current.getLayer('points-layer')) {
      mapRef.current.setLayoutProperty('points-layer', 'visibility', visibility);
    }
    if (mapRef.current.getLayer('points-neighbor-badge')) {
      mapRef.current.setLayoutProperty('points-neighbor-badge', 'visibility', visibility);
    }
    if (mapRef.current.getLayer('grids-layer')) {
      mapRef.current.setLayoutProperty('grids-layer', 'visibility', activeLayer === 'grids' ? 'visible' : 'none');
    }
  }, [activeLayer, mapReady]);

  // --- CLICK LOGIC ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['points-layer', 'points-neighbor-badge', 'grids-layer'] });
        if (features.length > 0) {
            const feature = features[0];
            const props = feature.properties;
            const layerId = feature.layer.id;
            
            if (layerId === 'points-layer' || layerId === 'points-neighbor-badge') {
                const currentReportNum = props.report || props['Report Number'];
                if (currentReportNum) setSelectedReportNum(String(currentReportNum));
            } else if (layerId === 'grids-layer') {
                // Keep grids native popup
                const rsrp_avg = props.rsrp_avg ? Number(props.rsrp_avg).toFixed(1) : 'N/A';
                const rsrq_avg = props.rsrq_avg ? Number(props.rsrq_avg).toFixed(1) : 'N/A';
                const speed_avg = props.speed_avg ? Number(props.speed_avg).toFixed(2) : 'N/A';

                const sigLabel = networkType === 'wifi' ? 'RSSI' : 'RSRP';
                const qualLabel = networkType === 'wifi' ? 'SNR' : 'RSRQ';

                const html = `
                <div style="min-width: 200px; font-family: sans-serif; color: #000; max-height: 300px; overflow-y: auto;">
                    <div style="font-weight: bold; font-size: 14px; margin-bottom: 4px; color: #1f2937;">Grid Summary</div>
                    <div style="font-size: 10px; color: #6b7280; margin-bottom: 6px; text-transform: uppercase;">
                        ${renderValue(props.net_op_name)} | ${renderValue(props.band)}
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 12px;">
                        <div><b>Avg ${sigLabel}:</b> <span style="color:${findColor(Number(rsrp_avg), networkType)}">${rsrp_avg} dBm</span></div>
                        ${networkType === 'wifi' ? '' : `<div><b>Avg ${qualLabel}:</b> ${rsrq_avg} dB</div>`}
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 12px;">
                        <div><b>Avg Speed:</b> ${speed_avg} km/h</div>
                        <div><b>Points:</b> ${renderValue(props.point_count)}</div>
                    </div>
                    <hr style="border: 0; border-top: 1px solid #ddd; margin: 6px 0;"/>
                    <div style="background-color: #f3f4f6; padding: 6px; border-radius: 4px; margin-bottom: 6px; font-size: 11px;">
                        <div style="font-weight: bold; color: #4b5563; margin-bottom: 2px;">Avg Barometer</div>
                        <div style="display: flex; justify-content: space-between;"><span>Pressure:</span> <span>${renderValue(props.pressure_avg)} hPa</span></div>
                        <div style="display: flex; justify-content: space-between;"><span>Rel Alt:</span> <span>${renderValue(props.baro_rel_alt_avg)} m</span></div>
                        <div style="display: flex; justify-content: space-between;"><span>Floor:</span> <span>${renderValue(props.floor_avg)}</span></div>
                    </div>
                    <div style="background-color: #f3f4f6; padding: 6px; border-radius: 4px; font-size: 11px;">
                        <div style="font-weight: bold; color: #4b5563; margin-bottom: 2px;">Avg GPS/GNSS</div>
                        <div style="display: flex; justify-content: space-between;"><span>Abs Alt:</span> <span>${renderValue(props.altitude_avg)} m</span></div>
                        <div style="display: flex; justify-content: space-between;"><span>Rel Alt:</span> <span>${renderValue(props.gps_rel_alt_avg)} m</span></div>
                    </div>
                </div>`;

                if (gridPopupRef.current) gridPopupRef.current.remove();
                gridPopupRef.current = new maplibregl.Popup({ offset: 10, maxWidth: '320px', closeButton: true })
                  .setLngLat(e.lngLat)
                  .setHTML(html)
                  .addTo(map);
            }
        } else {
            setSelectedReportNum(null);
        }
    };

    map.on('click', handleClick);
    
    const handleMouseMove = (e: any) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['points-layer', 'points-neighbor-badge', 'grids-layer'] });
        map.getCanvas().style.cursor = features.length > 0 ? 'pointer' : '';
    };
    map.on('mousemove', handleMouseMove);

    return () => {
        map.off('click', handleClick);
        map.off('mousemove', handleMouseMove);
    };
  }, [networkType]);

  // --- NAVIGATION BUTTON HANDLERS ---
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

  useEffect(() => { setInputValue(selectedReportNum || ''); }, [selectedReportNum]);
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { setInputValue(e.target.value); };
  const handleInputSubmit = () => {
      const trimmed = inputValue.trim();
      if (!trimmed) { setInputValue(selectedReportNum || ''); return; }
      if (trimmed === selectedReportNum) return;
      if (uniqueReports.includes(trimmed)) setSelectedReportNum(trimmed);
      else { setInputValue(selectedReportNum || ''); alert(`Report Number ${trimmed} not found.`); }
  };
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
  };

  // --- BACKGROUND MODELS ONLY ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const fetchAndRenderBackground = async () => {
      try {
        const response = await fetch('http://localhost:5000/get-all-configs');
        const allConfigs = await response.json();

        Object.keys(allConfigs).forEach((filename) => {
          const config = allConfigs[filename];
          if (config && config.lat && config.lng) {
            const boxSourceId = `bg-box-source-${filename}`;
            const boxLayerId = `bg-box-layer-${filename}`;      
            const labelLayerId = `bg-label-layer-${filename}`;      
            const clickLayerId = `bg-click-layer-${filename}`;   
            const modelLayerId = `static-model-${filename}`;     
            
            const loadStatic3DModel = (e?: any) => {
                if (e) e.preventDefault(); 

                if (map.getLayer(boxLayerId)) {
                    map.off('click', boxLayerId, loadStatic3DModel);
                    map.setLayoutProperty(boxLayerId, 'visibility', 'none');
                }
                
                addStaticLayer({
                    map,
                    id: modelLayerId,
                    url: `http://localhost:5000/static/models/${filename}`,
                    lngLat: [config.lng, config.lat],
                    scale: config.scale || 1,
                    altitude: config.altitude || 0,
                    rotateX: config.rotateX || 0,
                    rotateY: config.rotateY || 0
                });

                if (!map.getLayer(clickLayerId)) {
                    map.addLayer({
                        id: clickLayerId,
                        type: 'fill-extrusion',
                        source: boxSourceId, 
                        paint: { 
                            'fill-extrusion-color': '#000000', 
                            'fill-extrusion-height': 30 * (config.scale || 1), 
                            'fill-extrusion-base': config.altitude || 0, 
                            'fill-extrusion-opacity': 0 
                        }
                    });
                    
                    let bgPopupInstance: maplibregl.Popup;

                    const showActionPopup = (ev: any) => {
                        ev.preventDefault();
                        const displayName = config.label ? config.label : filename;

                        const container = document.createElement('div');
                        container.style.textAlign = 'center';
                        container.innerHTML = `<h4 style="margin:0 0 8px 0; color:#333; font-size:12px;">${displayName}</h4>`;

                        const btnHide = document.createElement('button');
                        btnHide.innerText = '✖ Close';
                        btnHide.style.cssText = 'background:#6b7280; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;';
                        btnHide.onclick = () => {
                            if(bgPopupInstance) bgPopupInstance.remove();
                            if (map.getLayer(modelLayerId)) map.removeLayer(modelLayerId);
                            if (map.getLayer(clickLayerId)) { 
                                map.off('click', clickLayerId, showActionPopup); 
                                map.removeLayer(clickLayerId); 
                            }
                            if (map.getLayer(boxLayerId)) {
                                map.setLayoutProperty(boxLayerId, 'visibility', 'visible');
                                map.on('click', boxLayerId, loadStatic3DModel);
                            }
                        };

                        container.appendChild(btnHide);
                        bgPopupInstance = new maplibregl.Popup().setLngLat(ev.lngLat).setDOMContent(container).addTo(map);
                    };
                    
                    map.on('click', clickLayerId, showActionPopup);
                    map.on('mouseenter', clickLayerId, () => map.getCanvas().style.cursor = 'pointer');
                    map.on('mouseleave', clickLayerId, () => map.getCanvas().style.cursor = '');
                }
            };

            if (!map.getSource(boxSourceId)) {
                const baseWidth = 0.00015;  
                const baseLength = 0.0001; 
                const sizeX = baseWidth * (config.scale || 1);
                const sizeY = baseLength * (config.scale || 1);
                const c = [config.lng, config.lat];
                
                const squareCoords = [[
                    [c[0]-sizeX, c[1]-sizeY], [c[0]+sizeX, c[1]-sizeY],
                    [c[0]+sizeX, c[1]+sizeY], [c[0]-sizeX, c[1]+sizeY],
                    [c[0]-sizeX, c[1]-sizeY]  
                ]];
                map.addSource(boxSourceId, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: squareCoords }, properties: { title: config.label || filename } } });
            }
            if (!map.getLayer(boxLayerId)) {
                map.addLayer({
                    id: boxLayerId,
                    type: 'fill-extrusion',
                    source: boxSourceId,
                    paint: { 
                        'fill-extrusion-color': '#cccccc', 
                        'fill-extrusion-height': 30 * (config.scale || 1), 
                        'fill-extrusion-base': config.altitude||0, 
                        'fill-extrusion-opacity': 0.8 
                    }
                });
                
                map.addLayer({
                    id: labelLayerId,
                    type: 'symbol',
                    source: boxSourceId,
                    layout: {
                        'text-field': ['get', 'title'],
                        'text-font': ['Noto Sans Bold'],
                        'text-size': 12, 'text-offset': [0, 2], 'text-anchor': 'top'
                    },
                    paint: { 'text-color': '#000', 'text-halo-color': '#fff', 'text-halo-width': 2 }
                });

                map.on('click', boxLayerId, loadStatic3DModel);
                map.on('mouseenter', boxLayerId, () => map.getCanvas().style.cursor = 'pointer');
                map.on('mouseleave', boxLayerId, () => map.getCanvas().style.cursor = '');
            }
          }
        });
      } catch (error) { console.error("Error fetching background models:", error); }
    };

    if (map.isStyleLoaded()) fetchAndRenderBackground();
    else map.once('style.load', fetchAndRenderBackground);

  }, [mapReady]); 

  return (
    <div className="relative w-full h-[88vh] rounded-lg overflow-hidden border border-gray-300">
      <div ref={mapContainer} className="w-full h-full" />
      
      {/* Settings Overlay */}
      <div className="absolute top-4 right-4 bg-white p-2 rounded shadow z-10 flex flex-col gap-2">
        <label className="flex items-center space-x-2 cursor-pointer"><input type="radio" checked={activeLayer==='points'} onChange={()=>setActiveLayer('points')}/><span>Points</span></label>
        <label className="flex items-center space-x-2 cursor-pointer"><input type="radio" checked={activeLayer==='grids'} onChange={()=>setActiveLayer('grids')}/><span>Grids</span></label>
      </div>
      
      {/* DYNAMIC LEGEND */}
      <div className="absolute bottom-12 right-4 z-10">
         <Legend networkType={networkType} /> 
      </div>

      {/* REPORT NAVIGATION OVERLAY */}
      {uniqueReports.length > 0 && activeLayer === 'points' && (
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-white bg-opacity-95 px-4 py-2 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.2)] border border-gray-200 flex items-center gap-4 z-20">
            
            <button 
                onClick={handlePrevReport} 
                disabled={!selectedReportNum || uniqueReports.indexOf(selectedReportNum) <= 0}
                className="p-1.5 rounded-full hover:bg-gray-200 disabled:opacity-30 transition-colors bg-gray-100"
                title="Previous Report"
            >
                <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
            </button>
            
            <div className="flex items-center gap-2">
                <span className="font-bold text-gray-700 text-sm select-none">Report</span>
                <input 
                    type="text"
                    value={inputValue}
                    onChange={handleInputChange}
                    onBlur={handleInputSubmit}
                    onKeyDown={handleInputKeyDown}
                    placeholder="---"
                    className="w-16 text-center font-bold text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-inner"
                />
                <span className="text-xs text-gray-500 font-medium select-none">
                    / {uniqueReports.length > 0 ? uniqueReports[uniqueReports.length - 1] : 0}
                </span>
            </div>

            <button 
                onClick={handleNextReport} 
                disabled={selectedReportNum ? uniqueReports.indexOf(selectedReportNum) >= uniqueReports.length - 1 : false}
                className="p-1.5 rounded-full hover:bg-gray-200 disabled:opacity-30 transition-colors bg-gray-100"
                title="Next Report"
            >
                <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
            </button>

        </div>
      )}

      {/* --- BOTTOM LEFT: FIXED POPUP UI (SPLIT) --- */}
      {selectedPointData && activeLayer === 'points' && (() => {
          const pt = selectedPointData as any;
          const reportNum = pt.report || pt['Report Number'];
          const { lat, lon } = getCoords(pt);
          
          const sigLabel = networkType === 'wifi' ? 'RSSI' : 'RSRP';
          const qualLabel = networkType === 'wifi' ? 'SNR' : 'RSRQ';
          const idLabel = networkType === 'wifi' ? 'BSSID' : 'Cell ID';

          const displayFreq = getFirstValid(pt.Frequency, pt.freq, pt.band, pt.ARFCN);
          const displayId = getFirstValid(pt.bssid, pt.BSSID, pt.mac, pt.MAC, pt.cid_bid, pt['Cell ID'], pt.cell_id);
          const displayQual = getFirstValid(pt.snr, pt.SNR, pt.rsrq, pt.RSRQ);
          const displaySig = getFirstValid(pt.rssi, pt.rsrp, pt.RSRP);
          const displayMode = getFirstValid(pt.tech, pt.Tech, pt.serving_tech);
          const displayNodeId = getFirstValid(pt.node_id_nid, pt.enodeb_id, pt.eNodeB_ID);

          const matchingNeighbors = neighborDataPoints.filter(n => 
              String(n.report || n['Report Number'] || n['Report No']) === String(reportNum)
          );

          return (
              <>
                  {/* 1. SERVING CELL INFO BOX*/}
                  <div 
                      className="absolute bottom-12 left-4 w-64 bg-white p-3 rounded-lg shadow-[0_10px_25px_rgba(0,0,0,0.5)] border border-gray-300 cursor-default overflow-y-auto custom-scrollbar z-40"
                      style={{ fontFamily: 'sans-serif', color: '#000', maxHeight: '300px' }}
                  >
                      <div className="absolute top-1.5 right-2 cursor-pointer text-gray-400 hover:text-red-500 font-bold text-sm" onClick={() => setSelectedReportNum(null)}>✕</div>

                      <div style={{ fontSize: '9px', color: '#6b7280', textTransform: 'uppercase', marginBottom: '2px' }}>
                          Report No: {reportNum} <span style={{color:'#1d4ed8', fontWeight:'bold'}}>(Serving)</span>
                      </div>
                      <div style={{ fontWeight: 'bold', color: '#000', marginBottom: '4px', fontSize: '13px', paddingRight: '12px', lineHeight: '1.2' }}>
                          {renderValue(pt.net_op_name)} ({renderValue(displayFreq)})
                      </div>
                      
                      <div style={{ marginBottom: '2px', fontSize: '12px', display: 'flex', justifyContent: 'space-between' }}>
                          <div><b>{sigLabel}:</b> {renderValue(displaySig, ' dBm')}</div>
                          {networkType !== 'wifi' && (
                              <div><b>{qualLabel}:</b> {renderValue(displayQual, ' dB')}</div>
                          )}
                      </div>
                          
                      {networkType === 'wifi' ? (
                          <div style={{ marginBottom: '4px', fontSize: '11px' }}>
                              <b>{idLabel}:</b> {renderValue(displayId)}
                          </div>
                      ) : (
                          <>
                              <div style={{ marginBottom: '4px', fontSize: '11px', display: 'flex', justifyContent: 'space-between' }}>
                                  <div><b>Node ID:</b> {renderValue(displayNodeId)}</div>
                                  <div><b>Tech:</b> <span style={{ color: '#4b5563', fontWeight: 600 }}>{renderValue(displayMode)}</span></div>
                              </div>
                              <div style={{ marginBottom: '4px', fontSize: '11px' }}>
                                  <b>{idLabel}:</b> {renderValue(displayId)}
                              </div>
                          </>
                      )}
                      
                      <hr style={{ border: 0, borderTop: '1px solid #eee', margin: '6px 0' }}/>
                      
                      <div style={{ fontSize: '10px', lineHeight: '1.4', marginBottom: '8px' }}>
                          <div><b>Time:</b> {formatTimestamp(pt.timestamp || pt.sys_time)}</div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span><b>Loc:</b> {lat.toFixed(6)}, {lon.toFixed(6)}</span>
                              <span><b>Spd:</b> {renderValue(pt.speed || pt.driving_speed_kmh)} {(pt.speed !== '—' && pt.speed !== undefined && pt.speed !== null) ? 'km/h' : ''}</span>
                          </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                          <div style={{ backgroundColor: '#f3f4f6', padding: '6px', borderRadius: '4px', fontSize: '9px', lineHeight: '1.3' }}>
                              <div style={{ fontWeight: 'bold', color: '#555', marginBottom: '2px' }}>Barometer</div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Press:</span> <span>{renderValue(pt.baro_pressure)} {(pt.baro_pressure !== '—' && pt.baro_pressure !== undefined && pt.baro_pressure !== null) ? 'hPa' : ''}</span></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Rel Alt:</span> <span>{renderValue(pt.baro_rel_alt)} {(pt.baro_rel_alt !== '—' && pt.baro_rel_alt !== undefined && pt.baro_rel_alt !== null) ? 'm' : ''}</span></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Floor:</span> <span>{renderValue(pt.baro_floor)}</span></div>
                          </div>
                          
                          <div style={{ backgroundColor: '#f3f4f6', padding: '6px', borderRadius: '4px', fontSize: '9px', lineHeight: '1.3' }}>
                              <div style={{ fontWeight: 'bold', color: '#555', marginBottom: '2px' }}>GPS/GNSS</div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Abs Alt:</span> <span>{renderValue(pt.altitude || pt.gps_abs_alt)} {(pt.altitude !== '—' && pt.altitude !== undefined && pt.altitude !== null) ? 'm' : ''}</span></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Rel Alt:</span> <span>{renderValue(pt.gps_rel_alt)} {(pt.gps_rel_alt !== '—' && pt.gps_rel_alt !== undefined && pt.gps_rel_alt !== null) ? 'm' : ''}</span></div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Floor:</span> <span>{renderValue(pt.gps_floor)}</span></div>
                          </div>
                      </div>
                  </div>

                  {/* 2. NEIGHBOR TABLE BOX */}
                  {matchingNeighbors.length > 0 && hiddenNeighborReport !== selectedReportNum && (
                      <div 
                          className="absolute bottom-12 left-[280px] bg-white p-2.5 rounded-lg shadow-[0_10px_25px_rgba(0,0,0,0.5)] border border-gray-300 cursor-default flex flex-col z-40"
                          style={{ fontFamily: 'sans-serif', color: '#000', width: '280px', maxHeight: '300px' }}
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
                              {/* ลบ width: '100%' ออก ปล่อยให้ตารางขยายตามเนื้อหา เพื่อสร้าง Scrollbar */}
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
                                          const nRsrpRaw = getFirstValid(n.neighbor_level, n.signalqual, n.neighbor_rsrp, n.Neighbor_RSRP, n.rssi, getRSRP(n));
                                          const nRsrq = getFirstValid(n.neighbor_rsrq, n.Neighbor_RSRQ, n.rsrq, n.RSRQ, n.snr);
                                          const nFreq = getFirstValid(n.neighbor_freq, n.neighbor_freq_mhz, n.Neighbor_Freq_MHZ, n.Frequency);
                                          
                                          const nTimeRaw = getFirstValid(n.sys_time, n.timestamp, n.Time, n.time);
                                          let nTime = formatTimestamp(nTimeRaw);


                                          const { lat: nLatRaw, lon: nLonRaw } = getCoords(n);
                                          const nLoc = (!isNaN(nLatRaw) && !isNaN(nLonRaw)) 
                                              ? `${Number(nLatRaw).toFixed(5)}, ${Number(nLonRaw).toFixed(5)}` 
                                              : 'N/A';
                                          
                                          const nRsrpNum = (nRsrpRaw !== undefined && nRsrpRaw !== null && nRsrpRaw !== 'N/A' && !isNaN(Number(nRsrpRaw))) ? Number(nRsrpRaw) : -120;
                                          const nColor = findColor(nRsrpNum, networkType);

                                          // ปลดล็อคไม่ให้ตัดคำ (ลบ overflow: hidden) ปล่อยให้ข้อความยาวได้เลย เพราะเรามี Scrollbar แล้ว
                                          return (
                                              <tr key={idx} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                                  <td style={{ padding: '2px 6px' }}>{renderValue(nPci)}</td>
                                                  <td style={{ padding: '2px 6px' }}>{renderValue(nArfcn)}</td>
                                                  <td style={{ padding: '2px 6px', color: nColor, fontWeight: 'bold' }}>{renderValue(nRsrpRaw)}</td>
                                                  {networkType !== 'wifi' && (
                                                      <td style={{ padding: '2px 6px' }}>{renderValue(nRsrq)}</td>
                                                  )}
                                                  <td style={{ padding: '2px 6px' }}>{renderValue(nFreq)}</td>
                                                  <td style={{ padding: '2px 6px' }}>{nTime}</td>
                                                  <td style={{ padding: '2px 6px', letterSpacing: '-0.5px' }}>{nLoc}</td>
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

    </div>
  );
};

// --- HELPER FUNCTIONS ---

const getCoords = (obj: any) => {
    const lat = obj.latitude ?? obj.lat ?? obj.Lat ?? obj.LATITUDE ?? obj.grid_lat;
    const lon = obj.longitude ?? obj.long ?? obj.lng ?? obj.Long ?? obj.LONGITUDE ?? obj.grid_lon;
    return { lat: Number(lat), lon: Number(lon) };
};

const getRSRP = (obj: any) => {
    let val = obj.rsrp ?? obj.RSRP ?? obj.rssi ?? obj.RSSI ?? obj.nrssrsrp ?? obj.rsrp_avg;
    
    if (val === undefined || val === null || val === '—') {
        const matchingKey = Object.keys(obj).find(k => 
            k.toLowerCase().includes('rsrp') || k.toLowerCase().includes('rssi') || k.toLowerCase().includes('rxlev')
        );
        if (matchingKey) val = obj[matchingKey];
    }

    if (val === '—' || val === null || val === undefined || isNaN(Number(val))) return -120; 
    return Number(val);
};

const createSquare = (latIn: number, lonIn: number, sizeDegrees: number) => {
    if (isNaN(latIn) || isNaN(lonIn) || isNaN(sizeDegrees)) return null;
    const offset = sizeDegrees / 2;
    return [[
        [lonIn - offset, latIn - offset], 
        [lonIn + offset, latIn - offset], 
        [lonIn + offset, latIn + offset], 
        [lonIn - offset, latIn + offset], 
        [lonIn - offset, latIn - offset]  
    ]];
};

const findColor = (rsrp: number, networkType: string = 'cellular') => {
    const items = networkType === 'wifi' ? WIFI_LEGEND_ITEMS : RSRP_LEGEND_ITEMS;
    const item = items.find((i) => rsrp >= i.threshold);
    return item ? item.color : (networkType === 'wifi' ? '#9b59b6' : '#ff0000');
};

const getFirstValid = (...values: any[]) => {
    return values.find(v => v !== undefined && v !== null && String(v).trim() !== '' && v !== '—' && v !== 'null' && v !== 'N/A');
};

const renderValue = (val: any, suffix = '') => {
    if (val === undefined || val === null || val === '' || val === '—' || val === 'null' || val === 'N/A') return 'N/A';
    return `${val}${suffix}`;
};

const formatTimestamp = (ts: any) => {
    if (!ts || ts === '—' || ts === 'null') return 'N/A';
    const str = String(ts);
    if (str.length === 14) {
        return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)} ${str.slice(8, 10)}:${str.slice(10, 12)}:${str.slice(12, 14)}`;
    }
    return str;
};

// --- Dynamic Layer Functions ---
function addStaticLayer({ map, id, url, lngLat, altitude, scale, rotateX, rotateY }: any) {
    const modelAsMercator = maplibregl.MercatorCoordinate.fromLngLat(lngLat, altitude);
    const modelScale = modelAsMercator.meterInMercatorCoordinateUnits() * scale;
    let camera: THREE.Camera, scene: THREE.Scene, renderer: THREE.WebGLRenderer;

    const customLayer: CustomLayerInterface = {
        id: id, type: 'custom', renderingMode: '3d',
        onAdd: function (map, gl) {
            camera = new THREE.Camera(); scene = new THREE.Scene();
            const l1 = new THREE.DirectionalLight(0xffffff); l1.position.set(0, -70, 100).normalize(); scene.add(l1);
            const l2 = new THREE.DirectionalLight(0xffffff); l2.position.set(0, 70, 100).normalize(); scene.add(l2);
            scene.add(new THREE.AmbientLight(0x404040, 2));
            new GLTFLoader().load(url, (gltf: any) => { 
                const root = new THREE.Group();
                root.rotation.set(rotateX * (Math.PI/180), rotateY * (Math.PI/180), 0);
                root.add(gltf.scene);
                scene.add(root);
                map.triggerRepaint(); 
            });
            renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
            renderer.autoClear = false;
        },
        render: function (gl, args) {
            const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
            const l = new THREE.Matrix4().makeTranslation(modelAsMercator.x, modelAsMercator.y, modelAsMercator.z).scale(new THREE.Vector3(modelScale, -modelScale, modelScale));
            camera.projectionMatrix = m.multiply(l);
            renderer.resetState(); renderer.render(scene, camera); map.triggerRepaint();
        }
    };
    if (!map.getLayer(id)) map.addLayer(customLayer);
}

export default MapDisplay3D;