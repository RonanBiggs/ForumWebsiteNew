# Editing it yourself

All paths are relative to the `Hotel3D/` folder. Everything the browser sees is in `public/`.
Test your edits locally with `npm start` (see README), then reload the page.
To put a change online, commit and push it: Render redeploys automatically.

---

## The entrance screen (the page with the "Enter" button)

It's its own file: **`public/entrance.html`**. Edit it like any web page. You can even open it straight in your browser to preview it (double-click it); then reload the game to see it in place.

**How it works:** when the game starts, `js/main.js` loads `entrance.html` and copies everything inside its `<body>`, plus its `<style>` block, onto the start screen.

**What you can change:**
- **Colour:** `background: #ff69b4;` in `.entrance` (hot pink). Any CSS colour or gradient works.
- **The button:** its text is `data-ready="The Dom Forum"` (shown once the hotel has loaded; it's greyed out until then) and the text between the tags. Its look is `.entrance #enter-btn`.
- **Add things:** put text, links or images inside `<div class="entrance">`. Images go in `public/` (e.g. `public/logo.png`), then `<img src="logo.png" alt="">`. If you add more than the button, add `flex-direction: column; gap: 16px;` to `.entrance` so they stack.
- **Phone vs computer:** anything with `class="desktop-only"` only shows on computers, `class="touch-only"` only on phones/tablets.

**Rules (or it breaks):**
- Keep `<button id="enter-btn" ...>`. The game looks for that id. Without it, the plain fallback start screen from `index.html` is used instead.
- Start every CSS rule with `.entrance` so it can't restyle the rest of the game.
- `<script>` tags are ignored. Code that runs belongs in `public/js/`.
- Optional: add `<p id="data-mode"></p>` to show "Demo data" / load errors under the button.

| Other start-screen bits | Where |
|---|---|
| **What the button does** | `public/js/main.js`, the line `ui.enter.addEventListener('click', ...)`. It hides the start screen and starts the game |
| **Fallback start screen** (only used if `entrance.html` can't load) | `public/index.html`, inside `<div id="start">` |
| **Browser tab title** | `<title>` in `public/index.html`, and `HOTEL_NAME` in `public/js/config.js` (it overwrites the title) |

---

## The sign above the lobby computer

| What | Where |
|---|---|
| **The text** | `public/js/config.js`: `LOBBY_SIGN_TEXT: 'The Dom Forum'` |
| **Size, position, height** | `public/js/hotel.js`, inside `buildCorridor()`, below the comment `// LOBBY SIGN` (around line 130) |
| **Look** (white background, black border, font) | `labelTexture()` in `public/js/textures.js`. The door title signs use the same function |

The `addSign(...)` line in `hotel.js` takes these values:
- `w`, `h`: width and height in metres. Keep about the same ratio as the texture (1024 × 192) or the text stretches.
- `y`: height of the sign's centre above the floor. The ceiling is at 3.2.
- `z`: position along the wall. The computer is at `z: 3`.
- `x: halfW - 0.01`: sits it just off the lobby's right wall. Don't change this unless you move the sign to another wall.

To add **more signs**, copy that `addSign(...)` line and change the text and position.
Long text shrinks to fit, and then gets cut off with "…".

---

## Usernames (the box on the entrance screen)

Whatever someone types in the box on the entrance screen becomes their name **forever**, tied to their IP address, and is shown above their pill to everyone else. Nobody is told that, on purpose. On later visits the box shows their name and can't be edited. Left empty, "Write something here" appears in red.

| What | Where |
|---|---|
| The box, its placeholder (`example`), the red message, their look | `public/entrance.html`: `<input id="name-input">`, `<p id="name-error">` and their `.entrance #name-...` styles |
| What happens when the button is clicked (save name, then enter) | `onEnterClick()` in `public/js/main.js` |
| Max length (24) | `MAX_NAME` at the top of `server/index.js` and `maxlength` on the input |
| Label above the pill: font, size, look | `NAME_FONT`, `NAME_HEIGHT` and `nameSprite()` at the top of `public/js/net.js`. The font (Pirata One) is loaded by the `fonts.googleapis.com` link in `public/index.html` |
| **Change or delete someone's name** | In the database (Neon console → SQL editor): `UPDATE usernames SET name = 'new' WHERE name = 'old';` or `DELETE FROM usernames WHERE name = 'old';` |

Everyone on the same Wi-Fi / network usually shares one IP, so they share one name. How the visitor's IP is found (behind Render's proxies) is in `server/ip.js`.

---

## Typing on the computers

Everything is on the computer screen itself (there's no bar or instructions below it):
- Click **TITLE** or **BODY** to type there (or press Tab). **Enter makes a new line.**
- **POST** / **CREATE THREAD** (bottom right) sends, then you stand up automatically (`this.onExit()` in `postReply()` / `createThread()` in `public/js/terminal.js`). **EXIT** (top right) stands you up (so does Esc).
- **ATTACH** (bottom left on reply screens, next to ROOM SCAN on the new-thread screen) opens the file picker. You can also **paste an image** (Ctrl+V / Cmd+V). On reply screens the file waits (shown in blue above the buttons; click it to remove it) and is sent with the next **POST**.
- **Where it shows up:** an image / model posted **together with text** floats in front of that text's board. Posted **on its own**, it gets its own board with the shape in front. (Saved as `attached_to` on the reply; the layout is `replyLayout()` in `public/js/room.js`.)
- Allowed images: PNG, JPG, GIF, WEBP. Transparent parts are see-through on the shape, and **animated GIFs play** on it.
- **3D models:** GLB, glTF (single-file), OBJ, STL and FBX, up to 10 MB, through the same ATTACH / IMAGE line. Like images, a model floats in front of the message before it, spins, and can be picked up with E. Its own animation plays if it has one. OBJ / STL have no colours here, so they show plain grey.
- **Shape picker:** the four little drawings (cube, pyramid, sphere, icosahedron) left of the POST / CREATE THREAD button. The image floats in the room as the picked shape. It's saved with the reply (`shape` column of `replies`).

| What | Where |
|---|---|
| Clickable areas and the buttons' size/position on the screen | `BUTTON`, `ATTACH`, `EXIT` and `AREAS` at the top of `public/js/terminal.js` (in screen pixels, 1024 × 768) |
| Shape picker: position, size, the 2D drawings | `shapeRects()` and `drawShapeIcon()` in `public/js/terminal.js` |
| The 3D shapes (size, detail, add a new one) | `shapeGeometry()` in `public/js/room.js`. A new shape also needs adding to `SHAPES` in `terminal.js` and `server/index.js`, plus a drawing in `drawShapeIcon()` |
| Animated GIF playback | `playGif()` in `public/js/textures.js` (uses gifuct-js from the jsDelivr CDN) |
| 3D models: loading, size, plain grey look | `public/js/models.js` (`loadModel()`, `plain()`); the size passed in `addModel()` in `public/js/room.js` |
| Which model files the server accepts, size limits | `modelFromUpload()`, `MAX_MODEL_BYTES`, `MAX_IMAGE_BYTES` in `server/index.js` |
| Allowed image types | `imageFromUpload()` in `server/index.js` (checks the file's real contents), `IMAGE_TYPES` in `public/js/terminal.js`, `accept=` on `#file-input` in `public/index.html` |
| Image cube see-through cut-off | `alphaTest` on the cube material in `addReplyObjects()` in `public/js/room.js` (higher = more gets cut out) |
| How the screens are drawn | `drawReply()`, `drawThreadForm()`, `drawButton()` in `public/js/terminal.js` |

---

## Room scans (Polycam, Scaniverse…)

On the lobby computer, **ROOM SCAN** picks a 3D scan that becomes the new thread's room. Scan a room with a phone app, export it, and upload the file.

- **Formats:** GLB (best: keeps the colours/textures; Polycam "GLB", Scaniverse "GLB"), glTF (single file), FBX, OBJ (no textures here), PLY (mesh or point cloud). Not USDZ: export GLB instead. Max **300 MB** (a `.gltf` scan: 25 MB, since it's checked whole; use GLB for big ones). Big scans take a while to upload and to load, and are heavy for phones: a medium-quality export is friendlier. Scans are streamed in and out of the database in 1 MB pieces (tables `scans` / `scan_chunks`), so even 300 MB never has to fit in the server's 512 MB of memory.
- **How it's placed:** turned so its long side runs away from the door, scaled (same in all directions) to fill the room's width or height, set on the floor, starting at the door. The room gets deeper if the scan needs it. The part nearest the door is cut away so you can see in.
- **Everything else works as usual:** reply boards (hung just inside the scan's left wall), floating shapes, the computer, collisions (the normal room's walls, which stay behind the scan and show through its holes). You can walk through scanned furniture.
- **Storage:** scans are stored in the database. When it gets near its limit, **big scans (over 25 MB) are deleted first**, then everything else oldest-first (see "Database clean-up" below). Those rooms turn back into normal rooms. Before a scan is stored, enough is deleted for it to fit; if it can't fit at all, the upload is refused.

| What | Where |
|---|---|
| Fitting the scan into the room, door cut, board position | `loadRoomScan()`, `SCAN_DOOR_CUT`, `SCAN_BOARD_INSET` in `public/js/room.js` |
| How scans are drawn (unlit photo colours, both sides) | `loadScan()` in `public/js/models.js` |
| Accepted files, 300 MB limit | `scanFromDisk()`, `MAX_SCAN_BYTES` in `server/index.js`; storing/streaming: `insertScan()` / `streamScan()` in `server/db.js` |
| The ATTACH / ROOM SCAN buttons on the new-thread screen | `ATTACH_THREAD`, `SCAN` at the top of `public/js/terminal.js` and `drawThreadForm()` |

---

## Pictures on the walls (lobby + corridor)

Every image in **`public/assets/`** hangs once on a wall: the first in the lobby, the next in the corridor (on the wall across from the room doors), and so on alternating. The server lists the folder by itself, so to add a picture you just drop it in there and push. They're sorted by file name.

**Shrink photos and strip their location before adding them.** Phone photos are 3 to 7 MB and contain GPS coordinates. Anyone who downloads the picture from the site can read those. With ImageMagick:
```bash
magick Assets/MyPhoto.jpg -auto-orient -resize '1600x1600>' -strip -quality 82 public/assets/MyPhoto.jpg
```
(`-strip` removes the GPS/camera info, `-resize` makes it about 200–400 KB.) Your originals in `Assets/` are kept out of git on purpose (see `.gitignore`).

| What | Where |
|---|---|
| Picture height, how high it hangs, frame thickness | `PICTURE` at the top of `public/js/hotel.js` (the width follows each image's shape) |
| Where pictures can go in the lobby (and in what order) | `LOBBY_SPOTS` at the top of `public/js/hotel.js` |
| Where they go in the corridor | `hangPictures()` in `public/js/hotel.js`: first across from each door, then in between |
| Frame colour | `pictureMat` in the `Hotel` constructor in `public/js/hotel.js` |

**Empty frames:** every spot along the corridor that doesn't have one of your pictures gets an empty frame (across from each door and between doors), so more appear as the corridor grows. Press **E** at one to hang an image in it. Those are saved as `hall-1`, `hall-2`… (by position: hall-1 is 4 m down the corridor, hall-2 8 m…). Empty-frame colour: `0xf2efe6` in `addPicture()` in `public/js/hotel.js`.

**Anyone can change a picture:** walk up to a frame and press **E** (USE on phones), then pick an image. It replaces that picture for everyone, live, and stays (it's saved in the database, table `wall_pictures`). The frame resizes to the new image's shape.
- **Put the original back:** in the Neon SQL editor, `DELETE FROM wall_pictures WHERE slot = 'assets/DomBed.jpg';` (or `DELETE FROM wall_pictures;` for all of them).
- The upload endpoint is `POST /api/wall-image` in `server/index.js` (same size limit and spam limit as replies).

Not shown in demo mode (`npx serve public`), because there's no server there to list the folder.

---

## The lever (lobby)

On the lobby's back wall, just behind where you spawn. Hovering shows only **E**. Flipping it gives **every picture frame** (the photos and all hallway frames, empty ones too) a random image or `.obj` from everything uploaded to the database. Every frame first spins like a slot-machine reel and the reels stop one after another. Images show as normal pictures. An `.obj` floats in front of a blank card, scaled down to fit, slowly spinning. It's saved, everyone sees it live, and their lever flips too.

| What | Where |
|---|---|
| Lever position / swing | `LEVER` at the top of `public/js/hotel.js`, the model in `buildLever()` |
| Reel timing (spin length, stagger between frames, how many turns) | `SLOTS` at the top of `public/js/hotel.js`; the animation is `startSlots()` / `updateSlots()` |
| Size / distance / spin of an `.obj` in a frame | `PICTURE_MODEL` at the top of `public/js/hotel.js` |
| Which uploads it picks from | `shuffleWallPictures()` in `server/db.js` (images and `.obj` files) |
| Put a frame back to its original | same as above: `DELETE FROM wall_pictures WHERE slot = '...';` |

---

## Database clean-up (staying under the size limit)

Everything uploaded (images, 3D models, room scans, replaced wall pictures) is stored in the database. `server/prune.js` keeps it under the limit:

- When the database reaches **950 MB**, data is deleted until the live data is down to **850 MB**: first **room scans over 25 MB** (oldest first), then **every upload oldest-first** by upload date only (no preference for big files).
- Before a new room scan is stored, the same deleting makes room for it (it must fit under 950 MB). If it can't, the upload is refused with "Not enough storage left".
- Deleting an upload also removes its image/model reply, a wall frame's replacement (the frame shows its original picture again) and a room scan (the room becomes a normal room). Text replies stay.
- Only if there are no uploads left and it's still too big are the oldest threads deleted.
- It checks at startup, every hour, and about a minute after each upload. Each clean-up shows in the Render logs as `[prune] ...`.

| What | Where |
|---|---|
| The numbers (950 / 850 / big scan = 25 MB) | `PRUNE_AT_MB` / `PRUNE_TO_MB` / `BIG_SCAN_MB` at the top of `server/prune.js`, or set them as environment variables in Render (no code change needed) |
| What gets deleted with an upload | `deleteUpload()` in `server/prune.js` |

---

## The gun

Click (or **F**, hold it to spray) on a computer, **FIRE** on a phone. No ammo, no cooldown. A ball that hits another player launches them.

| What | Where |
|---|---|
| Ball speed, size, how long balls last, how hard a hit launches people (`PUSH` sideways, `LIFT` upwards), colour | `GUN` at the top of `public/js/gun.js` |
| The gun model in your hand (placeholder boxes) | the `// PLACEHOLDER gun model` part of the `Gun` constructor in `public/js/gun.js` |
| Gravity / bouncing while flying after a hit | `GRAVITY` at the top of `public/js/player.js`, and `updateKnock()` |
| Server spam limit for messages (positions + shots) | `MAX_MSGS_PER_SEC` at the top of `server/multiplayer.js` |

---

## Phone / tablet controls

Turned on automatically on touch screens. Add `?touch=1` to the address to try them on a computer (narrow the browser window or use the browser's device mode), or `?touch=0` to force them off.

| What | Where |
|---|---|
| ✕ / ⌨ buttons while sitting at a computer (phones only) | `<div id="seat-touch">` in `public/index.html`, `#seat-touch` in `public/style.css` |
| Keeping the keyboard open / the screen above it | `fitView()` and the seated `pointerdown` / `pointerup` handlers in `public/js/main.js` |
| Joystick, FIRE / USE buttons: look and position | `public/style.css`, the `Touch controls` section at the bottom |
| Look sensitivity, joystick size | `LOOK_SPEED`, `STICK_RADIUS` at the top of `public/js/touch.js` |

---

## Other things you'll probably want to change

| What | Where |
|---|---|
| Thread title signs above the doors | `buildShell()` in `public/js/room.js`, the `addSign(... labelTexture(this.thread.thread_title) ...)` line |
| Wall / floor / ceiling / furniture colours (placeholder grid textures) | `createMaterials()` in `public/js/materials.js` |
| How a reply looks on the wall | `replyPanelTexture()` in `public/js/textures.js` |
| Spacing of replies along the wall, and how fast rooms get longer | constants at the top of `public/js/room.js` (`SPACING`, `FIRST_Z`, `PANEL_Y`, …) and `roomDepth()` |
| Image cube size / how far it floats from the wall / gap between several cubes | `CUBE_SIZE`, `CUBE_OUT`, `CUBE_STEP` at the top of `public/js/room.js` |
| Which board an image floats in front of / when it gets its own board | `replyLayout()` in `public/js/room.js` |
| How the image wraps around the cube | `wrappedCubeGeometry()` at the bottom of `public/js/room.js` |
| The computer (desk, chair, screen) in rooms and lobby | `buildComputerDesk()` in `public/js/computer.js`. To use your own `.glb` model, see the README |
| What the computer screens show | `public/js/terminal.js` (`drawReply`, `drawThreadForm`) and the idle screens: `drawScreenIdle()` in `public/js/room.js`, and `lobbyStation` in `public/js/hotel.js` |
| Lobby size / layout | `LOBBY` at the top of `public/js/hotel.js`, and `buildCorridor()` |
| Menus, HUD, the "E" prompt (deliberately just the key, no description) | `public/style.css` (`#prompt`) and `public/index.html`. The text is set in the game loop in `public/js/main.js` |
| Walk / run speed, eye height | `public/js/config.js` |
| Other players (the pill): size, colour, how often positions are sent | top of `public/js/net.js` (`PILL_RADIUS`, `PILL_HEIGHT`, `SEND_EVERY`) and `pillMaterial` in its constructor |
| Max image size, spam limit | top of `server/index.js` (`MAX_IMAGE_BYTES`, `WRITES_PER_MINUTE`) |
