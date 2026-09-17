import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { ShieldCheck, Search, CheckCircle2, XCircle, ArrowLeft, Building, Calendar, User, BookOpen, Hash, Zap } from 'lucide-react';

export const PublicVerify: React.FC = () => {
  const [searchMode, setSearchMode] = useState<'SHORT' | 'FULL'>('SHORT');

  // Short Mode State (Faculty / HOD Quick Entry)
  const [branchCode, setBranchCode] = useState('IS');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [shortCode, setShortCode] = useState('');

  // Full Mode State
  const [certNumber, setCertNumber] = useState('');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResult(null);

    let payload: any = {};

    if (searchMode === 'SHORT') {
      if (!shortCode.trim()) {
        setError('Please enter the sequence number (e.g. 001, 002, 112).');
        return;
      }
      payload = {
        branchCode: branchCode.trim().toUpperCase(),
        year: year.trim(),
        shortCode: shortCode.trim()
      };
    } else {
      if (!certNumber.trim()) {
        setError('Please enter a certificate number or USN.');
        return;
      }
      payload = { certificateNumber: certNumber.trim() };
    }

    setLoading(true);
    try {
      const response = await api.post('/verify', payload);
      setResult(response.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Verification search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formattedPreviewSeq = shortCode.trim().replace(/\D/g, '').padStart(6, '0') || '000001';
  const liveTargetString = `NDC/MCE/${branchCode}/${year}/${formattedPreviewSeq}`;

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50/60 via-slate-50 to-sky-50/60 p-4 sm:p-6 relative overflow-hidden">
      {/* Decorative ambient background glows */}
      <div className="absolute top-[-10%] right-[-10%] w-[450px] h-[450px] rounded-full bg-indigo-200/30 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[450px] h-[450px] rounded-full bg-sky-200/30 blur-3xl pointer-events-none" />

      <div className="w-full max-w-lg bg-white/95 backdrop-blur-xl border border-slate-200/80 rounded-3xl shadow-soft-xl p-8 sm:p-10 relative z-10">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-50 to-violet-50 rounded-2xl p-2 shadow-soft-xs border border-indigo-100/80 mx-auto mb-3 flex items-center justify-center">
            <img src="/mce_logo.png" alt="MCE Logo" className="w-full h-full object-contain drop-shadow-sm" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mb-1 tracking-tight">Certificate Verification</h1>
          <p className="text-xs font-semibold text-slate-500">Confirm the authenticity of an official No Due Certificate issued by MCE</p>
        </div>

        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-2 p-1 bg-slate-100/80 rounded-2xl mb-6 text-xs font-bold border border-slate-200/60">
          <button
            type="button"
            onClick={() => { setSearchMode('SHORT'); setResult(null); setError(''); }}
            className={`py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              searchMode === 'SHORT' ? 'bg-white text-indigo-700 shadow-soft-xs font-bold border border-indigo-100' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Zap className="w-4 h-4 text-indigo-600" />
            Quick Entry
          </button>
          <button
            type="button"
            onClick={() => { setSearchMode('FULL'); setResult(null); setError(''); }}
            className={`py-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              searchMode === 'FULL' ? 'bg-white text-indigo-700 shadow-soft-xs font-bold border border-indigo-100' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Search className="w-4 h-4 text-indigo-600" />
            Full Cert No. / USN
          </button>
        </div>

        <form onSubmit={handleVerify} className="space-y-4">
          {searchMode === 'SHORT' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Branch</label>
                  <select
                    value={branchCode}
                    onChange={(e) => setBranchCode(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 text-xs font-bold focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  >
                    <option value="IS">IS (ISE)</option>
                    <option value="CS">CS (CSE)</option>
                    <option value="EC">EC (ECE)</option>
                    <option value="ME">ME (Mech)</option>
                    <option value="CV">CV (Civil)</option>
                    <option value="EE">EE (EEE)</option>
                    <option value="AI">AI (AIML)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Year</label>
                  <input
                    type="text"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 text-xs font-mono font-bold focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1 uppercase tracking-wider">Seq No.</label>
                  <input
                    type="text"
                    value={shortCode}
                    onChange={(e) => setShortCode(e.target.value)}
                    placeholder="001"
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50/50 text-indigo-700 text-xs font-mono font-bold focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl text-center font-mono text-[11px] text-slate-500 border border-slate-200/70">
                Target: <span className="font-bold text-indigo-600">{liveTargetString}</span>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] font-bold text-slate-600 mb-1.5 uppercase tracking-wider">Certificate Number or USN</label>
              <input
                type="text"
                value={certNumber}
                onChange={(e) => setCertNumber(e.target.value)}
                placeholder="NDC-2026-004821 or USN"
                className="w-full py-2.5 px-3.5 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-900 text-xs font-mono font-bold focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold text-sm shadow-soft-md hover:shadow-soft-lg transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>{loading ? 'Verifying Registry...' : 'Verify Certificate'}</span>
          </button>
        </form>

        {error && (
          <div className="mt-5 p-3.5 bg-rose-50 border border-rose-200/80 text-rose-700 rounded-2xl text-xs font-semibold text-center animate-in fade-in">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-6 pt-5 border-t border-slate-100 animate-in fade-in">
            {result.status === 'VALID' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2.5 p-3.5 bg-emerald-50 text-emerald-800 rounded-2xl font-bold text-xs border border-emerald-200/70">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>Certificate is Authentic & Valid</span>
                </div>
                <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80 text-xs space-y-2.5">
                  <div className="flex justify-between border-b border-slate-200/60 pb-2"><span className="text-slate-500 font-medium">Student Name:</span><span className="font-bold text-slate-900">{result.certificate.studentName}</span></div>
                  <div className="flex justify-between border-b border-slate-200/60 pb-2"><span className="text-slate-500 font-medium">USN:</span><span className="font-mono font-bold text-indigo-700">{result.certificate.usn}</span></div>
                  <div className="flex justify-between border-b border-slate-200/60 pb-2"><span className="text-slate-500 font-medium">Department:</span><span className="font-semibold text-slate-800">{result.certificate.departmentName}</span></div>
                  <div className="flex justify-between border-b border-slate-200/60 pb-2"><span className="text-slate-500 font-medium">Issued Date:</span><span className="font-mono text-slate-700">{new Date(result.certificate.issuedAt).toLocaleDateString()}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500 font-medium">Certificate Ref:</span><span className="font-mono font-bold text-slate-900">{result.certificate.certificateNumber}</span></div>
                </div>
              </div>
            )}

            {result.status === 'REVOKED' && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 space-y-2 text-xs">
                <div className="flex items-center gap-2 font-bold text-sm text-rose-900">
                  <XCircle className="w-5 h-5 text-rose-600" /> Certificate Revoked
                </div>
                <p><strong>Student:</strong> {result.certificate.studentName} ({result.certificate.usn})</p>
                <p><strong>Reason:</strong> {result.certificate.revocationReason}</p>
              </div>
            )}

            {result.status === 'NOT_FOUND' && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-center text-xs font-bold">
                No matching certificate found in institutional registry.
              </div>
            )}
          </div>
        )}

        <div className="text-center mt-8">
          <Link to="/login" className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Sign In</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
