/**
 * api/_controllers/_aiController.js
 * ------------------------------------------------------------------
 * Handles AI summarization of voice notes from both Frontend and WhatsApp.
 * 
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

const connectDB = require('../_config/_db');
const waha = require('../_config/_waha');
const Folder = require('../_models/_Folder');
const VoiceNote = require('../_models/_VoiceNote');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy-key');

/**
 * Helper to call Gemini API and summarize the audio buffer.
 */
async function generateSummary(mimeType, base64Data) {
    // gemini-1.5-flash: fast, cheap, supports inline audio up to ~9 MB
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = 'Please concisely transcribe and summarize this voice note.';
    
    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: base64Data,
                mimeType: mimeType || 'audio/ogg',
            },
        },
    ]);
    return result.response.text();
}

/**
 * POST /api/ai/upload (requireAuth)
 * 
 * Frontend upload handler. Accepts raw Base64 audio.
 * Saves the note and validates folder ownership.
 */
async function uploadVoiceNote(req, res) {
    const { audioBase64, mimeType, folderId } = req.body;

    if (!audioBase64) {
        return res.status(400).json({ message: 'Audio payload (audioBase64) is required' });
    }

    try {
        await connectDB();
        
        // 1. Verify Folder Ownership if folderId is provided
        if (folderId) {
            if (!mongoose.isValidObjectId(folderId)) {
                return res.status(400).json({ message: 'Invalid folder ID' });
            }
            const folder = await Folder.findOne({ _id: folderId, userId: req.user.id });
            if (!folder) {
                return res.status(403).json({ message: 'Folder not found or access denied' });
            }
        }

        // 2. Generate Summary via Gemini
        const summary = await generateSummary(mimeType, audioBase64);

        // 3. Save to Database
        // For now, pending architectural decision on S3, we strictly store the base64 payload
        const originalAudioUrl = `data:${mimeType || 'audio/ogg'};base64,${audioBase64}`;
        
        const note = await VoiceNote.create({
            userId: req.user.id,
            folderId: folderId || null,
            originalAudioUrl,
            summary,
        });

        return res.status(201).json(note);
    } catch (err) {
        console.error('[ai] uploadVoiceNote failed:', err);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

/**
 * POST /api/ai/webhook (Unauthenticated)
 * 
 * WAHA webhook handler. When a message is received on a session, WAHA posts here.
 * The WAHA session name IS the userId.
 */
async function wahaWebhook(req, res) {
    // Fast response to WAHA acknowledging receipt
    res.status(200).send('OK');

    const { event, session, payload } = req.body;

    // We only care about new messages containing media
    if (event !== 'message' || !payload || !payload.hasMedia) {
        return;
    }

    // `session` is strictly our user's ID, ensuring isolation
    if (!session || !mongoose.isValidObjectId(session)) {
        console.warn(`[ai] Webhook received invalid session name: ${session}`);
        return;
    }

    try {
        await connectDB();
        
        const messageId = payload.id;
        const chatId = payload.from;

        // 1. Download media buffer from WAHA
        const { mimetype, buffer } = await waha.downloadMedia(session, messageId);
        const base64Data = buffer.toString('base64');

        // 2. Generate Summary via Gemini
        const summary = await generateSummary(mimetype, base64Data);

        // 3. Save to Database
        const originalAudioUrl = `data:${mimetype};base64,${base64Data}`;
        await VoiceNote.create({
            userId: session,
            folderId: null, // webhooks hit the "inbox" (unfiled)
            originalAudioUrl,
            summary,
        });

        // 4. Reply strictly back to the original req.user.id (session)
        await waha.sendText(session, chatId, `*Summary:*\n${summary}`);

    } catch (err) {
        console.error('[ai] wahaWebhook processing failed:', err.message);
    }
}

module.exports = {
    uploadVoiceNote,
    wahaWebhook,
    // Exported for unit tests
    _internal: { generateSummary },
};
