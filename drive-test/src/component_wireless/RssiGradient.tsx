import React from 'react';

export const RssiGradientLegend: React.FC = () => {
  // RF Scale: -120dBm (Dead Zone) to -50dBm (Excellent)
  // Color Map: Purple (-120) -> Red (-95) -> Orange (-85) -> Yellow (-75) -> Light Green (-65) -> Green (-50)
  const gradientStyle = {
    background: 'linear-gradient(to right, #9B59B6 0%, #FF6B6B 35%, #FFB27C 50%, #FFD66E 64%, #7CF3A1 78%, #2ECC71 100%)',
  };

  return (
    <div className="w-full mt-1 mb-2">
      {/* 1. Gradient Bar */}
      <div 
        className="relative h-3 w-full rounded-full shadow-inner border border-white/10" 
        style={gradientStyle}
      />

      {/* 2. Scale Labels (Ticks) */}
      <div className="relative h-4 w-full mt-1 text-[9px] text-gray-400 font-mono flex justify-between select-none px-1">
        {/* Evenly spaced ticks spanning the -120 to -50 range */}
        {[-120, -105, -90, -75, -60, -50].map((val) => (
          <div key={val} className="flex flex-col items-center w-6">
            {/* Tiny Tick Mark */}
            <div className="h-1 w-px bg-gray-600 mb-0.5"></div>
            {/* Label */}
            <span>{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
};