import React, { useState, useEffect } from 'react';
import MapViewer from '../component/Mapviewer'; 
import ModelUploader from '../component_threeD/ModelUploader'; 

const ThreeDPage = () => {
  // --- State Management ---
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [currentFilename, setCurrentFilename] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  // Model Parameters
  const [modelConfig, setModelConfig] = useState({
    label: '', 
    lat: 13.7273,
    lng: 100.7745,
    altitude: 0,
    scale: 1,
    rotateX: 90,
    rotateY: 0,
    rotateZ: 0 
  });

  // 1. ON LOAD: Check local storage
  useEffect(() => {
    const savedFilename = localStorage.getItem('last_active_model');
    if (savedFilename) {
        fetch(`http://localhost:5000/get-config/${savedFilename}`)
            .then(res => res.json())
            .then(config => {
                const hasConfig = config && Object.keys(config).length > 0;
                loadModelByFilename(savedFilename, hasConfig ? config : null);
            })
            .catch(err => {
                console.error("Error loading config on startup:", err);
                loadModelByFilename(savedFilename, null);
            });
    }
  }, []);

  // --- Helper: Load Model ---
  const loadModelByFilename = (filename: string, config: any | null) => {
      const url = `http://localhost:5000/static/models/${filename}`;
      setUploadedUrl(url);
      setCurrentFilename(filename);
      localStorage.setItem('last_active_model', filename);

      if (config) {
          setModelConfig({
              label: config.label || filename, 
              lat: config.lat,
              lng: config.lng,
              altitude: config.altitude ?? 0,
              scale: config.scale ?? 1,
              rotateX: config.rotateX ?? 90,
              rotateY: config.rotateY ?? 0,
              rotateZ: config.rotateZ ?? 0
          });
          setIsLocked(true); 
      } else {
          setModelConfig({ label: filename, lat: 13.7273, lng: 100.7745, altitude: 0, scale: 1, rotateX: 90, rotateY: 0, rotateZ: 0 });
          setIsLocked(false);
      }
  };

  const handleUploadSuccess = (url: string) => {
      const filename = url.split('/').pop(); 
      if (filename) loadModelByFilename(filename, null); 
  };

  const handleEditRequest = (filename: string, config: any) => {
      loadModelByFilename(filename, config);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setModelConfig(prev => ({
      ...prev,
      [name]: name === 'label' ? value : (parseFloat(value) || 0)
    }));
  };

  const handleSaveAndLock = async () => {
      if (!currentFilename) return;
      try {
          await fetch('http://localhost:5000/save-config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: currentFilename, config: modelConfig })
          });
          setIsLocked(true);
          alert("Configuration Saved!");
      } catch (err) {
          console.error(err);
          alert("Failed to save configuration.");
      }
  };

  const handleClear = () => {
      setUploadedUrl(null);
      setCurrentFilename(null);
      localStorage.removeItem('last_active_model');
      setIsLocked(false);
  };
  
  const handleMapClick = (lat: number, lng: number) => {
      if (!isLocked) {
          setModelConfig(prev => ({
              ...prev,
              lat: lat,
              lng: lng
          }));
      }
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      
      {/* 1. Uploader Component (Top Left) */}
      <ModelUploader onUploadSuccess={handleUploadSuccess} />

      {/* 2. Controls Sidebar (Right Side) */}
      {uploadedUrl && (
        <div style={{ 
            position: 'absolute', top: 20, right: 20, zIndex: 20, 
            background: 'white', padding: '20px', borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)', width: '300px',
            fontFamily: 'sans-serif', maxHeight: '90vh', overflowY: 'auto'
        }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
              <div>
                  <h4 style={{ margin: 0, color: '#333' }}>Model Settings</h4>
                  <div style={{ fontSize: '10px', color: '#888', maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentFilename}</div>
              </div>
              {!isLocked ? (
                  <button onClick={handleSaveAndLock} style={{ background: '#28a745', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>💾 Save</button>
              ) : (
                  <button onClick={() => setIsLocked(false)} style={{ background: '#ffc107', color: 'black', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>🔓 Unlock</button>
              )}
          </div>

          <fieldset disabled={isLocked} style={{ border: 'none', padding: 0, margin: 0 }}>
              <div style={controlGroupStyle}>
                <label style={labelStyle}>Building Name</label>
                <input 
                    type="text" 
                    name="label" 
                    placeholder="e.g. Office Building A"
                    value={modelConfig.label} 
                    onChange={handleChange} 
                    style={inputStyle} 
                />
              </div>
              <div style={controlGroupStyle}>
                <label style={labelStyle}>Latitude</label>
                <input type="number" name="lat" step="0.000001" value={modelConfig.lat} onChange={handleChange} style={inputStyle} />
              </div>
              <div style={controlGroupStyle}>
                <label style={labelStyle}>Longitude</label>
                <input type="number" name="lng" step="0.000001" value={modelConfig.lng} onChange={handleChange} style={inputStyle} />
              </div>
              <div style={controlGroupStyle}>
                <label style={labelStyle}>Altitude</label>
                <div style={{ display: 'flex', gap: '8px' }}><input type="range" name="altitude" min="-10" max="200" step="0.5" value={modelConfig.altitude} onChange={handleChange} style={{ flex: 1 }} /><input type="number" name="altitude" step="0.1" value={modelConfig.altitude} onChange={handleChange} style={{ width: '60px' }} /></div>
              </div>
              <div style={controlGroupStyle}>
                <label style={labelStyle}>Scale</label>
                <div style={{ display: 'flex', gap: '8px' }}><input type="range" name="scale" min="0.01" max="10" step="0.01" value={modelConfig.scale} onChange={handleChange} style={{ flex: 1 }} /><input type="number" name="scale" step="0.01" value={modelConfig.scale} onChange={handleChange} style={{ width: '60px'}} /></div>
              </div>
              <div style={controlGroupStyle}><label style={labelStyle}>Tilt (X)</label><input type="range" name="rotateX" min="0" max="360" value={modelConfig.rotateX} onChange={handleChange} style={{ width: '75%' }} /><input type="number" name="rotateX" min="0" max="360" value={modelConfig.rotateX} onChange={handleChange} style={{ width: '60px'}} /></div>
              <div style={controlGroupStyle}><label style={labelStyle}>Azimuth (Y)</label><input type="range" name="rotateY" min="0" max="360" value={modelConfig.rotateY} onChange={handleChange} style={{ width: '75%' }} /><input type="number" name="rotateY" min="0" max="360" value={modelConfig.rotateY} onChange={handleChange} style={{ width: '60px'}} /></div>
          </fieldset>
          <button onClick={handleClear} style={{ marginTop: '20px', background: '#dc3545', color: 'white', width: '100%', padding: '10px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>✖ Close Editor</button>
        </div>
      )}

      {/* 4. Map Component */}
      <div style={{ width: '100%', height: '100%' }}>
        <MapViewer 
            uploadedModelUrl={uploadedUrl} 
            label={modelConfig.label} 
            lat={modelConfig.lat}
            lng={modelConfig.lng}
            altitude={modelConfig.altitude}
            scale={modelConfig.scale}
            rotateX={modelConfig.rotateX}
            rotateY={modelConfig.rotateY}
            onEdit={handleEditRequest}
            onMapClick={handleMapClick}
            isEditing={!isLocked} 
        />
      </div>
    </div>
  );
};

// --- Styles ---
const controlGroupStyle = { marginBottom: '12px' };
const labelStyle = { display: 'block', fontSize: '12px', fontWeight: '600', color: '#555', marginBottom: '4px' };
const inputStyle = { width: '100%', padding: '6px', border: '1px solid #ccc', borderRadius: '4px', fontSize: '13px' };

export default ThreeDPage;