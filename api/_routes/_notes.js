const express = require('express');
const requireAuth = require('../_middlewares/_authMiddleware');
const VoiceNote = require('../_models/_VoiceNote');
const connectDB = require('../_config/_db');

const router = express.Router();

// GET /api/notes
router.get('/', requireAuth, async (req, res) => {
    try {
        await connectDB();
        const query = { userId: req.user._id };
        if (req.query.folder) {
            query.folderId = req.query.folder;
        }
        
        const notes = await VoiceNote.find(query).sort({ createdAt: -1 }).populate('folderId');
        
        const formattedNotes = notes.map(n => {
            const doc = n.toJSON();
            if (doc.folderId) {
                doc.folder = doc.folderId;
                doc.folderName = doc.folderId.name;
            }
            return doc;
        });

        res.json({ notes: formattedNotes });
    } catch (err) {
        console.error('[notes] GET failed:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
