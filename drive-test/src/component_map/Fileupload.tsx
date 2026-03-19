import React, { useState, useRef, useMemo } from 'react';
import type { ChangeEvent } from 'react';
import axios from 'axios';
import JSZip from 'jszip';
import type { NetworkType } from '../pages/home';

interface FieldDefinition {
  key: string;
  label: string;
  required: boolean;
}

interface FileUploadProps {
  networkType: NetworkType;
  onUploadStart: () => void;
  onUploadSuccess: (data: any) => void; 
  onUploadError: (message: string) => void;
  disabled?: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ 
  networkType,
  onUploadStart, 
  onUploadSuccess, 
  onUploadError, 
  disabled 
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Display name for the UI (shows the name of the .zip)
  const [uploadedFilename, setUploadedFilename] = useState<string>('');
  
  // Actual file payloads to be sent to the backend (extracted from ZIP)
  const [servingFile, setServingFile] = useState<File | null>(null);
  const [neighborFile, setNeighborFile] = useState<File | null>(null);
  
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [showMappingModal, setShowMappingModal] = useState<boolean>(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  // Dynamic required fields based on network type
  const REQUIRED_FIELDS = useMemo<FieldDefinition[]>(() => {
    const baseFields = [
      { key: 'report', label: 'Report Number', required: true }, 
      { key: 'sys_time', label: 'System Time (Time)', required: true },
      { key: 'lat', label: 'Latitude', required: true },
      { key: 'long', label: 'Longitude', required: true },
      { key: 'gps_abs_alt', label: 'GPS Abs Altitude (altitude)', required: false },
      { key: 'gps_rel_alt', label: 'GPS Rel Altitude', required: false },
      { key: 'baro_pressure', label: 'Baro Pressure', required: false },
      { key: 'baro_rel_alt', label: 'Baro Rel Altitude', required: false },
      { key: 'baro_floor', label: 'Baro Floor', required: false },
    ];

    if (networkType === 'cellular') {
      return [
        ...baseFields,
        { key: 'rssi', label: 'RSRP (Signal Strength)', required: true },
        { key: 'rsrq', label: 'RSRQ (Quality)', required: true },
        { key: 'band', label: 'Frequency Band', required: false },
        { key: 'net_op_name', label: 'Operator Name', required: false },
        { key: 'node_id_nid', label: 'eNodeB ID', required: true },
        { key: 'cid_bid', label: 'Cell ID', required: true },
      ];
    } else {
      return [
        ...baseFields,
        { key: 'rssi', label: 'RSSI (Signal Strength)', required: true },
        { key: 'band', label: 'Frequency (e.g. 2.4/5GHz)', required: true },
        { key: 'net_op_name', label: 'SSID (Network Name)', required: false }, 
        { key: 'cid_bid', label: 'MAC Address (BSSID)', required: false },
      ];
    }
  }, [networkType]);

  const processZipFile = async (file: File) => {
    try {
      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(file);

      let extractedServing: File | null = null;
      let extractedNeighbor: File | null = null;
      const warnings: string[] = [];

      // Iterate through all files in the ZIP
      for (const relativePath in loadedZip.files) {
        const zipEntry = loadedZip.files[relativePath];
        if (zipEntry.dir) continue; // Skip folders

        const fileName = zipEntry.name.toLowerCase();

        // Validate file type
        if (fileName.endsWith('.csv')) {
          const blob = await zipEntry.async('blob');
          const extractedFile = new File([blob], zipEntry.name, { type: 'text/csv' });
          
          // Auto-route based on filename
          if (fileName.includes('nei_') || fileName.includes('neighbor')) {
            extractedNeighbor = extractedFile;
          } else if (fileName.includes('serv_') || fileName.includes('surv_')) {
            extractedServing = extractedFile;
          } else {
            // Fallback: If naming is ambiguous, assume the first CSV is serving
            if (!extractedServing) extractedServing = extractedFile;
            else extractedNeighbor = extractedFile;
          }
        } else {
          warnings.push(zipEntry.name);
        }
      }

      if (!extractedServing) {
        onUploadError("No valid Serving CSV found inside the ZIP file.");
        setUploadedFilename('');
        setServingFile(null);
        setNeighborFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      // Populate states 
      setServingFile(extractedServing);
      setNeighborFile(extractedNeighbor);
      setUploadedFilename(file.name);

      if (warnings.length > 0) {
        alert(`ZIP extracted successfully!\n\nSkipped unsupported files:\n${warnings.join('\n')}`);
      }
    } catch (err: any) {
      setUploadedFilename('');
      setServingFile(null);
      setNeighborFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onUploadError(`Failed to extract ZIP: ${err.message || err}`);
    }
  };

  const handleFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Enforce ZIP only
    if (file.name.toLowerCase().endsWith('.zip')) {
      await processZipFile(file);
    } else {
      onUploadError("Please upload a .zip file containing your survey data.");
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleInitiateUpload = () => {
    if (!servingFile) {
        onUploadError("Please select a ZIP file first.");
        return;
    }

    const reader = new FileReader();
    const blobSlice = servingFile.slice(0, 10240); 
    
    reader.onload = (e: ProgressEvent<FileReader>) => {
      const text = e.target?.result;
      if (typeof text !== 'string') return;

      const firstLine = text.split('\n')[0]; 
      let headers: string[] = [];
      if (firstLine.includes(';')) {
        headers = firstLine.split(';');
      } else {
        headers = firstLine.split(',');
      }
      
      headers = headers.map(h => h.trim().replace(/['"]+/g, ''));
      setCsvHeaders(headers);
      
      const initialMapping: Record<string, string> = {};
      REQUIRED_FIELDS.forEach(field => {
        let match = headers.find(h => 
          h.toLowerCase() === field.key.toLowerCase() || 
          h.toLowerCase() === field.label.toLowerCase()
        );
        
        // --- SMART AUTO-MAPPING FOR WI-FI CSV---
        if (!match && field.key === 'gps_abs_alt') {
             match = headers.find(h => h.toLowerCase() === 'altitude');
        }
        if (!match && field.key === 'rssi') {
             match = headers.find(h => h.toLowerCase() === 'rssi' || h.toLowerCase() === 'signal_strength');
        }
        if (!match && field.key === 'band') {
             match = headers.find(h => h.toLowerCase() === 'freq' || h.toLowerCase() === 'frequency');
        }
        if (!match && field.key === 'net_op_name') {
             match = headers.find(h => h.toLowerCase() === 'ssid' || h.toLowerCase() === 'network_name');
        }
        if (!match && field.key === 'cid_bid') {
             match = headers.find(h => h.toLowerCase() === 'mac' || h.toLowerCase() === 'bssid');
        }

        if (match) initialMapping[field.key] = match;
        else initialMapping[field.key] = '';
      });
      setMapping(initialMapping);
      setShowMappingModal(true); 
    };
    
    reader.onerror = () => {
        onUploadError("Error reading file header.");
    };

    reader.readAsText(blobSlice);
  };

  const handleMappingChange = (systemKey: string, csvHeader: string) => {
    setMapping(prev => ({ ...prev, [systemKey]: csvHeader }));
  };

  const handleConfirmUpload = () => {
    if (!servingFile) return;

    setShowMappingModal(false);

    setTimeout(() => {
        onUploadStart();
        
        const formData = new FormData();
        formData.append('serving_file', servingFile);
        if (neighborFile) {
            formData.append('neighbor_file', neighborFile);
        }
        formData.append('mapping', JSON.stringify(mapping));
        formData.append('network_type', networkType);

        axios.post('http://127.0.0.1:5000/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 300000 
        })
        .then(response => {
            onUploadSuccess(response.data);
        })
        .catch((error: unknown) => {
            let errorMsg = "An unknown error occurred.";
            if (axios.isAxiosError(error)) {
                if (error.response) errorMsg = error.response.data?.error || `Server error: ${error.response.status}`;
                else if (error.request) errorMsg = "No response from server.";
                else errorMsg = error.message;
            } else if (error instanceof Error) {
                errorMsg = error.message;
            }
            onUploadError(errorMsg);
        });
    }, 100);
  };
  
  const handleCancel = () => {
    setShowMappingModal(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Single Full-Width File Input for ZIP */}
      <div>
        <p className="block mb-2 text-sm font-bold text-blue-700">
          Upload Survey Data (.zip) *
        </p>
        <label 
          className={`flex w-full items-center justify-start rounded-lg border ${uploadedFilename ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white'} 
              ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}
        >
          {/* Changed accept to ONLY .zip */}
          <input 
              ref={fileInputRef} type="file" accept=".zip" onChange={handleFileSelect}
              disabled={disabled} style={{ display: 'none' }} 
          />
          <div className="py-2 px-4 bg-gray-100 border-r border-gray-300 rounded-l-lg text-gray-700 font-medium text-sm">
              Choose ZIP File
          </div>
          <div className="py-2 px-4 text-sm text-gray-600 truncate flex-1" title={uploadedFilename}>
              {uploadedFilename ? <span className="text-blue-600 font-semibold">{uploadedFilename}</span> : <span className="text-gray-400 italic">Click to browse...</span>}
          </div>
        </label>
        <p className="text-xs text-gray-500 mt-2">
          Please upload a <span className="font-semibold">ZIP file</span> containing your Serving CSV and (optionally) your Neighbor CSV. The system will automatically extract and map them.
        </p>
      </div>

      <div className="flex justify-end mt-2">
          <button 
            onClick={handleInitiateUpload}
            disabled={!servingFile || disabled}
            className={`px-6 py-2 rounded-lg font-bold text-white transition-colors
              ${(!servingFile || disabled) ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 shadow-md'}`}
          >
            Upload
          </button>
      </div>

      {/* --- Modal Mapping --- */}
      {showMappingModal && (
        <div className="fixed inset-0 z-[9999] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={handleCancel}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            
            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full relative z-10">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                
                <h3 className="text-lg leading-6 font-bold text-gray-900" id="modal-title">
                  Map Columns
                </h3>
                
                <div className="mt-2">
                  <p className="text-sm text-gray-500 mb-4">
                    Please match the columns from your Serving Cell CSV to the system fields. <br/><br/>
                    
                    {neighborFile ? (
                        <span className="inline-block bg-orange-50 border border-orange-200 text-orange-700 px-3 py-2 rounded-md w-full">
                            <b>Neighbor file extracted:</b> {neighborFile.name} <br/>
                            <span className="italic text-xs">(Columns for this file will be auto-detected by the backend)</span>
                        </span>
                    ) : (
                        <span className="inline-block bg-gray-50 border border-gray-200 text-gray-500 px-3 py-2 rounded-md w-full italic text-xs">
                            No neighbor file detected in the ZIP.
                        </span>
                    )}
                  </p>
                  
                  <div className="max-h-60 overflow-y-auto pr-2 border-t pt-3">
                    {REQUIRED_FIELDS.map((field) => (
                      <div key={field.key} className="mb-3">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {field.label} {field.required && <span className="text-red-500">*</span>}
                        </label>
                        <select
                          className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                          value={mapping[field.key] || ''}
                          onChange={(e) => handleMappingChange(field.key, e.target.value)}
                        >
                          <option value="">-- Select Column --</option>
                          {csvHeaders.map((header, idx) => (
                            <option key={idx} value={header}>{header}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button type="button" className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm" onClick={handleConfirmUpload}>
                  Confirm & Upload
                </button>
                <button type="button" className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm" onClick={handleCancel}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FileUpload;