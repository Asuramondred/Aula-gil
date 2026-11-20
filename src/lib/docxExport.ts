import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { saveAs } from 'file-saver';
import {
  computeAttendanceStats,
  computeStudentTrimesterGrade,
} from './grading';
import type {
  Assignment,
  AttendanceDay,
  Classroom,
  DailyLog,
  FormativeField,
  GradingPeriod,
  Incident,
  LessonPlan,
  NemMethodology,
  Student,
  StudentFile,
  StudentGrade,
  TrimesterPeriod,
  WeekdayKey,
} from '../types';

const FORMATIVE_FIELD_LABELS: Record<FormativeField, string> = {
  general: 'Planeación Integrada (Todos los Campos Formativos)',
  lenguajes: 'Lenguajes',
  saberes: 'Saberes y Pensamiento Científico',
  etica: 'Ética, Naturaleza y Sociedades',
  humano: 'De lo Humano y lo Comunitario',
};

const METHODOLOGY_LABELS: Record<NemMethodology, string> = {
  abp_proyectos: 'Aprendizaje Basado en Proyectos Comunitarios (ABPC)',
  steam: 'Aprendizaje Basado en Indagación (STEAM)',
  problemas: 'Aprendizaje Basado en Problemas (ABP)',
  servicio: 'Aprendizaje Servicio (AS)',
};

const WEEKDAY_LABELS: Record<WeekdayKey, string> = {
  lunes: 'Lunes',
  martes: 'Martes',
  miercoles: 'Miércoles',
  jueves: 'Jueves',
  viernes: 'Viernes',
};

function headerBanner(schoolName: string, title: string, subtitle: string): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: (schoolName || 'ESCUELA PRIMARIA').toUpperCase(),
          bold: true,
          size: 24,
          color: '1E293B',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 28,
          color: '0F172A',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      border: {
        bottom: { color: '334155', space: 6, style: BorderStyle.SINGLE, size: 12 },
      },
      children: [
        new TextRun({
          text: subtitle,
          size: 20,
          color: '475569',
        }),
      ],
    }),
  ];
}

function makeCell(text: string, bold = false, align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT, shade = false): TableCell {
  return new TableCell({
    shading: shade ? { fill: 'F1F5F9' } : undefined,
    margins: { top: 80, bottom: 80, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: align,
        children: [new TextRun({ text, bold, size: 19, color: '0F172A' })],
      }),
    ],
  });
}

function makeSignatureRow(labels: string[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: labels.map(
          (label) =>
            new TableCell({
              margins: { top: 480, bottom: 40, left: 120, right: 120 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  border: {
                    top: { color: '0F172A', space: 4, style: BorderStyle.SINGLE, size: 8 },
                  },
                  children: [new TextRun({ text: label, bold: true, size: 18 })],
                }),
              ],
            })
        ),
      }),
    ],
  });
}

async function saveDocx(doc: Document, filename: string) {
  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

// 1. Bitácora Diaria del Docente (.docx)
export async function exportDailyLogDocx(
  classroom: Classroom,
  logs: DailyLog[],
  label: string
) {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const children: Array<Paragraph | Table> = [
    ...headerBanner(
      classroom.schoolName,
      'Bitácora Diaria del Docente',
      `Grupo ${classroom.name} · Docente: ${classroom.teacherName} · Ciclo ${classroom.cycle} · ${label}`
    ),
  ];

  sorted.forEach((log, idx) => {
    children.push(
      new Paragraph({
        spacing: { before: idx === 0 ? 100 : 280, after: 100 },
        children: [
          new TextRun({
            text: `Fecha: ${log.date}   |   Periodo: ${log.period}   |   Grupo: ${classroom.name}`,
            bold: true,
            size: 22,
            color: '1D4ED8',
          }),
        ],
      })
    );

    const blocks = [
      { title: 'Temas abordados', text: log.topicsCovered },
      { title: 'Observaciones de alumnos e incidencias relevantes', text: log.studentObservations },
      { title: 'Acuerdos y pendientes', text: log.agreementsPending },
      { title: 'Reflexión pedagógica', text: log.pedagogicalReflection },
    ];

    blocks.forEach((blk) => {
      children.push(
        new Paragraph({
          spacing: { before: 80, after: 30 },
          children: [new TextRun({ text: `${blk.title}:`, bold: true, size: 20 })],
        }),
        new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: blk.text || 'Sin registro.', size: 20 })],
        })
      );
    });
  });

  children.push(
    makeSignatureRow([
      `${classroom.teacherName || 'Docente Titular'}`,
      'Vo. Bo. Dirección Escolar',
    ])
  );

  const doc = new Document({ sections: [{ children }] });
  const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  await saveDocx(doc, `Bitacora_Docente_${classroom.name}_${safeName}.docx`);
}

