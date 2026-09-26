import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import api from '../services/api';
import { Eye, EyeOff, ShieldCheck, Mail, Lock, ArrowRight } from 'lucide-react';
import { ErrorAlert } from '../components/ErrorAlert';

export const Login: React.FC = () => {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const setAuth = useAuthStore((state) => state.setAuth);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await api.post('/auth/login', { loginId, email: loginId, password });
      const { user, token } = response.data;

      setAuth(user, token);

      if (user.role === 'STUDENT') {
        navigate('/student/dashboard');
      } else if (user.role === 'HOD') {
        navigate('/teaching-departments');
      } else if (user.role === 'DEPARTMENT_OFFICER') {
        const code = user?.department?.code || user?.officerProfile?.departmentIds?.[0]?.code || (typeof user?.departmentId === 'object' ? (user?.departmentId as any)?.code : undefined);
        const isAcademic = user?.department?.isAcademicBranch || user?.department?.category === 'ACADEMIC_BRANCH' || user?.officerProfile?.departmentIds?.[0]?.isAcademicBranch;
        if (user.loginId === 'PHY001' || user.email?.includes('physics') || code === 'PHY') {
          navigate('/officer/physics-lab');
        } else if (user.loginId === 'CHEM001' || user.email?.includes('chemistry') || code === 'CHEM') {
          navigate('/officer/chemistry-lab');
        } else if (isAcademic) {
          navigate('/officer/department-lab');
        } else {
          navigate('/officer/dashboard');
        }
      } else {
        navigate('/admin/dashboard');
      }
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center p-4 sm:p-6 overflow-hidden">
      {/* Cinematic Background with Vignette */}
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat filter brightness-[0.9] contrast-[1.05]"
        style={{ backgroundImage: "url('/mce_gate_bg.jpg')" }}
      />
      <div className="fixed inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/70 backdrop-blur-[1px]" />

      <div className="relative z-10 w-full max-w-[420px] bg-white/85 sm:bg-white/90 backdrop-blur-2xl border border-white/90 rounded-3xl shadow-[0_25px_60px_-10px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.8),inset_0_1px_2px_rgba(255,255,255,1)] p-7 sm:p-9 text-center">
        {/* Crest */}
        <div className="w-16 h-16 mx-auto mb-3.5 p-2 rounded-2xl bg-white/80 border border-white/90 shadow-sm flex items-center justify-center">
          <img
            src="/mce_logo.png"
            alt="Malnad College of Engineering"
            className="w-12 h-12 object-contain"
          />
        </div>

        <h1 className="text-xl font-bold text-zinc-900 mb-0.5 tracking-tight">
          Malnad College of Engineering
        </h1>
        <p className="text-xs font-medium text-zinc-500 mb-5">
          Officer &amp; Staff Clearance Portal
        </p>

        {/* Student Portal Switcher Banner */}
        <Link
          to="/student-login"
          className="mb-5 p-3 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50/80 border border-blue-200/90 text-blue-950 text-xs font-bold flex items-center justify-between group hover:border-blue-300 hover:shadow-xs transition-all text-left"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-600/10 text-blue-700 flex items-center justify-center text-sm border border-blue-200">
              🎓
            </div>
            <div>
              <p className="text-[12px] font-bold text-blue-950">Are you a Student?</p>
              <p className="text-[10px] font-medium text-blue-700">Sign in using your USN &amp; Password</p>
            </div>
          </div>
          <span className="text-blue-600 font-bold text-xs group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
            Student Login →
          </span>
        </Link>

        {error && (
          <ErrorAlert
            error={error}
            onDismiss={() => setError(null)}
            className="mb-5"
            title="Officer Sign-in Failed"
          />
        )}
        <form onSubmit={handleSubmit} className="space-y-3.5 text-left">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">
              Login ID / Username
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="e.g. PHY001, CHEM001, ISE001"
                required
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl border border-zinc-200/90 bg-white/90 hover:bg-white focus:bg-white text-zinc-900 text-xs font-medium placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 shadow-xs transition-all uppercase placeholder:normal-case"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-zinc-200/90 bg-white/90 hover:bg-white focus:bg-white text-zinc-900 text-xs font-medium placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 shadow-xs transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-3 text-zinc-400 hover:text-zinc-600 transition-colors"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-3 py-3 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-semibold text-xs shadow-md shadow-zinc-900/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <span>{loading ? 'Authenticating...' : 'Sign in'}</span>
            {!loading && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-zinc-200/80 flex items-center justify-center">
          <Link
            to="/verify"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            <ShieldCheck className="w-4 h-4 text-zinc-600" />
            <span>Verify Student QR Certificate</span>
          </Link>
        </div>
      </div>

      <p className="relative z-10 text-[11px] font-semibold text-white/90 mt-4 tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
        Malnad College of Engineering, Hassan • Estd. 1960
      </p>
    </div>
  );
};
