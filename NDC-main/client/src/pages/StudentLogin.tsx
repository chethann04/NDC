import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import api from '../services/api';
import {
  GraduationCap,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Building2,
  UserCheck,
  Sparkles,
  KeyRound,
  Mail
} from 'lucide-react';
import { ErrorAlert } from '../components/ErrorAlert';

type AuthMode = 'login' | 'register';

export const StudentLogin: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [usn, setUsn] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<any>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const setAuth = useAuthStore((state) => state.setAuth);
  const navigate = useNavigate();

  const checkUsnEmail = async (rawUsn: string) => {
    const trimmed = rawUsn.trim().toUpperCase().replace(/\s+/g, '');
    if (trimmed.length >= 7 && !email) {
      try {
        const res = await api.get(`/auth/student-check/${trimmed}`);
        if (res.data?.email && !email) {
          setEmail(res.data.email);
        }
      } catch {
        // ignore
      }
    }
  };

  const handleTabSwitch = (newMode: AuthMode) => {
    setMode(newMode);
    setError(null);
    setSuccessMsg(null);
    setPassword('');
    setConfirmPassword('');
    if (newMode === 'register' && usn) {
      checkUsnEmail(usn);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const trimmedUsn = usn.trim().toUpperCase().replace(/\s+/g, '');
    const trimmedPassword = password.trim();

    if (!trimmedUsn) {
      setError({ title: 'USN required', message: 'Please enter your University Seat Number (USN).' });
      return;
    }
    if (!trimmedPassword) {
      setError({ title: 'Password required', message: 'Please enter your password to sign in.' });
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/student-login', {
        usn: trimmedUsn,
        password: trimmedPassword
      });

      const { user, token, accessToken } = response.data;
      setAuth(user, token || accessToken);
      navigate('/student/dashboard');
    } catch (err: any) {
      const serverMsg = err.response?.data?.message || err.message || '';
      // If student has not yet registered a password, offer quick registration switch
      if (serverMsg.toLowerCase().includes('register') || serverMsg.toLowerCase().includes('no account')) {
        setError({
          title: 'Registration Required',
          message: 'This USN has not yet created a password. Please switch to the "Register" tab to set up your account.',
          action: {
            label: 'Go to Register Tab',
            onClick: () => handleTabSwitch('register')
          }
        });
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const trimmedUsn = usn.trim().toUpperCase().replace(/\s+/g, '');
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedUsn) {
      setError({ title: 'USN required', message: 'Please enter your University Seat Number (USN).' });
      return;
    }
    if (!trimmedEmail) {
      setError({ title: 'Email ID required', message: 'Please enter your email address so clearance updates and your final certificate can be sent to you.' });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError({ title: 'Invalid Email format', message: 'Please enter a valid email address (e.g. name@mce.ac.in or personal email).' });
      return;
    }
    if (!trimmedPassword) {
      setError({ title: 'Password required', message: 'Please choose a password.' });
      return;
    }
    if (trimmedPassword.length < 6) {
      setError({ title: 'Password too short', message: 'Password must be at least 6 characters long.' });
      return;
    }
    if (trimmedPassword !== trimmedConfirm) {
      setError({ title: 'Passwords do not match', message: 'Please make sure both passwords match.' });
      return;
    }

    setLoading(true);
    try {
      const response = await api.post('/auth/student-register', {
        usn: trimmedUsn,
        email: trimmedEmail,
        password: trimmedPassword,
        confirmPassword: trimmedConfirm
      });

      const { user, token, accessToken, message } = response.data;
      setSuccessMsg(message || 'Registration successful! Signing you in...');

      // Save session and redirect
      setTimeout(() => {
        setAuth(user, token || accessToken);
        navigate('/student/dashboard');
      }, 500);
    } catch (err: any) {
      const serverMsg = err.response?.data?.message || err.message || '';
      if (serverMsg.toLowerCase().includes('already registered')) {
        setError({
          title: 'Already Registered',
          message: 'An account already exists for this USN. Please switch to the Sign In tab.',
          action: {
            label: 'Go to Sign In',
            onClick: () => handleTabSwitch('login')
          }
        });
      } else {
        setError(err);
      }
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

        {/* Tab Segmented Control */}
        <div className="flex rounded-2xl bg-zinc-100/90 p-1 mb-5 border border-zinc-200/80">
          <button
            type="button"
            onClick={() => handleTabSwitch('login')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-xl transition-all ${
              mode === 'login'
                ? 'bg-white text-blue-700 shadow-xs border border-zinc-200/60'
                : 'text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>Sign In</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('register')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-all ${
              mode === 'register'
                ? 'bg-white/90 text-blue-900 shadow-xs border border-white/60'
                : 'text-zinc-700 hover:text-zinc-950'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>First-Time Register</span>
          </button>
        </div>

        {/* Info card for registration */}
        {mode === 'register' && (
          <div className="mb-4 p-3 rounded-xl bg-white/40 border border-white/60 text-left text-xs text-blue-950 leading-relaxed flex gap-2.5 items-start backdrop-blur-md">
            <KeyRound className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-blue-950">First-time registration</p>
              <p className="text-[11px] text-blue-900 mt-0.5 font-medium">
                Enter your USN and choose a password. Your credentials will be saved and you will use this password to sign in next time.
              </p>
            </div>
          </div>
        )}

        {/* Success Alert */}
        {successMsg && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-950 text-xs font-medium text-left backdrop-blur-md">
            {successMsg}
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mb-5">
            <ErrorAlert
              error={error}
              onDismiss={() => setError(null)}
              title={mode === 'login' ? 'Sign In Failed' : 'Registration Failed'}
            />
            {error.action && (
              <button
                type="button"
                onClick={error.action.onClick}
                className="mt-2 text-xs font-bold text-blue-700 hover:text-blue-900 underline block text-left"
              >
                {error.action.label} →
              </button>
            )}
          </div>
        )}

        {/* FORM */}
        <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-3.5 text-left">
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
                onBlur={() => checkUsnEmail(usn)}
                placeholder="4MC22IS001"
                required
                maxLength={12}
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-white/60 bg-white/65 hover:bg-white/80 focus:bg-white/95 text-zinc-900 text-sm font-mono font-bold tracking-wide placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-zinc-500 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition-all uppercase"
              />
            </div>
          </div>

          {/* Email Address Field (Register mode only) */}
          {mode === 'register' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-zinc-800 uppercase tracking-wider">
                  Registered Email Address
                </label>
                <span className="text-[10px] text-blue-800 font-bold">Clearance &amp; Certificate Alerts</span>
              </div>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@example.com"
                  required
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-white/60 bg-white/65 hover:bg-white/80 focus:bg-white/95 text-zinc-900 text-sm font-medium placeholder:text-zinc-500 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition-all lowercase"
                />
              </div>
              <p className="text-[10px] text-zinc-600 mt-1 font-medium">
                Departmental clearance notifications and your final No Due Certificate will be emailed here.
              </p>
            </div>
          )}

          {/* Password Field */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-zinc-800 uppercase tracking-wider">
                {mode === 'register' ? 'Choose Password' : 'Password'}
              </label>
              {mode === 'register' && (
                <span className="text-[10px] text-zinc-600 font-semibold">Min 6 characters</span>
              )}
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'Create a secure password' : 'Enter your password'}
                required
                className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-white/60 bg-white/65 hover:bg-white/80 focus:bg-white/95 text-zinc-900 text-sm font-medium placeholder:text-zinc-500 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-700 focus:outline-none"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirm Password Field (Register mode only) */}
          {mode === 'register' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-zinc-800 uppercase tracking-wider">
                  Confirm Password
                </label>
                <span className="text-[10px] text-zinc-600 font-semibold">Must match</span>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter chosen password"
                  required
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-white/60 bg-white/65 hover:bg-white/80 focus:bg-white/95 text-zinc-900 text-sm font-medium placeholder:text-zinc-500 focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-700 focus:outline-none"
                  tabIndex={-1}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
            <span>
              {loading
                ? mode === 'register'
                  ? 'Registering Account...'
                  : 'Signing In...'
                : mode === 'register'
                ? 'Register & Sign In'
                : 'Sign In to Portal'}
            </span>
            {!loading && <ArrowRight className="w-3.5 h-3.5" />}
          </button>
        </form>

        {/* Toggle Mode Link */}
        <div className="mt-4 text-center">
          {mode === 'login' ? (
            <p className="text-xs text-zinc-700 font-medium">
              First time visiting?{' '}
              <button
                type="button"
                onClick={() => handleTabSwitch('register')}
                className="font-bold text-blue-700 hover:text-blue-900 underline ml-0.5 cursor-pointer"
              >
                Register your account
              </button>
            </p>
          ) : (
            <p className="text-xs text-zinc-700 font-medium">
              Already created a password?{' '}
              <button
                type="button"
                onClick={() => handleTabSwitch('login')}
                className="font-bold text-blue-700 hover:text-blue-900 underline ml-0.5 cursor-pointer"
              >
                Sign in here
              </button>
            </p>
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
