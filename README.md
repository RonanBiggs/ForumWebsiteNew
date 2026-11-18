# The Hotel: 3D forum prototype

A first-person **prototype** of a 3D version of `../ForumWebsite`. Every thread is a hotel room.
Everything visual is a **placeholder**: grid textures, box furniture and plain browser-style UI, meant to be replaced with your own models.

- One continuous row of rooms down a corridor. **The most recently active thread is the first door from the lobby**, the same order as `ForumWebsite/index.php`.
- The only signs are the thread titles above each room's door.
- Every reply hangs on the room's **left wall** in one row, oldest nearest the door. The room gets longer to fit them all.
- **Image replies** also float in the room as a **cube with the image wrapped around it** (stretched round the 4 sides and folded over the top and bottom, distorted on purpose), in front of their wall panel. Press **E** on it to focus the camera on it, then **click and drag** to turn it. **E** or **Esc** steps back.
- **Reading:** look at a reply and press **E** to read it in full.
- **Replying:** sit at the computer at the back of the room (**E**) and type on the screen. **Enter** posts and the reply appears on the wall. You can attach images too.
- **New thread:** sit at the **computer in the lobby**. Type a **title** (Enter), then an optional **body**, optionally **attach an image**, then press Enter to create it. The new room becomes the first door. Tab switches between title and body.

It uses the **MySQL database** through the PHP files in `api/` (same tables as the 2D forum). When there's no PHP backend, it automatically falls back to **demo data** stored in your browser (`js/mockApi.js`).

- **Hosting on InfinityFree + database setup:** see [HOSTING.md](HOSTING.md)
- **Where to change things yourself** (start page, signs, looks): see [EDIT-INSTRUCTIONS.md](EDIT-INSTRUCTIONS.md)

## Run locally

```bash
cd Hotel3D
php -S localhost:8001 dev-server.php
```
`dev-server.php` turns off browser caching, so a reload always runs your latest edits.
Without an `api/config.php`, it runs on the demo data.
To use a local database instead, copy `api/config.sample.php` to `api/config.php` and point it at your local MariaDB.
It also supports `DB_SOCKET`, e.g. the private instance from `../ForumWebsite/local-db.sh`.
Open <http://localhost:8001> and click **Enter**.

| Key | Action |
|---|---|
| W A S D / arrows | walk |
| Shift | run |
| Mouse | look |
| E or Click | interact (read a reply, look at an image cube, sit at the computer, start a thread) |
| Click + drag | turn an image cube (while looking at it) |
| Esc | pause / stand up / step back from a cube |

To reset the fake data, run `localStorage.removeItem('hotel-mock-v1')` in the browser console and reload.
`window.hotelDebug` in the console gives you the scene, camera, hotel and so on, for poking around.

## Hosting
See [HOSTING.md](HOSTING.md).

## Code map: where to change what

| File | What it does | Change it when… |
|---|---|---|
| `js/config.js` | Hotel name, mock vs PHP data, walk speed, model path | always first |
| `js/room.js` | **Builds one room**: walls, door + title sign, desk/computer, reply panels, image cubes, room length | restyling rooms, importing models |
| `js/hotel.js` | Lobby, corridor, **room order and placement** | changing the building layout |
| `js/textures.js` | Placeholder grid texture, door signs, reply panels, image-cube textures | changing how posts look |
| `js/materials.js` | Shared placeholder materials + `addBox` helper | swapping in real textures |
| `style.css` | Plain placeholder UI (start screen, menus, HUD) | restyling the UI |
| `js/computer.js` | Desk + chair + computer (rooms and lobby), screen canvas, seat position, optional .glb model | restyling/replacing the computer |
| `js/player.js` | Movement + collision | movement feel |
| `js/terminal.js` | Typing on the computer screens: reply mode (rooms) and new-thread form (lobby) | terminal look/behaviour |
| `js/api.js` | **The only file that talks to data** (picks PHP backend or demo data) | changing the data source |
| `api/*.php` | PHP + MySQL backend (PDO): threads, replies, posting, uploads, new threads | server-side rules/validation |
| `js/mockApi.js` | Fake forum data | — |
| `js/main.js` | Start screen, game states, interaction, sit-down + cube-inspect camera | UI/flow |

The game logic only needs the following from the visuals, so you can replace any of the geometry:
- meshes with `userData.collider = true` block movement (walls, desks)
- meshes with `userData.interact = { type: ... }` can be targeted with E (`'computer'`, `'reply'`, `'image'`)
- `SEAT` / `SCREEN` in `computer.js` set where the camera sits and looks at a computer
- `Room.inspectPose(cube)` sets where the camera goes to look at an image cube

### Using your own computer model
1. Model it in Blender in **metres**, with the origin at the bottom centre, facing **+Z**.
2. Name the screen mesh **`Screen`**. The terminal text is drawn onto it, so it needs normal 0–1 UVs.
3. Export as `Hotel3D/models/computer.glb` and set `COMPUTER_MODEL_URL: 'models/computer.glb'` in `js/config.js`.
4. Adjust `SEAT` / `SCREEN` in `computer.js` if the camera doesn't line up with the screen.
   The same model is used for the lobby computer and every room's computer.

Room dimensions (in `ROOM` in `room.js`): 7.6 m wide, 3.2 m tall, doorway 1.4 × 2.3 m.
Length grows by 2 m per reply (`roomDepth()` in `room.js`, minimum 7.6 m). A 14-reply thread is about 31 m long.

## Backend (api/)

`js/api.js` and the PHP files in `api/` exchange rows from the existing MySQL tables:

```
Thread: { thread_id, thread_title, thread_date, session_id, reply_count, latest_date }
Reply:  { post_id, post_content, post_date, post_thread, image (0|1), session_id }
```

| Endpoint | Method | Returns |
|---|---|---|
| `api/threads.php` | GET | `Thread[]`, newest activity first |
| `api/replies.php?thread_id=N` | GET | `Reply[]`, oldest first |
| `api/reply.php` | POST `thread_id`, `post_content` | the new `Reply` |
| `api/upload.php` | POST `thread_id`, `image` (file) | the new `Reply` |
| `api/create_thread.php` | POST `thread_title`, optional `post_content`, optional `image` | the new `Thread`. The body/image are stored as its first replies |

Errors come back as `{"error": "message"}` with a 4xx/5xx status, and the hotel shows them on the computer screen.
Poster numbers work like in the 2D forum (one per visitor per thread, kept in the PHP session).

## Known prototype limits / next steps
- **Live re-ordering:** rooms are sorted when the page loads and when a thread is created. After you reply, the room doesn't jump to the front until the next reload, so it doesn't slide away while you're in it. For live updates, poll `threads.php` and call `hotel.layout()` when the player is in the lobby.
- **Lots of threads:** every room is built up front, but replies only load when you walk near a door. With hundreds of threads, build or destroy room shells by distance too (`Hotel.update` is the place).
- **Desktop only:** pointer lock plus keyboard. Mobile would need touch controls.
- No multiplayer: you can't see other visitors. That would need a WebSocket server, which InfinityFree doesn't support.
