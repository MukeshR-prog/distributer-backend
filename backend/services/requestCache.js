const cacheStore = new Map(); // key -> { data, expiresAt }
const pendingRequests = new Map(); // key -> Array of { res }

const getCacheKey = (userId, url) => {
  return `${userId}:${url}`;
};

const requestCache = (ttlMs = 5000) => {
  return (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    if (!req.user || !req.user._id) {
      return next();
    }

    const userId = req.user._id.toString();
    const key = getCacheKey(userId, req.originalUrl || req.url);
    const now = Date.now();

    // 1. Check cache hits
    if (cacheStore.has(key)) {
      const entry = cacheStore.get(key);
      if (now < entry.expiresAt) {
        return res.status(200).json(entry.data);
      } else {
        cacheStore.delete(key);
      }
    }

    // 2. Check for pending requests (deduplication)
    if (pendingRequests.has(key)) {
      // Add this res to the waiters list
      pendingRequests.get(key).push({ res });
      return; // Do not call next(), we wait for the in-progress request
    }

    // Initialize waiters array
    pendingRequests.set(key, []);

    // Intercept res.json to capture response and resolve waiters
    const originalJson = res.json;
    res.json = function (body) {
      // Save in cache if successful
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cacheStore.set(key, {
          data: body,
          expiresAt: Date.now() + ttlMs
        });
      }

      // Resolve current response
      const result = originalJson.call(this, body);

      // Resolve waiters
      const waiters = pendingRequests.get(key);
      if (waiters) {
        waiters.forEach(({ res: waiterRes }) => {
          waiterRes.status(res.statusCode).json(body);
        });
        pendingRequests.delete(key);
      }

      return result;
    };

    next();
  };
};

const clearUserCache = (userId) => {
  if (!userId) return;
  const prefix = `${userId.toString()}:`;
  for (const key of cacheStore.keys()) {
    if (key.startsWith(prefix)) {
      cacheStore.delete(key);
    }
  }
};

const clearCacheOnMutation = (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (req.user && req.user._id) {
      clearUserCache(req.user._id);
    }
  }
  next();
};

module.exports = {
  requestCache,
  clearUserCache,
  clearCacheOnMutation
};
