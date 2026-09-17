import React, { useEffect, useState } from 'react';
import api from '../../services/api';
import { ClearanceStatusBadge } from '../../components/ClearanceStatusBadge';
import { CertificatePreviewModal } from '../../components/CertificatePreviewModal';
import { Award, Download, Calendar, ShieldCheck, Eye } from 'lucide-react';

export const StudentCertificates: React.FC = () => {
  const [certificates, setCertificates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewCert, setPreviewCert] = useState<any>(null);

  useEffect(() => {
    fetchCertificates();
  }, []);

  const fetchCertificates = async () => {
    try {
      const response = await api.get('/certificates/student');
      setCertificates(response.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500 font-semibold">Loading certificates history...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-slate-900">Certificate History</h2>
        <p className="text-xs text-slate-500">Official No Due Certificates generated for your account</p>
      </div>

      {certificates.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center shadow-sm space-y-3">
          <Award className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-700">No Issued Certificates Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Once all required institutional departments approve your clearance request, your official certificate will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-4">Certificate Number</th>
                  <th className="p-4">Issued Date</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {certificates.map((cert) => (
                  <tr key={cert._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-4 font-mono font-bold text-slate-900 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-blue-600" />
                      {cert.certificateNumber}
                    </td>
                    <td className="p-4 font-medium text-slate-600">
                      {new Date(cert.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </td>
                    <td className="p-4">
                      <ClearanceStatusBadge status={cert.status} />
                    </td>
                    <td className="p-4 text-right">
                      {cert.status === 'VALID' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setPreviewCert(cert)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 font-semibold rounded-lg text-xs transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            View
                          </button>
                          <a
                            href={`/api/v1/certificates/${cert._id}/download?token=${localStorage.getItem('ndc_token') || ''}`}
                            download={`NDC_${cert.certificateNumber}.pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download PDF
                          </a>
                        </div>
                      ) : (
                        <span className="text-xs text-rose-600 font-bold italic">Certificate Revoked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {previewCert && (
        <CertificatePreviewModal certificate={previewCert} onClose={() => setPreviewCert(null)} />
      )}
    </div>
  );
};
