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
// Which backend is used is set by CONFIG.API_MODE ('auto', 'server' or 'mock').

import { CONFIG } from './config.js';
import { mockApi } from './mockApi.js';

// ---- big photos: shrunk in the browser before uploading ----
// The server takes images up to 3 MB, and phone camera photos are often bigger, so
// those are scaled down / re-compressed here first. GIFs are left alone (it would stop
// them animating), and so is anything that isn't an image (3D models).
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;     // same as server/index.js
const SHRINK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function shrinkImage(file) {
    if (!file || file.size <= MAX_IMAGE_BYTES || !SHRINK_TYPES.includes(file.type)) return file;
    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch { return file; }     // can't read it: let the server say why
    const alpha = file.type !== 'image/jpeg';    // PNG / WEBP may have see-through parts: keep them
    const canvas = document.createElement('canvas');
    let scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    try {
        for (let tries = 0; tries < 6; tries++, scale *= 0.75) {
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            // with see-through parts: WEBP if the browser can make it (Safari falls back to PNG)
            const blob = await new Promise((done) => canvas.toBlob(done, alpha ? 'image/webp' : 'image/jpeg', 0.85));
            if (blob && blob.size <= MAX_IMAGE_BYTES) {
                const ext = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' }[blob.type] || 'jpg';
                return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.' + ext, { type: blob.type });
            }
        }
    } finally {
        bitmap.close();
    }
    return file;                                 // still too big: the server's error message explains
}

// ---- real backend: the Node server's /api endpoints (Postgres database) ----
async function request(path, options = {}) {
    const res = await fetch(CONFIG.API_BASE + path, { credentials: 'same-origin', ...options });
    const data = await res.json().catch(() => ({ error: `Bad response from ${path}` }));
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

const serverApi = {
    listThreads: () => request('threads'),
    // lobby / corridor pictures: [{ slot, url }] (slot = original file in public/assets/)
    listWallImages: () => request('wall-images'),
    // the lobby lever: random uploaded image / .obj in every frame -> { id, pictures: [{ slot, url, model }] }
    shufflePictures(slots) {
        const body = new FormData();
        body.append('slots', slots.join(','));
        return request('shuffle-pictures', { method: 'POST', body });
    },
    async setWallImage(slot, file) {
        file = await shrinkImage(file);
        const body = new FormData();
        body.append('slot', slot);
        body.append('image', file);
        return request('wall-image', { method: 'POST', body });
    },
    // username, one per IP, permanent: null if not chosen yet
    getMyName: async () => (await request('me')).name,
    async setMyName(name) {
        const body = new FormData();
        body.append('name', name);
        return (await request('name', { method: 'POST', body })).name;
    },
    getReplies: (threadId) => request(`replies?thread_id=${encodeURIComponent(threadId)}`),
    postReply(threadId, text) {
        const body = new FormData();
        body.append('thread_id', threadId);
        body.append('post_content', text);
        return request('reply', { method: 'POST', body });
    },
    // A room computer's post: text and/or a file (image / 3D model) together. Returns [reply, ...].
    async post(threadId, text, file = null, shape = 'cube') {
        file = await shrinkImage(file);
        const body = new FormData();
        body.append('thread_id', threadId);
        body.append('post_content', text);
        if (file) body.append('image', file);
        body.append('shape', shape);
        return request('post', { method: 'POST', body });
    },
    async uploadImage(threadId, file, shape = 'cube') {
        file = await shrinkImage(file);
        const body = new FormData();
        body.append('thread_id', threadId);
        body.append('image', file);
        body.append('shape', shape);
        return request('upload', { method: 'POST', body });
    },
    // A thread's body/image are stored as its first replies (the forum's threads
    // table only has a title), posted with the creator's poster number.
    // scanFile: optional 3D scan (Polycam, Scaniverse...) that becomes the room
    async createThread(title, body = '', imageFile = null, shape = 'cube', scanFile = null) {
        imageFile = await shrinkImage(imageFile);
        const form = new FormData();
        form.append('thread_title', title);
        if (body.trim()) form.append('post_content', body);
        if (imageFile) form.append('image', imageFile);
        if (scanFile) form.append('scan', scanFile);
        form.append('shape', shape);
        return request('create_thread', { method: 'POST', body: form });
    },
};

// 'auto': use the server if api/threads answers with JSON (it's running,
// even if it reports an error, so the error gets shown instead of hidden),
// otherwise fall back to the in-browser demo data (e.g. a plain static server).
async function detectBackend() {
    if (CONFIG.API_MODE === 'server') return serverApi;
    if (CONFIG.API_MODE === 'mock') return mockApi;
    try {
        const res = await fetch(CONFIG.API_BASE + 'threads', { credentials: 'same-origin' });
        if ((res.headers.get('content-type') || '').includes('application/json')) return serverApi;
    } catch { /* network error: no backend */ }
    return mockApi;
}

let backendPromise = null;
const backend = () => (backendPromise ??= detectBackend());

export const api = {
    // 'server' or 'mock' (once known)
    async mode() { return (await backend()) === serverApi ? 'server' : 'mock'; },
    listThreads: async (...a) => (await backend()).listThreads(...a),
    getReplies: async (...a) => (await backend()).getReplies(...a),
    postReply: async (...a) => (await backend()).postReply(...a),
    uploadImage: async (...a) => (await backend()).uploadImage(...a),
    post: async (...a) => (await backend()).post(...a),
    createThread: async (...a) => (await backend()).createThread(...a),
    // demo mode has no server to list public/assets/, so no wall pictures there
    listWallImages: async () => ((await backend()) === serverApi ? serverApi.listWallImages() : []),
    shufflePictures: async (slots) => ((await backend()) === serverApi ? serverApi.shufflePictures(slots) : mockApi.shufflePictures(slots)),
    // demo mode: only changes it in this browser, until reload
    setWallImage: async (slot, file) => ((await backend()) === serverApi
        ? serverApi.setWallImage(slot, file)
        : { slot, url: URL.createObjectURL(file) }),
    // demo mode: the name is kept in this browser instead
    getMyName: async () => ((await backend()) === serverApi ? serverApi.getMyName() : localName.get()),
    setMyName: async (name) => ((await backend()) === serverApi ? serverApi.setMyName(name) : localName.set(name)),
};

const localName = {
    get() { try { return localStorage.getItem('hotel_name'); } catch { return null; } },
    set(name) {
        const old = this.get();
        if (old) return old;
        try { localStorage.setItem('hotel_name', name); } catch { /* private mode */ }
        return name;
    },
};
