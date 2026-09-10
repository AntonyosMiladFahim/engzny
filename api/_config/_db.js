/**
 * api/_config/_db.js
 * ------------------------------------------------------------------
 * MongoDB (Atlas) connection helper for Vercel Serverless functions.
 *
 * WHY CACHING MATTERS ON SERVERLESS
 * ----------------------------------
 * Every Vercel function invocation runs inside a lambda container. A container
 * may be *reused* (warm start) or *freshly created* (cold start). Module-level
 * variables survive across warm invocations, but the Node.js module registry
 * itself can be re-evaluated by some bundlers/HMR setups. To be safe we stash
 * the connection promise on the **global** object, which is the most durable
 * place available inside a single container.
 *
 * Without this cache, each request would open a brand-new pool of sockets to
 * Atlas, quickly exhausting the cluster's connection limit (e.g. 500 on M0/M2)
 * and adding ~100-300 ms of handshake latency per request.
 *
 * WHY WE CACHE THE *PROMISE* AND NOT JUST THE CONNECTION
 * ------------------------------------------------------
 * If two requests hit a cold container at the same instant, both would see
 * `conn === null` and both would call `mongoose.connect()`. Caching the
 * in-flight promise makes the second caller simply `await` the first call.
 *
 * File is prefixed with `_` so Vercel does NOT treat it as an HTTP route.
 * ------------------------------------------------------------------
 */

const mongoose = require('mongoose');

// Read the connection string once. It is validated lazily inside connectDB()
// so that merely `require`-ing this module (e.g. in unit tests) never throws.
const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Global cache shape:
 *   global._mongoose = { conn: <mongoose instance> | null,
 *                        promise: <Promise<mongoose>> | null }
 *
 * We namespace it under `_mongoose` to avoid colliding with anything else
 * that might live on `global`.
 */
let cached = global._mongoose;

if (!cached) {
    cached = global._mongoose = { conn: null, promise: null };
}

/**
 * connectDB
 * ---------
 * Returns a connected Mongoose instance, reusing the cached connection when
 * one exists. Safe to call at the top of every request handler / controller:
 *
 *   const connectDB = require('../_config/_db');
 *   await connectDB();
 *
 * @returns {Promise<typeof mongoose>} the connected mongoose singleton
 * @throws  {Error} if MONGODB_URI is missing or the connection fails
 */
async function connectDB() {
    // 1. Fast path: connection already established in this container.
    if (cached.conn) {
        return cached.conn;
    }

    // 2. Fail loudly and early if the environment is misconfigured. Doing this
    //    here (rather than at module load) keeps the module import side-effect
    //    free, which is friendlier to TDD/unit tests that mock the DB.
    if (!MONGODB_URI) {
        throw new Error(
            '[db] MONGODB_URI is not defined. Add it to your .env file locally ' +
            'and to the Vercel project Environment Variables in production.'
        );
    }

    // 3. No connection yet and no connection attempt in flight -> start one.
    if (!cached.promise) {
        const options = {
            // Disable Mongoose's command buffering. On serverless we want an
            // immediate error if a query is issued before the connection is
            // ready, instead of silently queueing and eventually timing out
            // after the lambda has already been frozen.
            bufferCommands: false,

            // Give up on server selection quickly so a bad URI / IP-allowlist
            // problem surfaces as a clear error instead of a 10 s+ lambda hang.
            serverSelectionTimeoutMS: 5000,

            // Small pool: a single lambda instance serves one request at a
            // time, so a large pool only wastes Atlas connection slots.
            maxPoolSize: 5,
        };

        cached.promise = mongoose
            .connect(MONGODB_URI, options)
            .then((mongooseInstance) => {
                console.log('[db] MongoDB connected');
                return mongooseInstance;
            });
    }

    // 4. Await the (possibly shared) in-flight promise.
    try {
        cached.conn = await cached.promise;
    } catch (err) {
        // Reset the promise so the *next* invocation retries instead of being
        // stuck forever awaiting a rejected promise.
        cached.promise = null;
        console.error('[db] MongoDB connection failed:', err.message);
        throw err;
    }

    return cached.conn;
}

module.exports = connectDB;