// 2. Acta / Citatorio de Conducta (.docx)
export async function exportIncidentReportDocx(
  classroom: Classroom,
  student: Student,
  incident: Incident,
  target: 'parents' | 'direction' | 'both'
) {
  const sections: Array<{ children: Array<Paragraph | Table> }> = [];

  if (target === 'parents' || target === 'both') {
    sections.push({
      children: [
        ...headerBanner(
          classroom.schoolName,
          'Reporte y Citatorio de Conducta — Padres de Familia',
          `Fecha: ${incident.date} · Grupo: ${classroom.name} · Ciclo: ${classroom.cycle}`
        ),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                makeCell(`Alumno(a): ${student.fullName}`, true, AlignmentType.LEFT, true),
                makeCell(`No. Lista: ${student.listNumber}`, true, AlignmentType.LEFT, true),
              ],
            }),
            new TableRow({
              children: [
                makeCell(`Padre / Tutor: ${student.guardianName || 'No registrado'}`),
                makeCell(`Docente: ${classroom.teacherName}`),
              ],
            }),
          ],
        }),
        new Paragraph({ spacing: { before: 220, after: 80 }, children: [new TextRun({ text: 'Comunicado escolar:', bold: true, size: 21 })] }),
        ...(incident.aiReportParents || incident.description)
          .split('\n')
          .map(
            (line) =>
              new Paragraph({
                spacing: { after: 120 },
                children: [new TextRun({ text: line, size: 21 })],
              })
          ),
        makeSignatureRow([
          `${classroom.teacherName || 'Docente Titular'}\nDocente`,
          `${student.guardianName || 'Padre / Madre / Tutor'}\nFirma de enterado`,
          'Vo. Bo. Dirección Escolar',
        ]),
      ],
    });
  }

  if (target === 'direction' || target === 'both') {
    sections.push({
      children: [
        ...headerBanner(
          classroom.schoolName,
          'Informe Técnico-Pedagógico de Conducta — Dirección Escolar',
          `Fecha: ${incident.date} · Grupo: ${classroom.name} · Trimestre: ${incident.period}`
        ),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                makeCell(`Estudiante: ${student.fullName}`, true, AlignmentType.LEFT, true),
                makeCell(`Clasificación: ${incident.severity.toUpperCase()}`, true, AlignmentType.LEFT, true),
              ],
            }),
            new TableRow({
              children: [
                makeCell(`Categoría: ${incident.category}`),
                makeCell(`CURP: ${student.curp || 'N/A'}`),
              ],
            }),
          ],
        }),
        new Paragraph({ spacing: { before: 220, after: 80 }, children: [new TextRun({ text: 'Informe detallado:', bold: true, size: 21 })] }),
        ...(incident.aiReportDirection || incident.description)
          .split('\n')
          .map(
            (line) =>
              new Paragraph({
                spacing: { after: 120 },
                children: [new TextRun({ text: line, size: 21 })],
              })
          ),
        makeSignatureRow([
          `${classroom.teacherName || 'Docente Titular'}\nDocente que reporta`,
          'Dirección Escolar\nSello y firma de recibido',
        ]),
      ],
    });
  }

  const doc = new Document({ sections });
  const cleanStudent = student.fullName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 28);
  await saveDocx(doc, `Reporte_Conducta_${cleanStudent}_${incident.date}.docx`);
}

