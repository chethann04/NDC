import React, { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import api from '../services/api';
import { Eye, EyeOff } from 'lucide-react';
import { ErrorAlert } from './ErrorAlert';

export const FirstLoginPasswordModal: React.FC = () => {
  const { user, setAuth } = useAuthStore();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<any>(null);
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Auto-heal any stale student session having mustChangePassword in localStorage
  React.useEffect(() => {
    if (user?.role === 'STUDENT' && user?.mustChangePassword) {
      const token = localStorage.getItem('ndc_token') || '';
      setAuth({ ...user, mustChangePassword: false }, token);
    }
  }, [user, setAuth]);

  if (!user || !user.mustChangePassword || user.role === 'STUDENT') {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess('');

    if (!oldPassword) {
      setError({
        title: 'Current password required',
        message: 'Please enter your current temporary password (your USN in uppercase).'
      });
      return;
    }

    if (newPassword.length < 6) {
      setError({
        title: 'Password too short',
        message: 'Your new password must be at least 6 characters long. Choose a longer password and try again.'
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      setError({
        title: 'Passwords do not match',
        message: 'The new password and confirmation password do not match. Please re-enter them carefully.'
      });
      return;
    }

    try {
      setLoading(true);
      await api.post('/auth/reset-password', {
        oldPassword,
        newPassword
      });

      setSuccess('Password updated successfully!');
      setTimeout(() => {
        // Update user state locally
        const token = localStorage.getItem('ndc_token') || '';
        const updatedUser = { ...user, mustChangePassword: false };
        setAuth(updatedUser, token);
      }, 1000);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-100 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center gap-3 mb-4 text-blue-900">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700">
            <span className="material-symbols-outlined text-2xl">key</span>
          </div>
          <div>
            <h3 className="font-bold text-lg text-slate-800">First Login Password Reset</h3>
            <p className="text-xs text-slate-500">Please update your temporary password to proceed.</p>
          </div>
        </div>

        {error && (
          <ErrorAlert
            error={error}
            onDismiss={() => setError(null)}
            className="mb-4"
            title="Password Reset Issue"
          />
        )}

        {success && (
          <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium flex items-center gap-2">
            <span className="material-symbols-outlined text-lg">check_circle</span>
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Current Password (Default: USN)
            </label>
            <div className="relative">
              <input
                type={showOldPassword ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="Enter your USN password"
                required
                className="w-full px-3 py-2 pr-10 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowOldPassword(!showOldPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                {showOldPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              New Password
            </label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min. 6 chars)"
                required
                className="w-full px-3 py-2 pr-10 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Confirm New Password
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                className="w-full px-3 py-2 pr-10 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-900 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 transition-colors shadow-md disabled:opacity-50 mt-2"
          >
            {loading ? 'Updating Password...' : 'Save New Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
};
