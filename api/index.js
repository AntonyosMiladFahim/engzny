const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./_routes/_auth');
const wahaRoutes = require('./_routes/_waha');
const foldersRoutes = require('./_routes/_folders');
const notesRoutes = require('./_routes/_notes');
const aiRoutes = require('./_routes/_ai');

const app = express();

// Parse JSON bodies. The `verify` callback captures the raw Buffer on
// req.rawBody so the WAHA webhook can perform HMAC-SHA256 signature
// verification without re-stringifying the already-parsed object
// (which could produce a different byte sequence than what WAHA signed).
app.use(express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    },
}));

// Basic Health Check Route
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok', message: 'Vercel Serverless API is operational!'
    });
});

// Feature routers
app.use('/api/auth', authRoutes);
app.use('/api/waha', wahaRoutes);
app.use('/api/folders', foldersRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/ai', aiRoutes);

// ⚠️ Vercel expects the app to be exported.
// For local development (`node api/index.js` / nodemon) we listen on a port.
// `require.main === module` is false when Vercel or a test suite imports this
// file, so neither of them accidentally opens a socket.
if (require.main === module) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Local server running on port ${PORT
        }`));
}

module.exports = app;