// 3. Concentrado de Calificaciones Trimestrales (.docx)
export async function exportTrimesterGradesDocx(
  classroom: Classroom,
  periodConfig: GradingPeriod,
  students: Student[],
  grades: StudentGrade[],
  assignments: Assignment[],
  attendanceDays: AttendanceDay[],
  incidents: Incident[]
) {
  const sorted = [...students].sort((a, b) => a.listNumber - b.listNumber);
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      makeCell('#', true, AlignmentType.CENTER, true),
      makeCell('Alumno(a)', true, AlignmentType.LEFT, true),
      makeCell(`Trabajos (${periodConfig.trabajosWeight}%)`, true, AlignmentType.RIGHT, true),
      makeCell(`Tareas (${periodConfig.tareasWeight}%)`, true, AlignmentType.RIGHT, true),
      makeCell(`Examen (${periodConfig.examenWeight}%)`, true, AlignmentType.RIGHT, true),
      makeCell(`Asist. (${periodConfig.asistenciaWeight}%)`, true, AlignmentType.RIGHT, true),
      makeCell(`Conducta (${periodConfig.conductaWeight}%)`, true, AlignmentType.RIGHT, true),
      makeCell(`Final (/${periodConfig.scaleMax})`, true, AlignmentType.RIGHT, true),
    ],
  });

  const rows = sorted.map((st) => {
    const gDoc = grades.find(
      (g) => g.periodId === periodConfig.id && g.studentId === st.id
    );
    const comp = computeStudentTrimesterGrade(
      st.id,
      periodConfig,
      gDoc,
      assignments,
      attendanceDays,
      incidents
    );
    return new TableRow({
      children: [
        makeCell(String(st.listNumber), false, AlignmentType.CENTER),
        makeCell(st.fullName),
        makeCell(comp.trabajosHasData ? comp.trabajosPoints.toFixed(2) : '—', false, AlignmentType.RIGHT),
        makeCell(comp.tareasHasData ? comp.tareasPoints.toFixed(2) : '—', false, AlignmentType.RIGHT),
        makeCell(comp.examenHasData ? comp.examenPoints.toFixed(2) : '—', false, AlignmentType.RIGHT),
        makeCell(
          comp.asistenciaHasData && comp.asistenciaPct !== null
            ? `${comp.asistenciaPoints.toFixed(2)} (${comp.asistenciaPct}%)`
            : '—',
          false,
          AlignmentType.RIGHT
        ),
        makeCell(`${comp.conductaPoints.toFixed(2)} (${comp.conductBase10})`, false, AlignmentType.RIGHT),
        makeCell(
          comp.isPartial && !gDoc?.hasManualFinalGrade
            ? `${comp.finalGrade} (Parcial)`
            : String(comp.finalGrade),
          true,
          AlignmentType.RIGHT
        ),
      ],
    });
  });

  const children: Array<Paragraph | Table> = [
    ...headerBanner(
      classroom.schoolName,
      `Concentrado de Calificaciones — ${periodConfig.periodName}`,
      `Grupo: ${classroom.name} · Docente: ${classroom.teacherName} · Ciclo: ${classroom.cycle}`
    ),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...rows],
    }),
    new Paragraph({
      spacing: { before: 260, after: 100 },
      children: [
        new TextRun({
          text: 'Observaciones individuales por estudiante:',
          bold: true,
          size: 22,
        }),
      ],
    }),
  ];

  sorted.forEach((st) => {
    const gDoc = grades.find(
      (g) => g.periodId === periodConfig.id && g.studentId === st.id
    );
    if (gDoc?.customComment || gDoc?.aiConductReason) {
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [
            new TextRun({ text: `${st.listNumber}. ${st.fullName}: `, bold: true, size: 19 }),
            new TextRun({
              text: gDoc.customComment || gDoc.aiConductReason,
              size: 19,
            }),
          ],
        })
      );
    }
  });

  children.push(
    makeSignatureRow([
      `${classroom.teacherName || 'Docente Titular'}\nDocente`,
      'Vo. Bo. Dirección Escolar',
    ])
  );

  const doc = new Document({ sections: [{ children }] });
  await saveDocx(
    doc,
    `Concentrado_Calificaciones_${classroom.name}_${periodConfig.periodName.replace(/\s+/g, '_')}.docx`
  );
}

