import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import api from '../services/api';
import {
  GraduationCap,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Building2,
  Sparkles,
  KeyRound
} from 'lucide-react';
import { ErrorAlert } from '../components/ErrorAlert';

type LoginCredentialMode = 'email' | 'password';

export const StudentLogin: React.FC = () => {
  const [credentialMode, setCredentialMode] = useState<LoginCredentialMode>('email');
  const [usn, setUsn] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const setAuth = useAuthStore((state) => state.setAuth);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUsn = usn.trim().toUpperCase().replace(/\s+/g, '');
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();

    if (!trimmedUsn) {
      setError({ title: 'USN required', message: 'Please enter your University Seat Number (USN).' });
      return;
    }

    if (credentialMode === 'email') {
      if (!trimmedEmail) {
        setError({
          title: 'Registered Mail ID required',
          message: 'Please enter the email address provided in your college student records (Excel import).'
        });
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        setError({
          title: 'Invalid Email format',
          message: 'Please enter a valid email address (e.g. name@example.com or name@mce.ac.in).'
        });
        return;
      }
    } else {
      if (!trimmedPassword) {
        setError({ title: 'Password required', message: 'Please enter your password to sign in.' });
        return;
      }
    }

    setLoading(true);
    try {
      const payload: any = { usn: trimmedUsn };
      if (credentialMode === 'email') {
        payload.email = trimmedEmail;
      } else {
        payload.password = trimmedPassword;
      }

      const response = await api.post('/auth/student-login', payload);
      const { user, token, accessToken } = response.data;
      setAuth(user, token || accessToken);
      navigate('/student/dashboard');
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

      <div className="relative z-10 w-full max-w-[420px] bg-white/85 sm:bg-white/90 backdrop-blur-2xl border border-white/90 rounded-3xl shadow-[0_25px_60px_-10px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.8),inset_0_1px_2px_rgba(255,255,255,1)] p-7 sm:p-9 text-center relative overflow-hidden">
        {/* Decorative Top Accent Bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500" />

        {/* Institution Crest */}
        <div className="w-16 h-16 mx-auto mb-3.5 p-2 rounded-2xl bg-white/80 border border-white/90 shadow-sm flex items-center justify-center">
          <img
            src="/mce_logo.png"
            alt="Malnad College of Engineering"
            className="w-12 h-12 object-contain"
          />
        </div>

        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[11px] font-bold border border-blue-200/60 mb-2 shadow-xs">
          <GraduationCap className="w-3.5 h-3.5 text-blue-700" />
          <span>Student Portal Access</span>
        </div>

        <h1 className="text-xl font-bold text-zinc-900 tracking-tight">
          Malnad College of Engineering
        </h1>
        <p className="text-xs font-medium text-zinc-500 mt-0.5 mb-5">
          Student No Due Certificate (NDC) Portal
        </p>

        {/* Credential Mode Tabs */}
        <div className="flex rounded-2xl bg-zinc-100/90 p-1 mb-5 border border-zinc-200/80">
          <button
            type="button"
            onClick={() => {
              setCredentialMode('email');
              setError(null);
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
              credentialMode === 'email'
                ? 'bg-white text-blue-700 shadow-xs border border-zinc-200/60'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Sign In with Mail ID</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCredentialMode('password');
              setError(null);
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
              credentialMode === 'password'
                ? 'bg-white text-blue-700 shadow-xs border border-zinc-200/60'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>With Password</span>
          </button>
        </div>

        {/* Helpful notice for Mail ID login */}
        {credentialMode === 'email' && (
          <div className="mb-4 p-3 rounded-xl bg-blue-50/70 border border-blue-200/60 text-left text-xs text-blue-950 leading-relaxed flex gap-2.5 items-start">
            <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-blue-950">Direct Excel Record Authentication</p>
              <p className="text-[11px] text-blue-900/90 mt-0.5 font-medium">
                Log in instantly using your USN and the email address registered in your student batch sheet. No password setup required!
              </p>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mb-5">
            <ErrorAlert
              error={error}
              onDismiss={() => setError(null)}
              title="Sign In Failed"
            />
          </div>
        )}

        {/* FORM */}
        <form onSubmit={handleLogin} className="space-y-3.5 text-left">
          {/* USN Field */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-zinc-800 uppercase tracking-wider">
                University Seat Number (USN)
              </label>
              <span className="text-[10px] text-zinc-600 font-semibold">e.g. 4MC22IS001</span>
            </div>
            <div className="relative">
              <GraduationCap className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={usn}
                onChange={(e) => setUsn(e.target.value.toUpperCase())}
                placeholder="4MC22IS001"
                required
                maxLength={12}
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-white/60 bg-white/65 hover:bg-white/80 focus:bg-white/95 text-zinc-900 text-sm font-mono font-bold tracking-wide placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-zinc-500 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition-all uppercase"
              />
            </div>
          </div>

          {/* Mail ID Field */}
          {credentialMode === 'email' ? (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-zinc-800 uppercase tracking-wider">
                  Registered Email Address (Mail ID)
                </label>
                <span className="text-[10px] text-blue-800 font-bold">From Excel Records</span>
              </div>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. student@example.com"
                  required
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-white/60 bg-white/65 hover:bg-white/80 focus:bg-white/95 text-zinc-900 text-sm font-medium placeholder:text-zinc-500 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition-all lowercase"
                />
              </div>
              <p className="text-[10px] text-zinc-600 mt-1 font-medium">
                The institutional or personal email provided when your student profile was uploaded.
              </p>
            </div>
          ) : (
            /* Password Field */
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-zinc-800 uppercase tracking-wider">
                  Password
                </label>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-white/60 bg-white/65 hover:bg-white/80 focus:bg-white/95 text-zinc-900 text-sm font-medium placeholder:text-zinc-500 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-700 focus:outline-none cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-3 py-3 px-4 rounded-xl bg-blue-600/90 hover:bg-blue-600 active:bg-blue-700 text-white font-bold text-xs shadow-lg shadow-blue-900/30 border border-white/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <span>{loading ? 'Verifying & Signing In...' : 'Sign In to Student Portal'}</span>
            {!loading && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </form>

        {/* Mode Toggle Switcher */}
        <div className="mt-4 text-center">
          {credentialMode === 'email' ? (
            <button
              type="button"
              onClick={() => {
                setCredentialMode('password');
                setError(null);
              }}
              className="text-xs font-semibold text-zinc-600 hover:text-blue-700 transition-colors cursor-pointer"
            >
              Have a custom password? <span className="text-blue-700 font-bold underline">Sign in with password</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCredentialMode('email');
                setError(null);
              }}
              className="text-xs font-semibold text-zinc-600 hover:text-blue-700 transition-colors cursor-pointer"
            >
              Don't have a password? <span className="text-blue-700 font-bold underline">Sign in with Mail ID</span>
            </button>
          )}
        </div>

        {/* Navigation Switchers */}
        <div className="mt-5 pt-4 border-t border-white/30 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 font-bold text-zinc-600 hover:text-blue-700 transition-colors"
          >
            <Building2 className="w-3.5 h-3.5 text-zinc-400" />
            <span>Staff &amp; Officer Login →</span>
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

      <p className="relative z-10 text-[11px] font-medium text-white/80 mt-4 tracking-wide drop-shadow-sm">
        Malnad College of Engineering, Hassan • Estd. 1960
      </p>
    </div>
  );
};
