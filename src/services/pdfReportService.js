// PDF Report Generator for LinkTest Examination Results
// LinkTest Enterprise Academic Platform

import PDFDocument from 'pdfkit';

/**
 * Generates a clean, professional PDF report containing results of all authorized students
 * for a specific test and optional batch.
 *
 * @param {Object} params
 * @param {Object} params.test - Test metadata
 * @param {Object} params.batch - Batch metadata (optional)
 * @param {Object} params.teacher - Teacher/Admin user metadata
 * @param {Array} params.attempts - List of student attempts with student info and question reviews
 * @returns {Promise<Buffer>} - Resolves to PDF Buffer
 */
export function generateTestResultsPdf({ test, batch = null, teacher, attempts = [] }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `LinkTest Results - ${test.title}`,
          Author: teacher?.full_name || 'LinkTest Faculty',
          Subject: `${test.subject} Assessment Report`
        }
      });

      const buffers = [];
      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', err => reject(err));

      const primaryColor = '#1E3A8A'; // Deep Navy
      const secondaryColor = '#2563EB'; // Blue
      const accentGreen = '#059669';
      const accentRed = '#DC2626';
      const textColor = '#1F2937';
      const textMuted = '#6B7280';
      const borderLineColor = '#E5E7EB';

      // ── Header Banner ────────────────────────────────────────────────────────
      doc.rect(40, 40, 515, 6).fill(primaryColor);
      doc.moveDown(0.8);

      doc.fontSize(22).font('Helvetica-Bold').fillColor(primaryColor).text('LINKTEST', { letterSpacing: 1.5 });
      doc.fontSize(11).font('Helvetica-Bold').fillColor(secondaryColor).text('MOCK TEST EXAMINATION REPORT', { letterSpacing: 0.8 });
      doc.moveDown(0.6);

      // Metadata Box
      const metaY = doc.y;
      doc.roundedRect(40, metaY, 515, 75, 4).lineWidth(1).strokeColor(borderLineColor).stroke();

      doc.fontSize(9).font('Helvetica-Bold').fillColor(textMuted).text('TEST TITLE:', 55, metaY + 12);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(textColor).text(test.title || 'Examination', 130, metaY + 11);

      doc.fontSize(9).font('Helvetica-Bold').fillColor(textMuted).text('SUBJECT:', 55, metaY + 28);
      doc.fontSize(10).font('Helvetica').fillColor(textColor).text(test.subject || 'General', 130, metaY + 28);

      doc.fontSize(9).font('Helvetica-Bold').fillColor(textMuted).text('BATCH:', 55, metaY + 44);
      doc.fontSize(10).font('Helvetica').fillColor(textColor).text(batch ? batch.name : 'All Enrolled Batches', 130, metaY + 44);

      doc.fontSize(9).font('Helvetica-Bold').fillColor(textMuted).text('FACULTY:', 330, metaY + 12);
      doc.fontSize(10).font('Helvetica').fillColor(textColor).text(teacher?.full_name || 'Authorized Instructor', 400, metaY + 12);

      doc.fontSize(9).font('Helvetica-Bold').fillColor(textMuted).text('GENERATED:', 330, metaY + 28);
      doc.fontSize(9).font('Helvetica').fillColor(textColor).text(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), 400, metaY + 28);

      doc.fontSize(9).font('Helvetica-Bold').fillColor(textMuted).text('CANDIDATES:', 330, metaY + 44);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(secondaryColor).text(String(attempts.length), 400, metaY + 44);

      doc.y = metaY + 95;

      // ── Cohort Summary KPI Cards ───────────────────────────────────────────
      const totalCandidates = attempts.length;
      const passedCandidates = attempts.filter(a => a.passed).length;
      const passRate = totalCandidates > 0 ? Math.round((passedCandidates / totalCandidates) * 100) : 0;
      const scores = attempts.map(a => parseFloat(a.total_score || 0));
      const avgScore = totalCandidates > 0 ? (scores.reduce((a, b) => a + b, 0) / totalCandidates).toFixed(1) : 0;
      const maxScoreObtained = totalCandidates > 0 ? Math.max(...scores).toFixed(1) : 0;
      const testMaxMarks = test.total_marks || (attempts[0]?.max_score) || 100;

      const cardW = 120;
      const cardH = 45;
      const startX = 40;
      const gap = 11;
      const kpiY = doc.y;

      const kpis = [
        { label: 'ATTEMPTED', value: `${totalCandidates}`, color: textColor },
        { label: 'PASS RATE', value: `${passRate}%`, color: passRate >= 50 ? accentGreen : accentRed },
        { label: 'AVG SCORE', value: `${avgScore} / ${testMaxMarks}`, color: secondaryColor },
        { label: 'TOP SCORE', value: `${maxScoreObtained} / ${testMaxMarks}`, color: accentGreen }
      ];

      kpis.forEach((kpi, idx) => {
        const x = startX + idx * (cardW + gap);
        doc.roundedRect(x, kpiY, cardW, cardH, 4).fillAndStroke('#F8FAFC', borderLineColor);
        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(textMuted).text(kpi.label, x + 10, kpiY + 8);
        doc.fontSize(12).font('Helvetica-Bold').fillColor(kpi.color).text(kpi.value, x + 10, kpiY + 22);
      });

      doc.y = kpiY + 60;

      // ── Section 1: Candidate Score Summary Table ───────────────────────────
      doc.fontSize(12).font('Helvetica-Bold').fillColor(primaryColor).text('Candidate Examination Summary');
      doc.moveDown(0.4);

      // Table Header
      const tableTop = doc.y;
      doc.rect(40, tableTop, 515, 22).fill('#F1F5F9');

      const colSr = 48;
      const colName = 75;
      const colEmail = 210;
      const colScore = 340;
      const colPercent = 410;
      const colStatus = 475;

      doc.fontSize(8).font('Helvetica-Bold').fillColor(primaryColor);
      doc.text('SR', colSr, tableTop + 6);
      doc.text('STUDENT NAME', colName, tableTop + 6);
      doc.text('EMAIL / ID', colEmail, tableTop + 6);
      doc.text('SCORE', colScore, tableTop + 6);
      doc.text('%', colPercent, tableTop + 6);
      doc.text('RESULT', colStatus, tableTop + 6);

      let currentY = tableTop + 24;

      attempts.forEach((att, idx) => {
        // Page break handling
        if (currentY > 740) {
          doc.addPage();
          currentY = 50;
          doc.rect(40, currentY, 515, 20).fill('#F1F5F9');
          doc.fontSize(8).font('Helvetica-Bold').fillColor(primaryColor);
          doc.text('SR', colSr, currentY + 5);
          doc.text('STUDENT NAME', colName, currentY + 5);
          doc.text('EMAIL / ID', colEmail, currentY + 5);
          doc.text('SCORE', colScore, currentY + 5);
          doc.text('%', colPercent, currentY + 5);
          doc.text('RESULT', colStatus, currentY + 5);
          currentY += 22;
        }

        const isEven = idx % 2 === 0;
        if (isEven) {
          doc.rect(40, currentY - 2, 515, 18).fill('#FAFAFA');
        }

        const studentName = att.student_name || att.student?.full_name || `Candidate #${idx + 1}`;
        const studentEmail = att.student_email || att.student?.email || 'N/A';
        const scoreStr = `${parseFloat(att.total_score || 0).toFixed(1)} / ${parseFloat(att.max_score || testMaxMarks).toFixed(0)}`;
        const percentStr = `${parseFloat(att.percentage || 0).toFixed(1)}%`;

        let resultLabel = 'PENDING';
        let statusColor = '#B45309';

        if (att.result_status === 'RELEASED') {
          resultLabel = att.passed ? 'PASSED' : 'FAILED';
          statusColor = att.passed ? accentGreen : accentRed;
        } else if (att.result_status === 'READY') {
          resultLabel = 'EVALUATED';
          statusColor = secondaryColor;
        } else if (att.status === 'AUTO_SUBMITTED' || att.submission_status === 'AUTO_SUBMITTED') {
          resultLabel = 'AUTO_SUB';
          statusColor = accentRed;
        }

        doc.fontSize(8).font('Helvetica').fillColor(textMuted).text(String(idx + 1), colSr, currentY + 2);
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(textColor).text(studentName.slice(0, 24), colName, currentY + 2);
        doc.fontSize(8).font('Helvetica').fillColor(textMuted).text(studentEmail.slice(0, 26), colEmail, currentY + 2);
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(textColor).text(scoreStr, colScore, currentY + 2);
        doc.fontSize(8.5).font('Helvetica').fillColor(textColor).text(percentStr, colPercent, currentY + 2);

        doc.fontSize(7.5).font('Helvetica-Bold').fillColor(statusColor).text(resultLabel, colStatus, currentY + 2);

        // Thin divider line
        doc.strokeColor(borderLineColor).lineWidth(0.5).moveTo(40, currentY + 16).lineTo(555, currentY + 16).stroke();
        currentY += 18;
      });

      // ── Section 2: Detailed Candidate Performance Sheets ───────────────────
      // Add detailed student breakdown on subsequent pages
      attempts.forEach((att, idx) => {
        doc.addPage();

        // Student Header Box
        doc.rect(40, 40, 515, 4).fill(secondaryColor);
        doc.fontSize(14).font('Helvetica-Bold').fillColor(primaryColor).text(`Candidate Detailed Scorecard: ${att.student_name || 'Candidate'}`);
        doc.fontSize(9).font('Helvetica').fillColor(textMuted).text(`Candidate Email: ${att.student_email || 'N/A'} • Attempt ID: ${att.id || att.attempt_id}`);
        doc.moveDown(0.6);

        // Score Bar
        const cardY = doc.y;
        doc.roundedRect(40, cardY, 515, 40, 4).fillAndStroke('#F8FAFC', borderLineColor);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(textColor).text(`Final Score: ${att.total_score || 0} / ${att.max_score || testMaxMarks} (${att.percentage || 0}%)`, 55, cardY + 14);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(att.passed ? accentGreen : accentRed).text(att.passed ? 'STATUS: PASSED' : 'STATUS: NEEDS IMPROVEMENT', 340, cardY + 14);
        doc.y = cardY + 50;

        // Breakdown by Question Type if questions list available
        const questions = att.questions || att.responses || [];
        if (questions.length > 0) {
          doc.fontSize(11).font('Helvetica-Bold').fillColor(primaryColor).text('Question-by-Question Evaluation');
          doc.moveDown(0.3);

          questions.forEach((q, qIdx) => {
            if (doc.y > 700) {
              doc.addPage();
            }

            const isPending = Boolean(q.is_pending_review);
            const scoreText = isPending ? 'Pending Evaluation' : `${q.score_awarded || 0} / ${q.marks || 0} Marks`;
            const qType = (q.question_type || 'mcq').toUpperCase().replace('_', ' ');

            const qY = doc.y;
            doc.roundedRect(40, qY, 515, isPending || q.evaluation_comment ? 52 : 36, 4).lineWidth(0.5).strokeColor(borderLineColor).stroke();

            doc.fontSize(8.5).font('Helvetica-Bold').fillColor(primaryColor).text(`Q${qIdx + 1} [${qType}]`, 50, qY + 6);
            doc.fontSize(8).font('Helvetica-Bold').fillColor(isPending ? '#B45309' : q.score_awarded > 0 ? accentGreen : accentRed).text(scoreText, 430, qY + 6);

            const qText = (q.question_text || 'Assessment Question').replace(/\r?\n|\r/g, ' ');
            doc.fontSize(8).font('Helvetica').fillColor(textColor).text(qText.slice(0, 110) + (qText.length > 110 ? '...' : ''), 50, qY + 18, { width: 440 });

            if (q.evaluation_comment) {
              doc.fontSize(7.5).font('Helvetica-Oblique').fillColor(secondaryColor).text(`Teacher Feedback: ${q.evaluation_comment}`, 50, qY + 34, { width: 440 });
            }

            doc.y = qY + (isPending || q.evaluation_comment ? 58 : 42);
          });
        }
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
