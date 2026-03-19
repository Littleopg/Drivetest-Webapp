import React, { useRef, useEffect, useState } from 'react';
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl';
import type { CustomLayerInterface } from 'maplibre-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useNavigate } from 'react-router-dom'; 
import 'maplibre-gl/dist/maplibre-gl.css';

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

interface MapViewerProps {
  uploadedModelUrl: string | null;
  label?: string; 
  lat: number;
  lng: number;
  altitude: number;
  scale: number;
  rotateX: number;
  rotateY: number;
  onEdit?: (filename: string, config: any) => void;
  onMapClick?: (lat: number, lng: number) => void;
  isEditing: boolean; 
  networkType?: string; // เพิ่ม networkType เพื่อเช็คเงื่อนไขซ่อน/แสดง
}

const MapViewer = ({ uploadedModelUrl, label, lat, lng, altitude, scale, rotateX, rotateY, onEdit, onMapClick, isEditing, networkType }: MapViewerProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const navigate = useNavigate(); 
  
  const [mapLoaded, setMapLoaded] = useState(false); 

  const markerRef = useRef<maplibregl.Marker | null>(null);
  const bgMarkersRef = useRef<maplibregl.Marker[]>([]);
  const antennaMarkersRef = useRef<maplibregl.Marker[]>([]); // สำหรับเก็บหมุดเสาสัญญาณ
  const activeModelConfigRef = useRef({ lat, lng, altitude, scale, rotateX, rotateY });

  useEffect(() => {
    activeModelConfigRef.current = { lat, lng, altitude, scale, rotateX, rotateY };
    if (mapRef.current && mapLoaded) mapRef.current.triggerRepaint();
  }, [lat, lng, altitude, scale, rotateX, rotateY, mapLoaded]);

  // --- 1. INITIALIZE MAP ---
  useEffect(() => {
    if (localStorage.getItem('last_active_model')) {
        localStorage.removeItem('last_active_model');
    }

    if (mapRef.current || !mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://tiles.openfreemap.org/styles/bright',
      zoom: 17.5,
      center: [100.775, 13.7273],
      pitch: 60,
      canvasContextAttributes: { antialias: true },
      localIdeographFontFamily: "'Kanit', 'Sarabun', 'Noto Sans Thai', 'sans-serif'"
    });
    
    mapRef.current = map;
    map.on('load', () => setMapLoaded(true));

    return () => {
      if (markerRef.current) markerRef.current.remove();
      bgMarkersRef.current.forEach(m => m.remove());
      antennaMarkersRef.current.forEach(m => m.remove()); // ลบหมุดเสาตอนปิดหน้า
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, []);

  // --- 2. ANTENNA LOGO MARKERS ---
  useEffect(() => {
    if (!mapLoaded || !mapRef.current) return;
    const map = mapRef.current;

    // 1. Clear existing markers first (crucial for toggling)
    antennaMarkersRef.current.forEach(marker => marker.remove());
    antennaMarkersRef.current = [];

    // 2. Only draw markers if we are NOT in wifi mode
    if (networkType !== 'wifi') {
      ANTENNA_SITES.forEach(site => {
        // Create element for the AIS logo
        const el = document.createElement('div');
        el.style.width = '36px';
        el.style.height = '36px';
        el.style.backgroundImage = 'url("/124C4D25-025C-4C20-846C-E76C02A0D958.png")';
        el.style.backgroundSize = 'contain';
        el.style.backgroundRepeat = 'no-repeat';
        el.style.backgroundPosition = 'center';
        el.style.cursor = 'pointer';
        el.style.filter = 'drop-shadow(0px 3px 4px rgba(0,0,0,0.4))'; 

        // Create popup HTML
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

        // Configure Popup
        const popup = new maplibregl.Popup({ offset: 20, closeButton: true, maxWidth: '250px' })
          .setHTML(popupHtml);

        // Attach marker to map
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([site.lng, site.lat])
          .setPopup(popup)
          .addTo(map);

        antennaMarkersRef.current.push(marker);
      });
    }

    // Cleanup when dependencies change
    return () => {
      antennaMarkersRef.current.forEach(marker => marker.remove());
      antennaMarkersRef.current = [];
    };
  }, [mapLoaded, networkType]);

  // --- 3. UPDATE ACTIVE MARKER (RED DOT & NATIVE SYMBOL TEXT) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return; 

    const sourceId = 'active-model-label-source';
    const layerId = 'active-model-label-layer';

    // จัดการ Red Dot (HTML Marker) - แสดงเฉพาะโหมด Edit
    if (uploadedModelUrl && isEditing) {
        if (!markerRef.current) {
            const newEl = document.createElement('div');
            newEl.style.display = 'flex';
            newEl.style.flexDirection = 'column';
            newEl.style.alignItems = 'center';
            newEl.style.pointerEvents = 'none'; 
            
            markerRef.current = new maplibregl.Marker({ element: newEl })
                .setLngLat([lng, lat])
                .addTo(map);
        }

        const el = markerRef.current.getElement();
        const dotHtml = isEditing 
            ? `<div style="width:14px; height:14px; background-color:#ef4444; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>` 
            : ``;
            
        el.innerHTML = dotHtml;
        markerRef.current.setLngLat([lng, lat]);
        
        if (!el.isConnected) markerRef.current.addTo(map);

    } else {
        if (markerRef.current) {
            markerRef.current.remove();
            markerRef.current = null;
        }
    }

    // จัดการ Text Label (เปลี่ยนมาใช้ Native WebGL Symbol)
    if (uploadedModelUrl && label) {
        const geojsonData = {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: { title: label }
        };

        if (!map.getSource(sourceId)) {
            map.addSource(sourceId, { type: 'geojson', data: geojsonData as any });
        } else {
            (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(geojsonData as any);
        }

        if (!map.getLayer(layerId)) {
            map.addLayer({
                id: layerId,
                type: 'symbol',
                source: sourceId,
                layout: {
                    'text-field': ['get', 'title'],
                    'text-font': ['Noto Sans Bold'],
                    'text-size': 12,
                    'text-offset': [0, isEditing ? 1.5 : 0], // ถอยลงมา 1.5 เมื่อมีจุดแดง (Edit)
                    'text-anchor': 'top'
                },
                paint: { 
                    'text-color': '#000', 
                    'text-halo-color': '#fff', 
                    'text-halo-width': 2 
                }
            });
        } else {
            map.setLayoutProperty(layerId, 'text-offset', [0, isEditing ? 1.5 : 0]);
        }
    } else {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
    }

  }, [lat, lng, isEditing, uploadedModelUrl, mapLoaded, label]);

  // --- 4. CLICK TO MOVE LOGIC ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return; 

    if (onMapClick && uploadedModelUrl && isEditing) {
        map.getCanvas().style.cursor = 'crosshair'; 
        const handleMapClick = (e: maplibregl.MapMouseEvent) => onMapClick(e.lngLat.lat, e.lngLat.lng);
        map.on('click', handleMapClick);
        return () => {
            map.off('click', handleMapClick);
            map.getCanvas().style.cursor = '';
        };
    } else {
        map.getCanvas().style.cursor = '';
    }
  }, [onMapClick, uploadedModelUrl, isEditing, mapLoaded]); 

  // --- 5. LOAD BACKGROUND MODELS & MARKERS ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    
    let isMounted = true; 

    const fetchAndRenderBackground = async () => {
      try {
        const response = await fetch('http://localhost:5000/get-all-configs');
        const allConfigs = await response.json();
        
        if (!isMounted) return;

        bgMarkersRef.current.forEach(m => m.remove());
        bgMarkersRef.current = [];

        const currentFileName = uploadedModelUrl ? uploadedModelUrl.split('/').pop() : "";

        Object.keys(allConfigs).forEach((filename) => {
          const config = allConfigs[filename];
          if (config && config.lat && config.lng) {
            
            const boxSourceId = `bg-box-source-${filename}`;
            const boxLayerId = `bg-box-layer-${filename}`;       
            const labelLayerId = `bg-label-layer-${filename}`; 
            const clickLayerId = `bg-click-layer-${filename}`;   
            const modelLayerId = `static-model-${filename}`;     
            
            if (filename === currentFileName) {
                if (map.getLayer(modelLayerId)) map.removeLayer(modelLayerId);
                if (map.getLayer(clickLayerId)) map.removeLayer(clickLayerId);
                if (map.getLayer(labelLayerId)) map.removeLayer(labelLayerId);
                if (map.getLayer(boxLayerId)) map.removeLayer(boxLayerId);
                if (map.getSource(boxSourceId)) map.removeSource(boxSourceId);
                return;
            }
          
            const loadStatic3DModel = (e?: any) => {
                if (e) e.preventDefault(); 
                if (map.getLayer(boxLayerId)) {
                    map.off('click', boxLayerId, loadStatic3DModel);
                    map.setLayoutProperty(boxLayerId, 'visibility', 'none'); 
                }
                
                addStaticLayer({
                    map, id: modelLayerId,
                    url: `http://localhost:5000/static/models/${filename}`,
                    lngLat: [config.lng, config.lat],
                    scale: config.scale || 1, altitude: config.altitude || 0,
                    rotateX: config.rotateX || 0, rotateY: config.rotateY || 0
                });

                if (!map.getLayer(clickLayerId)) {
                    map.addLayer({
                        id: clickLayerId, type: 'fill-extrusion', source: boxSourceId, 
                        paint: { 'fill-extrusion-height': 30 * (config.scale || 1), 'fill-extrusion-base': config.altitude || 0, 'fill-extrusion-opacity': 0 }
                    });
                    
                    let bgPopupInstance: maplibregl.Popup;

                    const showActionPopup = (ev: any) => {
                        ev.preventDefault();
                        const displayName = config.label ? config.label : filename;
                        const container = document.createElement('div');
                        container.style.textAlign = 'center';
                        container.innerHTML = `<h4 style="margin:0 0 8px 0; color:#333; font-size:12px;">${displayName}</h4>`;

                        const btnEdit = document.createElement('button');
                        btnEdit.innerText = '✏️ Edit';
                        btnEdit.style.cssText = 'background:#f59e0b; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; margin-right:5px;';
                        btnEdit.onclick = () => {
                          if (map.getLayer(modelLayerId)) map.removeLayer(modelLayerId);
                          if (map.getLayer(clickLayerId)) map.removeLayer(clickLayerId);
                          if (bgPopupInstance) bgPopupInstance.remove();
                          if (onEdit) onEdit(filename, config);
                        };

                        const btnDelete = document.createElement('button');
                        btnDelete.innerText = '🗑️';
                        btnDelete.style.cssText = 'background:#ef4444; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; margin-right:5px;';
                        btnDelete.onclick = async () => {
                            if (window.confirm(`Delete ${displayName}?`)) {
                                try {
                                    await fetch(`http://localhost:5000/delete-config/${filename}`, { method: 'DELETE' });
                                    
                                    if(map.getLayer(labelLayerId)) map.removeLayer(labelLayerId);
                                    if(map.getLayer(boxLayerId)) map.removeLayer(boxLayerId);
                                    if(map.getLayer(modelLayerId)) map.removeLayer(modelLayerId);
                                    if(map.getLayer(clickLayerId)) map.removeLayer(clickLayerId);
                                    if(map.getSource(boxSourceId)) map.removeSource(boxSourceId);
                                    
                                    const markerIndex = bgMarkersRef.current.findIndex(m => m.getLngLat().lat === config.lat);
                                    if (markerIndex > -1) {
                                        bgMarkersRef.current[markerIndex].remove();
                                        bgMarkersRef.current.splice(markerIndex, 1);
                                    }
                                    if(bgPopupInstance) bgPopupInstance.remove();
                                } catch (err) { console.error(err); }
                            }
                        };

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

                        container.appendChild(btnEdit);
                        container.appendChild(btnDelete);
                        container.appendChild(btnHide);

                        bgPopupInstance = new maplibregl.Popup().setLngLat(ev.lngLat).setDOMContent(container).addTo(map);
                    };
                    
                    map.on('click', clickLayerId, showActionPopup);
                    map.on('mouseenter', clickLayerId, () => map.getCanvas().style.cursor = 'pointer');
                    map.on('mouseleave', clickLayerId, () => map.getCanvas().style.cursor = '');
                }
            };

            const markerEl = document.createElement('div');
            markerEl.style.width = '14px';
            markerEl.style.height = '14px';
            markerEl.style.backgroundColor = '#3b82f6'; 
            markerEl.style.borderRadius = '50%';
            markerEl.style.border = '2px solid white';
            markerEl.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
            markerEl.style.cursor = 'pointer';

            markerEl.onclick = (e) => {
                e.stopPropagation();
                navigate('/indoor', { state: { targetModel: filename } }); 
            };

            const bgMarker = new maplibregl.Marker({ element: markerEl }).setLngLat([config.lng, config.lat]).addTo(map);
            bgMarkersRef.current.push(bgMarker);

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
                
                map.addSource(boxSourceId, { 
                    type: 'geojson', 
                    data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: squareCoords }, properties: { title: config.label || filename } } 
                });
            }

            if (!map.getLayer(boxLayerId)) {
                map.addLayer({
                    id: boxLayerId, type: 'fill-extrusion', source: boxSourceId,
                    paint: { 'fill-extrusion-color': '#cccccc', 'fill-extrusion-height': 30 * (config.scale || 1), 'fill-extrusion-base': config.altitude||0, 'fill-extrusion-opacity': 0.8 }
                });
                
                map.addLayer({
                    id: labelLayerId, type: 'symbol', source: boxSourceId,
                    layout: { 'text-field': ['get', 'title'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 2], 'text-anchor': 'top' },
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

    fetchAndRenderBackground();

    return () => { isMounted = false; };

  }, [uploadedModelUrl, mapLoaded, navigate, onEdit]); 

  // --- 6. HANDLE ACTIVE MODEL LAYER ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const layerId = 'uploaded-custom-model';
    if (map.getLayer(layerId)) map.removeLayer(layerId);

    if (!uploadedModelUrl) return;

    addDynamicLayer({ map, id: layerId, url: uploadedModelUrl, configRef: activeModelConfigRef });

  }, [uploadedModelUrl, mapLoaded]); 

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />;
};

