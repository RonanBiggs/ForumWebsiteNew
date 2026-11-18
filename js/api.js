// api.js - the ONLY place the 3D world talks to data.
//
// Every function returns plain objects shaped exactly like the rows in the
// forum's MySQL tables, so the PHP side can just json_encode() query results:
//
//   Thread: { thread_id, thread_title, thread_date, session_id, reply_count, latest_date }
//           (latest_date = newest of thread_date and its replies' post_date; rooms are
//            sorted by it, newest first, exactly like ForumWebsite/index.php)
//   Reply:  { post_id, post_content, post_date, post_thread, image (0|1), session_id }
//           (when image = 1, post_content is the image URL, e.g. "uploads/abc.png")
//
// Which backend is used is set by CONFIG.API_MODE ('auto', 'php' or 'mock').

import { CONFIG } from './config.js';
import { mockApi } from './mockApi.js';

// ---- real backend: the PHP endpoints in api/ (MySQL database) ----
async function request(path, options = {}) {
    const res = await fetch(CONFIG.API_BASE + path, { credentials: 'same-origin', ...options });
    const data = await res.json().catch(() => ({ error: `Bad response from ${path}` }));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

const phpApi = {
    listThreads: () => request('threads.php'),
    getReplies: (threadId) => request(`replies.php?thread_id=${encodeURIComponent(threadId)}`),
    postReply(threadId, text) {
        const body = new FormData();
        body.append('thread_id', threadId);
        body.append('post_content', text);
        return request('reply.php', { method: 'POST', body });
    },
    uploadImage(threadId, file) {
        const body = new FormData();
        body.append('thread_id', threadId);
        body.append('image', file);
        return request('upload.php', { method: 'POST', body });
    },
    // A thread's body/image are stored as its first replies (the forum's threads
    // table only has a title), posted with the creator's poster number.
    createThread(title, body = '', imageFile = null) {
        const form = new FormData();
        form.append('thread_title', title);
        if (body.trim()) form.append('post_content', body);
        if (imageFile) form.append('image', imageFile);
        return request('create_thread.php', { method: 'POST', body: form });
    },
};

// 'auto': use the PHP backend if api/threads.php answers with JSON (it's installed,
// even if it reports an error, so the error gets shown instead of hidden),
// otherwise fall back to the in-browser demo data (e.g. a plain static server).
async function detectBackend() {
    if (CONFIG.API_MODE === 'php') return phpApi;
    if (CONFIG.API_MODE === 'mock') return mockApi;
    try {
        const res = await fetch(CONFIG.API_BASE + 'threads.php', { credentials: 'same-origin' });
        if ((res.headers.get('content-type') || '').includes('application/json')) return phpApi;
    } catch { /* network error: no backend */ }
    return mockApi;
}

let backendPromise = null;
const backend = () => (backendPromise ??= detectBackend());

export const api = {
    // 'php' or 'mock' (once known)
    async mode() { return (await backend()) === phpApi ? 'php' : 'mock'; },
    listThreads: async (...a) => (await backend()).listThreads(...a),
    getReplies: async (...a) => (await backend()).getReplies(...a),
    postReply: async (...a) => (await backend()).postReply(...a),
    uploadImage: async (...a) => (await backend()).uploadImage(...a),
    createThread: async (...a) => (await backend()).createThread(...a),
};
