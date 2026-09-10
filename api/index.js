const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./_routes/_auth');
const wahaRoutes = require('./_routes/_waha');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Basic Health Check Route
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok', message: 'Vercel Serverless API is operational!'
    });
});

// Feature routers
app.use('/api/auth', authRoutes);
app.use('/api/waha', wahaRoutes);

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