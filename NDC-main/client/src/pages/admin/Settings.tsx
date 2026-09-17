import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { Settings as SettingsIcon, Save, Building, Award } from 'lucide-react';

export const Settings: React.FC = () => {
  const [formData, setFormData] = useState({
    collegeName: '',
    collegeAddress: '',
    certificateTitle: '',
    certificateStatement: '',
    certificatePrefix: '',
    academicYear: '2025-2026',
    signatoryName: '',
    signatoryDesignation: '',
    footerText: ''
  });

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await api.get('/settings');
      if (res.data.data) {
        setFormData(res.data.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    setSubmitting(true);

    try {
      await api.put('/settings', formData);
      setMsg({ type: 'success', text: 'System settings updated successfully.' });
    } catch (err: any) {
      setMsg({ type: 'error', text: err.response?.data?.message || 'Failed to update settings.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Loading system settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-slate-900">System Configuration</h2>
        <p className="text-xs text-slate-500">Configure institution branding, PDF certificate templates, and signatory details</p>
      </div>

      {msg.text && (
        <div className={`p-4 rounded-xl text-xs font-semibold ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
          {msg.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm max-w-2xl space-y-5 text-xs">
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2">
            <Building className="w-4 h-4 text-blue-600" />
            Institutional Branding
          </h3>

          <div>
            <label className="block font-bold text-slate-700 mb-1">College Name *</label>
            <input
              type="text"
              value={formData.collegeName}
              onChange={(e) => setFormData({ ...formData, collegeName: e.target.value })}
              required
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">College Address & Subtitle *</label>
            <input
              type="text"
              value={formData.collegeAddress}
              onChange={(e) => setFormData({ ...formData, collegeAddress: e.target.value })}
              required
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900"
            />
          </div>

          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-2 pt-4">
            <Award className="w-4 h-4 text-emerald-600" />
            PDF Certificate Template & Signatory Configuration
          </h3>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Certificate Title *</label>
            <input
              type="text"
              value={formData.certificateTitle}
              onChange={(e) => setFormData({ ...formData, certificateTitle: e.target.value })}
              required
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900"
            />
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Certificate Number Prefix Pattern *</label>
            <input
              type="text"
              value={formData.certificatePrefix}
              onChange={(e) => setFormData({ ...formData, certificatePrefix: e.target.value })}
              placeholder="e.g. NDC/MCE/"
              required
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-mono font-bold text-blue-700"
            />
            <p className="text-[10px] text-slate-400 mt-1">Generated sample: <span className="font-mono font-bold">{formData.certificatePrefix || 'NDC/MCE/'}2026/000001</span></p>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Default Academic Year *</label>
            <input
              type="text"
              value={formData.academicYear || ''}
              onChange={(e) => setFormData({ ...formData, academicYear: e.target.value })}
              placeholder="e.g. 2025-2026 or 2025-26"
              required
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-900"
            />
            <p className="text-[10px] text-slate-400 mt-1">Configures default Academic Year printed on No Due Certificates</p>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Official Wording / Statement *</label>
            <textarea
              value={formData.certificateStatement}
              onChange={(e) => setFormData({ ...formData, certificateStatement: e.target.value })}
              rows={3}
              required
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-medium text-slate-900"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Signatory Name *</label>
              <input
                type="text"
                value={formData.signatoryName}
                onChange={(e) => setFormData({ ...formData, signatoryName: e.target.value })}
                required
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Signatory Designation *</label>
              <input
                type="text"
                value={formData.signatoryDesignation}
                onChange={(e) => setFormData({ ...formData, signatoryDesignation: e.target.value })}
                required
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-900"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {submitting ? 'Saving Settings...' : 'Save Configuration Changes'}
        </button>
      </form>
    </div>
  );
};
