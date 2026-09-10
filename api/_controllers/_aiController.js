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
const BatchAnalysis = require('../_models/_BatchAnalysis');
const { chatId, isGroupChat } = require('../_utils/_contact');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'dummy-key');

/** Longest sender name / id we will persist. Guards against hostile payloads. */
const MAX_SENDER_FIELD = 120;

/**
 * Return the first argument that is a non-blank string, trimmed and capped.
 * @param {...unknown} candidates
 * @returns {string} '' when nothing usable was supplied
 */
function firstText(...candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim().slice(0, MAX_SENDER_FIELD);
        }
    }
    return '';
}

/**
 * Pull the contact identity out of a WAHA `message` event payload.
 *
 * WAHA's payload shape is engine-dependent — the docs are explicit that
 * `_data` holds "internal engine data, can be different for each engine" — so
 * we probe every field the two engines we support are known to use instead of
 * betting on one:
 *
 *   WEBJS : payload._data.notifyName          (+ payload._data.author in groups)
 *   NOWEB : payload.pushName / payload._data.pushName
 *   Both  : payload.notifyName on newer builds, verifiedBizName for businesses
 *
 * Group chats are the subtle case: `payload.from` is the *group* id
 * (`…@g.us`), and the human who actually recorded the note is in
 * `participant` / `_data.author`. Grouping by `from` there would file every
 * member of a group under one pseudo-contact, so we prefer the participant.
 *
 * @param {object} payload WAHA `message` event payload
 * @returns {{ senderId: string|null, senderName: string }}
 */
function extractSender(payload = {}) {
    const data = (payload && payload._data) || {};

    const from = chatId(payload.from);
    const participant = chatId(payload.participant ?? data.participant ?? data.author);

    // In a group the participant is the person; in a 1:1 chat `from` already is.
    const senderId = (isGroupChat(from) ? participant || from : from) || null;

    const senderName = firstText(
        data.notifyName,      // WEBJS
        payload.notifyName,   // newer WAHA builds
        payload.pushName,     // NOWEB
        data.pushName,        // NOWEB raw
        data.verifiedBizName, // WhatsApp Business accounts
        payload.participantName
    );

    return { senderId: senderId ? senderId.slice(0, MAX_SENDER_FIELD) : null, senderName };
}

/**
 * Call Gemini and return { transcript, summary } for the given audio.
 *
 * PROMPT DESIGN
 * -------------
 * We instruct the model to respond with a *single* JSON object containing
 * exactly two keys:
 *
 *   transcript – the verbatim spoken words in the original language (Arabic,
 *                English, or code-switched). NO paraphrasing, NO omissions.
 *   summary    – a concise, clean digest in the same language as the speaker.
 *
 * We explicitly:
 *   - Forbid markdown syntax (**, __, >, #, -).
 *   - Forbid English meta-text ("Transcription:", "Summary:", "Here is…").
 *   - Require only the JSON object in the response, nothing before or after.
 *
 * PARSING
 * -------
 * Some model versions wrap the JSON in a ```json … ``` code fence even when
 * asked not to. We strip the fence before parsing. If parsing still fails we
 * fall back gracefully: the raw text is stored as the summary and transcript
 * is left empty, so the note is never silently lost.
 *
 * @param {string} mimeType  MIME type of the audio (e.g. 'audio/ogg')
 * @param {string} base64Data  base64-encoded audio bytes
 * @returns {Promise<{ transcript: string, summary: string }>}
 */
