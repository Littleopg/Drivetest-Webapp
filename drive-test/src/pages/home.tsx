import React, { useState } from 'react'
import FileUpload from '../component_map/Fileupload'
import MapDisplay3D from '../component_map/Mapdisplay3D'
import AnalysisDashboard from '../component_map/AnalysisDashboard'

export type NetworkType = 'cellular' | 'wifi';

interface RawDataPoint { latitude: number; longitude: number; rsrp: number; report_num?: string | number; [key: string]: any }
interface NeighborDataPoint { report_num: string | number; [key: string]: any }
interface GridDataPoint { grid_lat: number; grid_lon: number; grid_size: number; rsrp_avg: number; point_count: number; [key: string]: any }
interface AnalysisMetric { Type: string; 'MAE (dB)': number; 'RMSE (dB)': number }
interface UploadResponse {
  rawData: RawDataPoint[]; 
  neighborData?: NeighborDataPoint[]; 
  gridData: GridDataPoint[]; 
  analysisMetrics: AnalysisMetric[];
  plotData: Record<string, any>; 
  plotData_cell: Record<string, any>; 
  analysisWarning?: string; 
  error?: string
}

const Home: React.FC = () => {
  // --- Gatekeeper State ---
  const [networkType, setNetworkType] = useState<NetworkType | null>(null);

  const [rawData, setRawData] = useState<RawDataPoint[]>([])
  const [neighborData, setNeighborData] = useState<NeighborDataPoint[]>([]) 
  const [gridData, setGridData] = useState<GridDataPoint[]>([])
  const [analysisMetrics, setAnalysisMetrics] = useState<AnalysisMetric[]>([])
  const [plotData, setPlotData] = useState<Record<string, any>>({})
  const [plotDataCell, setPlotDataCell] = useState<Record<string, any>>({})
  const [error, setError] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(false)

  // --- 3D Model Editor State ---
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [currentFilename, setCurrentFilename] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [modelConfig, setModelConfig] = useState({
    label: '', lat: 13.7273, lng: 100.7745, altitude: 0, scale: 1, rotateX: 90, rotateY: 0, rotateZ: 0 
  });
  
  const [refreshKey, setRefreshKey] = useState(0);


  const handleDataUploadSuccess = (data: UploadResponse) => {
    setIsLoading(false)
    if (data && data.rawData) {
      setRawData(data.rawData); 
      setGridData(data.gridData); 
      setAnalysisMetrics(data.analysisMetrics)
      setPlotData(data.plotData); 
      setPlotDataCell(data.plotData_cell); 
      setError(data.analysisWarning || '');
      if (data.neighborData) setNeighborData(data.neighborData);
    } else {
      setError(data.error || 'Invalid data format.')
    }
  }

  const handleDataUploadError = (msg: string) => { setIsLoading(false); setError(msg); }
  const handleDataUploadStart = () => { setIsLoading(true); setError(''); }


  const loadModelByFilename = (filename: string, config: any | null) => {
      const url = `http://localhost:5000/static/models/${filename}`;
      setUploadedUrl(url);
      setCurrentFilename(filename);
      
      if (config) {
          setModelConfig({
              // Fallback to filename if the saved config somehow doesn't have a label
              label: config.label || filename, 
              lat: config.lat, lng: config.lng,
              altitude: config.altitude ?? 0, scale: config.scale ?? 1,
              rotateX: config.rotateX ?? 90, rotateY: config.rotateY ?? 0, rotateZ: 0
          });
          setIsLocked(true);
      } else {
          // FIX IS HERE: Default the label to the filename for new uploads
          setModelConfig(prev => ({ ...prev, label: filename, scale: 1, rotateX: 90, rotateY: 0 }));
          setIsLocked(false);
      }
  };


  const handleResetNetworkType = () => {
    setNetworkType(null);
    setRawData([]);
    setGridData([]);
    setNeighborData([]);
    setAnalysisMetrics([]);
    setPlotData({});
    setPlotDataCell({});
  };

  // --- Gatekeeper Rendering ---
  if (!networkType) {
    return (
      <div className="bg-gray-100 h-screen flex items-center justify-center font-sans">
        <div className="bg-white rounded-xl shadow-lg p-10 max-w-lg w-full text-center">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Outdoor Plan</h1>
          <p className="text-gray-500 mb-8">Please select the network type.</p>
          
          <div className="flex flex-col gap-4">
            <button 
              onClick={() => setNetworkType('cellular')}
              className="w-full py-4 px-6 bg-blue-50 hover:bg-blue-100 border-2 border-blue-500 rounded-lg text-blue-700 font-bold text-lg transition-colors flex flex-col items-center"
            >
              <span>Cellular Network</span>
              <span className="text-sm font-normal text-blue-500 mt-1">(e.g., LTE)</span>
            </button>
            
            <button 
              onClick={() => setNetworkType('wifi')}
              className="w-full py-4 px-6 bg-green-50 hover:bg-green-100 border-2 border-green-500 rounded-lg text-green-700 font-bold text-lg transition-colors flex flex-col items-center"
            >
              <span>Wi-Fi Network</span>
              <span className="text-sm font-normal text-green-500 mt-1">(e.g., 2.4 GHz / 5 GHz)</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Main Application Rendering ---
  return (
    <div className="bg-gray-100 font-sans h-screen overflow-y-auto relative">
      <div className="container mx-auto p-4">
        
        <header className="bg-white rounded-lg shadow-md p-6 mb-4 flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Data Visualization</h1>
              <p className="text-gray-500 mt-1">
                Active Mode: <span className="font-bold capitalize text-blue-600">{networkType}</span>
              </p>
            </div>
            <button 
              onClick={handleResetNetworkType} 
              className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded font-semibold text-sm transition-colors"
            >
              Change Network Type
            </button>
        </header>

        <main className="bg-white rounded-lg shadow-md p-6 relative">
          <FileUpload
            networkType={networkType}
            onUploadStart={handleDataUploadStart}
            onUploadSuccess={handleDataUploadSuccess}
            onUploadError={handleDataUploadError}
            disabled={isLoading}
          />

          {isLoading && <div className="mt-4 text-center text-blue-600">Analyzing data...</div>}
          {error && <div className="mt-4 text-red-600 font-bold">{error}</div>}

          <div className="mt-6 border-t pt-6 relative">
            <h2 className="text-2xl font-semibold text-gray-700 mb-4">Map Visualization</h2>
            
            <MapDisplay3D
                key={refreshKey}
                networkType={networkType} 
                rawDataPoints={rawData}
                neighborDataPoints={neighborData} 
                gridDataPoints={gridData}
            />
          </div>
        </main>

        {(analysisMetrics.length > 0 || Object.keys(plotData).length > 0) && !isLoading && (
            <aside className="bg-white rounded-lg shadow-md p-6 mt-4 mb-4">
              <AnalysisDashboard metrics={analysisMetrics} plotData={plotData} plotData_cell={plotDataCell} />
            </aside>
        )}
      </div>
    </div>
  )
}

export default Home