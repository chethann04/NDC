import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';
import api from '../../services/api';
import * as xlsx from 'xlsx';
import {
  Upload,
  Download,
  CheckCircle2,
  RefreshCw,
  Loader2,
  FileSpreadsheet,
  AlertCircle,
  Database,
  ChevronDown,
  ChevronUp,
  UserPlus,
  Building2
} from 'lucide-react';
import { ErrorAlert } from '../../components/ErrorAlert';

export type ImportStage =
  | 'IDLE'
  | 'UPLOADING'
  | 'PARSING'
  | 'VALIDATING'
  | 'PREVIEW'
  | 'IMPORTING'
  | 'COMPLETED'
  | 'FAILED';

export const BulkImport: React.FC = () => {
  const { user } = useAuthStore();
  const [stage, setStage] = useState<ImportStage>('IDLE');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [duplicateAction, setDuplicateAction] = useState<'SKIP' | 'UPDATE'>('SKIP');
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStatusText, setProgressStatusText] = useState('');
  const [importResult, setImportResult] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [showErrorTable, setShowErrorTable] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      setError(null);
      processFile(selected);
    }
  };

  const processFile = async (selectedFile: File) => {
    setError(null);
    setShowErrorTable(false);

    // Stage 1: Parsing
    setStage('PARSING');
    setProgressPercent(15);
    setProgressStatusText(`Reading ${selectedFile.name} workbook...`);

    let clientRowCount = 0;
    try {
      const buffer = await selectedFile.arrayBuffer();
      const wb = xlsx.read(buffer, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      if (sheet) {
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
        clientRowCount = Math.max(0, rows.length - 1);
      }
    } catch {
      // Graceful fallback if local read has quirks
    }

    // Stage 2: Uploading
    setStage('UPLOADING');
    setProgressPercent(30);
    setProgressStatusText(
      clientRowCount > 0
        ? `Found ${clientRowCount} student records. Uploading ${selectedFile.name}...`
        : `Uploading ${selectedFile.name}...`
    );

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await api.post('/students/import/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const uploadProgress = Math.round(30 + (progressEvent.loaded / progressEvent.total) * 35);
            setProgressPercent(uploadProgress);
            if (uploadProgress < 65) {
              const loadedKb = Math.round(progressEvent.loaded / 1024);
              const totalKb = Math.round(progressEvent.total / 1024);
              setProgressStatusText(`Uploading ${selectedFile.name} (${loadedKb} KB / ${totalKb} KB)...`);
            }
          }
        }
      });

      // Stage 3: Validating
      setStage('VALIDATING');
      setProgressPercent(80);
      setProgressStatusText('Cross-referencing department codes and verifying database duplicates...');

      const previewData = response.data.data;
      await new Promise((r) => setTimeout(r, 200));

      setProgressPercent(100);
      setProgressStatusText(`Validation complete: ${previewData.validRecords} valid records ready.`);
      setPreview(previewData);

      setTimeout(() => {
        setStage('PREVIEW');
      }, 350);
    } catch (err: any) {
      setError(err);
      setStage('FAILED');
    }
  };

  const handleConfirmImport = async () => {
    if (!preview || !preview.rows || preview.rows.length === 0) return;

    setError(null);
    setStage('IMPORTING');
    setProgressPercent(0);

    const totalRows = preview.rows.length;
    // Scale batch size dynamically: 25 to 500 records per batch
    const BATCH_SIZE = Math.min(500, Math.max(25, Math.ceil(totalRows / 5)));
    const numBatches = Math.ceil(totalRows / BATCH_SIZE);

    let accumulatedImported = 0;
    let accumulatedUpdated = 0;
    let accumulatedSkipped = 0;
    let accumulatedFailed = 0;
    const accumulatedErrors: any[] = [];

    try {
      for (let i = 0; i < numBatches; i++) {
        const startIdx = i * BATCH_SIZE;
        const endIdx = Math.min(startIdx + BATCH_SIZE, totalRows);
        const batchRows = preview.rows.slice(startIdx, endIdx);

        const currentProcessed = startIdx;
        const currentPercent = Math.round((currentProcessed / totalRows) * 100);
        setProgressPercent(currentPercent);
        setProgressStatusText(
          `Importing batch ${i + 1} of ${numBatches} (records ${startIdx + 1} to ${endIdx} of ${totalRows})...`
        );

        const response = await api.post('/students/import/confirm', {
          rows: batchRows,
          duplicateAction
        });

        const data = response.data.data;
        if (data) {
          accumulatedImported += data.imported || 0;
          accumulatedUpdated += data.updated || 0;
          accumulatedSkipped += data.skipped || 0;
          accumulatedFailed += data.failed || data.invalid || 0;
          if (data.errorReport && Array.isArray(data.errorReport)) {
            accumulatedErrors.push(...data.errorReport);
          }
        }

        const updatedPercent = Math.round((endIdx / totalRows) * 100);
        setProgressPercent(updatedPercent);
        setProgressStatusText(
          `Imported ${endIdx} of ${totalRows} students (${updatedPercent}%)... (${accumulatedImported} added, ${accumulatedUpdated} updated)`
        );
      }

      setProgressPercent(100);
      setProgressStatusText(
        `Import complete: ${accumulatedImported + accumulatedUpdated} student profiles synchronized successfully!`
      );

      setImportResult({
        totalRows,
        imported: accumulatedImported,
        updated: accumulatedUpdated,
        skipped: accumulatedSkipped,
        failed: accumulatedFailed,
        errorReport: accumulatedErrors
      });

      setTimeout(() => {
        setStage('COMPLETED');
      }, 400);
    } catch (err: any) {
      setError(err);
      setStage('FAILED');
    }
  };

  const handleDownloadErrorReport = () => {
    const reports =
      importResult?.errorReport ||
      (preview?.rows
        ? preview.rows
            .filter((r: any) => !r.isValid)
            .map((r: any) => ({
              row: r.rowNumber,
              usn: r.usn || 'N/A',
              fullName: r.fullName || 'N/A',
              errorReason: r.errors?.join('; ') || 'Invalid record'
            }))
        : []);

    if (!reports || reports.length === 0) return;

    const worksheet = xlsx.utils.json_to_sheet(reports);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'ImportErrors');
    xlsx.writeFile(workbook, `Student_Import_Error_Report_${Date.now()}.xlsx`);
  };

  const handleReset = () => {
    setStage('IDLE');
    setFile(null);
    setPreview(null);
    setImportResult(null);
    setError('');
    setProgressPercent(0);
    setProgressStatusText('');
  };

  const invalidPreviewRows = preview?.rows?.filter((r: any) => !r.isValid) || [];

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="section-head">
        <div>
          <h1 className="page-title">Import Students</h1>
          <p className="caption-text mt-1">Bulk ingest and sync student rosters via Excel (.xlsx / .xls) or CSV</p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to={user?.role === 'DEPARTMENT_OFFICER' ? '/officer/students' : '/admin/students'}
            className="btn btn-secondary text-xs flex items-center gap-1.5 border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-50"
          >
            <UserPlus className="w-3.5 h-3.5 text-blue-600" />
            Single Student Entry
          </Link>
          <a
            href="/api/v1/students/template"
            download="Students.xlsx"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            Download Sample Template
          </a>
        </div>
      </div>

      {/* Progress Stage Tracker */}
      <div className="card p-3 bg-white border border-slate-200">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 overflow-x-auto pb-1">
          <div className={`flex items-center gap-1.5 ${stage === 'UPLOADING' ? 'text-blue-600 font-bold' : ''}`}>
            <Upload className="w-3.5 h-3.5" />
            <span>1. Uploading</span>
          </div>
          <span>&rarr;</span>
          <div className={`flex items-center gap-1.5 ${stage === 'PARSING' ? 'text-blue-600 font-bold' : ''}`}>
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>2. Parsing</span>
          </div>
          <span>&rarr;</span>
          <div className={`flex items-center gap-1.5 ${stage === 'VALIDATING' ? 'text-blue-600 font-bold' : ''}`}>
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>3. Validating</span>
          </div>
          <span>&rarr;</span>
          <div className={`flex items-center gap-1.5 ${stage === 'IMPORTING' ? 'text-blue-600 font-bold' : ''}`}>
            <Database className="w-3.5 h-3.5" />
            <span>4. Importing</span>
          </div>
          <span>&rarr;</span>
          <div
            className={`flex items-center gap-1.5 ${
              stage === 'COMPLETED' ? 'text-emerald-600 font-bold' : stage === 'FAILED' ? 'text-rose-600 font-bold' : ''
            }`}
          >
            {stage === 'FAILED' ? (
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            <span>5. {stage === 'FAILED' ? 'Failed' : 'Completed'}</span>
          </div>
        </div>
      </div>

      <div className="card card-pad max-w-2xl">
        {error && (
          <ErrorAlert
            error={error}
            onDismiss={() => { setError(null); handleReset(); }}
            actionButton={{
              label: 'Retry Upload',
              onClick: handleReset
            }}
            className="mb-4"
            title="Import Validation Error"
          />
        )}

        {/* Stage: IDLE / Dropzone Upload */}
        {stage === 'IDLE' && (
          <div>
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileChange}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="dropzone block cursor-pointer">
              <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <div className="font-bold text-sm text-slate-900 mb-1">Drag a file here, or click to browse</div>
              <div className="caption-text">CSV or XLSX · USN, Name, Department, Batch columns required</div>
            </label>
          </div>
        )}

        {/* Stages: UPLOADING, PARSING, VALIDATING */}
        {(stage === 'UPLOADING' || stage === 'PARSING' || stage === 'VALIDATING') && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
                <div>
                  <div className="font-bold text-xs text-slate-900">{file?.name}</div>
                  <div className="caption-text">{progressStatusText}</div>
                </div>
              </div>
              <span className="mono-text font-black text-sm text-blue-600">{progressPercent}%</span>
            </div>

            {/* Dynamic 0-100% Progress Bar Container */}
            <div className="h-3.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-200 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Stage: PREVIEW */}
        {stage === 'PREVIEW' && preview && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span>
                {preview.validRecords} records ready to import · {preview.invalidRecords} need attention
              </span>
            </div>

            <div className="hairline"></div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="caption-text text-slate-500">Total Rows</div>
                <div className="mono-text font-bold text-base text-slate-900">
                  {preview.totalRows || preview.totalRecords}
                </div>
              </div>
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <div className="caption-text text-emerald-700">Valid Records</div>
                <div className="mono-text font-bold text-base text-emerald-700">{preview.validRecords}</div>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="caption-text text-amber-700">Duplicates</div>
                <div className="mono-text font-bold text-base text-amber-700">{preview.duplicateRecords}</div>
              </div>
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl">
                <div className="caption-text text-rose-700">Errors</div>
                <div className="mono-text font-bold text-base text-rose-700">{preview.invalidRecords}</div>
              </div>
            </div>

            {/* Department Separation Breakdown */}
            <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-blue-950">
                  <Building2 className="w-4 h-4 text-blue-600" />
                  <span>Roster Separated by Department ({preview.departmentBreakdown?.length || 0} Academic Branches)</span>
                </div>
                <span className="text-[10px] text-blue-700 font-bold uppercase tracking-wider bg-blue-100/70 px-2 py-0.5 rounded-full">
                  Auto Clearance Desk Routing
                </span>
              </div>
              <p className="text-[11px] text-blue-900/80 leading-relaxed">
                When imported, these students will be automatically partitioned by their academic branch across all clearance sections (Library, Laboratory, Hostel, Sports, Fee Section, and Academic HOD desks).
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {(preview.departmentBreakdown || []).map((dept: any) => (
                  <div key={dept.code} className="p-2.5 bg-white border border-blue-100 rounded-lg flex items-center justify-between shadow-2xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase bg-blue-100 text-blue-800 shrink-0">
                        {dept.code}
                      </span>
                      <span className="text-xs font-semibold text-slate-800 truncate" title={dept.name}>
                        {dept.name}
                      </span>
                    </div>
                    <span className="text-xs font-bold mono-text text-blue-700 shrink-0 ml-2">
                      {dept.validCount} {dept.validCount === 1 ? 'student' : 'students'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Duplicate Strategy */}
            <div>
              <label className="field-label">Duplicate USN Strategy</label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label
                  className={`p-3 rounded-xl border cursor-pointer font-medium transition-all ${
                    duplicateAction === 'SKIP' ? 'bg-blue-50 border-blue-600 font-bold' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="strategy"
                    checked={duplicateAction === 'SKIP'}
                    onChange={() => setDuplicateAction('SKIP')}
                    className="mr-2"
                  />
                  Skip Existing
                </label>

                <label
                  className={`p-3 rounded-xl border cursor-pointer font-medium transition-all ${
                    duplicateAction === 'UPDATE' ? 'bg-blue-50 border-blue-600 font-bold' : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <input
                    type="radio"
                    name="strategy"
                    checked={duplicateAction === 'UPDATE'}
                    onChange={() => setDuplicateAction('UPDATE')}
                    className="mr-2"
                  />
                  Update Existing
                </label>
              </div>
            </div>

            {/* Invalid Rows Accordion / Table */}
            {invalidPreviewRows.length > 0 && (
              <div className="border border-rose-200 rounded-xl overflow-hidden bg-rose-50/50">
                <button
                  type="button"
                  onClick={() => setShowErrorTable(!showErrorTable)}
                  className="w-full flex items-center justify-between p-3 text-xs font-semibold text-rose-800 hover:bg-rose-100/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    <span>View {invalidPreviewRows.length} Rows With Errors</span>
                  </div>
                  {showErrorTable ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>

                {showErrorTable && (
                  <div className="max-h-48 overflow-y-auto border-t border-rose-200 bg-white">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="p-2">Row</th>
                          <th className="p-2">USN</th>
                          <th className="p-2">Name</th>
                          <th className="p-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {invalidPreviewRows.slice(0, 50).map((r: any, idx: number) => (
                          <tr key={idx} className="hover:bg-rose-50/30">
                            <td className="p-2 mono-text font-bold text-slate-700">{r.rowNumber}</td>
                            <td className="p-2 mono-text font-semibold text-slate-800">{r.usn || 'N/A'}</td>
                            <td className="p-2 text-slate-800">{r.fullName || 'N/A'}</td>
                            <td className="p-2 text-rose-600">{r.errors?.join('; ') || 'Validation error'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={handleConfirmImport}
                disabled={preview.validRecords === 0}
                className="btn btn-primary"
              >
                Confirm Bulk Import
              </button>
              <button onClick={handleReset} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Stage: IMPORTING */}
        {stage === 'IMPORTING' && (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
                <div>
                  <div className="font-bold text-xs text-slate-900">Synchronizing with Database</div>
                  <div className="caption-text">{progressStatusText}</div>
                </div>
              </div>
              <span className="mono-text font-black text-sm text-blue-600">{progressPercent}%</span>
            </div>

            <div className="h-3.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-150 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Stage: COMPLETED */}
        {stage === 'COMPLETED' && importResult && (
          <div className="text-center space-y-4 py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="h2-title">
              {importResult.imported + importResult.updated} Records Synchronized (100% Complete)
            </h3>
            <p className="caption-text max-w-xs mx-auto">
              Student records and departmental clearance requests have been created and are immediately active.
            </p>

            <div className="grid grid-cols-4 gap-2 text-center text-xs py-2">
              <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-slate-500">Total</div>
                <div className="mono-text font-bold text-slate-800">{importResult.totalRows}</div>
              </div>
              <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div className="text-emerald-700">Created</div>
                <div className="mono-text font-bold text-emerald-700">{importResult.imported}</div>
              </div>
              <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="text-blue-700">Updated</div>
                <div className="mono-text font-bold text-blue-700">{importResult.updated}</div>
              </div>
              <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-amber-700">Skipped</div>
                <div className="mono-text font-bold text-amber-700">{importResult.skipped}</div>
              </div>
            </div>

            {/* Department Import Distribution */}
            {importResult.departmentSummary && importResult.departmentSummary.length > 0 && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-left space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <Building2 className="w-4 h-4 text-blue-600" />
                    <span>Department Distribution Across Clearance Sections</span>
                  </div>
                  <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    Provisioned
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {importResult.departmentSummary.map((dept: any) => (
                    <div key={dept.code} className="p-2 bg-white border border-slate-200/80 rounded-lg flex items-center justify-between shadow-2xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 font-bold rounded text-[10px] border border-blue-100">
                          {dept.code}
                        </span>
                        <span className="truncate text-slate-700 font-medium text-xs" title={dept.name}>
                          {dept.name}
                        </span>
                      </div>
                      <span className="font-bold mono-text text-emerald-700 ml-2 shrink-0 text-xs">
                        +{dept.imported} new ({dept.total} total)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {importResult.errorReport && importResult.errorReport.length > 0 && (
              <button
                onClick={handleDownloadErrorReport}
                className="btn btn-secondary text-xs text-rose-600 border-rose-200"
              >
                <Download className="w-3.5 h-3.5" />
                Download Error Report XLSX ({importResult.errorReport.length} Rows)
              </button>
            )}

            <div>
              <button onClick={handleReset} className="btn btn-secondary text-xs mt-2">
                <RefreshCw className="w-3.5 h-3.5" />
                Import Another File
              </button>
            </div>
          </div>
        )}

        {/* Stage: FAILED */}
        {stage === 'FAILED' && !error && (
          <div className="text-center space-y-3 py-4">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h3 className="h2-title text-rose-600">Import Operation Failed</h3>
            <p className="caption-text max-w-xs mx-auto">
              The file could not be processed. Please check the file formatting and try again.
            </p>
            <button onClick={handleReset} className="btn btn-secondary text-xs">
              <RefreshCw className="w-3.5 h-3.5" />
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
