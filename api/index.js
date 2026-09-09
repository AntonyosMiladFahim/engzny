const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./_routes/_auth');

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

// ⚠️ Vercel expects the app to be exported.
// For local development, we listen on the port from your environment.
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 Local server running on port ${PORT
        }`));
}

module.exports = app;