// 4. Boleta Individual Editable (.docx)
export async function exportSingleReportCardDocx(
  classroom: Classroom,
  periodConfig: GradingPeriod,
  student: Student,
  gradeDoc: StudentGrade | undefined,
  assignments: Assignment[],
  attendanceDays: AttendanceDay[],
  incidents: Incident[]
) {
  const comp = computeStudentTrimesterGrade(
    student.id,
    periodConfig,
    gradeDoc,
    assignments,
    attendanceDays,
    incidents
  );
  const att = computeAttendanceStats(student.id, attendanceDays, periodConfig.periodName);

  const doc = new Document({
    sections: [
      {
        children: [
          ...headerBanner(
            classroom.schoolName,
            `Boleta e Informe Trimestral — ${periodConfig.periodName}`,
            `Grupo: ${classroom.name} · Ciclo Escolar: ${classroom.cycle} · Docente: ${classroom.teacherName}`
          ),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  makeCell(`Alumno(a): ${student.fullName}`, true, AlignmentType.LEFT, true),
                  makeCell(`No. Lista: ${student.listNumber}`, true, AlignmentType.LEFT, true),
                ],
              }),
              new TableRow({
                children: [
                  makeCell(`Tutor: ${student.guardianName || 'No registrado'}`),
                  makeCell(`CURP: ${student.curp || 'N/A'}`),
                ],
              }),
            ],
          }),
          new Paragraph({ spacing: { before: 180, after: 80 }, children: [new TextRun({ text: 'Desglose de evaluación:', bold: true, size: 21 })] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  makeCell('Rubro', true, AlignmentType.LEFT, true),
                  makeCell('Detalle', true, AlignmentType.LEFT, true),
                  makeCell('Peso / Máx', true, AlignmentType.RIGHT, true),
                  makeCell('Puntos', true, AlignmentType.RIGHT, true),
                ],
              }),
              new TableRow({
                children: [
                  makeCell('Trabajos en clase'),
                  makeCell(
                    comp.trabajosHasData && comp.trabajosAvg10 !== null
                      ? `${comp.trabajosReviewedCount}/${comp.trabajosCount} revisados (Prom. ${comp.trabajosAvg10})`
                      : 'Sin actividades registradas'
                  ),
                  makeCell(`${periodConfig.trabajosWeight}% (${comp.maxTrabajosPoints})`, false, AlignmentType.RIGHT),
                  makeCell(comp.trabajosHasData ? comp.trabajosPoints.toFixed(2) : '—', true, AlignmentType.RIGHT),
                ],
              }),
              new TableRow({
                children: [
                  makeCell('Tareas'),
                  makeCell(
                    comp.tareasHasData && comp.tareasAvg10 !== null
                      ? `${comp.tareasReviewedCount}/${comp.tareasCount} entregadas (Prom. ${comp.tareasAvg10})`
                      : 'Sin actividades registradas'
                  ),
                  makeCell(`${periodConfig.tareasWeight}% (${comp.maxTareasPoints})`, false, AlignmentType.RIGHT),
                  makeCell(comp.tareasHasData ? comp.tareasPoints.toFixed(2) : '—', true, AlignmentType.RIGHT),
                ],
              }),
              new TableRow({
                children: [
                  makeCell('Exámenes / Proyectos'),
                  makeCell(
                    comp.examenHasData && comp.examenAvg10 !== null
                      ? `Promedio ${comp.examenAvg10} / 10`
                      : 'Sin exámenes registrados'
                  ),
                  makeCell(`${periodConfig.examenWeight}% (${comp.maxExamenPoints})`, false, AlignmentType.RIGHT),
                  makeCell(comp.examenHasData ? comp.examenPoints.toFixed(2) : '—', true, AlignmentType.RIGHT),
                ],
              }),
              new TableRow({
                children: [
                  makeCell('Asistencia'),
                  makeCell(
                    comp.asistenciaHasData && comp.asistenciaPct !== null
                      ? `${comp.asistenciaPct}% (${att.presentes}P · ${att.retardos}R · ${att.faltas}F)`
                      : 'Sin pases de lista registrados'
                  ),
                  makeCell(`${periodConfig.asistenciaWeight}% (${comp.maxAsistenciaPoints})`, false, AlignmentType.RIGHT),
                  makeCell(comp.asistenciaHasData ? comp.asistenciaPoints.toFixed(2) : '—', true, AlignmentType.RIGHT),
                ],
              }),
              new TableRow({
                children: [
                  makeCell('Conducta'),
                  makeCell(`Base ${comp.conductBase10}/10 · ${gradeDoc?.aiConductReason || 'Comportamiento evaluado'}`),
                  makeCell(`${periodConfig.conductaWeight}% (${comp.maxConductaPoints})`, false, AlignmentType.RIGHT),
                  makeCell(comp.conductaPoints.toFixed(2), true, AlignmentType.RIGHT),
                ],
              }),
              new TableRow({
                children: [
                  makeCell('CALIFICACIÓN FINAL', true, AlignmentType.LEFT, true),
                  makeCell(
                    comp.isPartial && !gradeDoc?.hasManualFinalGrade
                      ? `Escala 0 a ${periodConfig.scaleMax} (Cálculo parcial · ${comp.activeWeightPct}% evaluado)`
                      : `Escala 0 a ${periodConfig.scaleMax}`,
                    false,
                    AlignmentType.LEFT,
                    true
                  ),
                  makeCell(String(periodConfig.scaleMax), true, AlignmentType.RIGHT, true),
                  makeCell(String(comp.finalGrade), true, AlignmentType.RIGHT, true),
                ],
              }),
            ],
          }),
          new Paragraph({ spacing: { before: 180, after: 60 }, children: [new TextRun({ text: 'Comentarios personalizados del docente:', bold: true, size: 21 })] }),
          new Paragraph({
            spacing: { after: 180 },
            children: [
              new TextRun({
                text: gradeDoc?.customComment || 'Sin observaciones adicionales registradas.',
                size: 20,
              }),
            ],
          }),
          makeSignatureRow([
            `${classroom.teacherName || 'Docente Titular'}\nDocente`,
            'Vo. Bo. Dirección Escolar',
            `${student.guardianName || 'Padre / Tutor'}\nFirma de enterado`,
          ]),
        ],
      },
    ],
  });

  const cleanName = student.fullName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 28);
  await saveDocx(
    doc,
    `Boleta_${cleanName}_${periodConfig.periodName.replace(/\s+/g, '_')}.docx`
  );
}

