/**
 * api/__tests__/_aiController.test.js
 * ------------------------------------------------------------------
 * Unit tests for the AI Controller.
 * Tests folder ownership validation and WAHA webhook handling.
 * ------------------------------------------------------------------
 */

const mongoose = require('mongoose');
const { uploadVoiceNote, wahaWebhook } = require('../_controllers/_aiController');

// Mocks
jest.mock('@google/generative-ai', () => {
    const mGenerateContent = jest.fn().mockResolvedValue({
        response: { text: () => JSON.stringify({ transcript: 'Mock transcript', summary: 'Mocked summary from Gemini' }) }
    });
    return {
        GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
            getGenerativeModel: jest.fn().mockReturnValue({
                generateContent: mGenerateContent
            })
        }))
    };
});

jest.mock('../_config/_db', () => jest.fn().mockResolvedValue({}));
jest.mock('../_config/_waha', () => ({
    downloadMedia: jest.fn(),
    sendText: jest.fn(),
}));

jest.mock('../_models/_Folder', () => ({
    findOne: jest.fn(),
}));

jest.mock('../_models/_VoiceNote', () => ({
    create: jest.fn(),
}));

const waha = require('../_config/_waha');
const Folder = require('../_models/_Folder');
const VoiceNote = require('../_models/_VoiceNote');

// ---- Helpers -------------------------------------------------------------

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
}

const userIdA = new mongoose.Types.ObjectId().toString();
const userIdB = new mongoose.Types.ObjectId().toString();
const folderIdA = new mongoose.Types.ObjectId().toString();

beforeEach(() => {
    jest.clearAllMocks();
});

// ---- uploadVoiceNote -----------------------------------------------------

describe('uploadVoiceNote', () => {
    test('400 if audioBase64 is missing', async () => {
        const res = mockRes();
        await uploadVoiceNote({ body: {}, user: { id: userIdA } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(Folder.findOne).not.toHaveBeenCalled();
    });

    test('400 if folderId is provided but invalid ObjectId', async () => {
        const res = mockRes();
        await uploadVoiceNote({ body: { audioBase64: 'base64', folderId: 'invalid' }, user: { id: userIdA } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    test('403 if user tries to save to a folder they do not own (User B folder)', async () => {
        const res = mockRes();
        Folder.findOne.mockResolvedValue(null); // Not found or doesn't belong to userIdA
        
        await uploadVoiceNote({ 
            body: { audioBase64: 'base64', folderId: folderIdA }, 
            user: { id: userIdA } 
        }, res);

        expect(Folder.findOne).toHaveBeenCalledWith({ _id: folderIdA, userId: userIdA });
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ message: 'Folder not found or access denied' });
        expect(VoiceNote.create).not.toHaveBeenCalled();
    });

    test('201 saves note successfully if folder is owned by user', async () => {
        const res = mockRes();
        Folder.findOne.mockResolvedValue({ _id: folderIdA, userId: userIdA });
        VoiceNote.create.mockResolvedValue({ _id: 'note123' });

        await uploadVoiceNote({ 
            body: { audioBase64: 'dummy-audio', folderId: folderIdA, mimeType: 'audio/mp4' }, 
            user: { id: userIdA } 
        }, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(VoiceNote.create).toHaveBeenCalledWith(expect.objectContaining({
            userId: userIdA,
            folderId: folderIdA,
            originalAudioUrl: 'data:audio/mp4;base64,dummy-audio',
            summary: 'Mocked summary from Gemini'
        }));
    });

    test('201 saves note to inbox (unfiled) if folderId is omitted', async () => {
        const res = mockRes();
        VoiceNote.create.mockResolvedValue({ _id: 'note123' });

        await uploadVoiceNote({ 
            body: { audioBase64: 'dummy-audio' }, 
            user: { id: userIdA } 
        }, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(Folder.findOne).not.toHaveBeenCalled();
        expect(VoiceNote.create).toHaveBeenCalledWith(expect.objectContaining({
            userId: userIdA,
            folderId: null,
            originalAudioUrl: 'data:audio/ogg;base64,dummy-audio',
            summary: 'Mocked summary from Gemini'
        }));
    });
});

// ---- wahaWebhook ---------------------------------------------------------

describe('wahaWebhook', () => {
    test('immediately responds 200 OK to WAHA', async () => {
        const res = mockRes();
        await wahaWebhook({ body: { event: 'ping' } }, res);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('OK');
    });

    test('ignores non-message events or messages without media', async () => {
        const res = mockRes();
        await wahaWebhook({ body: { event: 'message', payload: { hasMedia: false } } }, res);
        expect(waha.downloadMedia).not.toHaveBeenCalled();
    });

    test('ignores webhook if session is not a valid ObjectId (ensures tenant isolation)', async () => {
        const res = mockRes();
        await wahaWebhook({ 
            body: { event: 'message', session: 'global-session', payload: { hasMedia: true } } 
        }, res);
        expect(waha.downloadMedia).not.toHaveBeenCalled();
    });

    test('processes valid media message, saves note, and sends WAHA reply', async () => {
        const res = mockRes();
        const chatId = 'sender@c.us';
        const messageId = 'msg-123';

        waha.downloadMedia.mockResolvedValue({
            mimetype: 'audio/ogg',
            buffer: Buffer.from('fake-audio-buffer')
        });

        await wahaWebhook({ 
            body: { 
                event: 'message', 
                session: userIdA, 
                payload: { id: messageId, from: chatId, hasMedia: true } 
            } 
        }, res);

        // 1. Downloaded media from WAHA
        expect(waha.downloadMedia).toHaveBeenCalledWith(userIdA, messageId);

        // 2. Created VoiceNote in DB
        expect(VoiceNote.create).toHaveBeenCalledWith(expect.objectContaining({
            userId: userIdA,
            folderId: null, // inbox
            summary: 'Mocked summary from Gemini',
            originalAudioUrl: expect.stringContaining('base64,')
        }));

        // 3. Sent reply strictly back to the original session
        expect(waha.sendText).toHaveBeenCalledWith(userIdA, chatId, '*Summary:*\nMocked summary from Gemini');
    });

    test('handles waha download or processing failure gracefully', async () => {
        const res = mockRes();
        waha.downloadMedia.mockRejectedValue(new Error('Network error'));
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

        await wahaWebhook({ 
            body: { 
                event: 'message', 
                session: userIdA, 
                payload: { id: 'msg-123', from: 'sender@c.us', hasMedia: true } 
            } 
        }, res);

        expect(waha.sendText).not.toHaveBeenCalled();
        expect(VoiceNote.create).not.toHaveBeenCalled();
        
        spy.mockRestore();
    });
});
