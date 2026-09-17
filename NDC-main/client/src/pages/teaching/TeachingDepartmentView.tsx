import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import {
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Award,
  Search,
  Download,
  Eye,
  X
} from 'lucide-react';

export const TeachingDepartmentView: React.FC = () => {
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  const [dueDeptFilter, setDueDeptFilter] = useState('');

  // Pagination state
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });

  // Drawer States
  const [selectedStudentDues, setSelectedStudentDues] = useState<any>(null);
  const [duesLoading, setDuesLoading] = useState(false);

  const [selectedStudentDetail, setSelectedStudentDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchDashboard();
  }, []);

  useEffect(() => {
    fetchStudents(1);
  }, [activeTab, search, batchFilter, dueDeptFilter]);

  const fetchDashboard = async () => {
    try {
      const res = await api.get('/teaching-department/dashboard');
      setDashboardData(res.data.data);
    } catch (err) {
      console.error('Error fetching teaching department dashboard:', err);
    }
  };

  const fetchStudents = async (page = 1) => {
    setLoading(true);
    try {
      const res = await api.get('/teaching-department/students', {
        params: {
          page,
          limit: 20,
          status: activeTab === 'ALL' ? '' : activeTab,
          search,
          batch: batchFilter,
          dueDepartment: dueDeptFilter
        }
      });
      setStudents(res.data.data);
      setPagination(res.data.pagination);
    } catch (err) {
      console.error('Error fetching teaching department students:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDuesModal = async (student: any) => {
    setDuesLoading(true);
    try {
      const res = await api.get(`/teaching-department/students/${student._id}/dues`);
      setSelectedStudentDues(res.data);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to load student dues.');
    } finally {
      setDuesLoading(false);
    }
  };

  const handleOpenDetailModal = async (student: any) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/teaching-department/students/${student._id}`);
      setSelectedStudentDetail(res.data.data);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to load student details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDownloadCertificate = (certId: string, certNo: string) => {
    if (!certId) return;
    const token = localStorage.getItem('ndc_token') || '';
    const downloadUrl = `${api.defaults.baseURL}/teaching-department/certificates/${certId}/download?token=${token}`;
    window.open(downloadUrl, '_blank');
  };

  const { department, statistics } = dashboardData || {};

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="section-head">
        <div>
          <h1 className="page-title">{department ? `${department.name} — Dashboard` : 'Teaching Department Dashboard'}</h1>
          <p className="caption-text mt-1">Teaching department view for academic branch clearance monitoring & certificate download</p>
        </div>
      </div>

      {/* 5 Fraunces Display Stat Cards in Single Line */}
      <div className="stat-row-5">
        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--cobalt-50)', color: 'var(--cobalt-600)' }}>
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg">{statistics?.totalStudents || 0}</div>
          <div className="caption-text mt-1">Students in dept.</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--success-50)', color: 'var(--success-600)' }}>
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-emerald-600">{statistics?.approved || 0}</div>
          <div className="caption-text mt-1">Approved</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--warning-50)', color: 'var(--warning-600)' }}>
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-amber-600">{statistics?.pending || 0}</div>
          <div className="caption-text mt-1">Pending</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--danger-50)', color: 'var(--danger-600)' }}>
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-rose-600">{statistics?.due || 0}</div>
          <div className="caption-text mt-1">Due</div>
        </div>

        <div className="stat-card">
          <div className="stat-top">
            <div className="stat-icon" style={{ background: 'var(--gold-50)', color: 'var(--gold-600)' }}>
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="display-lg text-amber-700">{statistics?.certificatesAvailable || 0}</div>
          <div className="caption-text mt-1">Certificates ready</div>
        </div>
      </div>

      {/* Table Container with Pill Filters */}
      <div className="table-wrap">
        <div className="filter-bar">
          {[
            { id: 'ALL', label: 'All', count: statistics?.totalStudents || 0 },
            { id: 'APPROVED', label: 'Approved', count: statistics?.approved || 0 },
            { id: 'PENDING', label: 'Pending', count: statistics?.pending || 0 },
            { id: 'WITH_DUES', label: 'Due', count: statistics?.due || 0 },
            { id: 'CERTIFICATES_AVAILABLE', label: 'Certificates ready', count: statistics?.certificatesAvailable || 0 }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pill-filter ${activeTab === tab.id ? 'active' : ''}`}
            >
              {tab.label} <span className="count">{tab.count}</span>
            </button>
          ))}

          <div className="filter-spacer"></div>

          <div className="relative max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search USN or student name…"
              className="input pl-9 text-xs"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 font-semibold">Loading student records...</div>
        ) : students.length === 0 ? (
          <div className="p-12 text-center text-slate-500 font-semibold">No student records found matching current criteria.</div>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>USN</th>
                  <th>Batch</th>
                  <th>Clearance</th>
                  <th>Status</th>
                  <th>Due Details</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => {
                  const initials = student.fullName.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();
                  const isDue = student.ndcStatus === 'DUE' || student.duesCount > 0;
                  return (
                    <tr key={student._id} className={isDue ? 'due-row-accent' : ''}>
                      <td>
                        <div className="name-cell">
                          <div className="avatar-sm">{initials}</div>
                          <span className="cell-primary">{student.fullName}</span>
                        </div>
                      </td>
                      <td className="mono-text font-bold text-blue-700">{student.usn}</td>
                      <td>{student.batch}</td>
                      <td>
                        <div className="progress-frac">{student.progress.cleared} / {student.progress.total}</div>
                        <div className="seg-bar">
                          {Array.from({ length: student.progress.total || 6 }).map((_, i) => (
                            <div
                              key={i}
                              className={`seg ${i < student.progress.cleared ? 'done' : 'pend'}`}
                            />
                          ))}
                        </div>
                      </td>
                      <td>
                        <ClearanceStatusBadge status={student.ndcStatus} />
                      </td>
                      <td className="max-w-xs">
                        {isDue ? (
                          <div>
                            <span className="font-bold text-rose-700 block">{student.dueDepartment}</span>
                            {student.dueAmount > 0 && <span className="mono-text font-bold text-rose-800">₹{student.dueAmount.toLocaleString()}</span>}
                          </div>
                        ) : (
                          <span className="caption-text">-</span>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleOpenDetailModal(student)}
                            className="btn-icon"
                            title="View Student Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {isDue && (
                            <button
                              onClick={() => handleOpenDuesModal(student)}
                              className="btn btn-secondary btn-compact text-rose-700 border-rose-200"
                            >
                              View Dues
                            </button>
                          )}

                          {student.ndcStatus === 'APPROVED' && student.certificateId ? (
                            <button
                              onClick={() => handleDownloadCertificate(student.certificateId, student.certificateNumber)}
                              className="btn btn-primary btn-compact"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Certificate
                            </button>
                          ) : !isDue && (
                            <span className="caption-text">Pending</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Itemized Student Dues Slide-out Drawer */}
      {selectedStudentDues && (
        <>
          <div className="drawer-scrim" onClick={() => setSelectedStudentDues(null)} />
          <div className="drawer-panel">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="h2-title">Due Details</h3>
                <p className="mono-text caption-text text-blue-600">
                  {selectedStudentDues.student?.fullName} · {selectedStudentDues.student?.usn}
                </p>
              </div>
              <button onClick={() => setSelectedStudentDues(null)} className="btn-icon">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3 overflow-y-auto flex-1 text-xs">
              {duesLoading ? (
                <div className="p-8 text-center text-slate-500 font-semibold">Loading due details...</div>
              ) : selectedStudentDues.dues?.length === 0 ? (
                <div className="p-4 bg-emerald-50 text-emerald-800 rounded-xl font-bold text-center">
                  No active outstanding dues recorded for this student.
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedStudentDues.dues.map((dueItem: any) => (
                    <div key={dueItem.clearanceId} className="card card-pad bg-rose-50/50 border-rose-200 space-y-1">
                      <div className="kv-row border-none font-bold">
                        <span>{dueItem.departmentName}</span>
                        <span className="mono-text text-rose-700 font-bold">₹{dueItem.dueAmount?.toLocaleString()}</span>
                      </div>
                      <p className="caption-text text-slate-400">Reported by {dueItem.reportedBy} · {new Date(dueItem.reportedAt).toLocaleDateString()}</p>
                    </div>
                  ))}

                  <div className="kv-row font-bold text-sm pt-3 border-t border-slate-200">
                    <span>Total Outstanding</span>
                    <span className="mono-text text-rose-600 font-extrabold">₹{(selectedStudentDues.totalDueAmount || 0).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100">
              <button onClick={() => setSelectedStudentDues(null)} className="btn btn-secondary w-full justify-center">
                Close Drawer
              </button>
            </div>
          </div>
        </>
      )}

      {/* Student Details Slide-out Drawer */}
      {selectedStudentDetail && (
        <>
          <div className="drawer-scrim" onClick={() => setSelectedStudentDetail(null)} />
          <div className="drawer-panel">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h3 className="h2-title">{selectedStudentDetail.student?.fullName}</h3>
                <p className="mono-text caption-text text-blue-600">
                  {selectedStudentDetail.student?.usn} · {selectedStudentDetail.student?.departmentId?.name}
                </p>
              </div>
              <button onClick={() => setSelectedStudentDetail(null)} className="btn-icon">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
              <div className="h3-title">Clearance Timeline</div>
              <div className="space-y-1">
                {selectedStudentDetail.clearances?.map((task: any) => (
                  <div key={task._id} className="kv-row">
                    <span>{task.departmentId?.name}</span>
                    <ClearanceStatusBadge status={task.status} />
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-slate-100">
              <button onClick={() => setSelectedStudentDetail(null)} className="btn btn-secondary w-full justify-center">
                Close Drawer
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