// 5. Lista de Asistencia (.docx)
export async function exportAttendanceRosterDocx(
  classroom: Classroom,
  students: Student[],
  attendanceDays: AttendanceDay[],
  selectedDate: string,
  period: TrimesterPeriod
) {
  const sorted = [...students].sort((a, b) => a.listNumber - b.listNumber);
  const currentDay = attendanceDays.find((d) => d.date === selectedDate);

  const rows = sorted.map((st) => {
    const status = currentDay?.records?.[st.id] || 'sin_registro';
    const label =
      status === 'presente'
        ? 'Presente'
        : status === 'retardo'
        ? 'Retardo'
        : status === 'falta'
        ? 'Falta'
        : status === 'justificada'
        ? 'Justificado'
        : '—';
    const stats = computeAttendanceStats(st.id, attendanceDays, period);
    return new TableRow({
      children: [
        makeCell(String(st.listNumber), false, AlignmentType.CENTER),
        makeCell(st.fullName),
        makeCell(label, false, AlignmentType.CENTER),
        makeCell(`${stats.presentes}/${stats.retardos}/${stats.faltas}`, false, AlignmentType.RIGHT),
        makeCell(stats.percentage !== null ? `${stats.percentage}%` : '—', true, AlignmentType.RIGHT),
      ],
    });
  });

  const doc = new Document({
    sections: [
      {
        children: [
          ...headerBanner(
            classroom.schoolName,
            `Lista de Asistencia — ${period}`,
            `Grupo: ${classroom.name} · Fecha: ${selectedDate} · Docente: ${classroom.teacherName}`
          ),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  makeCell('#', true, AlignmentType.CENTER, true),
                  makeCell('Nombre completo', true, AlignmentType.LEFT, true),
                  makeCell(`Asistencia (${selectedDate})`, true, AlignmentType.CENTER, true),
                  makeCell('P / R / F Trimestre', true, AlignmentType.RIGHT, true),
                  makeCell('% Asistencia', true, AlignmentType.RIGHT, true),
                ],
              }),
              ...rows,
            ],
          }),
          makeSignatureRow([`${classroom.teacherName || 'Docente Titular'}\nDocente`]),
        ],
      },
    ],
  });

  await saveDocx(doc, `Lista_Asistencia_${classroom.name}_${selectedDate}.docx`);
}

