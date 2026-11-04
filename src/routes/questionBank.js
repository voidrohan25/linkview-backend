import { Router } from 'express';
import multer from 'multer';
import { questionBankController } from '../controllers/questionBankController.js';
import { authenticateToken, requireAnyRole } from '../middleware/auth.js';

const router = Router();

// Multer memory storage with 5MB limit for CSV uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB max
  },
  fileFilter: (req, file, cb) => {
    // Check extension or mime
    const isCsv = file.originalname.toLowerCase().endsWith('.csv') ||
                  file.mimetype === 'text/csv' ||
                  file.mimetype === 'application/vnd.ms-excel' ||
                  file.mimetype === 'text/plain';
    if (isCsv) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files (.csv) are accepted for bulk question import.'));
    }
  }
});

// All Question Bank operations require ADMIN or TEACHER role
router.use(authenticateToken, requireAnyRole('ADMIN', 'TEACHER'));

// ── CSV Import Endpoints ──
router.get('/csv/template', questionBankController.downloadTemplate);
router.post('/csv/preview', upload.single('file'), questionBankController.previewCSV);
router.post('/csv/import', upload.single('file'), questionBankController.importCSV);
router.post('/csv/error-report', questionBankController.downloadErrorReport);

// ── Question Bank CRUD & Retrieval ──
router.get('/bank/filters', questionBankController.getFilterOptions);
router.get('/bank', questionBankController.getQuestions);
router.get('/', questionBankController.getQuestions);

router.post('/bank', questionBankController.createQuestion);
router.post('/', questionBankController.createQuestion);

router.get('/bank/:id', questionBankController.getQuestionById);
router.get('/:id', questionBankController.getQuestionById);

router.put('/bank/:id', questionBankController.updateQuestion);
router.put('/:id', questionBankController.updateQuestion);

router.delete('/bank/:id', questionBankController.deleteQuestion);
router.delete('/:id', questionBankController.deleteQuestion);

export default router;
