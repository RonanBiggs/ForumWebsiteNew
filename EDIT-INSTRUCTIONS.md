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
- **POST** / **CREATE THREAD** (bottom right) sends. **EXIT** (top right) stands you up (so does Esc).
- **ATTACH IMAGE** (bottom left on reply screens) or the **IMAGE** line (new-thread screen) opens the file picker. You can also **paste an image** (Ctrl+V / Cmd+V).
- Allowed images: PNG, JPG, GIF, WEBP. Transparent parts of a PNG / WEBP are see-through on its image cube.

| What | Where |
|---|---|
| Clickable areas and the buttons' size/position on the screen | `BUTTON`, `ATTACH`, `EXIT` and `AREAS` at the top of `public/js/terminal.js` (in screen pixels, 1024 × 768) |
| Allowed image types | `imageFromUpload()` in `server/index.js` (checks the file's real contents), `IMAGE_TYPES` in `public/js/terminal.js`, `accept=` on `#file-input` in `public/index.html` |
| Image cube see-through cut-off | `alphaTest` on the cube material in `addReplyObjects()` in `public/js/room.js` (higher = more gets cut out) |
| How the screens are drawn | `drawReply()`, `drawThreadForm()`, `drawButton()` in `public/js/terminal.js` |

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
| Which board an image floats in front of (images get no board of their own) | `replyLayout()` in `public/js/room.js` |
| How the image wraps around the cube | `wrappedCubeGeometry()` at the bottom of `public/js/room.js` |
| The computer (desk, chair, screen) in rooms and lobby | `buildComputerDesk()` in `public/js/computer.js`. To use your own `.glb` model, see the README |
| What the computer screens show | `public/js/terminal.js` (`drawReply`, `drawThreadForm`) and the idle screens: `drawScreenIdle()` in `public/js/room.js`, and `lobbyStation` in `public/js/hotel.js` |
| Lobby size / layout | `LOBBY` at the top of `public/js/hotel.js`, and `buildCorridor()` |
| Menus, HUD, the "E" prompt (deliberately just the key, no description) | `public/style.css` (`#prompt`) and `public/index.html`. The text is set in the game loop in `public/js/main.js` |
| Walk / run speed, eye height | `public/js/config.js` |
| Other players (the pill): size, colour, how often positions are sent | top of `public/js/net.js` (`PILL_RADIUS`, `PILL_HEIGHT`, `SEND_EVERY`) and `pillMaterial` in its constructor |
| Max image size, spam limit | top of `server/index.js` (`MAX_IMAGE_BYTES`, `WRITES_PER_MINUTE`) |
