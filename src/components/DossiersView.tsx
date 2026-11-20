import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  ExternalLink,
  Eye,
  FileDown,
  FileText,
  FolderOpen,
  Link2,
  Printer,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { localApi } from '../lib/api';
import { exportStudentDossierDocx } from '../lib/docxExport';
import { formatBytes, processDossierFile } from '../lib/fileUtils';
import type {
  AttendanceDay,
  Classroom,
  FileCategory,
  Incident,
  LocalDatabase,
  Student,
  StudentFile,
} from '../types';

interface DossiersViewProps {
  classroom: Classroom;
  students: Student[];
  files: StudentFile[];
  incidents: Incident[];
  attendanceDays: AttendanceDay[];
  selectedStudentId: string;
  onSelectStudent: (studentId: string) => void;
  onDbUpdate: (db: LocalDatabase) => void;
}

const FILE_CATEGORIES: Array<{ value: FileCategory; label: string }> = [
  { value: 'acta', label: 'Acta de nacimiento' },
  { value: 'curp', label: 'CURP' },
  { value: 'boleta', label: 'Boleta anterior' },
  { value: 'medica', label: 'Ficha médica / Cartilla' },
  { value: 'evidencia', label: 'Evidencia de trabajo' },
  { value: 'otro', label: 'Otro documento' },
];

