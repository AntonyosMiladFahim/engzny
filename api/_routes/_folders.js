const express = require('express');
const requireAuth = require('../_middlewares/_authMiddleware');
const Folder = require('../_models/_Folder');
const VoiceNote = require('../_models/_VoiceNote');
const connectDB = require('../_config/_db');

const router = express.Router();

// GET /api/folders
router.get('/', requireAuth, async (req, res) => {
    try {
        await connectDB();
        const folders = await Folder.find({ userId: req.user._id }).lean();
        
        const counts = await VoiceNote.aggregate([
            { $match: { userId: req.user._id, folderId: { $ne: null } } },
            { $group: { _id: '$folderId', count: { $sum: 1 } } }
        ]);
        
        const countMap = counts.reduce((acc, c) => ({ ...acc, [c._id]: c.count }), {});
        
        const foldersWithCount = folders.map(f => ({
            ...f,
            id: f._id,
            count: countMap[f._id] || 0
        }));

        res.json({ folders: foldersWithCount });
    } catch (err) {
        console.error('[folders] GET failed:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// POST /api/folders
router.post('/', requireAuth, async (req, res) => {
    try {
        await connectDB();
        const { name } = req.body;
        if (!name) return res.status(400).json({ message: 'Folder name is required' });
        
        const folder = await Folder.create({ name, userId: req.user._id });
        res.status(201).json({ folder });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ message: 'Folder already exists' });
        console.error('[folders] POST failed:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
