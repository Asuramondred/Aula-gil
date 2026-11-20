import type {
  Assignment,
  AssignmentCategory,
  AttendanceDay,
  GradingPeriod,
  Incident,
  StudentGrade,
  TrimesterPeriod,
} from '../types';

export interface AttendanceStats {
  totalDays: number;
  presentes: number;
  retardos: number;
  faltas: number;
  justificadas: number;
  percentage: number | null; // 0..100 or null when 0 days logged
}

export interface ComputedTrimesterGrade {
  trabajosAvg10: number | null;
  trabajosCount: number;
  trabajosReviewedCount: number;
  trabajosHasData: boolean;

  tareasAvg10: number | null;
  tareasCount: number;
  tareasReviewedCount: number;
  tareasHasData: boolean;

  examenAvg10: number | null;
  examenCount: number;
  examenHasData: boolean;

  asistenciaPct: number | null;
  asistenciaAvg10: number | null;
  asistenciaHasData: boolean;

  conductBase10: number;
  conductaHasData: boolean;

  trabajosPoints: number;
  tareasPoints: number;
  examenPoints: number;
  asistenciaPoints: number;
  conductaPoints: number;

  maxTrabajosPoints: number;
  maxTareasPoints: number;
  maxExamenPoints: number;
  maxAsistenciaPoints: number;
  maxConductaPoints: number;

  activeWeightPct: number;
  isPartial: boolean;
  calculatedTotal: number;
  finalGrade: number;
  hasAnyManualOverride: boolean;
}

export function roundScore(value: number, scaleMax: 10 | 100): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(0, Math.min(scaleMax, value));
  return scaleMax === 10 ? Math.round(clamped * 10) / 10 : Math.round(clamped);
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, value) * 100) / 100;
}

export function computeAttendanceStats(
  studentId: string,
  attendanceDays: AttendanceDay[],
  period?: TrimesterPeriod
): AttendanceStats {
  const days = period
    ? attendanceDays.filter((d) => d.period === period)
    : attendanceDays;

  let totalDays = 0;
  let presentes = 0;
  let retardos = 0;
  let faltas = 0;
  let justificadas = 0;

  days.forEach((day) => {
    const status = day.records?.[studentId];
    if (!status) return;
    totalDays += 1;
    if (status === 'presente') presentes += 1;
    else if (status === 'retardo') retardos += 1;
    else if (status === 'falta') faltas += 1;
    else if (status === 'justificada') justificadas += 1;
  });

  if (totalDays === 0) {
    return {
      totalDays: 0,
      presentes: 0,
      retardos: 0,
      faltas: 0,
      justificadas: 0,
      percentage: null,
    };
  }

  // Presente & Justificada count 100%, Retardo counts 80%, Falta counts 0%
  const earned = presentes + justificadas + retardos * 0.8;
  const percentage = Math.round((earned / totalDays) * 100);
  return {
    totalDays,
    presentes,
    retardos,
    faltas,
    justificadas,
    percentage,
  };
}

export function computeCategoryAverage10(
  studentId: string,
  assignments: Assignment[],
  period: TrimesterPeriod,
  category: AssignmentCategory
): { avg10: number | null; total: number; reviewed: number } {
  const items = assignments.filter(
    (a) => a.period === period && a.type === category
  );
  if (items.length === 0) {
    return { avg10: null, total: 0, reviewed: 0 };
  }

  let sum10 = 0;
  let reviewed = 0;
  items.forEach((item) => {
    const sub = item.submissions?.[studentId] || 'no_entregado';
    const rawScore = item.scores?.[studentId];
    const maxScore = Math.max(1, item.maxScore || 10);

    if (sub === 'revisado') reviewed += 1;

    if (typeof rawScore === 'number' && Number.isFinite(rawScore)) {
      sum10 += Math.max(0, Math.min(10, (rawScore / maxScore) * 10));
    } else if (sub === 'revisado') {
      sum10 += 10;
    } else if (sub === 'incompleto') {
      sum10 += 6;
    } else {
      sum10 += 0;
    }
  });

  return {
    avg10: Math.round((sum10 / items.length) * 100) / 100,
    total: items.length,
    reviewed,
  };
}

