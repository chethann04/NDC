import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import api from '../services/api';
import { Eye, EyeOff, ShieldCheck, Mail, Lock, ArrowRight } from 'lucide-react';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const setAuth = useAuthStore((state) => state.setAuth);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/login', { email, password });
      const { user, token } = response.data;

      setAuth(user, token);

      if (user.role === 'STUDENT') {
        navigate('/student/dashboard');
      } else if (user.role === 'HOD') {
        navigate('/teaching-departments');
      } else if (user.role === 'DEPARTMENT_OFFICER') {
        navigate('/officer/dashboard');
      } else {
        navigate('/admin/dashboard');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Invalid credentials or server error.');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError('');
  };

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-zinc-50 p-4 sm:p-6">
      <div className="w-full max-w-md bg-white border border-zinc-200/80 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-6 sm:p-8 text-center">
        <img
          src="/mce_logo.png"
          alt="Malnad College of Engineering"
          className="w-16 h-16 object-contain mx-auto mb-3"
        />

        <h1 className="text-lg font-bold text-zinc-900 mb-0.5 tracking-tight">
          Malnad College of Engineering
        </h1>
        <p className="text-xs font-medium text-zinc-500 mb-4">
          Officer & Staff Portal
        </p>

        {/* Student Portal Switcher Banner */}
        <Link
          to="/student-login"
          className="mb-5 p-2.5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 text-blue-900 text-xs font-bold flex items-center justify-between group hover:border-blue-300 hover:shadow-xs transition-all text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-base">🎓</span>
            <div>
              <p className="text-[11px] font-bold text-blue-950">Are you a Student?</p>
              <p className="text-[10px] font-medium text-blue-700">Sign in using your USN & Date of Birth</p>
            </div>
          </div>
          <span className="text-blue-600 font-bold text-[11px] group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
            Student Login →
          </span>
        </Link>

        {error && (
          <div className="mb-5 p-3 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-700 text-xs font-semibold text-left">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 text-left">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">
              College Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@mce.ac.in"
                required
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-900 text-xs font-medium focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-400 absolute left-3 top-2.5" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-9 pr-9 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-900 text-xs font-medium focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-zinc-400 hover:text-zinc-600 transition-colors"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-2.5 px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-semibold text-xs shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <span>{loading ? 'Authenticating...' : 'Sign in'}</span>
            {!loading && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </form>

        {/* Quick Demo Login Buttons */}
        <div className="mt-6 pt-4 border-t border-zinc-100 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
              Designated Clearance Officers (Status Review & Verification)
            </p>
            <span className="text-[9px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
              Clearance Desks
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-xs">
            {/* 1. Central Library */}
            <button
              type="button"
              onClick={() => fillDemo('library@mce.ac.in', 'Officer@123')}
              title="1. Central Library (library@mce.ac.in)"
              className="py-2 px-2 rounded-lg bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/80 text-zinc-700 font-medium text-[11px] leading-tight transition-colors flex items-center justify-center gap-1 cursor-pointer text-center"
            >
              <span>📚 1. Library (LIB)</span>
            </button>

            {/* 2. Laboratory Section */}
            <button
              type="button"
              onClick={() => fillDemo('lab@mce.ac.in', 'Officer@123')}
              title="2. Laboratory Section (lab@mce.ac.in)"
              className="py-2 px-2 rounded-lg bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/80 text-zinc-700 font-medium text-[11px] leading-tight transition-colors flex items-center justify-center gap-1 cursor-pointer text-center"
            >
              <span>🔬 2. Lab (LAB)</span>
            </button>

            {/* 3. Hostel Section */}
            <button
              type="button"
              onClick={() => fillDemo('hostel@mce.ac.in', 'Officer@123')}
              title="3. Hostel Section (hostel@mce.ac.in)"
              className="py-2 px-2 rounded-lg bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/80 text-zinc-700 font-medium text-[11px] leading-tight transition-colors flex items-center justify-center gap-1 cursor-pointer text-center"
            >
              <span>🏠 3. Hostel (HST)</span>
            </button>

            {/* 4. Sports Section */}
            <button
              type="button"
              onClick={() => fillDemo('sports@mce.ac.in', 'Officer@123')}
              title="4. Sports Section (sports@mce.ac.in)"
              className="py-2 px-2 rounded-lg bg-zinc-50 hover:bg-zinc-100 border border-zinc-200/80 text-zinc-700 font-medium text-[11px] leading-tight transition-colors flex items-center justify-center gap-1 cursor-pointer text-center"
            >
              <span>⚽ 4. Sports (SPT)</span>
            </button>

            {/* 5. Cash/Fee Section */}
            <div className="col-span-2 flex flex-col p-1.5 rounded-lg bg-zinc-50/70 border border-zinc-200/80">
              <button
                type="button"
                onClick={() => fillDemo('cashfee1@mce.ac.in', 'Officer@123')}
                title="5. Cash/Fee Section (cashfee1@mce.ac.in)"
                className="py-1 px-2 rounded bg-white hover:bg-zinc-100 border border-zinc-200/70 text-zinc-800 font-semibold text-[11px] transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>💳 5. Cash/Fee Section (ACC)</span>
              </button>
              <div className="flex items-center justify-center gap-1 mt-1">
                <button
                  type="button"
                  onClick={() => fillDemo('cashfee1@mce.ac.in', 'Officer@123')}
                  title="Cash/Fee Officer 1 (cashfee1@mce.ac.in)"
                  className="text-[9px] px-1.5 py-0.5 rounded bg-white hover:bg-blue-100 hover:text-blue-700 text-zinc-600 font-bold border border-zinc-200 shadow-2xs"
                >
                  Op 1
                </button>
                <button
                  type="button"
                  onClick={() => fillDemo('cashfee2@mce.ac.in', 'Officer@123')}
                  title="Cash/Fee Officer 2 (cashfee2@mce.ac.in)"
                  className="text-[9px] px-1.5 py-0.5 rounded bg-white hover:bg-blue-100 hover:text-blue-700 text-zinc-600 font-bold border border-zinc-200 shadow-2xs"
                >
                  Op 2
                </button>
                <button
                  type="button"
                  onClick={() => fillDemo('cashfee3@mce.ac.in', 'Officer@123')}
                  title="Cash/Fee Officer 3 (cashfee3@mce.ac.in)"
                  className="text-[9px] px-1.5 py-0.5 rounded bg-white hover:bg-blue-100 hover:text-blue-700 text-zinc-600 font-bold border border-zinc-200 shadow-2xs"
                >
                  Op 3
                </button>
                <button
                  type="button"
                  onClick={() => fillDemo('accounts@mce.ac.in', 'Officer@123')}
                  title="Cash/Fee In-charge (accounts@mce.ac.in)"
                  className="text-[9px] px-1.5 py-0.5 rounded bg-white hover:bg-blue-100 hover:text-blue-700 text-zinc-600 font-bold border border-zinc-200 shadow-2xs"
                >
                  In-charge
                </button>
              </div>
            </div>

            {/* 6. Academic Branch HOD */}
            <div className="col-span-2 flex flex-col p-1.5 rounded-lg bg-zinc-50/70 border border-zinc-200/80">
              <button
                type="button"
                onClick={() => fillDemo('hod.is@mce.ac.in', 'Officer@123')}
                title="6. Academic Branch: HOD Information Science (hod.is@mce.ac.in)"
                className="py-1 px-1.5 rounded bg-white hover:bg-zinc-100 border border-zinc-200/70 text-zinc-800 font-semibold text-[11px] transition-colors flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>🎓 6. Academic Branch HOD</span>
              </button>
              <div className="flex items-center justify-center gap-1 mt-1">
                <button
                  type="button"
                  onClick={() => fillDemo('hod.is@mce.ac.in', 'Officer@123')}
                  title="HOD Information Science (hod.is@mce.ac.in)"
                  className="text-[9px] px-1 py-0.5 rounded bg-white hover:bg-blue-100 hover:text-blue-700 text-zinc-600 font-bold border border-zinc-200 shadow-2xs"
                >
                  IS
                </button>
                <button
                  type="button"
                  onClick={() => fillDemo('hod.me@mce.ac.in', 'Officer@123')}
                  title="HOD Mechanical (hod.me@mce.ac.in)"
                  className="text-[9px] px-1 py-0.5 rounded bg-white hover:bg-blue-100 hover:text-blue-700 text-zinc-600 font-bold border border-zinc-200 shadow-2xs"
                >
                  ME
                </button>
                <button
                  type="button"
                  onClick={() => fillDemo('hod.cs@mce.ac.in', 'Officer@123')}
                  title="HOD Computer Science (hod.cs@mce.ac.in)"
                  className="text-[9px] px-1 py-0.5 rounded bg-white hover:bg-blue-100 hover:text-blue-700 text-zinc-600 font-bold border border-zinc-200 shadow-2xs"
                >
                  CS
                </button>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-zinc-100">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
              Administration & Student Portal
            </p>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {/* College Office (Institutional Oversight & Signatory) */}
              <button
                type="button"
                onClick={() => fillDemo('office@mce.ac.in', 'Officer@123')}
                title="College Office / Administrative Section (office@mce.ac.in)"
                className="py-2 px-2 rounded-lg bg-amber-50/70 hover:bg-amber-100/70 border border-amber-200 text-amber-900 font-semibold text-[11px] leading-tight transition-colors flex items-center justify-center gap-1 cursor-pointer text-center"
              >
                <span>📋 College Office (ADM)</span>
              </button>

              {/* Admin Block (System Management & Certificate Issuance) */}
              <button
                type="button"
                onClick={() => fillDemo('admin@mce.ac.in', 'Admin@123')}
                title="Administration Block (admin@mce.ac.in)"
                className="py-2 px-2 rounded-lg bg-blue-50/70 hover:bg-blue-100/70 border border-blue-200 text-blue-900 font-semibold text-[11px] leading-tight transition-colors flex items-center justify-center gap-1 cursor-pointer text-center"
              >
                <span>🏛️ Admin Block (PDF)</span>
              </button>

              {/* Student Portal (Dedicated USN & DOB Login) */}
              <Link
                to="/student-login"
                title="Open Dedicated Student Login (USN & Date of Birth)"
                className="col-span-2 py-2 px-2 rounded-lg bg-emerald-50/80 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 font-bold text-[11px] leading-tight transition-colors flex items-center justify-center gap-1.5 cursor-pointer text-center"
              >
                <span>🎓 Open Student Portal (USN & DOB Login) →</span>
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t border-zinc-100 flex items-center justify-center">
          <Link
            to="/verify"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-zinc-600" />
            <span>Verify Student QR Certificate</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
