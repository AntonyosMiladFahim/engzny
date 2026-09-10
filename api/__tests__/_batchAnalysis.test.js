/**
 * api/__tests__/_batchAnalysis.test.js
 * ------------------------------------------------------------------
 * Unit tests for Bulk WhatsApp Voice Note Analysis.
 * Tests startBatchAnalysis, getBatchAnalyses, getBatchDetail,
 * and the background worker task runBatchAnalysisTask.
 * ------------------------------------------------------------------
 */

const mongoose = require('mongoose');
const { startBatchAnalysis, getBatchAnalyses, getBatchDetail, _internal } = require('../_controllers/_aiController');

const { runBatchAnalysisTask } = _internal;

// Mocks
jest.mock('@google/generative-ai', () => {
    const mGenerateContent = jest.fn().mockResolvedValue({
        response: { text: () => JSON.stringify({ transcript: 'Mock transcript', summary: 'Mock summary' }) }
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
    getChatMessages: jest.fn(),
    downloadMedia: jest.fn(),
    sendText: jest.fn(),
}));

jest.mock('../_models/_BatchAnalysis', () => ({
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
}));

jest.mock('../_models/_VoiceNote', () => ({
    create: jest.fn(),
    find: jest.fn(),
}));

const waha = require('../_config/_waha');
const BatchAnalysis = require('../_models/_BatchAnalysis');
const VoiceNote = require('../_models/_VoiceNote');

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
}

const userIdA = new mongoose.Types.ObjectId().toString();
const batchIdA = new mongoose.Types.ObjectId().toString();

beforeEach(() => {
    jest.clearAllMocks();
});

describe('startBatchAnalysis', () => {
    test('400 if chatId is missing', async () => {
        const res = mockRes();
        await startBatchAnalysis({ body: { startDate: '2026-01-01', endDate: '2026-01-02' }, user: { id: userIdA } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'chatId is required' });
    });

    test('400 if startDate or endDate is missing', async () => {
        const res = mockRes();
        await startBatchAnalysis({ body: { chatId: '20100@c.us', startDate: '2026-01-01' }, user: { id: userIdA } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'startDate and endDate are required' });
    });

    test('400 if startDate > endDate', async () => {
        const res = mockRes();
        await startBatchAnalysis({ body: { chatId: '20100@c.us', startDate: '2026-01-05', endDate: '2026-01-01' }, user: { id: userIdA } }, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ message: 'startDate must be before or equal to endDate' });
    });

    test('202 creates batch analysis record and starts background task', async () => {
        const res = mockRes();
        const createdDoc = { _id: batchIdA, chatId: '20100@c.us', status: 'processing' };
        BatchAnalysis.create.mockResolvedValue(createdDoc);

        await startBatchAnalysis({
            body: {
                chatId: '20100@c.us',
                chatName: 'John Doe',
                startDate: '2026-01-01T00:00:00.000Z',
                endDate: '2026-01-07T00:00:00.000Z',
            },
            user: { id: userIdA },
        }, res);

        expect(res.status).toHaveBeenCalledWith(202);
        expect(res.json).toHaveBeenCalledWith(createdDoc);
        expect(BatchAnalysis.create).toHaveBeenCalledWith(expect.objectContaining({
            userId: userIdA,
            chatId: '20100@c.us',
            chatName: 'John Doe',
            status: 'processing',
        }));
    });
});

describe('getBatchAnalyses and getBatchDetail', () => {
    test('getBatchAnalyses returns user batches', async () => {
        const res = mockRes();
        const mockSort = jest.fn().mockResolvedValue([{ _id: batchIdA, chatName: 'Test' }]);
        BatchAnalysis.find.mockReturnValue({ sort: mockSort });

        await getBatchAnalyses({ user: { id: userIdA } }, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ batches: [{ _id: batchIdA, chatName: 'Test' }] });
    });

    test('getBatchDetail returns 404 if batch not found', async () => {
        const res = mockRes();
        BatchAnalysis.findOne.mockResolvedValue(null);

        await getBatchDetail({ params: { id: batchIdA }, user: { id: userIdA } }, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('getBatchDetail returns batch and notes if found', async () => {
        const res = mockRes();
        const mockBatch = { _id: batchIdA, chatName: 'Test Chat' };
        const mockNotes = [{ _id: 'note1', summary: 'Summary 1' }];

        BatchAnalysis.findOne.mockResolvedValue(mockBatch);
        const mockSort = jest.fn().mockResolvedValue(mockNotes);
        VoiceNote.find.mockReturnValue({ sort: mockSort });

        await getBatchDetail({ params: { id: batchIdA }, user: { id: userIdA } }, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ batch: mockBatch, notes: mockNotes });
    });
});

describe('runBatchAnalysisTask background worker', () => {
    test('fetches messages, processes matching voice notes, and updates batch status', async () => {
        const startDate = new Date('2026-01-01T00:00:00.000Z');
        const endDate = new Date('2026-01-10T00:00:00.000Z');
        const targetChatId = '20100@c.us';

        waha.getChatMessages.mockResolvedValue([
            {
                id: 'msg-1',
                hasMedia: true,
                type: 'ptt',
                timestamp: Math.floor(new Date('2026-01-05T12:00:00.000Z').getTime() / 1000),
                from: targetChatId,
                notifyName: 'Sender Alice',
            },
        ]);

        waha.downloadMedia.mockResolvedValue({
            mimetype: 'audio/ogg',
            buffer: Buffer.from('mock-audio-data'),
        });

        VoiceNote.create.mockResolvedValue({ _id: 'note-99' });

        await runBatchAnalysisTask(userIdA, batchIdA, targetChatId, startDate, endDate);

        expect(waha.getChatMessages).toHaveBeenCalledWith(userIdA, targetChatId, 500);
        expect(waha.downloadMedia).toHaveBeenCalledWith(userIdA, 'msg-1');
        expect(VoiceNote.create).toHaveBeenCalledWith(expect.objectContaining({
            userId: userIdA,
            batchId: batchIdA,
            senderName: 'Sender Alice',
        }));
        expect(BatchAnalysis.findByIdAndUpdate).toHaveBeenCalledWith(batchIdA, { status: 'completed' });
    });
});
