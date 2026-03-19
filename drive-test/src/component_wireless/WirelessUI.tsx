import React from 'react'
import type { AccessPoint } from '../component_wireless/HeatmapOverlay'
import { RssiGradientLegend } from '../component_wireless/RssiGradient'
import { Legend } from '../component_map/legend' 

type ApField = keyof AccessPoint | 'x' | 'y' | 'z';
type RefField = 'label' | 'x' | 'y' | 'z'; 

interface WirelessUIProps {
  buildings: any[]; activeBuildingId: string | null; setActiveBuildingId: (id: string) => void;
  floorCount: number; activeFloor: string; setActiveFloor: (floor: string) => void;
  showHeatmap: boolean; setShowHeatmap: (show: boolean) => void;

  aps: AccessPoint[]; selectedApId: string | null; setSelectedApId: (id: string | null) => void;
  handleApUpdate: (id: string, field: ApField, value: any) => void;
  onAddAp: () => void; onDeleteAp: (id: string) => void;
  
  onResetCamera: () => void;

  refPoints: any[]; selectedRefId: string | null; onSelectRef: (id: string) => void;
  onAddRef: () => void; onDeleteRef: (id: string) => void;
  handleRefUpdate: (id: string, field: RefField, value: any) => void;
  
  csvOrigin: [number, number, number] | null;
  isCsvOriginSelected: boolean;
  onSelectCsvOrigin: () => void;
  onAddCsvOrigin: () => void;
  csvDataCount: number;
  onClearCsv: () => void;
  onInitiateUpload: () => void; 
  onInitiateNeighborUpload: () => void; 

  networkType: 'cellular' | 'wifi';
  setNetworkType: (type: 'cellular' | 'wifi') => void;
  floorPlanImage: string | null;
  onViewFloorPlan: () => void;
}

