import React from 'react';

export interface LegendItem {
  threshold: number;
  color: string;
  label: string;
}

// 1. Cellular Color Stops
const RSRP_LEGEND_ITEMS: LegendItem[] = [
  { threshold: -84, color: '#7CF3A1', label: '> -85 (Excellent)' },
  { threshold: -95, color: '#FFD66E', label: '-86 to -95 (Good)' },
  { threshold: -100, color: '#FFB27C', label: '-96 to -100 (Fair)' },
  { threshold: -Infinity, color: '#FF8A8A', label: '< -100 (Poor)' } 
];

// 2. Wi-Fi Color Stops
const WIFI_LEGEND_ITEMS: LegendItem[] = [
  { threshold: -64, color: '#7cf3a1', label: '> -65 (Excellent)' },
  { threshold: -75, color: '#ffd66e', label: '-66 to -75 (Good)' },
  { threshold: -85, color: '#ffb27c', label: '-76 to -85 (Fair)' },
  { threshold: -95, color: '#ff6b6b', label: '-86 to -95 (Poor)' },
  { threshold: -Infinity, color: '#9b59b6', label: '< -95 (Very Poor)' }
];

interface LegendProps {
  networkType?: 'cellular' | 'wifi';
  variant?: 'floating' | 'sidebar';
}

function Legend({ networkType = 'cellular', variant = 'floating' }: LegendProps): React.JSX.Element {
  const isWifi = networkType === 'wifi';
  const items = isWifi ? WIFI_LEGEND_ITEMS : RSRP_LEGEND_ITEMS;
  
  if (variant === 'sidebar') {
    const title = isWifi ? 'RSSI (dBm)' : 'RSRP (dBm)';
    return (
      <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 min-w-[150px] pointer-events-auto">
      <h4 className="font-bold text-sm mb-2 text-gray-800 text-center border-b border-gray-200 pb-1">{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item.label} className="flex items-center mb-1.5">
            <span className="w-3 h-3 inline-block mr-2 rounded-sm shadow-sm" style={{ backgroundColor: item.color }}></span>
            <span className="text-xs text-gray-700 font-medium">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
    );
  }

  const title = isWifi ? 'RSSI (dBm)' : 'RSRP (dBm)';
  return (
    <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 min-w-[150px] pointer-events-auto">
      <h4 className="font-bold text-sm mb-2 text-gray-800 text-center border-b border-gray-200 pb-1">{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item.label} className="flex items-center mb-1.5">
            <span className="w-3 h-3 inline-block mr-2 rounded-sm shadow-sm" style={{ backgroundColor: item.color }}></span>
            <span className="text-xs text-gray-700 font-medium">{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { Legend, RSRP_LEGEND_ITEMS, WIFI_LEGEND_ITEMS };