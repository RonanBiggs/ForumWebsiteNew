// mockApi.js - fake forum backend so the 3D side can be built without a server.
// Data is kept in this browser's localStorage (if available) so posts survive a reload.
// Clear it from the browser console with: localStorage.removeItem('hotel-mock-v1')

const STORAGE_KEY = 'hotel-mock-v1';

// Little generated pictures so image replies have something to show.
function svgImage(bg, fg, label) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
        <rect width="400" height="300" fill="${bg}"/>
        <circle cx="200" cy="130" r="80" fill="${fg}"/>
        <rect x="60" y="230" width="280" height="24" fill="${fg}" opacity="0.6"/>
        <text x="200" y="140" font-family="Georgia" font-size="34" text-anchor="middle" fill="${bg}">${label}</text>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function seed() {
    const now = Date.now();
    const at = (minsAgo) => new Date(now - minsAgo * 60000).toISOString().slice(0, 19).replace('T', ' ');
    let postId = 1;
    let poster = 1;
    const threads = [];
    const replies = [];

    const make = (title, lines) => {
        const thread_id = threads.length + 1;
        threads.push({ thread_id, thread_title: title, thread_date: at(5000 - thread_id * 300), session_id: poster++ });
        lines.forEach((line, i) => {
            const isImg = typeof line === 'object';
            replies.push({
                post_id: postId++,
                post_content: isImg ? line.img : line,
                post_date: at(4000 - thread_id * 300 - i * 7),
                post_thread: thread_id,
                image: isImg ? 1 : 0,
                session_id: i % 3 === 0 ? threads[thread_id - 1].session_id : poster++,
            });
        });
    };

    make('Welcome to the hotel', [
        'First! The lobby smells like old carpet and I love it.',
        'Each thread is its own room. Walk in and read the walls.',
        'Sit at the computer in the back to reply.',
        { img: svgImage('#2b3a55', '#e9c46a', 'hello') },
        'This is the coolest forum I have ever seen honestly',
    ]);
    make('Post your desk setup', [
        { img: svgImage('#1d3557', '#a8dadc', 'desk') },
        'Mine is just a laptop on an ironing board.',
        { img: svgImage('#3d405b', '#f2cc8f', 'rgb') },
        'Need more RGB.',
        'The CRT in every room is a vibe.',
        'Can we get rolling chairs',
        'Rolling chairs are a security risk in this establishment.',
    ]);
    make('Ghost on floor 3?', [
        'Heard knocking from the empty room at the end of the hall.',
        'That was me, I was lost.',
        'There is no floor 3.',
        'Then where am I',
    ]);
    make('Best pizza toppings (serious)', [
        'Pineapple. Fight me.',
        'Mushrooms, onion, green pepper. Classic.',
        'Hot honey on pepperoni changed my life.',
        'Anchovies are underrated.',
        'No they are not.',
        'Yes they are.',
        'Moderators please lock this thread.',
        'There are no moderators. Only the hotel.',
        'Garlic. Just garlic.',
        { img: svgImage('#9b2226', '#ee9b00', 'pizza') },
        'Long reply test: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident.',
        'Corn. (I am from the future)',
        'Ham and pineapple and jalapeno.',
        'This room is getting big.',
    ]);
    make('Room service is slow', [
        'Ordered a sandwich in 2019.',
        'Still waiting.',
    ]);
    make('Lost key', []);
    make('Music while browsing?', [
        'Somebody add elevator music to the lobby please.',
        'Lounge jazz or nothing.',
        'Vaporwave obviously.',
    ]);

    return { threads, replies, nextPostId: postId };
}

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* storage unavailable or corrupt: fall through to seed */ }
    return seed();
}

const db = load();

function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch { /* full or blocked: keep in memory */ }
}

// Mirrors the 2D forum: you get one poster number per thread, per browser session.
const posterNumbers = {};
function nextPosterNumber() {
    const all = [...db.threads.map(t => t.session_id), ...db.replies.map(r => r.session_id)];
    return Math.max(0, ...all) + 1;
}
function posterFor(threadId) {
    if (!posterNumbers[threadId]) posterNumbers[threadId] = nextPosterNumber();
    return posterNumbers[threadId];
}

const delay = (ms = 150) => new Promise(r => setTimeout(r, ms));
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const clone = (x) => JSON.parse(JSON.stringify(x));

function addReply(threadId, content, image, shape = 'cube') {
    const thread = db.threads.find(t => t.thread_id === threadId);
    if (!thread) throw new Error('Thread not found');
    const reply = {
        post_id: db.nextPostId++,
        post_content: content,
        post_date: nowSql(),
        post_thread: threadId,
        image,
        shape,
        session_id: posterFor(threadId),
    };
    db.replies.push(reply);
    save();
    return clone(reply);
}

function checkImage(file) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Only PNG, JPG, JPEG, GIF and WEBP files are allowed');
    if (file.size > 5000000) throw new Error('File is too large');
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
    });
}

export const mockApi = {
    async listThreads() {
        await delay();
        return db.threads.map(t => {
            const replies = db.replies.filter(r => r.post_thread === t.thread_id);
            const latest = replies.reduce((max, r) => (r.post_date > max ? r.post_date : max), t.thread_date);
            return { ...clone(t), reply_count: replies.length, latest_date: latest };
        });
    },

    async getReplies(threadId) {
        await delay(250);
        return clone(db.replies.filter(r => r.post_thread === threadId).sort((a, b) => a.post_id - b.post_id));
    },

    async postReply(threadId, text) {
        await delay();
        text = String(text).trim();
        if (!text) throw new Error('Reply cannot be empty.');
        if (text.length > 5000) throw new Error('Reply is too long (max 5000 characters).');
        return addReply(threadId, text, 0);
    },

    async uploadImage(threadId, file, shape = 'cube') {
        await delay();
        checkImage(file);
        return addReply(threadId, await fileToDataUrl(file), 1, shape);
    },

    // Body and image become the thread's first replies, by the thread's creator.
    async createThread(title, body = '', imageFile = null, shape = 'cube') {
        await delay();
        title = String(title).trim();
        body = String(body || '').trim();
        if (!title) throw new Error('Please enter a thread title.');
        if (body.length > 5000) throw new Error('Body is too long (max 5000 characters).');
        if (imageFile) checkImage(imageFile);       // validate before creating anything
        const imageUrl = imageFile ? await fileToDataUrl(imageFile) : null;

        const thread = {
            thread_id: Math.max(0, ...db.threads.map(t => t.thread_id)) + 1,
            thread_title: title.slice(0, 255),
            thread_date: nowSql(),
            session_id: nextPosterNumber(),
        };
        posterNumbers[thread.thread_id] = thread.session_id; // creator keeps their number
        db.threads.push(thread);
        save();
        let count = 0;
        if (body) { addReply(thread.thread_id, body, 0); count++; }
        if (imageUrl) { addReply(thread.thread_id, imageUrl, 1, shape); count++; }
        return { ...clone(thread), reply_count: count, latest_date: thread.thread_date };
    },
};