async function generateSummary(mimeType, base64Data) {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });

    const prompt = [
        'Listen to the audio and identify the language being spoken.',
        'Transcribe it and summarize it.',
        'You MUST respond entirely in the ORIGINAL LANGUAGE spoken in the audio — never in English unless the audio itself is in English.',
        '',
        'Return your response as a strict JSON object with exactly two keys:',
        '  "transcript" — the verbatim words spoken, in the original language.',
        '  "summary"    — a concise summary (2–5 sentences) of the main point, in the original language.',
        '',
        'Rules:',
        '  - Do NOT wrap the response in markdown code blocks like ```json.',
        '  - Do NOT add any English labels, headers, or wrapper text.',
        '  - Do NOT use markdown formatting (**, __, >, #, or lists) inside the values.',
        '  - If the audio is inaudible or empty, set both values to an empty string.',
        '',
        'Respond with ONLY the JSON object. Example:',
        '{"transcript":"…verbatim words in original language…","summary":"…concise summary in original language…"}',
    ].join('\n');


    const result = await model.generateContent([
        prompt,
        {
            inlineData: {
                data: base64Data,
                mimeType: mimeType || 'audio/ogg',
            },
        },
    ]);

    const raw = result.response.text();

    // Strip markdown code fences the model may add despite instructions.
    const cleaned = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();

    try {
        const parsed = JSON.parse(cleaned);
        return {
            transcript: typeof parsed.transcript === 'string' ? parsed.transcript.trim() : '',
            summary:    typeof parsed.summary    === 'string' ? parsed.summary.trim()    : '',
        };
    } catch (parseErr) {
        // The model returned something unparseable. Keep the raw text in
        // summary so the note is not silently lost; transcript will be empty.
        console.warn('[ai] JSON parse failed, storing raw text as summary:', parseErr.message);
        return { transcript: '', summary: cleaned };
    }
}

/**
 * POST /api/ai/upload (requireAuth)
 * 
 * Frontend upload handler. Accepts raw Base64 audio.
 * Saves the note and validates folder ownership.
 */
