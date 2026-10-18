import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  UploadCloud,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  Save,
  CheckSquare,
  Square,
  ShieldCheck,
  Edit2,
  RefreshCw,
  Search,
  Check,
  ArrowRight,
  Atom,
  Clock,
  History,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Eye,
  X,
  Target,
  Layers,
  Info,
  Lock,
  XCircle
} from 'lucide-react';
import {
  aiService,
  ScanJob,
  ScanEntry,
  checkEntryApprovalEligibility,
  parseEntryForensics,
  ParsedForensicDetails
} from '../../services/aiService';
import { useAuthStore } from '../../store/useAuthStore';

export const LogbookScannerPage: React.FC = () => {
  const { user } = useAuthStore();
  const officerDeptObj = ((user?.officerProfile as any)?.department || user?.department) as any;
  const deptCode = (officerDeptObj?.code || (typeof user?.department === 'object' ? (user?.department as any)?.code : undefined) || 'PHY').toUpperCase();
  const deptName = officerDeptObj?.name || (typeof user?.department === 'object' ? (user?.department as any)?.name : '') || (deptCode === 'LIB' ? 'Central Library' : 'Physics Lab');

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [scanJob, setScanJob] = useState<ScanJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<ScanJob[]>([]);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());

  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ usn: string; amount: number; reason: string }>({
    usn: '',
    amount: 0,
    reason: ''
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyingEntryId, setApplyingEntryId] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ appliedCount: number; message: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [showProcessed, setShowProcessed] = useState<boolean>(false);
  const [appliedNotifications, setAppliedNotifications] = useState<Record<string, { deliveryStatus?: string; messageId?: string; lastError?: string }>>({});
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load recent scan jobs
  const loadRecentJobs = async () => {
    try {
      const jobs = await aiService.listScanJobs();
      setRecentJobs(jobs);
    } catch (err) {
      console.error('Failed to load recent jobs:', err);
    }
  };

  useEffect(() => {
    loadRecentJobs();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setErrorMsg(null);
      setScanJob(null);
      setApplyResult(null);

      if (selected.type.startsWith('image/')) {
        const url = URL.createObjectURL(selected);
        setPreviewUrl(url);
      } else {
        setPreviewUrl(null);
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
      setErrorMsg(null);
      setScanJob(null);
      setApplyResult(null);

      if (dropped.type.startsWith('image/')) {
        setPreviewUrl(URL.createObjectURL(dropped));
      } else {
        setPreviewUrl(null);
      }
    }
  };

  const handleExtract = async () => {
    if (!file || extracting) return;

    try {
      setExtracting(true);
      setErrorMsg(null);
      setApplyResult(null);

      const job = await aiService.uploadLogbook(file, deptCode);
      setScanJob(job);


      // Pre-select ONLY entries eligible for approval by default
      const eligibleIds = job.entries
        .filter((e) => checkEntryApprovalEligibility(e).isEligible)
        .map((e) => e.id);
      setSelectedEntryIds(new Set(eligibleIds));

      loadRecentJobs();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Logbook OCR extraction failed.');
    } finally {
      setExtracting(false);
    }
  };

  const handleSelectJob = async (jobId: string) => {
    try {
      setErrorMsg(null);
      setApplyResult(null);
      const job = await aiService.getScanJob(jobId);
      setScanJob(job);
      const eligibleIds = job.entries
        .filter((e) => checkEntryApprovalEligibility(e).isEligible)
        .map((e) => e.id);
      setSelectedEntryIds(new Set(eligibleIds));
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to load scan job.');
    }
  };

  const handleToggleSelect = (entry: ScanEntry) => {
    const { isEligible } = checkEntryApprovalEligibility(entry);
    if (!isEligible) return; // Prevent selecting ineligible entries
    const next = new Set(selectedEntryIds);
    if (next.has(entry.id)) next.delete(entry.id);
    else next.add(entry.id);
    setSelectedEntryIds(next);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked && scanJob) {
      // Select-all must select ONLY eligible entries
      const allEligible = scanJob.entries
        .filter((e) => checkEntryApprovalEligibility(e).isEligible)
        .map((e) => e.id);
      setSelectedEntryIds(new Set(allEligible));
    } else {
      setSelectedEntryIds(new Set());
    }
  };

  const handleStartEdit = (entry: ScanEntry) => {
    setEditingEntryId(entry.id);
    setEditForm({
      usn: entry.correctedUsn || entry.extractedUsn,
      amount: entry.correctedAmount ?? entry.extractedAmount,
      reason: entry.correctedReason || entry.extractedReason
    });
  };

  const handleCancelEdit = () => {
    setEditingEntryId(null);
  };

  const handleSaveEdit = async (entryId: string) => {
    try {
      setSavingEdit(true);
      const updated = await aiService.updateScanEntry(entryId, {
        correctedUsn: editForm.usn.trim(),
        correctedAmount: Number(editForm.amount),
        correctedReason: editForm.reason.trim()
      });

      if (scanJob) {
        const updatedEntries = scanJob.entries.map((e) => (e.id === entryId ? { ...e, ...updated } : e));
        setScanJob({
          ...scanJob,
          entries: updatedEntries
        });

        if (checkEntryApprovalEligibility(updated).isEligible) {
          setSelectedEntryIds((prev) => new Set([...prev, entryId]));
        }
      }

      setEditingEntryId(null);
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to update entry.');
    } finally {
      setSavingEdit(false);
    }
  };

  // Independent Single-Entry Approval
  const handleApplySingleEntry = async (entry: ScanEntry) => {
    const eligibility = checkEntryApprovalEligibility(entry);
    if (!eligibility.isEligible || applying || applyingEntryId) return;

    try {
      setApplyingEntryId(entry.id);
      setErrorMsg(null);

      const result = await aiService.applyScanEntries(scanJob!.id, [entry.id]);

      if (result.results && Array.isArray(result.results)) {
        const notifMap: Record<string, any> = {};
        for (const r of result.results) {
          if (r.entryId && r.notification) {
            notifMap[r.entryId] = r.notification;
          }
        }
        setAppliedNotifications((prev) => ({ ...prev, ...notifMap }));
      }

      setApplyResult({
        appliedCount: result.appliedCount,
        message: `Successfully approved & applied due of ₹${entry.correctedAmount ?? entry.extractedAmount} for ${entry.matchedStudentName || entry.matchedStudentUsn || entry.extractedUsn
          } directly to official clearance records.`
      });

      const refreshedJob = await aiService.getScanJob(scanJob!.id);
      setScanJob(refreshedJob);
      setSelectedEntryIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.id);
        return next;
      });
      loadRecentJobs();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to approve and apply entry.');
    } finally {
      setApplyingEntryId(null);
    }
  };

  // Batch Approval
  const handleApplyDues = async () => {
    if (!scanJob || selectedEntryIds.size === 0 || applying || applyingEntryId) return;

    try {
      setApplying(true);
      setErrorMsg(null);

      const result = await aiService.applyScanEntries(scanJob.id, Array.from(selectedEntryIds));

      if (result.results && Array.isArray(result.results)) {
        const notifMap: Record<string, any> = {};
        for (const r of result.results) {
          if (r.entryId && r.notification) {
            notifMap[r.entryId] = r.notification;
          }
        }
        setAppliedNotifications((prev) => ({ ...prev, ...notifMap }));
      }

      setApplyResult({
        appliedCount: result.appliedCount,
        message: `Successfully applied ${result.appliedCount} student dues directly to live departmental clearance records.`
      });

      const refreshedJob = await aiService.getScanJob(scanJob.id);
      setScanJob(refreshedJob);
      setSelectedEntryIds(new Set());
      loadRecentJobs();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to apply dues.');
    } finally {
      setApplying(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setPreviewUrl(null);
    setScanJob(null);
    setSelectedEntryIds(new Set());
    setErrorMsg(null);
    setApplyResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const filteredEntries = scanJob
    ? scanJob.entries.filter((e) => {
      const query = searchFilter.toLowerCase();
      return (
        e.extractedUsn.toLowerCase().includes(query) ||
        (e.correctedUsn && e.correctedUsn.toLowerCase().includes(query)) ||
        e.extractedName.toLowerCase().includes(query) ||
        (e.matchedStudentName && e.matchedStudentName.toLowerCase().includes(query)) ||
        e.extractedReason.toLowerCase().includes(query)
      );
    })
    : [];

  const eligibleEntriesCount = scanJob
    ? scanJob.entries.filter((e) => checkEntryApprovalEligibility(e).isEligible).length
    : 0;

  const selectedTotal = scanJob
    ? scanJob.entries
      .filter((e) => selectedEntryIds.has(e.id))
      .reduce((sum, e) => sum + (e.correctedAmount ?? e.extractedAmount), 0)
    : 0;

  const isLibrary = deptCode === 'LIB' || deptName.toLowerCase().includes('library');
  const queuePath = isLibrary
    ? '/officer/central-library'
    : deptCode === 'CHEM'
    ? '/officer/chemistry-lab'
    : '/officer/physics-lab';

  return (
    <div className="space-y-5">
      {/* Compact Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-50 border border-cyan-100 flex items-center justify-center text-cyan-600 shadow-2xs">
            <UploadCloud className="w-5 h-5 text-cyan-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">
                {isLibrary ? 'Library Register Scanner' : 'Lab Register Scanner'}
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200">
                {deptName}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {isLibrary
                ? 'Upload photos of library fine registers or book ledgers to scan student dues.'
                : 'Upload photos of handwritten equipment registers to scan student dues.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={queuePath}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <Atom className="w-3.5 h-3.5 text-cyan-600" />
            <span>Clearance Queue</span>
          </Link>

          <Link
            to="/officer/ai-assistant"
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            <span>Ask AI Assistant</span>
          </Link>
        </div>
      </div>


      {/* Notifications */}
      {errorMsg && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-rose-500 hover:text-rose-700">
            ×
          </button>
        </div>
      )}

      {applyResult && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <span className="font-bold block text-sm">Clearance Dues Successfully Applied!</span>
              <span>{applyResult.message}</span>
            </div>
          </div>
          <Link
            to="/officer/physics-lab"
            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold flex items-center gap-1"
          >
            <span>View in Queue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* STAGE 1: Upload Dropzone if no scanJob active */}
      {!scanJob && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 sm:p-14 text-center cursor-pointer transition-all ${file
                  ? 'border-indigo-400 bg-indigo-50/40'
                  : 'border-slate-300 hover:border-indigo-500 hover:bg-slate-100/50 bg-white'
                }`}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                className="hidden"
              />

              <div className="w-16 h-16 rounded-2xl bg-indigo-100 text-indigo-600 mx-auto flex items-center justify-center mb-4 shadow-xs">
                {file?.type.startsWith('image/') ? (
                  <ImageIcon className="w-8 h-8" />
                ) : file ? (
                  <FileText className="w-8 h-8" />
                ) : (
                  <UploadCloud className="w-8 h-8" />
                )}
              </div>

              {file ? (
                <div>
                  <h4 className="font-bold text-slate-800 text-base">{file.name}</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB • {file.type || 'Document'}
                  </p>
                  <p className="text-xs text-indigo-600 font-semibold mt-2">
                    Click to choose another file or drag & drop to replace
                  </p>
                </div>
              ) : (
                <div>
                  <h4 className="font-bold text-slate-800 text-base">
                    Upload Laboratory Due / Breakage Register
                  </h4>
                  <p className="text-xs text-slate-500 mt-1">
                    Accepts clear photos (JPEG, PNG, WEBP) or PDF scans of handwritten student due logs
                  </p>
                  <span className="inline-block mt-3 px-4 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-xl shadow-xs">
                    Browse File from Computer
                  </span>
                </div>
              )}
            </div>

            {previewUrl && (
              <div className="bg-white p-4 rounded-xl border border-slate-200">
                <span className="text-xs font-semibold text-slate-500 block mb-2">Image Preview:</span>
                <div className="max-h-72 overflow-hidden rounded-lg flex items-center justify-center bg-slate-900/5">
                  <img src={previewUrl} alt="Preview" className="max-h-72 object-contain" />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleExtract}
                disabled={!file || extracting}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl shadow-xs flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {extracting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Scanning Image for Dues...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>Scan Image</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Recent Scans History */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <History className="w-4 h-4 text-slate-500" />
              <span>Recent Scan Jobs</span>
            </h3>

            {recentJobs.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No previous logbook scans found.</p>
            ) : (
              <div className="space-y-2">
                {recentJobs.map((job) => (
                  <div
                    key={job.id}
                    onClick={() => handleSelectJob(job.id)}
                    className="p-3 rounded-xl bg-slate-50 hover:bg-indigo-50 border border-slate-100 hover:border-indigo-200 cursor-pointer transition-colors text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between font-semibold text-slate-800">
                      <span className="truncate max-w-[160px]">{job.originalFilename || 'Logbook Scan'}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${job.status === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-blue-100 text-blue-800'
                          }`}
                      >
                        {job.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400 text-[11px]">
                      <span>{new Date(job.createdAt).toLocaleDateString()}</span>
                      <span>{job.totalEntries || job.entries?.length || 0} entries</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* STAGE 2: Interactive Verification Data Grid */}
      {scanJob && (
        <div className="space-y-4">
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Extracted
              </span>
              <span className="text-2xl font-black text-slate-800 mt-1">{scanJob.totalEntries}</span>
            </div>
            <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200 shadow-xs">
              <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">
                Matched in Database
              </span>
              <span className="text-2xl font-black text-emerald-800 mt-1">{scanJob.matchedEntries}</span>
            </div>
            <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200 shadow-xs">
              <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider block">
                Needs Review
              </span>
              <span className="text-2xl font-black text-amber-800 mt-1">{scanJob.unmatchedEntries}</span>
            </div>
            <div className="bg-indigo-50/60 p-4 rounded-xl border border-indigo-200 shadow-xs">
              <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider block">
                Applied to Records
              </span>
              <span className="text-2xl font-black text-indigo-800 mt-1">{scanJob.appliedEntries}</span>
            </div>
          </div>

          {/* Original Document Inspection & Forensic Review Viewer */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs p-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <FileText className="w-4 h-4 text-indigo-600" />
                <span className="font-bold text-slate-800 text-xs">
                  Original Logbook Reference: <span className="text-slate-500 font-normal">{scanJob.originalFilename}</span>
                </span>
                <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold border border-indigo-100">
                  {scanJob.totalEntries === 1 ? '1 Visible Entry Detected' : `${scanJob.totalEntries} Visible Entries Detected`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  title="Rotate Document 90°"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Rotate ({rotation}°)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition-colors cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-mono text-slate-500 min-w-10 text-center">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                  className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs transition-colors cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowProcessed((s) => !s)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer ${showProcessed ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  title="Toggle Contrast Enhanced Image"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{showProcessed ? 'Enhanced Contrast' : 'Original Photo'}</span>
                </button>
              </div>
            </div>

            <div className="mt-3 max-h-80 overflow-auto bg-slate-900/5 rounded-xl p-4 flex items-center justify-center border border-slate-100">
              <img
                src={previewUrl || aiService.getJobImageUrl(scanJob.id, showProcessed)}
                alt="Scanned logbook reference"
                style={{
                  transform: `rotate(${rotation}deg) scale(${zoom})`,
                  transition: 'transform 0.2s ease-in-out',
                  transformOrigin: 'center center'
                }}
                className="max-h-72 object-contain rounded shadow-xs"
              />
            </div>
          </div>

          {/* Stage Metrics & Extraction Pipeline Discrepancy Banner */}
          {scanJob.extractionRaw && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 shadow-xs">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold text-slate-800">
                    Vision OCR Layout Analysis & Candidate Metrics
                  </span>
                  {scanJob.extractionRaw.layoutType && (
                    <span className="text-[10px] font-semibold bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                      Layout: {scanJob.extractionRaw.layoutType}
                    </span>
                  )}
                  {scanJob.extractionRaw.isRotated && (
                    <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                      Orientation Corrected (Upright)
                    </span>
                  )}
                  {scanJob.extractionRaw.lightingAdjusted && (
                    <span className="text-[10px] font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                      Lighting & Shadow Optimized
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-700 font-medium">
                    Physical Lines Detected:{' '}
                    <strong className="text-slate-900">
                      {scanJob.extractionRaw.stageMetrics?.detectedRowCount ?? scanJob.extractionRaw.detectedRowCount ?? scanJob.totalEntries}
                    </strong>
                  </span>
                  <span className="text-[11px] px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-indigo-700 font-medium">
                    Candidates Extracted:{' '}
                    <strong className="text-indigo-900">{scanJob.totalEntries}</strong>
                  </span>
                  {Boolean(scanJob.extractionRaw.stageMetrics?.blankLinesSkippedCount) && (
                    <span className="text-[11px] px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 font-medium">
                      Blank Lines Skipped:{' '}
                      <strong>{scanJob.extractionRaw.stageMetrics?.blankLinesSkippedCount}</strong>
                    </span>
                  )}
                  {Boolean(scanJob.extractionRaw.stageMetrics?.crossedOutRowCount) && (
                    <span className="text-[11px] px-2.5 py-1 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 font-medium">
                      Crossed-Out Rows: <strong>{scanJob.extractionRaw.stageMetrics?.crossedOutRowCount}</strong>
                    </span>
                  )}
                </div>
              </div>

              {scanJob.extractionRaw.stageMetrics?.discrepancyExplanation && (
                <div className="mt-2.5 pt-2.5 border-t border-slate-200/80 flex items-start gap-2 text-xs text-slate-600">
                  <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-800">Candidate Preservation Policy: </span>
                    <span>{scanJob.extractionRaw.stageMetrics.discrepancyExplanation}</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      Every candidate row detected by vision recognition is preserved below for human review. Unapproved entries never mutate the database.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Table Container */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    disabled={eligibleEntriesCount === 0 || applying || applyingEntryId !== null}
                    checked={
                      selectedEntryIds.size > 0 &&
                      selectedEntryIds.size === eligibleEntriesCount
                    }
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40"
                  />
                  <span>Select All Ready ({eligibleEntriesCount} ready to add)</span>
                </label>
                <span className="text-xs text-slate-500">
                  ({selectedEntryIds.size} selected • Total: ₹{selectedTotal})
                </span>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 hover:text-slate-900 text-xs font-semibold select-none bg-white border border-slate-200 px-3 py-1.5 rounded-xl shadow-2xs">
                  <input
                    type="checkbox"
                    checked={showTechnicalDetails}
                    onChange={(e) => setShowTechnicalDetails(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <span>Show OCR Details</span>
                </label>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Search USN, student name, reason..."
                    className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleReset}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Upload Another Image</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200">
                    <th className="py-3 px-3 w-10 text-center">#</th>
                    <th className="py-3 px-4 min-w-[220px]">Student</th>
                    <th className="py-3 px-4 min-w-[180px]">Reason / Apparatus</th>
                    <th className="py-3 px-4 w-28">Amount</th>
                    <th className="py-3 px-4 min-w-[170px]">Status</th>
                    {showTechnicalDetails && (
                      <th className="py-3 px-4 min-w-[200px]">OCR Raw Text & Confidence</th>
                    )}
                    <th className="py-3 px-4 text-right min-w-[160px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEntries.map((entry, idx) => {
                    const isEditing = editingEntryId === entry.id;
                    const isSelected = selectedEntryIds.has(entry.id);
                    const isApplied = entry.status === 'APPLIED';
                    const isSingleApplying = applyingEntryId === entry.id;
                    const displayUsn = entry.correctedUsn || entry.extractedUsn;
                    const displayAmount = entry.correctedAmount ?? entry.extractedAmount;
                    const displayReason = entry.correctedReason || entry.extractedReason;

                    const rawMeta = scanJob.extractionRaw?.entries?.[entry.entryIndex - 1] || null;
                    const forensics = parseEntryForensics(entry, rawMeta);
                    const eligibility = checkEntryApprovalEligibility(entry);

                    return (
                      <tr
                        key={entry.id}
                        className={`hover:bg-slate-50/70 transition-colors ${isApplied ? 'bg-emerald-50/20 opacity-75' : !eligibility.isEligible ? 'bg-amber-50/15' : ''
                          }`}
                      >
                        {/* Checkbox & Row Index */}
                        <td className="py-3.5 px-3 align-top text-center">
                          <div className="flex flex-col items-center gap-1 pt-0.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!eligibility.isEligible || isApplied || applying || isSingleApplying}
                              onChange={() => handleToggleSelect(entry)}
                              title={eligibility.isEligible ? 'Select for approval' : eligibility.blockerReason}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <span className="text-[10px] font-mono font-medium text-slate-400">
                              #{entry.entryIndex}
                            </span>
                          </div>
                        </td>

                        {/* Student Details: USN and Matched Name */}
                        <td className="py-3.5 px-4 align-top">
                          {isEditing ? (
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-500 uppercase">Student USN</label>
                              <input
                                type="text"
                                value={editForm.usn}
                                onChange={(e) => setEditForm({ ...editForm, usn: e.target.value.toUpperCase() })}
                                placeholder="e.g. 4MC24IS022"
                                className="w-full px-2.5 py-1 bg-white border border-indigo-500 rounded-lg text-xs font-mono font-bold uppercase focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-slate-900 text-sm">
                                  {displayUsn || <span className="text-rose-500 italic">No USN</span>}
                                </span>
                                {entry.matchedStudentName && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Matched
                                  </span>
                                )}
                              </div>

                              {entry.matchedStudentName ? (
                                <div className="font-medium text-slate-700 text-xs">
                                  {entry.matchedStudentName}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">
                                    <AlertCircle className="w-3 h-3 text-amber-600 shrink-0" />
                                    <span>Not found in student database</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleStartEdit(entry)}
                                    className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold underline cursor-pointer"
                                  >
                                    Edit USN
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Reason / Equipment */}
                        <td className="py-3.5 px-4 align-top">
                          {isEditing ? (
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-500 uppercase">Reason / Apparatus</label>
                              <input
                                type="text"
                                value={editForm.reason}
                                onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                                placeholder="e.g. Breaking thermometer"
                                className="w-full px-2.5 py-1 bg-white border border-indigo-500 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span className="text-slate-800 text-xs font-medium block">
                                {displayReason || <span className="text-slate-400 italic">No reason specified</span>}
                              </span>
                              {forensics.isCrossedOut && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                                  <AlertTriangle className="w-2.5 h-2.5" /> Struck out in logbook
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Amount */}
                        <td className="py-3.5 px-4 align-top">
                          {isEditing ? (
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-500 uppercase">Amount (₹)</label>
                              <input
                                type="number"
                                min="0"
                                value={editForm.amount}
                                onChange={(e) => setEditForm({ ...editForm, amount: Number(e.target.value) })}
                                className="w-24 px-2.5 py-1 bg-white border border-indigo-500 rounded-lg text-xs font-bold focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          ) : displayAmount > 0 ? (
                            <span className="font-bold text-slate-900 text-sm">
                              ₹{displayAmount}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-lg">
                              ⚠️ Missing Amount
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4 align-top">
                          <div className="space-y-1">
                            {isApplied ? (
                              <div className="space-y-1">
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-2.5 py-1 rounded-full">
                                  <Check className="w-3.5 h-3.5 text-emerald-700" /> Added to NDC
                                </span>
                                {appliedNotifications[entry.id] && (
                                  <div className="text-[10px] font-medium pt-0.5 text-slate-500">
                                    {appliedNotifications[entry.id].deliveryStatus === 'ACCEPTED' && '✉️ Email Sent'}
                                    {appliedNotifications[entry.id].deliveryStatus === 'QUEUED' && '✉️ Email Queued'}
                                    {appliedNotifications[entry.id].deliveryStatus === 'UNCERTAIN' && '⚠️ Email Uncertain'}
                                    {appliedNotifications[entry.id].deliveryStatus === 'FAILED' && '❌ Email Failed'}
                                  </div>
                                )}
                              </div>
                            ) : eligibility.isEligible ? (
                              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Ready to Approve
                              </span>
                            ) : (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Action Needed
                                </span>
                                <p className="text-[10px] text-slate-500">
                                  {!entry.matchedStudentName
                                    ? 'Click Edit to fix USN'
                                    : displayAmount <= 0
                                      ? 'Enter due amount'
                                      : 'Review details'}
                                </p>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Optional Technical Details */}
                        {showTechnicalDetails && (
                          <td className="py-3.5 px-4 align-top max-w-xs">
                            <div className="space-y-1 text-[10px]">
                              <div className="flex items-center gap-1.5 text-slate-500">
                                <span>Page {forensics.pageNumber} • Row {forensics.rowNumber}</span>
                                <span className="font-bold text-indigo-700 font-mono">({forensics.confidencePercent}% confidence)</span>
                              </div>
                              {forensics.rawText && (
                                <div className="bg-slate-100 rounded px-1.5 py-0.5 font-mono text-slate-600 truncate max-w-[220px]" title={forensics.rawText}>
                                  "{forensics.rawText}"
                                </div>
                              )}
                            </div>
                          </td>
                        )}

                        {/* Actions */}
                        <td className="py-3.5 px-4 align-top text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEdit(entry.id)}
                                  disabled={savingEdit}
                                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                >
                                  {savingEdit ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                  <span>Save</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={handleCancelEdit}
                                  disabled={savingEdit}
                                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium text-xs cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleStartEdit(entry)}
                                  disabled={isApplied}
                                  className="px-2.5 py-1.5 text-slate-700 hover:text-indigo-700 hover:bg-indigo-50 border border-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                  title="Edit USN, Amount, or Reason"
                                >
                                  <Edit2 className="w-3 h-3" />
                                  <span>Edit</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleApplySingleEntry(entry)}
                                  disabled={!eligibility.isEligible || isApplied || applying || isSingleApplying}
                                  title={
                                    isApplied
                                      ? 'Already applied to database'
                                      : eligibility.isEligible
                                        ? 'Approve and apply this entry'
                                        : 'Cannot approve until USN matches a registered student'
                                  }
                                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  {isSingleApplying ? (
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Check className="w-3 h-3" />
                                  )}
                                  <span>{isApplied ? 'Added' : 'Add Due'}</span>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Footer */}
          <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-600">
              <span className="font-bold text-slate-900">{selectedEntryIds.size}</span> student dues
              selected for batch application • Total amount:{' '}
              <span className="font-bold text-rose-700">₹{selectedTotal}</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                Note: Ineligible or unresolved candidate rows are excluded from approval until manually corrected.
              </span>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleReset}
                className="flex-1 sm:flex-none px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel / Reset
              </button>

              <button
                type="button"
                onClick={handleApplyDues}
                disabled={selectedEntryIds.size === 0 || applying || applyingEntryId !== null}
                className="flex-1 sm:flex-none px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {applying ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Applying to Database...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Add {selectedEntryIds.size} Selected Dues to Records</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
