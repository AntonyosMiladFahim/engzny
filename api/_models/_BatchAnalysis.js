/**
 * api/_models/_BatchAnalysis.js
 * ------------------------------------------------------------------
 * BatchAnalysis model – tracks a bulk voice note analysis job for a
 * selected WhatsApp chat over a specific date/time range.
 * ------------------------------------------------------------------
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const batchAnalysisSchema = new Schema(
    {
        /**
         * Owning tenant user. Indexed for fast lookup of a user's batch jobs.
         */
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: [true, 'Batch analysis must belong to a user'],
            index: true,
        },

        /**
         * WhatsApp chat ID (e.g. 201001234567@c.us or group ID).
         */
        chatId: {
            type: String,
            required: [true, 'Chat ID is required'],
            trim: true,
        },

        /**
         * WhatsApp display name of the chat or contact at batch creation.
         */
        chatName: {
            type: String,
            trim: true,
            default: '',
        },

        /**
         * WhatsApp avatar image URL if available.
         */
        chatPicture: {
            type: String,
            trim: true,
            default: null,
        },

        /**
         * Start date and time for voice note filtering.
         */
        startDate: {
            type: Date,
            required: [true, 'Start date is required'],
        },

        /**
         * End date and time for voice note filtering.
         */
        endDate: {
            type: Date,
            required: [true, 'End date is required'],
        },

        /**
         * Execution status of the background analysis batch.
         */
        status: {
            type: String,
            enum: ['pending', 'processing', 'completed', 'failed'],
            default: 'pending',
            index: true,
        },

        /**
         * Total voice notes found within the date range in this chat.
         */
        totalNotes: {
            type: Number,
            default: 0,
        },

        /**
         * Number of voice notes processed so far.
         */
        processedNotes: {
            type: Number,
            default: 0,
        },

        /**
         * Number of voice notes that failed processing.
         */
        failedNotes: {
            type: Number,
            default: 0,
        },

        /**
         * Error message if the batch analysis failed globally.
         */
        error: {
            type: String,
            trim: true,
            default: null,
        },

        /**
         * References to all VoiceNote documents created as part of this batch.
         */
        noteIds: [
            {
                type: Schema.Types.ObjectId,
                ref: 'VoiceNote',
            },
        ],
    },
    {
        timestamps: true,
        toJSON: {
            transform(_doc, ret) {
                delete ret.__v;
                return ret;
            },
        },
    }
);

batchAnalysisSchema.index({ userId: 1, createdAt: -1 });

module.exports =
    mongoose.models.BatchAnalysis || mongoose.model('BatchAnalysis', batchAnalysisSchema);