// =========================================================
// HELPER FUNCTIONS (ส่วน 3D Rendering คงเดิม ไม่เปลี่ยนแปลง)
// =========================================================

interface SingleLayerOptions {
  map: MapLibreMap;
  id: string;
  url: string;
  lngLat: [number, number];
  scale?: number;
  altitude?: number;
  rotateX?: number;
  rotateY?: number;
  onLoad?: (gltf: any, rootGroup: THREE.Group) => void;
}

export function addSingleFileLayer(opts: SingleLayerOptions) {
  createBaseLayer(opts.map, opts.id, opts.lngLat, opts.altitude || 0, opts.scale || 1, (scene) => {
    const loader = new GLTFLoader();
    const rootGroup = new THREE.Group();
    scene.add(rootGroup);
    const ambientLight = new THREE.AmbientLight(0x404040, 3);
    scene.add(ambientLight);
    
    loader.load(opts.url, (gltf: any) => {
      if (opts.onLoad) opts.onLoad(gltf, rootGroup);
      else rootGroup.add(gltf.scene);
      
      if (opts.rotateX !== undefined && opts.rotateY !== undefined) {
         rootGroup.rotation.set(opts.rotateX * (Math.PI/180), opts.rotateY * (Math.PI/180), 0);
      }
      opts.map.triggerRepaint();
    });
  });
}