// 6. Trabajos y Tareas (.docx) con filtro opcional por Campo Formativo SEP
export async function exportAssignmentsDocx(
  classroom: Classroom,
  period: TrimesterPeriod,
  students: Student[],
  assignments: Assignment[],
  formativeFieldFilter: 'todos' | FormativeField = 'todos'
) {
  const sorted = [...students].sort((a, b) => a.listNumber - b.listNumber);
  const periodItems = assignments
    .filter((a) => a.period === period)
    .filter((a) =>
      formativeFieldFilter === 'todos'
        ? true
        : (a.formativeField || 'general') === formativeFieldFilter
    );

  const fieldLabel =
    formativeFieldFilter === 'todos'
      ? 'Todos los Campos Formativos'
      : FORMATIVE_FIELD_LABELS[formativeFieldFilter];

  const rows = sorted.map((st) => {
    const tr = computeStudentTrimesterGrade(
      st.id,
      {
        id: 'tmp',
        classroomId: classroom.id,
        periodName: period,
        trabajosWeight: 40,
        tareasWeight: 20,
        examenWeight: 10,
        asistenciaWeight: 10,
        conductaWeight: 20,
        examTotalQuestions: 25,
        useActivityExamAverage: true,
        scaleMax: 10,
        updatedAt: '',
      },
      undefined,
      periodItems,
      [],
      []
    );
    return new TableRow({
      children: [
        makeCell(String(st.listNumber), false, AlignmentType.CENTER),
        makeCell(st.fullName),
        makeCell(
          tr.trabajosCount > 0 && tr.trabajosAvg10 !== null
            ? `${tr.trabajosReviewedCount}/${tr.trabajosCount} (${tr.trabajosAvg10})`
            : '—',
          false,
          AlignmentType.RIGHT
        ),
        makeCell(
          tr.tareasCount > 0 && tr.tareasAvg10 !== null
            ? `${tr.tareasReviewedCount}/${tr.tareasCount} (${tr.tareasAvg10})`
            : '—',
          false,
          AlignmentType.RIGHT
        ),
        makeCell(
          tr.examenCount > 0 && tr.examenAvg10 !== null ? String(tr.examenAvg10) : '—',
          false,
          AlignmentType.RIGHT
        ),
      ],
    });
  });

  const doc = new Document({
    sections: [
      {
        children: [
          ...headerBanner(
            classroom.schoolName,
            `Concentrado de Trabajos, Tareas y Exámenes — ${period}`,
            `Grupo: ${classroom.name} · Docente: ${classroom.teacherName} · Campo Formativo: ${fieldLabel} · Actividades: ${periodItems.length}`
          ),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  makeCell('#', true, AlignmentType.CENTER, true),
                  makeCell('Estudiante', true, AlignmentType.LEFT, true),
                  makeCell('Trabajos en clase', true, AlignmentType.RIGHT, true),
                  makeCell('Tareas', true, AlignmentType.RIGHT, true),
                  makeCell('Exámenes / Proyectos', true, AlignmentType.RIGHT, true),
                ],
              }),
              ...rows,
            ],
          }),
          ...(periodItems.length > 0
            ? [
                new Paragraph({
                  spacing: { before: 220, after: 80 },
                  children: [
                    new TextRun({
                      text: 'Detalle de actividades incluidas:',
                      bold: true,
                      size: 20,
                    }),
                  ],
                }),
                ...periodItems.map(
                  (item) =>
                    new Paragraph({
                      spacing: { after: 40 },
                      children: [
                        new TextRun({
                          text: `• [${item.dueDate}] ${item.title} — ${
                            FORMATIVE_FIELD_LABELS[item.formativeField || 'general']
                          }`,
                          size: 18,
                        }),
                      ],
                    })
                ),
              ]
            : []),
          makeSignatureRow([`${classroom.teacherName || 'Docente Titular'}\nDocente`]),
        ],
      },
    ],
  });

  const fieldSuffix =
    formativeFieldFilter === 'todos' ? '' : `_${formativeFieldFilter}`;
  await saveDocx(
    doc,
    `Trabajos_y_Tareas_${classroom.name}_${period.replace(/\s+/g, '_')}${fieldSuffix}.docx`
  );
}

