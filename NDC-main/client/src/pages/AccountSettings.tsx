import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import api from '../services/api';
import {
  ShieldCheck,
  Mail,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Eye,
  EyeOff,
  Building2,
  User,
  BadgeCheck,
  Lock,
  ChevronRight,
  LogOut
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const AccountSettings: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  // Wizard state: 'IDLE' | 'ENTER_EMAIL' | 'VERIFY_OTP' | 'SET_PASSWORD' | 'SUCCESS'
  const [step, setStep] = useState<'IDLE' | 'ENTER_EMAIL' | 'VERIFY_OTP' | 'SET_PASSWORD' | 'SUCCESS'>('IDLE');

  // Form states
  const [newEmail, setNewEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Status & loading
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Resend cooldown timer
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (cooldownSeconds > 0) {
      timer = setInterval(() => {
        setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const handleStartFlow = () => {
    setStep('ENTER_EMAIL');
    setNewEmail('');
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleCancelFlow = () => {
    setStep('IDLE');
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  // STEP 1: Request OTP to New Email
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const emailTrimmed = newEmail.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailTrimmed || !emailRegex.test(emailTrimmed)) {
      setErrorMsg('Please enter a valid official email address format.');
      return;
    }

    if (user?.email && emailTrimmed === user.email.toLowerCase()) {
      setErrorMsg('The new email is identical to your current login email.');
      return;
    }

    try {
      setLoading(true);
      const res = await api.post('/auth/credentials/request-email-otp', {
        newEmail: emailTrimmed
      });

      setSuccessMsg(res.data.message || `Verification code dispatched to ${emailTrimmed}.`);
      setCooldownSeconds(res.data.cooldownSeconds || 60);
      setStep('VERIFY_OTP');
    } catch (err: any) {
      console.error('Request OTP error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to dispatch verification code. Please check email and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (cooldownSeconds > 0) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      setLoading(true);
      const res = await api.post('/auth/credentials/request-email-otp', {
        newEmail: newEmail.trim().toLowerCase()
      });
      setSuccessMsg(res.data.message || 'A new verification code was sent.');
      setCooldownSeconds(res.data.cooldownSeconds || 60);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || 'Failed to resend code.');
    } finally {
      setLoading(false);
    }
  };

  // STEP 2: Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedOtp = otp.trim();
    if (!trimmedOtp || trimmedOtp.length !== 6) {
      setErrorMsg('Please enter the 6-digit verification code.');
      return;
    }

    try {
      setLoading(true);
      const res = await api.post('/auth/credentials/verify-otp', {
        newEmail: newEmail.trim().toLowerCase(),
        otp: trimmedOtp
      });

      setSuccessMsg(res.data.message || 'Email verified successfully. Now choose your new password.');
      setStep('SET_PASSWORD');
    } catch (err: any) {
      console.error('Verify OTP error:', err);
      setErrorMsg(err.response?.data?.message || 'Verification failed. Please check the code.');
    } finally {
      setLoading(false);
    }
  };

  // STEP 3: Set Password & Finalize Credential Change
  const handleFinalizeChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedPass = newPassword.trim();
    const trimmedConfirm = confirmPassword.trim();

    if (!trimmedPass || trimmedPass.length < 6) {
      setErrorMsg('New password must be at least 6 characters long.');
      return;
    }

    if (trimmedPass !== trimmedConfirm) {
      setErrorMsg('The new password and confirmation password do not match.');
      return;
    }

    try {
      setLoading(true);
      const res = await api.post('/auth/credentials/update', {
        newEmail: newEmail.trim().toLowerCase(),
        otp: otp.trim(),
        newPassword: trimmedPass,
        confirmPassword: trimmedConfirm
      });

      setSuccessMsg(res.data.message || 'Login credentials updated successfully.');
      setStep('SUCCESS');
    } catch (err: any) {
      console.error('Update credentials error:', err);
      setErrorMsg(err.response?.data?.message || 'Failed to update credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleFinishAndRelogin = () => {
    logout();
    navigate('/login');
  };

  const deptInfo = (user?.department || user?.departmentId) as any;
  const deptName =
    typeof deptInfo === 'object' && deptInfo?.name
      ? deptInfo.name
      : (user?.officerProfile?.departmentIds?.[0] as any)?.name || 'Institutional Clearance Desk';

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Page Title & Context Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-200/80 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-lg bg-zinc-900 text-white">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <h1 className="text-xl font-bold text-zinc-900 tracking-tight">Account &amp; Security Settings</h1>
          </div>
          <p className="text-xs text-zinc-500">
            Manage your authenticated operational identity, login email, and security credentials.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Active Account
          </span>
        </div>
      </div>

      {/* Account Identity Summary Card */}
      <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-zinc-500" />
            <span className="text-xs font-bold text-zinc-800 uppercase tracking-wider">Operational Identity</span>
          </div>
          <span className="text-[11px] font-semibold text-zinc-400">
            Protected Institution Record
          </span>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Account / Officer Name</label>
            <div className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
              <span>{user?.name || 'Authorized Operational Account'}</span>
              <BadgeCheck className="w-4 h-4 text-blue-600" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Assigned Role</label>
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-md text-xs font-semibold bg-zinc-100 text-zinc-800 border border-zinc-200">
                {user?.role?.replace(/_/g, ' ')}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Clearance Scope / Department</label>
            <div className="text-sm font-medium text-zinc-800 flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-zinc-400" />
              <span>{deptName}</span>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Login ID / Staff Identifier</label>
            <div className="text-sm font-mono font-semibold text-zinc-800">
              {user?.loginId || user?.officerProfile?.employeeId || 'Operational Account'}
            </div>
          </div>
        </div>
      </div>

      {/* Login Credentials & Self-Service Flow Card */}
      <div className="bg-white rounded-2xl border border-zinc-200/80 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 bg-zinc-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-zinc-500" />
            <span className="text-xs font-bold text-zinc-800 uppercase tracking-wider">Login Credentials</span>
          </div>
          <span className="text-[11px] font-medium text-zinc-500">
            Self-Service Email &amp; Password Update
          </span>
        </div>

        <div className="p-6">
          {/* Display Current Login Email & Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-zinc-50 border border-zinc-200/80 mb-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-zinc-400" />
                <span className="text-xs font-semibold text-zinc-500">Current Login Email Address:</span>
              </div>
              <div className="text-base font-bold font-mono text-zinc-900 pl-6">
                {user?.email}
              </div>
              <p className="text-[11px] text-zinc-400 pl-6">
                This email is used to authenticate into your section dashboard. Passwords and hashes are strictly concealed.
              </p>
            </div>

            {step === 'IDLE' && (
              <button
                type="button"
                onClick={handleStartFlow}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold shadow-xs transition-all cursor-pointer whitespace-nowrap self-start sm:self-center"
              >
                <KeyRound className="w-3.5 h-3.5 text-zinc-300" />
                <span>Change Login Credentials</span>
              </button>
            )}
          </div>

          {/* Feedback Alerts */}
          {errorMsg && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-3 animate-in fade-in">
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{errorMsg}</div>
            </div>
          )}

          {successMsg && step !== 'SUCCESS' && (
            <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-3 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{successMsg}</div>
            </div>
          )}

          {/* STEP 1: Enter New Email */}
          {step === 'ENTER_EMAIL' && (
            <div className="p-6 rounded-2xl border border-blue-200/80 bg-blue-50/20 space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">1</span>
                  <h3 className="text-sm font-bold text-zinc-900">Step 1: Enter New Official Email Address</h3>
                </div>
                <button
                  type="button"
                  onClick={handleCancelFlow}
                  className="text-xs text-zinc-500 hover:text-zinc-800 font-medium"
                >
                  Cancel
                </button>
              </div>

              <p className="text-xs text-zinc-600 leading-relaxed">
                Provide your official institutional email address. A 6-digit verification OTP will be sent to the <strong>new</strong> email to verify that you own and can receive emails at this address.
              </p>

              <form onSubmit={handleRequestOtp} className="space-y-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    New Official Email Address <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="e.g. library@college.edu or faculty.is@mce.ac.in"
                      required
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 text-sm font-medium bg-white"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={loading || !newEmail.trim()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Sending Verification Code...</span>
                      </>
                    ) : (
                      <>
                        <span>Send OTP Verification Code</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelFlow}
                    className="px-4 py-2.5 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP 2: Verify OTP */}
          {step === 'VERIFY_OTP' && (
            <div className="p-6 rounded-2xl border border-blue-200/80 bg-blue-50/20 space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">2</span>
                  <h3 className="text-sm font-bold text-zinc-900">Step 2: Enter 6-Digit Verification Code</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setStep('ENTER_EMAIL')}
                  className="text-xs text-blue-600 hover:underline font-semibold"
                >
                  Change Email
                </button>
              </div>

              <div className="p-3 rounded-xl bg-white border border-blue-100 text-xs text-zinc-600 flex items-center justify-between">
                <span>Verification code sent to: <strong className="font-mono text-zinc-900">{newEmail}</strong></span>
                <span className="text-[11px] text-zinc-400">Valid for 10 minutes</span>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-4 pt-2">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    6-Digit Verification OTP <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter 6-digit code"
                    required
                    className="w-full sm:w-64 tracking-widest text-center text-lg font-bold font-mono py-2.5 px-4 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white"
                  />
                  <p className="text-[11px] text-zinc-400 mt-1">Single-use secure code. Maximum 5 verification attempts allowed.</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={loading || otp.trim().length !== 6}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <>
                        <span>Verify Code &amp; Continue</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={loading || cooldownSeconds > 0}
                    onClick={handleResendOtp}
                    className="px-4 py-2.5 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {cooldownSeconds > 0 ? `Resend code in ${cooldownSeconds}s` : 'Resend Code'}
                  </button>

                  <button
                    type="button"
                    onClick={handleCancelFlow}
                    className="text-xs text-zinc-500 hover:text-zinc-800 font-medium ml-auto"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP 3: Set New Password */}
          {step === 'SET_PASSWORD' && (
            <div className="p-6 rounded-2xl border border-emerald-200/80 bg-emerald-50/20 space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center">3</span>
                  <h3 className="text-sm font-bold text-zinc-900">Step 3: Set New Account Password</h3>
                </div>
                <span className="text-xs font-bold text-emerald-700 bg-emerald-100/70 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Email Verified
                </span>
              </div>

              <p className="text-xs text-zinc-600">
                Email verification succeeded for <strong className="font-mono text-zinc-900">{newEmail}</strong>. Now choose a secure password to complete your new credentials.
              </p>

              <form onSubmit={handleFinalizeChange} className="space-y-4 pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">
                      New Password <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
                      <input
                        type={showNewPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 6 characters"
                        required
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-600 text-sm font-medium bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-3 text-zinc-400 hover:text-zinc-600 cursor-pointer"
                      >
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">
                      Confirm New Password <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3" />
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter new password"
                        required
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-600 text-sm font-medium bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-3 text-zinc-400 hover:text-zinc-600 cursor-pointer"
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-zinc-100/70 border border-zinc-200/80 text-[11px] text-zinc-600 space-y-1">
                  <div className="font-semibold text-zinc-800">Security Note:</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>Once saved, your old email ({user?.email}) and old password will immediately stop working.</li>
                    <li>Your role, permissions, and historical clearance records remain completely preserved.</li>
                  </ul>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={loading || !newPassword.trim() || !confirmPassword.trim()}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving Credentials...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Save &amp; Activate New Credentials</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleCancelFlow}
                    className="px-4 py-2.5 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP 4: Success & Re-login Confirmation */}
          {step === 'SUCCESS' && (
            <div className="p-8 rounded-2xl border border-emerald-200 bg-emerald-50/40 text-center space-y-4 animate-in fade-in zoom-in duration-200">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-zinc-900">Credentials Updated Successfully!</h3>
                <p className="text-xs text-zinc-600 mt-1 max-w-md mx-auto">
                  Your official login email is now updated to <strong className="font-mono text-zinc-900">{newEmail}</strong>. Your old credentials have been safely invalidated.
                </p>
              </div>

              <div className="max-w-md mx-auto p-4 rounded-xl bg-white border border-emerald-100 text-left text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500 font-medium">New Login Email:</span>
                  <span className="font-mono font-bold text-zinc-900">{newEmail}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500 font-medium">Password:</span>
                  <span className="text-emerald-700 font-semibold">Updated &amp; Encrypted</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500 font-medium">Account Role:</span>
                  <span className="font-semibold text-zinc-800">{user?.role?.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500 font-medium">Clearance Scope:</span>
                  <span className="font-semibold text-zinc-800">{deptName}</span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleFinishAndRelogin}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold shadow-md transition-all cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Log In with New Credentials</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default AccountSettings;
