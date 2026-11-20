import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookMarked,
  BookOpenCheck,
  Calculator,
  ClipboardList,
  FolderOpen,
  FolderPlus,
  GraduationCap,
  Home,
  LayoutDashboard,
  Menu,
  NotebookPen,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { localApi, toValidPeriodId } from './lib/api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HomeView } from './components/HomeView';
import { OverviewView } from './components/OverviewView';
import { RosterAttendanceView } from './components/RosterAttendanceView';
import { DossiersView } from './components/DossiersView';
import { AssignmentsView } from './components/AssignmentsView';
import { LessonPlansView } from './components/LessonPlansView';
import { IncidentsAIView } from './components/IncidentsAIView';
import { DailyLogView } from './components/DailyLogView';
import { GradingView } from './components/GradingView';
import { SettingsView } from './components/SettingsView';
import type {
  AppSection,
  GradingPeriod,
  LocalDatabase,
} from './types';

interface NavItem {
  id: AppSection;
  label: string;
  icon: typeof LayoutDashboard;
}

const NAV_GROUPS: Array<{ title?: string; items: NavItem[] }> = [
  {
    items: [{ id: 'inicio', label: 'Inicio', icon: Home }],
  },
  {
    title: 'Jornada diaria',
    items: [
      { id: 'lista', label: 'Lista y asistencia', icon: ClipboardList },
      { id: 'planeaciones', label: 'Planeaciones', icon: BookMarked },
      { id: 'diario', label: 'Bitácora diaria', icon: NotebookPen },
      { id: 'bitacora', label: 'Conducta e IA', icon: AlertTriangle },
    ],
  },
  {
    title: 'Evaluación y alumnos',
    items: [
      { id: 'trabajos', label: 'Trabajos y tareas', icon: BookOpenCheck },
      { id: 'calificaciones', label: 'Calificaciones', icon: Calculator },
      { id: 'expedientes', label: 'Expediente digital', icon: FolderOpen },
      { id: 'resumen', label: 'Resumen del grupo', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Sistema',
    items: [{ id: 'configuracion', label: 'Configuración', icon: Settings }],
  },
];

const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

function ClassroomWorkspace() {
  const [db, setDb] = useState<LocalDatabase | null>(null);
  const [loadError, setLoadError] = useState('');
  const [activeClassroomId, setActiveClassroomId] = useState<string>('');
  const [section, setSection] = useState<AppSection>('inicio');
  const [selectedDossierStudentId, setSelectedDossierStudentId] = useState<string>('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);

  // First-launch onboarding state when 0 classrooms exist locally
  const [onboardingName, setOnboardingName] = useState('4° A');
  const [onboardingSchool, setOnboardingSchool] = useState('Escuela Primaria');
  const [onboardingTeacher, setOnboardingTeacher] = useState('Docente Titular');
  const [onboardingCycle, setOnboardingCycle] = useState('2026-2027');
  const [onboardingBusy, setOnboardingBusy] = useState(false);

  const loadLocalDb = async () => {
    setLoadError('');
    try {
      const data = await localApi.getData();
      setDb(data);
      setActiveClassroomId((prev) => {
        if (prev && data.classrooms.some((c) => c.id === prev)) return prev;
        return data.classrooms[0]?.id || '';
      });
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'No se pudo conectar con la base de datos local.'
      );
    }
  };

  useEffect(() => {
    loadLocalDb();
    localApi
      .getKeyStatus()
      .then((s) => setLastBackupAt(s.lastBackupAt))
      .catch(() => {});
  }, []);

  // Keep activeClassroomId valid if classrooms change (e.g. import/delete)
  useEffect(() => {
    if (!db) return;
    if (
      activeClassroomId &&
      db.classrooms.some((c) => c.id === activeClassroomId)
    ) {
      return;
    }
    setActiveClassroomId(db.classrooms[0]?.id || '');
  }, [db, activeClassroomId]);

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center space-y-4">
          <GraduationCap className="w-8 h-8 text-blue-700 mx-auto" />
          <div className="space-y-1">
            <h1 className="font-display text-lg font-bold text-slate-900">
              Error al iniciar AulaÁgil
            </h1>
            <p className="text-sm text-red-700">{loadError}</p>
          </div>
          <button
            type="button"
            onClick={loadLocalDb}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg"
          >
            Reintentar conexión local
          </button>
        </div>
      </div>
    );
  }

  if (!db) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-2">
          <GraduationCap className="w-8 h-8 text-blue-700 mx-auto" />
          <p className="text-sm text-slate-600">Cargando AulaÁgil local...</p>
        </div>
      </div>
    );
  }

  // Direct First-Time Setup (no cloud login required)
  if (db.classrooms.length === 0) {
    const handleCreateFirst = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!onboardingName.trim()) return;
      setOnboardingBusy(true);
      try {
        const res = await localApi.createClassroom({
          name: onboardingName.trim(),
          schoolName: onboardingSchool.trim() || 'Escuela Primaria',
          teacherName: onboardingTeacher.trim() || 'Docente Titular',
          cycle: onboardingCycle.trim() || '2026-2027',
          activePeriod: 'Trimestre 1',
        });
        setDb(res.db);
        setActiveClassroomId(res.classroomId);
      } finally {
        setOnboardingBusy(false);
      }
    };

    const handleLoadSample = async () => {
      setOnboardingBusy(true);
      try {
        const res = await localApi.seedSampleClassroom(
          onboardingTeacher.trim() || 'Mtra. Laura Hernández'
        );
        setDb(res.db);
        setActiveClassroomId(res.classroomId);
      } finally {
        setOnboardingBusy(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="w-6 h-6 text-blue-700" />
            <span className="font-display text-lg font-bold text-slate-900">
              AulaÁgil
            </span>
          </div>
          <span className="text-xs font-medium text-slate-500">
            Almacenamiento 100% local
          </span>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-xl w-full bg-white border border-slate-200 rounded-xl p-8 space-y-6">
            <div>
              <p className="text-xs font-medium text-blue-700 mb-1">
                Gestión Docente de Primaria
              </p>
              <h1 className="font-display text-2xl font-bold text-slate-900">
                Configura tu primer grupo de primaria
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Todos tus alumnos, asistencias, bitácoras y calificaciones se guardan localmente en esta computadora. Crea un grupo en blanco o carga uno de ejemplo.
              </p>
            </div>

            <form onSubmit={handleCreateFirst} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Grado y grupo
                  </label>
                  <input
                    type="text"
                    required
                    value={onboardingName}
                    onChange={(e) => setOnboardingName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Ciclo escolar
                  </label>
                  <input
                    type="text"
                    required
                    value={onboardingCycle}
                    onChange={(e) => setOnboardingCycle(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nombre de la escuela
                  </label>
                  <input
                    type="text"
                    value={onboardingSchool}
                    onChange={(e) => setOnboardingSchool(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nombre del docente
                  </label>
                  <input
                    type="text"
                    value={onboardingTeacher}
                    onChange={(e) => setOnboardingTeacher(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={onboardingBusy}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg"
                >
                  <FolderPlus className="w-4 h-4" />
                  {onboardingBusy ? 'Creando...' : 'Crear mi grupo'}
                </button>
                <button
                  type="button"
                  disabled={onboardingBusy}
                  onClick={handleLoadSample}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 rounded-lg"
                >
                  <Sparkles className="w-4 h-4" />
                  Cargar grupo de ejemplo (4° A)
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    );
  }

  const activeClassroom =
    db.classrooms.find((c) => c.id === activeClassroomId) || db.classrooms[0];

  const students = db.students.filter((s) => s.classroomId === activeClassroom.id);
  const files = db.studentFiles.filter((f) => f.classroomId === activeClassroom.id);
  const attendanceDays = db.attendance.filter(
    (a) => a.classroomId === activeClassroom.id
  );
  const assignments = db.assignments.filter(
    (a) => a.classroomId === activeClassroom.id
  );
  const incidents = db.incidents.filter((i) => i.classroomId === activeClassroom.id);
  const gradingPeriods = db.gradingPeriods.filter(
    (p) => p.classroomId === activeClassroom.id
  );
  const grades = db.studentGrades.filter((g) => g.classroomId === activeClassroom.id);
  const dailyLogs = db.dailyLogs.filter((l) => l.classroomId === activeClassroom.id);
  const lessonPlans = (db.lessonPlans ?? []).filter(
    (p) => p.classroomId === activeClassroom.id
  );

  const activePeriodName = activeClassroom.activePeriod || 'Trimestre 1';
  const activePeriodId = `${activeClassroom.id}_${toValidPeriodId(activePeriodName)}`;
  const activeGradingPeriod: GradingPeriod = gradingPeriods.find(
    (p) => p.periodName === activePeriodName || p.id === activePeriodId
  ) || {
    id: activePeriodId,
    classroomId: activeClassroom.id,
    periodName: activePeriodName,
    trabajosWeight: 40,
    tareasWeight: 20,
    examenWeight: 10,
    asistenciaWeight: 10,
    conductaWeight: 20,
    examTotalQuestions: 25,
    useActivityExamAverage: true,
    scaleMax: 10,
    updatedAt: '',
  };

  const handleOpenDossier = (studentId: string) => {
    setSelectedDossierStudentId(studentId);
    setSection('expedientes');
  };

  const handleSelectSection = (next: AppSection) => {
    setSection(next);
    setMobileNavOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-2.5">
          <GraduationCap className="w-6 h-6 text-blue-700 shrink-0" />
          <span className="font-display text-base font-bold text-slate-900 whitespace-nowrap">
            AulaÁgil
          </span>
        </div>

        <div className="p-4 border-b border-slate-100">
          <label className="block text-[11px] font-medium text-slate-500 mb-1">
            Grupo activo
          </label>
          <select
            value={activeClassroom.id}
            onChange={(e) => setActiveClassroomId(e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {db.classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.cycle}
              </option>
            ))}
          </select>
        </div>

        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map((group, idx) => (
            <div key={group.title || `group-${idx}`} className="space-y-1">
              {group.title && (
                <p className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-slate-400">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectSection(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-blue-50 text-blue-800 font-semibold'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        active ? 'text-blue-700' : 'text-slate-400'
                      }`}
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-1.5">
          <p className="text-xs font-semibold text-slate-900 truncate">
            {activeClassroom.teacherName || 'Docente Titular'}
          </p>
          <p className="text-[11px] text-slate-500 truncate">
            Modo local · {activeClassroom.activePeriod}
          </p>
          {(() => {
            const daysSince = lastBackupAt
              ? Math.floor((Date.now() - Date.parse(lastBackupAt)) / 86400000)
              : null;
            const needsBackup = daysSince === null || daysSince > 15;
            return (
              <button
                type="button"
                onClick={() => handleSelectSection('configuracion')}
                className={`w-full text-left text-[11px] rounded px-2 py-1 border transition-colors ${
                  needsBackup
                    ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {daysSince === null
                  ? 'Sin respaldo reciente (+15 días)'
                  : daysSince > 15
                  ? `Respaldo antiguo (hace ${daysSince} días)`
                  : `Último respaldo: ${lastBackupAt!.slice(0, 10)}`}
              </button>
            );
          })()}
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative w-72 max-w-full bg-white h-full flex flex-col border-r border-slate-200 z-10">
            <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-6 h-6 text-blue-700" />
                <span className="font-display text-base font-bold text-slate-900">
                  AulaÁgil
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-1.5 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 border-b border-slate-100">
              <select
                value={activeClassroom.id}
                onChange={(e) => setActiveClassroomId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg"
              >
                {db.classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.cycle}
                  </option>
                ))}
              </select>
            </div>
            <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
              {NAV_GROUPS.map((group, idx) => (
                <div key={group.title || `m-group-${idx}`} className="space-y-1">
                  {group.title && (
                    <p className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-slate-400">
                      {group.title}
                    </p>
                  )}
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = section === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectSection(item.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg ${
                          active ? 'bg-blue-50 text-blue-800 font-semibold' : 'text-slate-600'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* Main Viewport */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="no-print h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-xs sm:text-sm text-slate-600 truncate">
              <button
                type="button"
                onClick={() => setSection('inicio')}
                className="font-semibold text-slate-900 hover:text-blue-700 transition-colors"
              >
                {activeClassroom.name}
              </button>
              <span className="mx-2 text-slate-300">/</span>
              <span>{ALL_NAV_ITEMS.find((i) => i.id === section)?.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {section !== 'inicio' && (
              <button
                type="button"
                onClick={() => setSection('inicio')}
                className="text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
              >
                Inicio
              </button>
            )}
            <span className="hidden sm:inline text-xs text-slate-500 whitespace-nowrap">
              {activeClassroom.schoolName || 'Primaria'}
            </span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {section === 'inicio' && (
            <HomeView
              classroom={activeClassroom}
              classroomCount={db.classrooms.length}
              students={students}
              files={files}
              attendanceDays={attendanceDays}
              assignments={assignments}
              incidents={incidents}
              dailyLogs={dailyLogs}
              lessonPlans={lessonPlans}
              gradingPeriod={activeGradingPeriod}
              grades={grades}
              lastBackupAt={lastBackupAt}
              onNavigate={setSection}
            />
          )}

          {section === 'resumen' && (
            <OverviewView
              classroom={activeClassroom}
              students={students}
              files={files}
              attendanceDays={attendanceDays}
              assignments={assignments}
              incidents={incidents}
              dailyLogs={dailyLogs}
              gradingPeriod={activeGradingPeriod}
              grades={grades}
              onNavigate={setSection}
            />
          )}

          {section === 'planeaciones' && (
            <LessonPlansView
              classroom={activeClassroom}
              lessonPlans={lessonPlans}
              onDbUpdate={setDb}
            />
          )}

          {section === 'lista' && (
            <RosterAttendanceView
              classroom={activeClassroom}
              students={students}
              attendanceDays={attendanceDays}
              onDbUpdate={setDb}
              onOpenDossier={handleOpenDossier}
            />
          )}

          {section === 'expedientes' && (
            <DossiersView
              classroom={activeClassroom}
              students={students}
              files={files}
              incidents={incidents}
              attendanceDays={attendanceDays}
              selectedStudentId={selectedDossierStudentId}
              onSelectStudent={setSelectedDossierStudentId}
              onDbUpdate={setDb}
            />
          )}

          {section === 'trabajos' && (
            <AssignmentsView
              classroom={activeClassroom}
              students={students}
              assignments={assignments}
              onDbUpdate={setDb}
            />
          )}

          {section === 'bitacora' && (
            <IncidentsAIView
              classroom={activeClassroom}
              students={students}
              incidents={incidents}
              onDbUpdate={setDb}
            />
          )}

          {section === 'diario' && (
            <DailyLogView
              classroom={activeClassroom}
              dailyLogs={dailyLogs}
              onDbUpdate={setDb}
            />
          )}

          {section === 'calificaciones' && (
            <GradingView
              classroom={activeClassroom}
              students={students}
              assignments={assignments}
              attendanceDays={attendanceDays}
              incidents={incidents}
              gradingPeriods={gradingPeriods}
              grades={grades}
              onDbUpdate={setDb}
            />
          )}

          {section === 'configuracion' && (
            <SettingsView
              classrooms={db.classrooms}
              activeClassroom={activeClassroom}
              onSelectClassroom={setActiveClassroomId}
              onDbUpdate={setDb}
              onBackupRecorded={setLastBackupAt}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ClassroomWorkspace />
    </ErrorBoundary>
  );
}
