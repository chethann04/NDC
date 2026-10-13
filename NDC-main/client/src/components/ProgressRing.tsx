import React from 'react';

interface Props {
  percentage: number;
  size?: number;
  strokeWidth?: number;
}

export const ProgressRing: React.FC<Props> = ({ percentage, size = 120, strokeWidth = 10 }) => {
  const safePercentage = Math.min(100, Math.max(0, Math.round(Number(percentage) || 0)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (safePercentage / 100) * circumference;

  const strokeColor =
    safePercentage === 100
      ? '#059669' // emerald
      : safePercentage >= 50
      ? '#0f172a' // slate-900
      : '#d97706'; // amber

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#f1f5f9"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-black text-slate-900 tracking-tight">{safePercentage}%</span>
        <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Cleared</span>
      </div>
    </div>
  );
};