export function DossiersView({
  classroom,
  students,
  files,
  incidents,
  attendanceDays,
  selectedStudentId,
  onSelectStudent,
  onDbUpdate,
}: DossiersViewProps) {
  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.listNumber - b.listNumber),
    [students]
  );

  const activeStudent =
    sortedStudents.find((s) => s.id === selectedStudentId) || sortedStudents[0];

  const [formState, setFormState] = useState({
    fullName: '',
    listNumber: 1,
    curp: '',
    birthDate: '',
    guardianName: '',
    guardianPhone: '',
    guardianEmail: '',
    medicalNotes: '',
    pedagogicalNotes: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');

  const [uploadMode, setUploadMode] = useState<'file' | 'link'>('file');
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState<FileCategory>('acta');
  const [docNotes, setDocNotes] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [previewFile, setPreviewFile] = useState<StudentFile | null>(null);

  useEffect(() => {
    if (activeStudent) {
      setFormState({
        fullName: activeStudent.fullName,
        listNumber: activeStudent.listNumber,
        curp: activeStudent.curp || '',
        birthDate: activeStudent.birthDate || '',
        guardianName: activeStudent.guardianName || '',
        guardianPhone: activeStudent.guardianPhone || '',
        guardianEmail: activeStudent.guardianEmail || '',
        medicalNotes: activeStudent.medicalNotes || '',
        pedagogicalNotes: activeStudent.pedagogicalNotes || '',
      });
      setSavedNotice('');
    }
  }, [activeStudent?.id]);

  const studentFiles = useMemo(
    () =>
      activeStudent ? files.filter((f) => f.studentId === activeStudent.id) : [],
    [files, activeStudent]
  );

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStudent) return;
    setSavingProfile(true);
    setSavedNotice('');
    try {
      const { db } = await localApi.updateStudent(activeStudent.id, {
        fullName: formState.fullName.trim(),
        listNumber: Math.max(1, Math.round(Number(formState.listNumber) || 1)),
        curp: formState.curp.trim(),
        birthDate: formState.birthDate.trim(),
        guardianName: formState.guardianName.trim(),
        guardianPhone: formState.guardianPhone.trim(),
        guardianEmail: formState.guardianEmail.trim(),
        medicalNotes: formState.medicalNotes.trim(),
        pedagogicalNotes: formState.pedagogicalNotes.trim(),
      });
      onDbUpdate(db);
      setSavedNotice('Expediente actualizado y guardado localmente.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStudent) return;
    setUploadError('');
    setUploading(true);
    try {
      if (uploadMode === 'file') {
        if (!selectedFile) {
          setUploadError('Selecciona un archivo PDF o imagen primero.');
          setUploading(false);
          return;
        }
        const processed = await processDossierFile(selectedFile);
        const { db } = await localApi.createStudentFile({
          classroomId: classroom.id,
          studentId: activeStudent.id,
          title: docTitle.trim() || processed.fileName,
          category: docCategory,
          fileName: processed.fileName,
          mimeType: processed.mimeType,
          sizeBytes: Math.round(processed.sizeBytes),
          storageMode: 'inline',
          dataUrl: processed.dataUrl,
          externalUrl: '',
          notes: docNotes.trim(),
        });
        onDbUpdate(db);
      } else {
        if (!externalUrl.trim()) {
          setUploadError('Ingresa el enlace o ruta al documento.');
          setUploading(false);
          return;
        }
        const { db } = await localApi.createStudentFile({
          classroomId: classroom.id,
          studentId: activeStudent.id,
          title: docTitle.trim() || 'Documento enlazado',
          category: docCategory,
          fileName: docTitle.trim() || 'Enlace externo',
          mimeType: 'text/uri-list',
          sizeBytes: 0,
          storageMode: 'link',
          dataUrl: '',
          externalUrl: externalUrl.trim(),
          notes: docNotes.trim(),
        });
        onDbUpdate(db);
      }
      setDocTitle('');
      setDocNotes('');
      setExternalUrl('');
      setSelectedFile(null);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : 'No se pudo adjuntar el documento.'
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (file: StudentFile) => {
    const { db } = await localApi.deleteStudentFile(file.id);
    onDbUpdate(db);
  };

  if (sortedStudents.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
        <FolderOpen className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <h2 className="font-display text-lg font-semibold text-slate-900">
          Sin estudiantes en el grupo
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Agrega alumnos en la sección Lista y Asistencia para gestionar sus expedientes digitales.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">
            Grupo {classroom.name} · Resguardo documental local y ficha individual
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight">
            Expediente digital del alumno
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeStudent && (
            <button
              type="button"
              onClick={() =>
                exportStudentDossierDocx(
                  classroom,
                  activeStudent,
                  files,
                  incidents,
                  attendanceDays
                )
              }
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
            >
              <FileDown className="w-4 h-4 text-blue-700" />
              Exportar expediente (.docx)
            </button>
          )}
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            Imprimir ficha
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="no-print lg:col-span-4 bg-white border border-slate-200 rounded-xl p-4 h-fit">
          <p className="text-xs font-semibold text-slate-700 mb-3">
            Seleccionar estudiante ({sortedStudents.length})
          </p>
          <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
            {sortedStudents.map((st) => {
              const docCount = files.filter((f) => f.studentId === st.id).length;
              const isSelected = activeStudent?.id === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => onSelectStudent(st.id)}
                  className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 rounded-lg transition-colors ${
                    isSelected ? 'bg-blue-50 text-blue-900' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      <span className="font-mono text-xs text-slate-400 mr-2 tabular-nums">
                        {String(st.listNumber).padStart(2, '0')}
                      </span>
                      {st.fullName}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {st.guardianName || 'Sin tutor asignado'}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-slate-500 shrink-0 tabular-nums">
                    {docCount} arch.
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {activeStudent && (
          <div className="lg:col-span-8 space-y-6 print-container">
            <div className="hidden print-only border-b-2 border-slate-900 pb-3 mb-4">
              <p className="text-xs text-slate-600">{classroom.schoolName || 'Escuela Primaria'}</p>
              <h1 className="font-display text-xl font-bold text-slate-900">
                Expediente Escolar Individual — {activeStudent.fullName}
              </h1>
              <p className="text-xs text-slate-700 mt-1">
                Grupo: {classroom.name} · No. Lista: {activeStudent.listNumber} · Ciclo: {classroom.cycle}
              </p>
            </div>

            <form
              onSubmit={handleSaveProfile}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    Datos generales y médicos
                  </h2>
                  <p className="text-xs text-slate-500">
                    No. Lista {activeStudent.listNumber} · Información de contacto y seguimiento
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={savingProfile}
                  className="no-print inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
                >
                  <Save className="w-3.5 h-3.5" />
                  {savingProfile ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>

              {savedNotice && (
                <p className="no-print text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  {savedNotice}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
                <div className="sm:col-span-4">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nombre completo
                  </label>
                  <input
                    type="text"
                    required
                    value={formState.fullName}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, fullName: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Fecha nacimiento
                  </label>
                  <input
                    type="date"
                    value={formState.birthDate}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, birthDate: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    CURP / Matrícula
                  </label>
                  <input
                    type="text"
                    value={formState.curp}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, curp: e.target.value.toUpperCase() }))
                    }
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Padre, madre o tutor
                  </label>
                  <input
                    type="text"
                    value={formState.guardianName}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, guardianName: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Teléfono de emergencia
                  </label>
                  <input
                    type="text"
                    value={formState.guardianPhone}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, guardianPhone: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Correo del tutor
                  </label>
                  <input
                    type="email"
                    value={formState.guardianEmail}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, guardianEmail: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-6">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Alergias, condiciones médicas o cuidados especiales
                  </label>
                  <textarea
                    rows={2}
                    value={formState.medicalNotes}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, medicalNotes: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-6">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Observaciones pedagógicas y estilos de aprendizaje
                  </label>
                  <textarea
                    rows={2}
                    value={formState.pedagogicalNotes}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, pedagogicalNotes: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>
            </form>

            {/* Upload Card */}
            <div className="no-print bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    Subir documento al expediente
                  </h2>
                  <p className="text-xs text-slate-500">
                    Se guarda directamente en tu computadora (fotos, PDFs o enlaces)
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setUploadMode('file')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                      uploadMode === 'file' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Archivo / Foto
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadMode('link')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                      uploadMode === 'link' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Enlace externo
                  </button>
                </div>
              </div>

              <form onSubmit={handleUploadDocument} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Categoría del documento
                    </label>
                    <select
                      value={docCategory}
                      onChange={(e) => setDocCategory(e.target.value as FileCategory)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                    >
                      {FILE_CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Título descriptivo
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Acta de nacimiento escaneada"
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                  </div>
                </div>

                {uploadMode === 'file' ? (
                  <label className="block border border-dashed border-slate-300 rounded-lg p-5 text-center cursor-pointer hover:border-blue-400 hover:bg-slate-50">
                    <input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                    <Upload className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-slate-700">
                      {selectedFile
                        ? `${selectedFile.name} (${formatBytes(selectedFile.size)})`
                        : 'Haz clic para seleccionar imagen, PDF o documento'}
                    </p>
                  </label>
                ) : (
                  <div className="relative">
                    <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="url"
                      required
                      placeholder="https://..."
                      value={externalUrl}
                      onChange={(e) => setExternalUrl(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg"
                    />
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <input
                    type="text"
                    placeholder="Nota breve opcional"
                    value={docNotes}
                    onChange={(e) => setDocNotes(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                  <button
                    type="submit"
                    disabled={uploading}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {uploading ? 'Guardando...' : 'Agregar al expediente'}
                  </button>
                </div>

                {uploadError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {uploadError}
                  </p>
                )}
              </form>
            </div>

            {/* Files List */}
            <div className="bg-white border border-slate-200 rounded-xl p-6">
              <h2 className="font-display text-lg font-semibold text-slate-900 mb-3">
                Documentos archivados ({studentFiles.length})
              </h2>
              {studentFiles.length === 0 ? (
                <p className="text-sm text-slate-500 py-4 border-t border-slate-100">
                  No hay documentos digitales adjuntos todavía.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {studentFiles.map((file) => {
                    const catLabel =
                      FILE_CATEGORIES.find((c) => c.value === file.category)?.label ||
                      file.category;
                    return (
                      <div key={file.id} className="py-3.5 flex items-center justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <FileText className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 truncate">
                              {file.title}
                            </p>
                            <p className="text-xs text-slate-500">
                              <span>{catLabel}</span>
                              <span className="mx-1.5">·</span>
                              <span className="font-mono">
                                {file.storageMode === 'link'
                                  ? 'Enlace'
                                  : formatBytes(file.sizeBytes)}
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="no-print flex items-center gap-1.5 shrink-0">
                          {file.storageMode === 'inline' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setPreviewFile(file)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-md"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                Ver
                              </button>
                              <a
                                href={file.dataUrl}
                                download={file.fileName}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-md"
                              >
                                <Download className="w-3.5 h-3.5" />
                                Descargar
                              </a>
                            </>
                          ) : (
                            <a
                              href={file.externalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-md"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Abrir
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteFile(file)}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-md"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {previewFile && (
        <div className="no-print fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 truncate">
                {previewFile.title}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="p-1 text-slate-500 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto bg-slate-100 flex items-center justify-center">
              {previewFile.mimeType.startsWith('image/') ? (
                <img
                  src={previewFile.dataUrl}
                  alt={previewFile.title}
                  className="max-w-full max-h-[70vh] object-contain rounded-lg"
                />
              ) : previewFile.mimeType === 'application/pdf' ? (
                <iframe
                  src={previewFile.dataUrl}
                  title={previewFile.title}
                  className="w-full h-[70vh] rounded-lg bg-white"
                />
              ) : (
                <a
                  href={previewFile.dataUrl}
                  download={previewFile.fileName}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg"
                >
                  <Download className="w-4 h-4" />
                  Descargar archivo
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