export function computeAutoConductBase10(
  studentId: string,
  incidents: Incident[],
  period: TrimesterPeriod
): number {
  const list = incidents.filter(
    (i) => i.studentId === studentId && i.period === period
  );
  let score = 10.0;
  list.forEach((inc) => {
    if (inc.severity === 'positiva') score += 0.4;
    else if (inc.severity === 'leve') score -= 0.5;
    else if (inc.severity === 'moderada') score -= 1.2;
    else if (inc.severity === 'grave') score -= 2.5;
  });
  return Math.round(Math.max(0, Math.min(10, score)) * 10) / 10;
}

export function computeStudentTrimesterGrade(
  studentId: string,
  periodConfig: GradingPeriod,
  gradeDoc: StudentGrade | undefined,
  assignments: Assignment[],
  attendanceDays: AttendanceDay[],
  incidents: Incident[]
): ComputedTrimesterGrade {
  const scaleFactor = periodConfig.scaleMax / 100;
  const maxTrabajosPoints = round2(periodConfig.trabajosWeight * scaleFactor);
  const maxTareasPoints = round2(periodConfig.tareasWeight * scaleFactor);
  const maxExamenPoints = round2(periodConfig.examenWeight * scaleFactor);
  const maxAsistenciaPoints = round2(periodConfig.asistenciaWeight * scaleFactor);
  const maxConductaPoints = round2(periodConfig.conductaWeight * scaleFactor);

  // 1. Trabajos en clase
  const trabajosStats = computeCategoryAverage10(
    studentId,
    assignments,
    periodConfig.periodName,
    'trabajo'
  );
  const trabajosHasData = Boolean(gradeDoc?.hasManualTrabajosScore) || trabajosStats.total > 0;
  const trabajosAvg10 = gradeDoc?.hasManualTrabajosScore
    ? Math.max(0, Math.min(10, gradeDoc.manualTrabajosScore))
    : trabajosStats.avg10;
  const trabajosPoints =
    trabajosHasData && trabajosAvg10 !== null
      ? round2((trabajosAvg10 / 10) * maxTrabajosPoints)
      : 0;

  // 2. Tareas
  const tareasStats = computeCategoryAverage10(
    studentId,
    assignments,
    periodConfig.periodName,
    'tarea'
  );
  const tareasHasData = Boolean(gradeDoc?.hasManualTareasScore) || tareasStats.total > 0;
  const tareasAvg10 = gradeDoc?.hasManualTareasScore
    ? Math.max(0, Math.min(10, gradeDoc.manualTareasScore))
    : tareasStats.avg10;
  const tareasPoints =
    tareasHasData && tareasAvg10 !== null
      ? round2((tareasAvg10 / 10) * maxTareasPoints)
      : 0;

  // 3. Exámenes / Proyectos
  const examenStats = computeCategoryAverage10(
    studentId,
    assignments,
    periodConfig.periodName,
    'examen'
  );
  const totalQuestions = Math.max(1, periodConfig.examTotalQuestions || 25);
  const rawCorrect = gradeDoc?.examCorrectAnswers ?? 0;
  const correctAnswers = Math.min(totalQuestions, Math.max(0, rawCorrect));
  const examByQuestions10 = (correctAnswers / totalQuestions) * 10;

  let examenHasData = false;
  let autoExamen10: number | null = null;

  if (gradeDoc?.hasManualExamenScore) {
    examenHasData = true;
    autoExamen10 = Math.max(0, Math.min(10, gradeDoc.manualExamenScore));
  } else if (periodConfig.useActivityExamAverage) {
    if (examenStats.total > 0) {
      examenHasData = true;
      autoExamen10 = examenStats.avg10;
    }
  } else {
    if (rawCorrect > 0) {
      examenHasData = true;
      autoExamen10 = round2(examByQuestions10);
    } else if (examenStats.total > 0) {
      examenHasData = true;
      autoExamen10 = examenStats.avg10;
    }
  }

  const examenAvg10 = autoExamen10;
  const examenPoints =
    examenHasData && examenAvg10 !== null
      ? round2((examenAvg10 / 10) * maxExamenPoints)
      : 0;

  // 4. Asistencia
  const attStats = computeAttendanceStats(
    studentId,
    attendanceDays,
    periodConfig.periodName
  );
  const asistenciaHasData =
    Boolean(gradeDoc?.hasManualAsistenciaScore) || attStats.totalDays > 0;
  const asistenciaPct = attStats.percentage;
  const asistenciaAvg10 = gradeDoc?.hasManualAsistenciaScore
    ? Math.max(0, Math.min(10, gradeDoc.manualAsistenciaScore))
    : asistenciaPct !== null
    ? round2(asistenciaPct / 10)
    : null;
  const asistenciaPoints =
    asistenciaHasData && asistenciaAvg10 !== null
      ? round2((asistenciaAvg10 / 10) * maxAsistenciaPoints)
      : 0;

  // 5. Conducta (base 10 from incidents, refined by AI, or manual override)
  const deterministicConduct10 = computeAutoConductBase10(
    studentId,
    incidents,
    periodConfig.periodName
  );
  const autoConduct10 = gradeDoc?.hasAiConductScore
    ? Math.max(0, Math.min(10, gradeDoc.aiConductBase10))
    : deterministicConduct10;
  const conductBase10 = gradeDoc?.hasManualConductScore
    ? Math.max(0, Math.min(10, gradeDoc.manualConductScore))
    : autoConduct10;
  const conductaHasData = periodConfig.conductaWeight > 0;
  const conductaPoints = round2((conductBase10 / 10) * maxConductaPoints);

  // Proportional rescaling across active rubrics so empty rubrics don't inflate or unfairly penalize
  let activeWeightPct = 0;
  let earnedWeighted10 = 0;

  if (trabajosHasData && periodConfig.trabajosWeight > 0 && trabajosAvg10 !== null) {
    activeWeightPct += periodConfig.trabajosWeight;
    earnedWeighted10 += (trabajosAvg10 / 10) * periodConfig.trabajosWeight;
  }
  if (tareasHasData && periodConfig.tareasWeight > 0 && tareasAvg10 !== null) {
    activeWeightPct += periodConfig.tareasWeight;
    earnedWeighted10 += (tareasAvg10 / 10) * periodConfig.tareasWeight;
  }
  if (examenHasData && periodConfig.examenWeight > 0 && examenAvg10 !== null) {
    activeWeightPct += periodConfig.examenWeight;
    earnedWeighted10 += (examenAvg10 / 10) * periodConfig.examenWeight;
  }
  if (asistenciaHasData && periodConfig.asistenciaWeight > 0 && asistenciaAvg10 !== null) {
    activeWeightPct += periodConfig.asistenciaWeight;
    earnedWeighted10 += (asistenciaAvg10 / 10) * periodConfig.asistenciaWeight;
  }
  if (conductaHasData && periodConfig.conductaWeight > 0) {
    activeWeightPct += periodConfig.conductaWeight;
    earnedWeighted10 += (conductBase10 / 10) * periodConfig.conductaWeight;
  }

  const totalConfiguredWeight =
    periodConfig.trabajosWeight +
    periodConfig.tareasWeight +
    periodConfig.examenWeight +
    periodConfig.asistenciaWeight +
    periodConfig.conductaWeight;

  const isPartial = activeWeightPct > 0 && activeWeightPct < totalConfiguredWeight;

  const rescaledNormalized =
    activeWeightPct > 0 ? earnedWeighted10 / activeWeightPct : 0;
  const calculatedTotal = roundScore(
    rescaledNormalized * periodConfig.scaleMax,
    periodConfig.scaleMax
  );

  const finalGrade = gradeDoc?.hasManualFinalGrade
    ? roundScore(gradeDoc.manualFinalGrade, periodConfig.scaleMax)
    : calculatedTotal;

  const hasAnyManualOverride = Boolean(
    gradeDoc?.hasManualTrabajosScore ||
      gradeDoc?.hasManualTareasScore ||
      gradeDoc?.hasManualExamenScore ||
      gradeDoc?.hasManualAsistenciaScore ||
      gradeDoc?.hasManualConductScore ||
      gradeDoc?.hasManualFinalGrade
  );

  return {
    trabajosAvg10,
    trabajosCount: trabajosStats.total,
    trabajosReviewedCount: trabajosStats.reviewed,
    trabajosHasData,
    tareasAvg10,
    tareasCount: tareasStats.total,
    tareasReviewedCount: tareasStats.reviewed,
    tareasHasData,
    examenAvg10,
    examenCount: examenStats.total,
    examenHasData,
    asistenciaPct,
    asistenciaAvg10,
    asistenciaHasData,
    conductBase10,
    conductaHasData,
    trabajosPoints,
    tareasPoints,
    examenPoints,
    asistenciaPoints,
    conductaPoints,
    maxTrabajosPoints,
    maxTareasPoints,
    maxExamenPoints,
    maxAsistenciaPoints,
    maxConductaPoints,
    activeWeightPct,
    isPartial,
    calculatedTotal,
    finalGrade,
    hasAnyManualOverride,
  };
}
