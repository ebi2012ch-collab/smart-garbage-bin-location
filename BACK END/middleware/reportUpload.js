const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname)),
});

module.exports = multer({
  storage,
  limits: { fileSize: (process.env.MAX_FILE_SIZE_MB || 5) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extensionOk = /jpeg|jpg|png|webp|gif/.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = /jpeg|jpg|png|webp|gif/.test(file.mimetype);
    cb(extensionOk && mimeOk ? null : new Error('Only image files are allowed.'), extensionOk && mimeOk);
  },
});