// 7. Expediente Individual del Alumno (.docx)
export async function exportStudentDossierDocx(
  classroom: Classroom,
  student: Student,
  files: StudentFile[],
  incidents: Incident[],
  attendanceDays: AttendanceDay[]
) {
  const att = computeAttendanceStats(student.id, attendanceDays);
  const stFiles = files.filter((f) => f.studentId === student.id);
  const stIncidents = incidents.filter((i) => i.studentId === student.id);

  const doc = new Document({
    sections: [
      {
        children: [
          ...headerBanner(
            classroom.schoolName,
            'Expediente Individual del Estudiante',
            `Grupo: ${classroom.name} · Ciclo: ${classroom.cycle} · No. Lista: ${student.listNumber}`
          ),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  makeCell(`Nombre completo: ${student.fullName}`, true, AlignmentType.LEFT, true),
                  makeCell(`CURP: ${student.curp || 'N/A'}`, true, AlignmentType.LEFT, true),
                ],
              }),
              new TableRow({
                children: [
                  makeCell(`Fecha de nacimiento: ${student.birthDate || 'N/A'}`),
                  makeCell(
                    `Asistencia global: ${
                      att.percentage !== null ? `${att.percentage}%` : '—'
                    } (${att.presentes}P/${att.retardos}R/${att.faltas}F)`
                  ),
                ],
              }),
              new TableRow({
                children: [
                  makeCell(`Padre / Tutor: ${student.guardianName || 'N/A'}`),
                  makeCell(`Teléfono / Correo: ${student.guardianPhone || 'N/A'} ${student.guardianEmail || ''}`),
                ],
              }),
            ],
          }),
          new Paragraph({ spacing: { before: 180, after: 40 }, children: [new TextRun({ text: 'Notas médicas y alergias:', bold: true, size: 20 })] }),
          new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: student.medicalNotes || 'Sin observaciones médicas.', size: 20 })] }),
          new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: 'Observaciones pedagógicas:', bold: true, size: 20 })] }),
          new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: student.pedagogicalNotes || 'Sin observaciones registradas.', size: 20 })] }),
          new Paragraph({ spacing: { before: 80, after: 60 }, children: [new TextRun({ text: `Documentos resguardados (${stFiles.length}):`, bold: true, size: 20 })] }),
          ...(stFiles.length > 0
            ? stFiles.map(
                (f) =>
                  new Paragraph({
                    spacing: { after: 40 },
                    children: [new TextRun({ text: `• ${f.title} (${f.category}) — ${f.fileName}`, size: 19 })],
                  })
              )
            : [new Paragraph({ children: [new TextRun({ text: 'Sin archivos adjuntos.', size: 19 })] })]),
          new Paragraph({ spacing: { before: 140, after: 60 }, children: [new TextRun({ text: `Historial de conducta (${stIncidents.length} registros):`, bold: true, size: 20 })] }),
          ...(stIncidents.length > 0
            ? stIncidents.map(
                (i) =>
                  new Paragraph({
                    spacing: { after: 50 },
                    children: [new TextRun({ text: `• [${i.date}] (${i.severity}): ${i.description}`, size: 19 })],
                  })
              )
            : [new Paragraph({ children: [new TextRun({ text: 'Sin incidencias registradas.', size: 19 })] })]),
          makeSignatureRow([
            `${classroom.teacherName || 'Docente Titular'}\nDocente`,
            `${student.guardianName || 'Padre / Tutor'}\nFirma`,
          ]),
        ],
      },
    ],
  });

  const cleanName = student.fullName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 28);
  await saveDocx(doc, `Expediente_${cleanName}.docx`);
}