async function uploadVoiceNote(req, res) {
    const { audioBase64, mimeType, folderId, senderName, senderId, timestamp } = req.body;

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

        // 2. Generate transcript + summary via Gemini
        const { transcript, summary } = await generateSummary(mimeType, audioBase64);

        // 3. Save to Database
        // For now, pending architectural decision on S3, we strictly store the base64 payload
        const originalAudioUrl = `data:${mimeType || 'audio/ogg'};base64,${audioBase64}`;

        // If the caller provided a timestamp (ms since epoch), use it as the
        // document's createdAt. This allows PWA share-target uploads to be dated
        // to the file's lastModified rather than the server insertion time.
        // We cap at Date.now() to guard against future-dated values.
        const maybeCreatedAt =
            typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
                ? new Date(Math.min(timestamp, Date.now()))
                : undefined;

        const note = await VoiceNote.create({
            userId: req.user.id,
            folderId: folderId || null,
            // Optional attribution: the Web Share Target hands us a file with
            // no WhatsApp envelope, but a caller that *does* know who sent it
            // (e.g. a future "forward to engzny" flow) can say so and the note
            // will group under that contact like any webhook note.
            senderId: firstText(senderId) || null,
            senderName: firstText(senderName),
            originalAudioUrl,
            transcript,
            summary,
            ...(maybeCreatedAt ? { createdAt: maybeCreatedAt } : {}),
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

    // ── Strict content-type guard ─────────────────────────────────────────
    // Ignore WhatsApp Statuses (Stories). WAHA routes these through the
    // same webhook but they are ephemeral broadcast content — not voice notes.
    if (payload.from === 'status@broadcast' || payload.chatId === 'status@broadcast') {
        return;
    }

    // Only process push-to-talk voice notes and regular audio messages.
    // Images, videos, stickers, and documents are silently dropped here so
    // we never attempt to pass binary image/video data to Gemini's audio API,
    // and we never waste a lambda invocation on non-audio media.
    const mediaType = (payload.type ?? 'ptt').toLowerCase();
    if (mediaType && mediaType !== 'ptt' && mediaType !== 'audio') {
        console.log(`[waha/webhook] Skipping non-audio message (type=${mediaType || 'unknown'})`);
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
        // Where the *reply* goes: always the originating chat, group or not.
        const replyChatId = payload.from;
        // Who the note is *filed under*: the human, even inside a group.
        const { senderId, senderName } = extractSender(payload);

        // 1. Download media buffer from WAHA
        // ── Isolated try/catch so a network timeout or socket hang-up on
        //    the download leg does NOT cascade into the Gemini call or the
        //    DB write. A failed download is logged and the handler exits
        //    cleanly. The outer HTTP response (200 OK) was already sent, so
        //    WAHA will not retry.
        let mimetype, base64Data;
        try {
            const media = await waha.downloadMedia(session, messageId);
            mimetype   = media.mimetype;
            base64Data = media.buffer.toString('base64');
        } catch (dlErr) {
            console.error('[waha/webhook] Failed to download media from WAHA:', dlErr.message);
            return; // exit cleanly — do not attempt Gemini with no buffer
        }

        // 2. Generate transcript + summary via Gemini
        const { transcript, summary } = await generateSummary(mimetype, base64Data);

        // 3. Save to Database — use the WAHA message timestamp as createdAt so
        //    the note is filed under when it was actually *sent*, not when our
        //    server processed it. payload.timestamp is UNIX seconds; Mongoose
        //    accepts a Date, and `timestamps: true` will not overwrite an
        //    explicitly-supplied createdAt.
        const originalAudioUrl = `data:${mimetype};base64,${base64Data}`;
        const msgTimestamp = typeof payload.timestamp === 'number' && payload.timestamp > 0
            ? new Date(payload.timestamp * 1000)
            : new Date();

        await VoiceNote.create({
            userId: session,
            folderId: null, // webhooks hit the "inbox" (unfiled)
            senderId,
            senderName,
            originalAudioUrl,
            transcript,
            summary,
            createdAt: msgTimestamp,
        });

        // 4. Reply strictly back to the original req.user.id (session)
        // Use the clean summary (not the full transcript) for the WhatsApp reply.
        await waha.sendText(session, replyChatId, `*Summary:*\n${summary}`);

    } catch (err) {
        console.error('[ai] wahaWebhook processing failed:', err.message);
    }
}

/**
 * Background worker task for running a batch analysis asynchronously.
 */
/**
 * Helper to generate individual text message summary via Gemini.
 */
async function generateTextSummary(textBody) {
    if (!textBody || textBody.length < 50) {
        return { transcript: textBody, summary: textBody };
    }
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
        const prompt = [
            'Summarize the following message in its original language.',
            'Respond with ONLY a JSON object: {"transcript": "...", "summary": "..."}',
            `Message: "${textBody}"`,
        ].join('\n');
        const result = await model.generateContent(prompt);
        const raw = result.response.text();
        const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
        const parsed = JSON.parse(cleaned);
        return {
            transcript: textBody,
            summary: parsed.summary || textBody,
        };
    } catch {
        return { transcript: textBody, summary: textBody };
    }
}

/**
 * Helper to generate overall chat summary for the entire date range.
 */
async function generateOverallChatSummary(conversationLog) {
    if (!conversationLog || !conversationLog.trim()) return '';
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
        const prompt = [
            'Analyze and summarize the following chat conversation between participants during the selected date range.',
            'Provide a clear, structured executive summary in the ORIGINAL LANGUAGE spoken/written.',
            'Highlight key topics discussed, decisions made, action items, and important updates.',
            'Do NOT use markdown headers (# or ##), but bullet points (-) are allowed.',
            '',
            `Conversation History:\n${conversationLog.slice(0, 10000)}`,
        ].join('\n');
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (err) {
        console.warn('[batch-analyze] Could not generate overall chat summary:', err.message);
        return '';
    }
}

/**
 * Background worker task for running a batch analysis asynchronously (text + voice notes).
 */
async function runBatchAnalysisTask(userId, batchId, targetChatId, startDate, endDate) {
    try {
        await connectDB();
        const session = String(userId);

        let rawMessages = [];
        try {
            rawMessages = await waha.getChatMessages(session, targetChatId, 500);
        } catch (err) {
            console.error('[batch-analyze] Failed to fetch chat messages:', err.message);
            await BatchAnalysis.findByIdAndUpdate(batchId, {
                status: 'failed',
                error: 'Could not fetch messages from WhatsApp chat',
            });
            return;
        }

        const startMs = new Date(startDate).getTime();
        const endMs = new Date(endDate).getTime();

        const matching = (Array.isArray(rawMessages) ? rawMessages : []).filter((msg) => {
            if (!msg) return false;
            const hasMedia = msg.hasMedia || Boolean(msg.media);
            const mType = (msg.type || msg.mediaType || '').toLowerCase();
            const mime = (msg.media?.mimetype || msg._data?.mimetype || '').toLowerCase();
            const isAudio = mType === 'ptt' || mType === 'audio' || mime.startsWith('audio/');
            const isText = (typeof msg.body === 'string' && msg.body.trim().length > 0) ||
                           (typeof msg._data?.body === 'string' && msg._data.body.trim().length > 0);

            if (!isAudio && !isText) return false;

            const rawTs = msg.timestamp || msg._data?.t;
            if (!rawTs) return false;
            const tsMs = typeof rawTs === 'number' && rawTs < 1e11 ? rawTs * 1000 : Number(rawTs);
            return tsMs >= startMs && tsMs <= endMs;
        });

        await BatchAnalysis.findByIdAndUpdate(batchId, {
            totalNotes: matching.length,
            status: matching.length === 0 ? 'completed' : 'processing',
        });

        if (matching.length === 0) {
            return;
        }

        matching.sort((a, b) => {
            const tA = a.timestamp || a._data?.t || 0;
            const tB = b.timestamp || b._data?.t || 0;
            return tA - tB;
        });

        const conversationEntries = [];

        for (const msg of matching) {
            try {
                const messageId = msg.id?._serialized || msg.id;
                const rawTs = msg.timestamp || msg._data?.t;
                const msgDate = new Date(typeof rawTs === 'number' && rawTs < 1e11 ? rawTs * 1000 : Number(rawTs));
                const { senderId, senderName } = extractSender(msg);
                const sName = senderName || 'WhatsApp Contact';

                const mType = (msg.type || msg.mediaType || '').toLowerCase();
                const mime = (msg.media?.mimetype || msg._data?.mimetype || '').toLowerCase();
                const isAudio = (msg.hasMedia || Boolean(msg.media)) && (mType === 'ptt' || mType === 'audio' || mime.startsWith('audio/'));

                let transcript = '';
                let summary = '';
                let originalAudioUrl = null;
                let messageType = 'text';

                if (isAudio) {
                    messageType = 'audio';
                    let mimetype = 'audio/ogg';
                    let base64Data = null;

                    try {
                        const media = await waha.downloadMedia(session, messageId);
                        mimetype = media.mimetype;
                        base64Data = media.buffer.toString('base64');
                    } catch (dlErr) {
                        console.warn(`[batch-analyze] Could not download message ${messageId}:`, dlErr.message);
                        await BatchAnalysis.findByIdAndUpdate(batchId, { $inc: { failedNotes: 1 } });
                        continue;
                    }

                    const resAI = await generateSummary(mimetype, base64Data);
                    transcript = resAI.transcript;
                    summary = resAI.summary;
                    originalAudioUrl = `data:${mimetype};base64,${base64Data}`;
                } else {
                    messageType = 'text';
                    const textContent = (msg.body || msg._data?.body || '').trim();
                    const resAI = await generateTextSummary(textContent);
                    transcript = resAI.transcript;
                    summary = resAI.summary;
                }

                const note = await VoiceNote.create({
                    userId,
                    batchId,
                    folderId: null,
                    senderId: senderId || targetChatId,
                    senderName: sName,
                    messageType,
                    originalAudioUrl,
                    transcript,
                    summary,
                    createdAt: msgDate,
                });

                conversationEntries.push(`[${msgDate.toLocaleTimeString()}] ${sName}: ${summary || transcript}`);

                await BatchAnalysis.findByIdAndUpdate(batchId, {
                    $inc: { processedNotes: 1 },
                    $push: { noteIds: note._id },
                });
            } catch (noteErr) {
                console.error('[batch-analyze] Error processing note:', noteErr.message);
                await BatchAnalysis.findByIdAndUpdate(batchId, { $inc: { failedNotes: 1 } });
            }
        }

        // Generate overall chat summary
        const overallSummary = await generateOverallChatSummary(conversationEntries.join('\n'));

        await BatchAnalysis.findByIdAndUpdate(batchId, {
            status: 'completed',
            overallSummary,
        });
    } catch (err) {
        console.error('[batch-analyze] Global task error:', err.message);
        await BatchAnalysis.findByIdAndUpdate(batchId, {
            status: 'failed',
            error: err.message,
        });
    }
}

/**
 * POST /api/ai/batch-analyze (requireAuth)
 * Starts a background bulk chat analysis job. Responds immediately (202 Accepted).
 */
async function startBatchAnalysis(req, res) {
    const { chatId, chatName, chatPicture, startDate, endDate } = req.body;

    if (!chatId || typeof chatId !== 'string') {
        return res.status(400).json({ message: 'chatId is required' });
    }
    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'startDate and endDate are required' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ message: 'Invalid startDate or endDate' });
    }
    if (start > end) {
        return res.status(400).json({ message: 'startDate must be before or equal to endDate' });
    }

    try {
        await connectDB();

        const batch = await BatchAnalysis.create({
            userId: req.user.id,
            chatId: chatId.trim(),
            chatName: (chatName || '').trim(),
            chatPicture: chatPicture || null,
            startDate: start,
            endDate: end,
            status: 'processing',
            totalNotes: 0,
            processedNotes: 0,
            failedNotes: 0,
            noteIds: [],
        });

        res.status(202).json(batch);

        setImmediate(() => {
            runBatchAnalysisTask(req.user.id, batch._id, chatId.trim(), start, end);
        });
    } catch (err) {
        console.error('[ai] startBatchAnalysis failed:', err.message);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

/**
 * GET /api/ai/batches (requireAuth)
 * Returns all bulk batch analyses for the authenticated user.
 */
async function getBatchAnalyses(req, res) {
    try {
        await connectDB();
        const batches = await BatchAnalysis.find({ userId: req.user.id }).sort({ createdAt: -1 });
        return res.status(200).json({ batches });
    } catch (err) {
        console.error('[ai] getBatchAnalyses failed:', err.message);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

/**
 * GET /api/ai/batches/:id (requireAuth)
 * Returns a batch analysis with populated notes for the authenticated user.
 */
async function getBatchDetail(req, res) {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ message: 'Invalid batch ID' });
    }

    try {
        await connectDB();
        const batch = await BatchAnalysis.findOne({ _id: id, userId: req.user.id });
        if (!batch) {
            return res.status(404).json({ message: 'Batch analysis not found' });
        }

        const notes = await VoiceNote.find({ batchId: batch._id, userId: req.user.id }).sort({ createdAt: 1 });

        return res.status(200).json({ batch, notes });
    } catch (err) {
        console.error('[ai] getBatchDetail failed:', err.message);
        return res.status(500).json({ message: 'Internal server error' });
    }
}

module.exports = {
    uploadVoiceNote,
    wahaWebhook,
    startBatchAnalysis,
    getBatchAnalyses,
    getBatchDetail,
    // Exported for unit tests
    _internal: { generateSummary, extractSender, runBatchAnalysisTask },
};
