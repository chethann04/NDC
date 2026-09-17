import React from 'react';

interface Props {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'slate';
}

export const StatCard: React.FC<Props> = ({ title, value, subtitle, icon, color = 'blue' }) => {
  const colorMap = {
    blue: 'bg-zinc-100 text-zinc-900 border-zinc-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    slate: 'bg-zinc-100 text-zinc-700 border-zinc-200'
  };

  return (
    <div className="bg-white rounded-xl p-5 border border-zinc-200/80 shadow-[0_1px_2px_rgba(0,0,0,0.03)] flex items-center justify-between">
      <div>
        <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{title}</p>
        <h3 className="text-2xl font-bold text-zinc-900 mt-1">{value}</h3>
        {subtitle && <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>}
      </div>
      <div className={`p-3 rounded-xl border ${colorMap[color]}`}>
        {icon}
      </div>
    </div>
  );
};