export async function exportLessonPlanDocx(
  classroom: Classroom,
  plan: LessonPlan
) {
  const nonSchoolText =
    plan.nonSchoolDays.length > 0
      ? plan.nonSchoolDays
          .map((d) => `${WEEKDAY_LABELS[d.day]} (${d.reason || 'Sin clases'})`)
          .join(' · ')
      : 'Ninguno (Semana completa de lunes a viernes)';

  const sessionRows =
    plan.sessions.length > 0
      ? plan.sessions.map(
          (s) =>
            new TableRow({
              children: [
                makeCell(
                  s.active
                    ? `${WEEKDAY_LABELS[s.day]}\n(Con clases)`
                    : `${WEEKDAY_LABELS[s.day]}\n(Sin clases)`,
                  true
                ),
                makeCell(
                  s.active
                    ? s.activities
                    : `SUSPENSIÓN DE LABORES / SIN ASISTENCIA\nMotivo: ${s.suspensionReason || 'Ajuste de calendario escolar'}`
                ),
                makeCell(s.active ? s.materials || 'Material del aula y SEP' : '—'),
              ],
            })
        )
      : [
          new TableRow({
            children: [
              makeCell('Lunes a Viernes', true),
              makeCell(plan.notes || 'Planeación adjunta por el docente.'),
              makeCell('—'),
            ],
          }),
        ];

  const doc = new Document({
    sections: [
      {
        children: [
          ...headerBanner(
            classroom.schoolName,
            `Planeación Didáctica — Nueva Escuela Mexicana (NEM)`,
            `Grupo: ${classroom.name} · ${plan.period} · Ciclo Escolar: ${classroom.cycle} · Docente: ${classroom.teacherName || 'Titular'}`
          ),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  makeCell(`Proyecto / Tema: ${plan.title}`, true, AlignmentType.LEFT, true),
                  makeCell(
                    `Semana: ${plan.weekStartDate || '—'} al ${plan.weekEndDate || '—'}`,
                    true,
                    AlignmentType.LEFT,
                    true
                  ),
                ],
              }),
              new TableRow({
                children: [
                  makeCell(`Campo Formativo: ${FORMATIVE_FIELD_LABELS[plan.formativeField] || 'General'}`),
                  makeCell(`Metodología NEM: ${METHODOLOGY_LABELS[plan.methodology] || 'Proyectos'}`),
                ],
              }),
              new TableRow({
                children: [
                  makeCell(
                    `Ejes Articuladores: ${
                      plan.articulatingAxes.length > 0
                        ? plan.articulatingAxes.join(', ')
                        : 'Inclusión, Pensamiento crítico'
                    }`
                  ),
                  makeCell(`Días sin asistencia a clases: ${nonSchoolText}`),
                ],
              }),
            ],
          }),
          new Paragraph({
            spacing: { before: 160, after: 40 },
            children: [new TextRun({ text: 'Proceso de Desarrollo de Aprendizaje (PDA) / Contenido:', bold: true, size: 20 })],
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [new TextRun({ text: plan.pda || 'Acorde al programa sintético y analítico del grado.', size: 20 })],
          }),
          ...(plan.teacherNeeds
            ? [
                new Paragraph({
                  spacing: { before: 80, after: 40 },
                  children: [new TextRun({ text: 'Necesidades y temas indicados por el docente:', bold: true, size: 20 })],
                }),
                new Paragraph({
                  spacing: { after: 120 },
                  children: [new TextRun({ text: plan.teacherNeeds, size: 20 })],
                }),
              ]
            : []),
          ...(plan.fieldBlocks && plan.fieldBlocks.length > 0
            ? [
                new Paragraph({
                  spacing: { before: 100, after: 80 },
                  children: [
                    new TextRun({
                      text: 'Temas y PDA separados por Campo Formativo (NEM):',
                      bold: true,
                      size: 20,
                    }),
                  ],
                }),
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  rows: [
                    new TableRow({
                      children: [
                        makeCell('Campo Formativo', true, AlignmentType.LEFT, true),
                        makeCell('Tema / Contenido', true, AlignmentType.LEFT, true),
                        makeCell('PDA y Actividades clave', true, AlignmentType.LEFT, true),
                      ],
                    }),
                    ...plan.fieldBlocks.map(
                      (b) =>
                        new TableRow({
                          children: [
                            makeCell(b.fieldLabel || FORMATIVE_FIELD_LABELS[b.field] || b.field, true),
                            makeCell(b.topic || 'Contenido del programa'),
                            makeCell(
                              `${b.pda ? `PDA: ${b.pda}\n` : ''}${b.activitiesSummary || ''}`.trim()
                            ),
                          ],
                        })
                    ),
                  ],
                }),
              ]
            : []),
          new Paragraph({
            spacing: { before: 120, after: 80 },
            children: [new TextRun({ text: 'Secuencia Didáctica Semanal (Lunes a Viernes):', bold: true, size: 20 })],
          }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  makeCell('Día', true, AlignmentType.LEFT, true),
                  makeCell('Actividades (Inicio, Desarrollo y Cierre) / Motivo si no hay clases', true, AlignmentType.LEFT, true),
                  makeCell('Materiales y Recursos', true, AlignmentType.LEFT, true),
                ],
              }),
              ...sessionRows,
            ],
          }),
          new Paragraph({
            spacing: { before: 160, after: 40 },
            children: [new TextRun({ text: 'Evaluación Formativa e Instrumentos:', bold: true, size: 20 })],
          }),
          new Paragraph({
            spacing: { after: 100 },
            children: [
              new TextRun({
                text: plan.evaluationFormative || 'Observación formativa, retroalimentación continua y lista de cotejo.',
                size: 20,
              }),
            ],
          }),
          new Paragraph({
            spacing: { before: 80, after: 40 },
            children: [new TextRun({ text: 'Ajustes Razonables / Inclusión:', bold: true, size: 20 })],
          }),
          new Paragraph({
            spacing: { after: 140 },
            children: [
              new TextRun({
                text: plan.adjustments || 'Acompañamiento personalizado y apoyos visuales según ritmos de aprendizaje.',
                size: 20,
              }),
            ],
          }),
          ...(plan.notes
            ? [
                new Paragraph({
                  spacing: { before: 60, after: 40 },
                  children: [new TextRun({ text: 'Notas adicionales del docente:', bold: true, size: 20 })],
                }),
                new Paragraph({
                  spacing: { after: 120 },
                  children: [new TextRun({ text: plan.notes, size: 20 })],
                }),
              ]
            : []),
          makeSignatureRow([
            `${classroom.teacherName || 'Docente Titular'}\nDocente de Grupo`,
            'Vo. Bo. Dirección Escolar\nFirma y Sello',
          ]),
        ],
      },
    ],
  });

  const cleanTitle = (plan.title || 'Planeacion_NEM')
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 32);
  await saveDocx(doc, `Planeacion_NEM_${cleanTitle || classroom.name}.docx`);
}
