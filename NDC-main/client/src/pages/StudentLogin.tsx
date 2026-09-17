import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import api from '../services/api';
import {
  GraduationCap,
  Calendar,
  ArrowRight,
  ShieldCheck,
  Building2,
  Sparkles,
  Info,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

export const StudentLogin: React.FC = () => {
  const [usn, setUsn] = useState('');
  const [dob, setDob] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const setAuth = useAuthStore((state) => state.setAuth);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedUsn = usn.trim().toUpperCase();
    if (!trimmedUsn) {
      setError('Please enter your University Seat Number (USN).');
      return;
    }

    if (!dob) {
      setError('Please select or enter your Date of Birth.');
      return;
    }

    setLoading(true);

    try {
      const response = await api.post('/auth/student-login', {
        usn: trimmedUsn,
        dob
      });
      const { user, token } = response.data;

      setAuth(user, token);
      navigate('/student/dashboard');
    } catch (err: any) {
      console.error('Student login error:', err);
      setError(
        err.response?.data?.message ||
        'Authentication failed. Please check your USN and Date of Birth.'
      );
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (demoUsn: string, demoDob: string) => {
    setUsn(demoUsn);
    setDob(demoDob);
    setError('');
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-b from-blue-50/40 via-zinc-50 to-zinc-100 p-4 sm:p-6">
      <div className="w-full max-w-md bg-white border border-blue-100/80 rounded-2xl shadow-[0_4px_24px_rgba(30,58,138,0.06)] p-6 sm:p-8 text-center relative overflow-hidden">
        {/* Decorative Top Accent Bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500" />

        {/* Institution Crest */}
        <div className="relative inline-block mb-3">
          <img
            src="/mce_logo.png"
            alt="Malnad College of Engineering"
            className="w-16 h-16 object-contain mx-auto transition-transform hover:scale-105"
          />
        </div>

        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[11px] font-bold border border-blue-200/60 mb-2">
          <GraduationCap className="w-3.5 h-3.5" />
          <span>Student Portal Access</span>
        </div>

        <h1 className="text-xl font-bold text-zinc-900 tracking-tight">
          Malnad College of Engineering
        </h1>
        <p className="text-xs font-medium text-zinc-500 mt-0.5 mb-6">
          Student No Due Certificate (NDC) Portal
        </p>

        {error && (
          <div className="mb-5 p-3 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-700 text-xs font-semibold text-left flex items-start gap-2 animate-shake">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          {/* USN Field */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider">
                University Seat Number (USN)
              </label>
              <span className="text-[10px] text-zinc-400 font-medium">e.g. 4MC22IS001</span>
            </div>
            <div className="relative">
              <GraduationCap className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={usn}
                onChange={(e) => setUsn(e.target.value.toUpperCase())}
                placeholder="4MC22IS001"
                required
                maxLength={12}
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-zinc-300 bg-white text-zinc-900 text-sm font-mono font-bold tracking-wide placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-zinc-400 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all uppercase"
              />
            </div>
            <p className="text-[10px] text-zinc-400 font-medium mt-1">
              Enter your 10-character VTU University Seat Number
            </p>
          </div>

          {/* Date of Birth Field */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-zinc-700 uppercase tracking-wider">
                Date of Birth (DOB)
              </label>
              <span className="text-[10px] text-zinc-400 font-medium">As per records</span>
            </div>
            <div className="relative">
              <Calendar className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                required
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-zinc-300 bg-white text-zinc-900 text-sm font-medium focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 transition-all cursor-pointer"
              />
            </div>
            <p className="text-[10px] text-zinc-400 font-medium mt-1">
              Select your birthdate matching college admission records
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-xs shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <span>{loading ? 'Verifying Student Records...' : 'Access Student Clearance Portal'}</span>
            {!loading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        {/* Quick Demo Student Accounts */}
        <div className="mt-6 pt-5 border-t border-zinc-100 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" />
              <span>Demo Student Accounts (Click to Autofill)</span>
            </p>
            <span className="text-[9px] text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
              Demo Test
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs text-left">
            {/* 1. Active Test Student (IS) */}
            <button
              type="button"
              onClick={() => fillDemo('4MC22IS001', '2004-05-15')}
              className="p-2.5 rounded-xl bg-blue-50/60 hover:bg-blue-100/70 border border-blue-200/80 text-zinc-800 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-mono font-bold text-blue-700 text-xs">4MC22IS001</span>
                <span className="text-[9px] font-bold bg-white text-blue-800 px-1 rounded shadow-2xs">ISE</span>
              </div>
              <p className="text-[11px] font-semibold text-zinc-800 truncate">TEST (Active)</p>
              <p className="text-[10px] text-zinc-500 font-medium">DOB: 15-May-2004</p>
            </button>

            {/* 2. CS Student */}
            <button
              type="button"
              onClick={() => fillDemo('4MC22CS001', '2004-05-15')}
              className="p-2.5 rounded-xl bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/80 text-zinc-800 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-mono font-bold text-zinc-800 text-xs">4MC22CS001</span>
                <span className="text-[9px] font-bold bg-white text-zinc-600 px-1 rounded shadow-2xs">CSE</span>
              </div>
              <p className="text-[11px] font-semibold text-zinc-800 truncate">Aarav Sharma</p>
              <p className="text-[10px] text-zinc-500 font-medium">DOB: 15-May-2004</p>
            </button>

            {/* 3. EC Student */}
            <button
              type="button"
              onClick={() => fillDemo('4MC22EC001', '2004-05-15')}
              className="p-2.5 rounded-xl bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/80 text-zinc-800 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-mono font-bold text-zinc-800 text-xs">4MC22EC001</span>
                <span className="text-[9px] font-bold bg-white text-zinc-600 px-1 rounded shadow-2xs">ECE</span>
              </div>
              <p className="text-[11px] font-semibold text-zinc-800 truncate">Abhinav Nambiar</p>
              <p className="text-[10px] text-zinc-500 font-medium">DOB: 15-May-2004</p>
            </button>

            {/* 4. ME Student */}
            <button
              type="button"
              onClick={() => fillDemo('4MC22ME001', '2004-05-15')}
              className="p-2.5 rounded-xl bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/80 text-zinc-800 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-mono font-bold text-zinc-800 text-xs">4MC22ME001</span>
                <span className="text-[9px] font-bold bg-white text-zinc-600 px-1 rounded shadow-2xs">ME</span>
              </div>
              <p className="text-[11px] font-semibold text-zinc-800 truncate">Bharath Kumar</p>
              <p className="text-[10px] text-zinc-500 font-medium">DOB: 15-May-2004</p>
            </button>
          </div>
        </div>

        {/* Navigation Switchers */}
        <div className="mt-5 pt-4 border-t border-zinc-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 font-bold text-zinc-600 hover:text-blue-700 transition-colors"
          >
            <Building2 className="w-3.5 h-3.5 text-zinc-400" />
            <span>Staff & Officer Login →</span>
          </Link>

          <Link
            to="/verify"
            className="inline-flex items-center gap-1.5 font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
            <span>Verify QR Certificate</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
