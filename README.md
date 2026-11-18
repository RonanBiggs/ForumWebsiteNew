# The Hotel: 3D forum prototype

A first-person, multiplayer **prototype** of a 3D forum. Every thread is a hotel room.
Everything visual is a **placeholder**: grid textures, box furniture, plain UI, and other players shown as pills.

- One continuous row of rooms down a corridor. **The most recently active thread is the first door from the lobby.**
- The only signs are the thread titles above each room's door (plus "The Dom Forum" above the lobby computer).
- Every reply hangs on the room's **left wall** in one row, oldest nearest the door. The room gets longer to fit them all.
- **Image replies** also float in the room as a **cube with the image wrapped around it**. Press **E** on it to look at it, then **click and drag** to turn it.
- **Reading:** look at a reply and press **E** to read it in full.
- **Replying:** sit at the computer at the back of a room (**E**) and type on its screen. **Enter** makes a new line; click **POST** on the screen to send. You can attach or paste images (PNG, JPG, GIF, WEBP; transparent PNGs make see-through cubes).
- **New thread:** sit at the computer in the lobby and fill in the **title**, an optional **body** and an optional **image**.
- **Gun:** click (or F) to shoot a ball. No ammo, no cooldown. A ball that hits another player launches them across the room.
- **Phones/tablets:** on-screen joystick (left thumb), drag to look (right thumb), a FIRE button, and a USE button that pops up when you can interact with something.
- **Usernames:** the box on the entrance screen sets your name forever (one per IP), shown above your pill in a pirate font.
- **Wall pictures:** every image in `public/assets/` hangs once in the lobby or the corridor (across from the doors). Press **E** at one to replace it with your own image, for everyone.
- **Entrance screen:** its own file, `public/entrance.html` (see EDIT-INSTRUCTIONS.md).
- **Multiplayer:** everyone on the site sees everyone else as a **pill**, live, over a WebSocket. New threads and replies show up for everybody immediately, and rooms re-sort themselves.

**Stack:** three.js in the browser (no build step) · Node.js server (Express + `ws`) · PostgreSQL on Neon.
**Hosting:** see [DEPLOY.md](DEPLOY.md) (Render + Neon). **Changing things yourself:** see [EDIT-INSTRUCTIONS.md](EDIT-INSTRUCTIONS.md).

## Run locally

Needs Node.js 20.12 or newer.
```bash
cd Hotel3D
npm install
npm start               # http://localhost:3000
```
`npm start` reads `DATABASE_URL` from `.env`, so it uses **the same Neon database as the live site**. Anything you post locally shows up online.
- **Separate test data:** run `DB_SCHEMA=dev npm start` to keep test posts in their own `dev` schema in the same database.
- **No database at all:** serve `public/` with any static server (e.g. `npx serve public`). The site falls back to demo data stored in your browser, with no multiplayer.

Open two browser windows to see yourself as a pill in the other one.

| Key | Action |
|---|---|
| W A S D / arrows | walk |
| Shift | run |
| Mouse | look |
| E | interact (read a reply, look at an image cube, sit at a computer) |
| Click / F | shoot (hold F to spray) |
| Click + drag | turn an image cube (while looking at it) |
| Esc | stand up from a computer / step back from a cube / close a reply |

`window.hotelDebug` in the browser console gives you the scene, camera, hotel, multiplayer and so on.

## Code map

| File | What it does |
|---|---|
| `server/index.js` | Web server: serves `public/`, the JSON API, image downloads, spam limit |
| `server/db.js` | All database queries (Postgres) |
| `server/schema.sql` | The tables. Created automatically on startup, or with `npm run db:setup` |
| `server/multiplayer.js` | WebSocket `/ws`: relays player positions and gun shots/hits, pushes new threads/replies live |
| `public/index.html`, `public/style.css` | Page, menus, HUD, touch-control styles |
| `public/entrance.html` | The entrance (start) screen content, loaded by main.js |
| `public/js/gun.js` | The gun: balls, hits, the gun model |
| `public/js/touch.js` | Phone/tablet controls: joystick, drag-to-look, FIRE/USE buttons |
| `public/js/config.js` | Hotel name, lobby sign text, data mode, speeds, model path |
| `public/js/main.js` | Start screen, game states, interaction, camera moves, live re-sorting |
| `public/js/net.js` | Multiplayer client: sends your position, draws other players as pills |
| `public/js/hotel.js` | Lobby, corridor, **room order and placement**, lobby computer + sign |
| `public/js/room.js` | **One room**: walls, door + title sign, reply panels, image cubes, length |
| `public/js/computer.js` | Desk + chair + computer (rooms and lobby), optional `.glb` model |
| `public/js/terminal.js` | Typing on the computer screens (reply / new-thread form) |
| `public/js/textures.js`, `materials.js` | Placeholder textures/materials, signs, reply panels |
| `public/js/player.js` | Walking + collision, touch-joystick input, flying after being shot |
| `public/js/api.js` | Talks to the server API (or `mockApi.js` demo data when there's no server) |

### API
| Endpoint | Method | Returns |
|---|---|---|
| `/api/threads` | GET | threads, newest activity first |
| `/api/replies?thread_id=N` | GET | that thread's replies, oldest first |
| `/api/reply` | POST `thread_id`, `post_content` | the new reply |
| `/api/upload` | POST `thread_id`, `image` (file) | the new image reply |
| `/api/create_thread` | POST `thread_title`, optional `post_content`, optional `image` | the new thread. The body/image become its first replies |
| `/api/images/:id` | GET | an uploaded image (stored in the database) |
| `/api/health` | GET | `{ ok, online }` |

Shapes: `Thread { thread_id, thread_title, thread_date, session_id, reply_count, latest_date }`,
`Reply { post_id, post_content, post_date, post_thread, image (0|1), session_id }`.
`session_id` is the poster number: one per visitor per thread, remembered with a cookie.

### Using your own computer model
1. Model it in Blender in **metres**, with the origin at the bottom centre, facing **+Z**. Name the screen mesh **`Screen`**, with normal 0–1 UVs.
2. Export it as `public/models/computer.glb` and set `COMPUTER_MODEL_URL: 'models/computer.glb'` in `public/js/config.js`.
3. If the seated camera doesn't line up, adjust `SEAT` / `SCREEN` in `public/js/computer.js`.

## Prototype limits
- **Desktop only:** pointer lock plus keyboard.
- **No moderation tools:** delete rows in the Neon SQL editor. Deleting a thread deletes its replies.
- **Spam limit:** 10 posts per minute per IP. Images are limited to 3 MB.
- **Live re-sorting:** when someone posts, rooms slide along the corridor. If you're inside a room you move with it. If you're sitting at a computer, it waits until you stand up.