function createBaseLayer(
  map: MapLibreMap, id: string, lngLat: [number, number], altitude: number, scale: number, initScene: (scene: THREE.Scene) => void
) {
  const modelAsMercator = maplibregl.MercatorCoordinate.fromLngLat(lngLat, altitude);
  const modelTransform = {
    translateX: modelAsMercator.x, translateY: modelAsMercator.y, translateZ: modelAsMercator.z,
    scale: modelAsMercator.meterInMercatorCoordinateUnits() * scale,
  };

  let camera: THREE.Camera, scene: THREE.Scene, renderer: THREE.WebGLRenderer;

  const customLayer: CustomLayerInterface = {
    id: id, type: 'custom', renderingMode: '3d',
    onAdd: function (map, gl) {
      camera = new THREE.Camera(); scene = new THREE.Scene();
      const l1 = new THREE.DirectionalLight(0xffffff); l1.position.set(0, -70, 100).normalize(); scene.add(l1);
      const l2 = new THREE.DirectionalLight(0xffffff); l2.position.set(0, 70, 100).normalize(); scene.add(l2);
      initScene(scene);
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render: function (gl, args) {
      const layerArgs = args as any;
      const m = new THREE.Matrix4().fromArray(layerArgs.defaultProjectionData.mainMatrix);
      const l = new THREE.Matrix4().makeTranslation(modelTransform.translateX, modelTransform.translateY, modelTransform.translateZ).scale(new THREE.Vector3(modelTransform.scale, -modelTransform.scale, modelTransform.scale));
      camera.projectionMatrix = m.multiply(l);
      renderer.resetState(); renderer.render(scene, camera); map.triggerRepaint();
    }
  };
  if (!map.getLayer(id)) map.addLayer(customLayer);
}

function addDynamicLayer({ map, id, url, configRef }: any) {
    let camera: THREE.Camera, scene: THREE.Scene, renderer: THREE.WebGLRenderer, modelGroup: THREE.Group;
    const customLayer: CustomLayerInterface = {
        id: id, type: 'custom', renderingMode: '3d',
        onAdd: function (map, gl) {
            camera = new THREE.Camera(); scene = new THREE.Scene();
            const l1 = new THREE.DirectionalLight(0xffffff); l1.position.set(0, -70, 100).normalize(); scene.add(l1);
            const l2 = new THREE.DirectionalLight(0xffffff); l2.position.set(0, 70, 100).normalize(); scene.add(l2);
            scene.add(new THREE.AmbientLight(0x404040, 2));
            modelGroup = new THREE.Group(); scene.add(modelGroup);
            new GLTFLoader().load(url, (gltf: any) => { modelGroup.add(gltf.scene); map.triggerRepaint(); });
            renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
            renderer.autoClear = false;
        },
        render: function (gl, args) {
            const { lat, lng, altitude, scale, rotateX, rotateY } = configRef.current;
            const modelAsMercator = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], altitude);
            const modelScale = modelAsMercator.meterInMercatorCoordinateUnits() * scale;
            const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
            const l = new THREE.Matrix4().makeTranslation(modelAsMercator.x, modelAsMercator.y, modelAsMercator.z).scale(new THREE.Vector3(modelScale, -modelScale, modelScale));
            if (modelGroup) {
                modelGroup.rotation.set(rotateX * (Math.PI / 180), rotateY * (Math.PI / 180), 0);
            }
            camera.projectionMatrix = m.multiply(l);
            renderer.resetState(); renderer.render(scene, camera); map.triggerRepaint();
        }
    };
    if (!map.getLayer(id)) map.addLayer(customLayer);
}

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
                root.add(gltf.scene); scene.add(root); map.triggerRepaint();
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

export default MapViewer;