export const WirelessUI: React.FC<WirelessUIProps> = ({
  buildings, activeBuildingId, setActiveBuildingId,
  floorCount, activeFloor, setActiveFloor,
  showHeatmap, setShowHeatmap,
  aps, selectedApId, setSelectedApId, handleApUpdate,
  onAddAp, onDeleteAp, onResetCamera,
  refPoints, selectedRefId, onSelectRef, onAddRef, onDeleteRef, handleRefUpdate, 
  csvOrigin, isCsvOriginSelected, onSelectCsvOrigin, onAddCsvOrigin, csvDataCount, onClearCsv, 
  onInitiateUpload, onInitiateNeighborUpload, networkType, setNetworkType,
  floorPlanImage, onViewFloorPlan
}) => {
  
  const selectedAp = aps.find(a => a.id === selectedApId)
  const selectedRef = refPoints.find(r => r.id === selectedRefId)

  return (
    <>
      {/* LEFT SIDEBAR */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2 w-56 pointer-events-none max-h-[95vh] overflow-hidden">
        
        {/* MODEL SELECTOR */}
        <div className="pointer-events-auto bg-white/10 p-2.5 rounded-lg backdrop-blur-sm border border-white/20 shadow-xl flex shrink-0 flex-col">
          <h3 className="text-white font-bold text-[10px] mb-1.5 text-center uppercase tracking-wider">Select Model</h3>
          <div className="flex flex-col gap-1 max-h-24 overflow-y-auto custom-scrollbar">
            {buildings.map((b) => (
              <button key={b.id} onClick={() => setActiveBuildingId(b.id)}
                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-all ${activeBuildingId === b.id ? 'bg-green-600 text-white shadow-md' : 'text-gray-300 hover:bg-white/10'}`}>
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {/* FLOOR SELECTOR */}
        {activeBuildingId && (
            <div className="pointer-events-auto bg-white/10 p-2.5 rounded-lg backdrop-blur-sm border border-white/20 shadow-xl flex shrink-0 flex-col">
                <h3 className="text-white font-bold text-[10px] mb-1.5 text-center uppercase tracking-wider">Select Floor</h3>
               <div className="grid grid-cols-2 gap-1.5 max-h-20 overflow-y-auto custom-scrollbar">
                 <button onClick={() => setActiveFloor('all')} className={`px-1.5 py-1 rounded text-[11px] col-span-2 transition-colors ${activeFloor === 'all' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}>Show All</button>
                 {Array.from({ length: floorCount }, (_, i) => i + 1).map((f) => (
                   <button key={f} onClick={() => setActiveFloor(f.toString())} className={`px-1.5 py-1 rounded text-[11px] transition-colors ${activeFloor === f.toString() ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}>Floor {f}</button>
                 ))}
               </div>
            </div>
        )}

        {/* CSV UPLOAD PANEL */}
        {activeBuildingId && (
            <div className="pointer-events-auto bg-white/10 p-2.5 rounded-lg backdrop-blur-sm border border-purple-500/50 shadow-xl shrink-0 flex flex-col">
                <h3 className="text-purple-300 font-bold text-[10px] uppercase tracking-wider mb-2">CSV Visualizer</h3>
                
                {!csvOrigin ? (
                    <button onClick={onAddCsvOrigin} className="w-full bg-purple-600 hover:bg-purple-500 text-white text-[10px] py-1.5 rounded transition-colors font-bold">
                        1. Place Reference Point
                    </button>
                ) : (
                    <div className="flex flex-col gap-2">
                        <button onClick={onSelectCsvOrigin} className={`w-full text-[10px] py-1.5 rounded transition-colors font-bold border ${isCsvOriginSelected ? 'bg-purple-600 text-white border-purple-500' : 'bg-black/40 text-gray-300 border-white/10 hover:bg-black/60'}`}>
                            {isCsvOriginSelected ? 'Origin Selected' : 'Select Origin'}
                        </button>
                        
                        <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                                <button 
                                    onClick={onInitiateUpload} 
                                    className="flex-1 text-center bg-green-600 hover:bg-green-500 text-white text-[10px] py-1.5 rounded transition-colors font-bold cursor-pointer"
                                >
                                    Upload Zip
                                </button>
                                {csvDataCount > 0 && (
                                    <button onClick={onClearCsv} className="bg-red-600 hover:bg-red-500 text-white text-[10px] px-2 py-1.5 rounded transition-colors font-bold">
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* View Floor Plan Button */}
                        {floorPlanImage && (
                            <button 
                                onClick={onViewFloorPlan}
                                className="w-full bg-blue-600/80 hover:bg-blue-500 text-white text-[10px] py-1.5 rounded transition-colors font-bold flex items-center justify-center gap-2 border border-blue-400/50 shadow-lg mt-1"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                View Floor Plan
                            </button>
                        )}

                        {csvDataCount > 0 && (
                            <div className="text-[9px] text-gray-400 text-center bg-black/30 py-1 rounded">
                                Rendered <strong className="text-white">{csvDataCount}</strong> points
                            </div>
                        )}
                    </div>
                )}
            </div>
        )}
      </div>

      {/* RIGHT SIDEBAR */}
      {activeBuildingId && (
        <div className="absolute top-3 right-3 z-10 flex flex-col gap-2 w-60 pointer-events-none max-h-[95vh] overflow-y-auto custom-scrollbar pb-4">
          
          <div className="pointer-events-auto bg-white/10 p-2.5 rounded-lg backdrop-blur-sm border border-white/20 shadow-xl flex shrink-0 flex-col gap-2">
            <h3 className="text-white font-bold text-[10px] text-center uppercase tracking-wider">Simulation</h3>
            <div className="h-px bg-white/10 w-full" />

            {/* TOGGLE NETWORK TYPE */}
            <div className="flex bg-black/40 rounded p-0.5 mb-1 border border-white/5">
                <button 
                    onClick={() => setNetworkType('wifi')} 
                    className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${networkType === 'wifi' ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                    Wi-Fi
                </button>
                <button 
                    onClick={() => setNetworkType('cellular')}
                    className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${networkType === 'cellular' ? 'bg-gray-600 text-gray-300' : 'text-gray-400 hover:text-white'}`}
                >
                    Cellular
                </button>
            </div>

            <div className="flex gap-1.5">
                <button onClick={() => setShowHeatmap(!showHeatmap)} className={`flex-1 px-1.5 py-1.5 rounded text-[11px] font-semibold transition-all ${showHeatmap ? 'bg-yellow-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                  {showHeatmap ? 'Stop' : 'Run'}
                </button>
                <button onClick={onResetCamera} className="flex-1 px-1.5 py-1.5 rounded text-[11px] font-semibold bg-blue-600/80 hover:bg-blue-500 text-white transition-all border border-blue-500/30">
                  Reset Cam
                </button>
            </div>
          </div>

          {showHeatmap && (
              <div className="pointer-events-auto bg-black/60 p-2.5 rounded-lg backdrop-blur-md border border-white/20 shadow-xl shrink-0 animate-fadeIn">
                <div className="text-[11px] font-bold text-white tracking-wide text-center">
                  Heatmap Legend RSSI (dBm)
                </div>
                 <RssiGradientLegend />
              </div>
          )}

          <div className="pointer-events-auto bg-white/10 p-2.5 rounded-lg backdrop-blur-sm border border-white/20 shadow-xl shrink-0 flex flex-col">
             <div className="flex justify-between items-center mb-1.5">
                <h3 className="text-white font-bold text-[10px] uppercase tracking-wider">
                    Tx
                </h3>
                
                {networkType === 'wifi' && (
                    <button onClick={onAddAp} className="bg-green-600 hover:bg-green-500 text-white text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors">
                      <span>+ Add</span>
                    </button>
                )}
             </div>
             
             {networkType === 'wifi' && (
                 <>
                     <div className="flex flex-col gap-1 max-h-28 overflow-y-auto custom-scrollbar">
                        {aps.map(ap => (
                          <button key={ap.id} onClick={() => setSelectedApId(ap.id === selectedApId ? null : ap.id)}
                            className={`group flex justify-between items-center w-full px-2 py-1.5 rounded text-xs transition-colors ${selectedApId === ap.id ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}>
                            <span className="font-medium truncate max-w-[100px]">{ap.label}</span>
                            <span onClick={(e) => { e.stopPropagation(); onDeleteAp(ap.id); }} className="text-red-400 hover:text-red-200 px-1 opacity-0 group-hover:opacity-100 transition-opacity">×</span>
                          </button>
                        ))}
                     </div>

                     {selectedAp && (
                       <div className="bg-black/20 p-2 mt-2 rounded border border-white/10 flex flex-col gap-2 animate-fadeIn shrink-0">
                          <div className="flex flex-col gap-0.5 w-full">
                            <label className="text-[9px] text-gray-400 uppercase font-bold">Rename</label>
                            <input type="text" value={selectedAp.label} onChange={(e) => handleApUpdate(selectedAp.id, 'label', e.target.value)} className="bg-black/40 text-white text-[11px] px-1.5 py-1 rounded border border-white/10 focus:border-indigo-500 outline-none w-full" />
                          </div>
                          <div className="flex flex-col gap-0.5 w-full">
                            <div className="flex justify-between">
                               <label className="text-[9px] text-gray-400 uppercase font-bold">Tx Power</label>
                               <span className="text-[9px] text-yellow-400 font-bold">{selectedAp.txPower} dBm</span>
                            </div>
                            <input type="range" min="-10" max="30" step="1" value={selectedAp.txPower} onChange={(e) => handleApUpdate(selectedAp.id, 'txPower', parseFloat(e.target.value))} className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-yellow-500" />
                          </div>
                          <div className="flex flex-col gap-0.5 w-full">
                            <label className="text-[9px] text-gray-400 uppercase font-bold">Frequency Band</label>
                            <div className="flex bg-black/40 rounded border border-white/10 p-0.5">
                                <button 
                                    onClick={() => handleApUpdate(selectedAp.id, 'frequency', 2400)} 
                                    className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${selectedAp.frequency === 2400 || !selectedAp.frequency ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                                    2.4 GHz
                                </button>
                                <button 
                                    onClick={() => handleApUpdate(selectedAp.id, 'frequency', 5000)} 
                                    className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${selectedAp.frequency === 5000 ? 'bg-indigo-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}>
                                    5 GHz
                                </button>
                            </div>
                          </div>
                          <div className="flex flex-col gap-0.5">
                             <label className="text-[9px] text-gray-400 uppercase font-bold">Position (X,Y,Z)</label>
                             <div className="grid grid-cols-3 gap-1">
                                <input type="number" step="0.5" value={selectedAp.position[0].toFixed(1)} onChange={(e) => handleApUpdate(selectedAp.id, 'x', e.target.value)} className="bg-black/40 text-white text-[11px] px-1 py-0.5 rounded border border-white/10 outline-none text-center" />
                                <input type="number" step="0.5" value={selectedAp.position[1].toFixed(1)} onChange={(e) => handleApUpdate(selectedAp.id, 'y', e.target.value)} className="bg-black/40 text-white text-[11px] px-1 py-0.5 rounded border border-white/10 outline-none text-center" />
                                <input type="number" step="0.5" value={selectedAp.position[2].toFixed(1)} onChange={(e) => handleApUpdate(selectedAp.id, 'z', e.target.value)} className="bg-black/40 text-white text-[11px] px-1 py-0.5 rounded border border-white/10 outline-none text-center" />
                             </div>
                          </div>
                          <button onClick={() => onDeleteAp(selectedAp.id)} className="mt-1 w-full bg-red-900/50 hover:bg-red-700 text-red-200 text-[10px] py-1 rounded border border-red-800/50 transition-colors">Delete AP</button>
                       </div>
                     )}
                 </>
             )}
          </div>

          <div className="pointer-events-auto bg-white/10 p-2.5 rounded-lg backdrop-blur-sm border border-white/20 shadow-xl shrink-0 flex flex-col">
              <div className="flex justify-between items-center mb-1.5">
                 <h3 className="text-white font-bold text-[10px] uppercase tracking-wider">Rx</h3>
                 <button onClick={onAddRef} className="bg-blue-600 hover:bg-blue-500 text-white text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors">
                   <span>+ Add</span>
                 </button>
              </div>
              <div className="flex flex-col gap-1 max-h-24 overflow-y-auto custom-scrollbar">
                 {refPoints.map(rp => (
                   <button key={rp.id} onClick={() => onSelectRef(rp.id)}
                     className={`flex justify-between items-center w-full px-2 py-1.5 rounded text-xs transition-colors ${selectedRefId === rp.id ? 'bg-blue-600 text-white shadow-lg' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}>
                     <span className="font-medium truncate max-w-[100px]">{rp.label}</span>
                     <span onClick={(e) => { e.stopPropagation(); onDeleteRef(rp.id); }} className="text-red-400 hover:text-red-200 px-1">×</span>
                   </button>
                 ))}
              </div>
          </div>
        </div>
      )}
      
      {csvDataCount > 0 && (
        <div className="absolute bottom-18 right-4 z-50 pointer-events-auto scale-110 origin-bottom-right">
          <div className="bg-white/90 rounded-lg shadow-lg border border-gray-200 p-2">
            <Legend networkType={networkType} variant="sidebar" />
          </div>
        </div>
      )}
    </>
  )
}