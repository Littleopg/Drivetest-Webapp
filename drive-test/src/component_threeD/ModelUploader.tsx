/* fileName: src/component_threeD/ModelUploader.tsx */
import React, { useState } from 'react';

interface ModelUploaderProps {
  onUploadSuccess: (url: string) => void;
}

const ModelUploader: React.FC<ModelUploaderProps> = ({ onUploadSuccess }) => {
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.glb')) {
        alert("Please upload a valid .glb file");
        return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('modelFile', file);

    try {
      const response = await fetch('http://localhost:5000/upload-model', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (response.ok) {
        onUploadSuccess(data.url);
      } else {
        alert(`Upload failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Error uploading file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ 
        position: 'absolute', 
        top: 20, 
        left: 20, 
        zIndex: 20,
        background: 'white',
        padding: '10px', // Reduced padding
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        width: '240px', // Reduced width
        textAlign: 'center',
        fontFamily: 'sans-serif'
    }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', color: '#333', fontWeight: 'bold' }}>
        Add Building Model
      </h3>
      
      <label 
        style={{ 
            display: 'block', 
            background: uploading ? '#ccc' : '#f8f9fa', 
            border: '1px dashed #3b82f6', 
            borderRadius: '6px',
            padding: '12px 5px',
            cursor: uploading ? 'wait' : 'pointer',
            transition: 'background 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#eef2ff'}
        onMouseLeave={(e) => e.currentTarget.style.background = '#f8f9fa'}
      >
        <div style={{ fontSize: '20px', marginBottom: '4px' }}>📂</div>
        <div style={{ fontWeight: 'bold', color: '#3b82f6', fontSize: '12px' }}>
            {uploading ? 'Uploading...' : 'Click to Upload .GLB'}
        </div>
        
        <input 
            type="file" 
            accept=".glb" 
            onChange={handleFileChange} 
            disabled={uploading}
            style={{ display: 'none' }} 
        />
      </label>

      {/* --- Instructions Section --- */}
      <div style={{ 
          marginTop: '10px', 
          textAlign: 'left', 
          fontSize: '10px', // Smaller font
          color: '#555',
          background: '#f9fafb',
          padding: '8px',
          borderRadius: '6px',
          border: '1px solid #eee'
      }}>
          <h4 style={{ margin: '0 0 4px 0', color: '#222', fontSize: '13px' }}>📝 File Upload Instructions:</h4>
          <ul style={{ paddingLeft: '14px', margin: 0, lineHeight: '1.4', fontSize: '12px' }}>
              <li><strong>Sketchup:</strong> Group each floor separately and name each group using the format <code>{"{Number of floor}_floor"}</code>.</li>
              <li><strong>Export:</strong> Export the model in <code>.glb</code> format.</li>
              <li><strong>Blender:</strong> Import the model and export it again using <code>glTF 2.0</code></li>
          </ul>
      </div>

    </div>
  );
};

export default ModelUploader;